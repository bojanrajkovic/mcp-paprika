/**
 * Compiles each widget under `src/features/widgets/<name>/` into a single
 * self-contained `dist/widgets/<name>.html` that the widgets kernel module
 * serves as a `ui://widget/<name>` resource (ADR-0019, C1 #324).
 *
 * "Self-contained" is the whole point: the iframe a host renders the widget in
 * is CSP-sandboxed and cannot fetch external scripts, so EVERYTHING is inlined —
 * the widget's bundled JS (Svelte runtime + component + entry), its CSS (Svelte's
 * `css: "injected"`), and the `@modelcontextprotocol/ext-apps` browser runtime.
 * ext-apps ships a pre-bundled `app-with-deps` file ending in `export{…}`; we
 * rewrite that tail to `globalThis.ExtApps = {…}` (the build-mcp-app skill's
 * pattern) and prepend it, so the widget reads `globalThis.ExtApps.App` instead
 * of importing the package. That keeps ext-apps a BUILD-TIME-only devDependency:
 * the runtime reads the finished HTML as a string and never imports it, so
 * `pnpm install --prod` can omit ext-apps/esbuild/svelte entirely.
 *
 * The build is an esbuild `context` whose `onEnd` plugin wraps each entry's
 * bundled JS in the HTML shell — so the one-shot `buildWidgets()` (a `rebuild()`)
 * and the `--watch` loop (`ctx.watch()`) share the exact same wrapping pipeline.
 * `buildWidgets` is exported and parameterized for tests; the thin CLI tail runs
 * it only when invoked directly (`tsx scripts/build-widgets.ts`).
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { BuildContext, Plugin } from "esbuild";
import { context } from "esbuild";
import esbuildSvelte from "esbuild-svelte";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_SRC_DIR = join(REPO_ROOT, "src", "features", "widgets");
const DEFAULT_OUT_DIR = join(REPO_ROOT, "dist", "widgets");

export interface BuildWidgetsOptions {
  /** Directory holding the per-widget source subdirs. Defaults to `src/features/widgets`. */
  readonly srcDir?: string;
  /** Directory the self-contained `<name>.html` files are written to. Defaults to `dist/widgets`. */
  readonly outDir?: string;
}

/** Build every widget once and return the built widget names. */
export async function buildWidgets(options: BuildWidgetsOptions = {}): Promise<readonly string[]> {
  const { ctx, names } = await makeContext(options);
  try {
    await ctx.rebuild();
    return names;
  } finally {
    await ctx.dispose();
  }
}

/**
 * Build every widget, then watch the source tree and rebuild on change. Returns
 * the live context so a caller can `dispose()` it; the CLI keeps the process
 * alive instead.
 */
export async function watchWidgets(options: BuildWidgetsOptions = {}): Promise<BuildContext> {
  const { ctx } = await makeContext(options);
  await ctx.watch();
  return ctx;
}

async function makeContext(options: BuildWidgetsOptions): Promise<{ ctx: BuildContext; names: readonly string[] }> {
  const srcDir = options.srcDir ?? DEFAULT_SRC_DIR;
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const extAppsBundle = await loadExtAppsBundle();
  const names = await discoverWidgets(srcDir);
  const ctx = await context({
    entryPoints: Object.fromEntries(names.map((name) => [name, join(srcDir, name, "main.ts")])),
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outdir: outDir,
    logLevel: "silent",
    plugins: [esbuildSvelte({ compilerOptions: { css: "injected" } }), wrapAsHtml(outDir, extAppsBundle)],
  });
  return { ctx, names };
}

/**
 * An esbuild plugin that, after each build, wraps every entry's bundled JS in the
 * HTML shell and writes `<outDir>/<name>.html`. Runs for both `rebuild()` and the
 * `watch()` loop. esbuild is configured with `write: false`, so the raw `.js` is
 * never emitted — only the finished HTML.
 */
function wrapAsHtml(outDir: string, extAppsBundle: string): Plugin {
  return {
    name: "wrap-widget-html",
    setup(build) {
      build.onEnd(async (result) => {
        const outputs = result.outputFiles ?? [];
        if (outputs.length === 0) return;
        await mkdir(outDir, { recursive: true });
        await Promise.all(
          outputs.map((file) => {
            const name = basename(file.path).replace(/\.js$/, "");
            return writeFile(join(outDir, `${name}.html`), renderShell(name, extAppsBundle, file.text), "utf8");
          }),
        );
      });
    },
  };
}

/** Enumerate widget source dirs: a direct subdir of `srcDir` containing a `main.ts`. */
async function discoverWidgets(srcDir: string): Promise<readonly string[]> {
  const entries = await readdir(srcDir, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const main = await readFile(join(srcDir, entry.name, "main.ts"), "utf8").then(
      () => true,
      () => false,
    );
    if (main) names.push(entry.name);
  }
  return names.sort();
}

/**
 * Read ext-apps' pre-bundled browser runtime and rewrite its trailing
 * `export{ local as Exported, … }` into `globalThis.ExtApps ??= { Exported: local, … }`
 * so it can be inlined ahead of the widget bundle and read via `globalThis.ExtApps`.
 *
 * The assignment is NULLISH (`??=`), not plain `=`: in production nothing has set
 * `globalThis.ExtApps`, so the real runtime installs normally; under the dev
 * preview route a fake host shim is injected by an earlier classic `<script>` and
 * claims the slot first, so the real runtime no-ops and the shim wins (it would
 * otherwise overwrite the shim and hang waiting for a host that isn't there).
 */
async function loadExtAppsBundle(): Promise<string> {
  const raw = await readFile(require.resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8");
  return raw.replace(/export\s*\{([^}]+)\};?\s*$/, (_match, body: string) => {
    const members = body
      .split(",")
      .map((pair) => {
        const [local, exported] = pair.split(" as ").map((s) => s.trim());
        return `${exported ?? local}:${local}`;
      })
      .join(",");
    return `globalThis.ExtApps??={${members}};`;
  });
}

function renderShell(name: string, extAppsBundle: string, widgetBundle: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${name} widget</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module">
${extAppsBundle}
${widgetBundle}
    </script>
  </body>
</html>
`;
}

/** Run the build when invoked directly (`tsx scripts/build-widgets.ts [--watch]`), not when imported. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fail = (err: unknown): void => {
    process.stderr.write(`build-widgets failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 1;
  };
  if (process.argv.includes("--watch")) {
    watchWidgets().then(() => process.stdout.write("build-widgets: watching for changes…\n"), fail);
  } else {
    buildWidgets().then(
      (names) =>
        process.stdout.write(`build-widgets: built ${names.length.toString()} widget(s): ${names.join(", ")}\n`),
      fail,
    );
  }
}
