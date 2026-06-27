/**
 * Compiles each widget under `src/features/widgets/<name>/` into a `dist/widgets/<name>.html`
 * that the widgets kernel module serves as a `ui://widget/<name>` resource (ADR-0019), plus ONE
 * shared `dist/widgets/vendor-<hash>.js` carrying the `@modelcontextprotocol/ext-apps` browser
 * runtime (ext-apps + the MCP SDK + zod, ~329 KB) for every widget to import (ADR-0025).
 *
 * The vendor is EXTERNAL, not inlined: each widget bundle keeps a bare
 * `import … from "@modelcontextprotocol/ext-apps"` (esbuild `external`), and the served HTML
 * carries an `<script type="importmap">` resolving that specifier — to the self-hosted
 * `vendor-<hash>.js` URL under HTTP (fetched once, `immutable`-cached across all widgets), or to an
 * inline `data:` URL under stdio (no HTTP server on a local pipe). The serving layer fills the
 * `WIDGET_VENDOR_SLOT`; this build only emits the artifacts. ext-apps stays a BUILD-TIME-only
 * devDependency: the value import lives ONLY in the browser bundles esbuild compiles (never the
 * Node runtime path), and the vendor file is its pre-bundled `app-with-deps` copied verbatim.
 *
 * The vendor is content-hashed (so `immutable` caching is correct — the URL changes only when
 * ext-apps changes) and pre-compressed at build (brotli-11 + gzip), so the self-hosted route serves
 * `Content-Encoding`-negotiated bytes (~60 KB br) with zero per-request CPU.
 *
 * Because the vendor lives in its own `<script>`, the widget bundle no longer shares module scope
 * with it, so it is built as **ESM** (the old IIFE existed only to avoid top-level name collisions
 * with the inlined runtime in one shared script) and **fully minified** — env-gated (`MCP_WIDGETS_DEBUG=1`,
 * and off by default under `--watch`) so `pnpm dev:widgets` stays readable for debugging.
 *
 * The build is an esbuild `context` whose `onEnd` plugin wraps each entry's bundled JS in the HTML
 * shell — so the one-shot `buildWidgets()` (a `rebuild()`) and the `--watch` loop (`ctx.watch()`)
 * share the exact same wrapping pipeline. `buildWidgets` is exported and parameterized for tests; the
 * thin CLI tail runs it only when invoked directly (`tsx scripts/build-widgets.ts`).
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliCompressSync, gzipSync, constants as zlibConstants } from "node:zlib";

import type { BuildContext, Plugin } from "esbuild";
import { context } from "esbuild";

import {
  EXT_APPS_SPECIFIER,
  WIDGET_INJECT_SLOT,
  WIDGET_VENDOR_SLOT,
} from "../src/features/widgets/shared/server-caps-key.js";

const require = createRequire(import.meta.url);

// esbuild-svelte ships dual CJS/ESM with no `exports` map, so under nodenext BOTH
// the default import and the namespace resolve to a non-callable shape. Load it via
// require (runtime: CJS `module.exports = sveltePlugin`, a function) and recover the
// plugin factory's type from the package's own default-export type.
const esbuildSvelte = require("esbuild-svelte") as typeof import("esbuild-svelte").default;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_SRC_DIR = join(REPO_ROOT, "src", "features", "widgets");
const DEFAULT_OUT_DIR = join(REPO_ROOT, "dist", "widgets");

export interface BuildWidgetsOptions {
  /** Directory holding the per-widget source subdirs. Defaults to `src/features/widgets`. */
  readonly srcDir?: string;
  /** Directory the `<name>.html` files and the shared `vendor-<hash>.js` are written to. Defaults to `dist/widgets`. */
  readonly outDir?: string;
  /** Minify the widget bundles. Defaults on (`MCP_WIDGETS_DEBUG=1` disables); `watchWidgets` defaults it off. */
  readonly minify?: boolean;
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
 * alive instead. Minification defaults OFF here so `pnpm dev:widgets` is readable.
 */
export async function watchWidgets(options: BuildWidgetsOptions = {}): Promise<BuildContext> {
  const { ctx } = await makeContext({ ...options, minify: options.minify ?? false });
  await ctx.watch();
  return ctx;
}

async function makeContext(options: BuildWidgetsOptions): Promise<{ ctx: BuildContext; names: readonly string[] }> {
  const srcDir = options.srcDir ?? DEFAULT_SRC_DIR;
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const minify = options.minify ?? process.env["MCP_WIDGETS_DEBUG"] !== "1";
  await emitVendor(outDir);
  const names = await discoverWidgets(srcDir);
  const ctx = await context({
    entryPoints: Object.fromEntries(names.map((name) => [name, join(srcDir, name, "main.ts")])),
    bundle: true,
    write: false,
    // ESM, not IIFE: the ext-apps runtime is a SEPARATE `<script>` (the import map's target), so the
    // widget bundle no longer shares module scope with it and an ESM bundle's top-level names can't
    // collide with the runtime's. esbuild keeps the bare `@modelcontextprotocol/ext-apps` import
    // (external) for the import map to resolve at runtime.
    format: "esm",
    external: [EXT_APPS_SPECIFIER],
    minify,
    platform: "browser",
    target: "es2022",
    outdir: outDir,
    logLevel: "silent",
    plugins: [esbuildSvelte({ compilerOptions: { css: "injected" } }), wrapAsHtml(outDir)],
  });
  return { ctx, names };
}

/**
 * An esbuild plugin that, after each build, wraps every entry's bundled JS in the
 * HTML shell and writes `<outDir>/<name>.html`. Runs for both `rebuild()` and the
 * `watch()` loop. esbuild is configured with `write: false`, so the raw `.js` is
 * never emitted — only the finished HTML.
 */
function wrapAsHtml(outDir: string): Plugin {
  return {
    name: "wrap-widget-html",
    setup(build) {
      build.onEnd(async (result) => {
        // One `<name>.js` per entry (css is injected, no sourcemaps). Filter to
        // `.js` so a future extra output (a sourcemap, an asset chunk) is never
        // wrapped into a bogus `<name>.<ext>.html` the resource would then serve.
        const outputs = (result.outputFiles ?? []).filter((file) => file.path.endsWith(".js"));
        if (outputs.length === 0) return;
        await mkdir(outDir, { recursive: true });
        await Promise.all(
          outputs.map((file) => {
            const name = basename(file.path).replace(/\.js$/, "");
            return writeFile(join(outDir, `${name}.html`), renderShell(name, file.text), "utf8");
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
 * Emit the ONE shared vendor file every widget imports: ext-apps' pre-bundled `app-with-deps`
 * (ext-apps + MCP SDK + zod) copied VERBATIM — it is already minified and, being fully bundled
 * (no top-level `import`s), is a self-contained ES module exporting `App` + the host-style helpers.
 *
 * Content-hashed so `immutable` caching is correct (the URL changes only when ext-apps changes), and
 * pre-compressed (brotli-11 + gzip) so the self-hosted route serves `Content-Encoding`-negotiated
 * bytes with no per-request CPU. Stale `vendor-*.js*` from an earlier ext-apps version is cleared
 * first so the serving layer finds exactly one vendor file. Returns the emitted base filename.
 */
async function emitVendor(outDir: string): Promise<string> {
  const content = await readFile(require.resolve(`${EXT_APPS_SPECIFIER}/app-with-deps`));
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  const base = `vendor-${hash}.js`;
  await mkdir(outDir, { recursive: true });
  for (const file of await readdir(outDir).catch(() => [] as string[])) {
    if (/^vendor-[0-9a-f]+\.js(\.gz|\.br)?$/.test(file) && file !== base && !file.startsWith(`${base}.`)) {
      await rm(join(outDir, file));
    }
  }
  await Promise.all([
    writeFile(join(outDir, base), content),
    writeFile(join(outDir, `${base}.gz`), gzipSync(content, { level: 9 })),
    writeFile(
      join(outDir, `${base}.br`),
      brotliCompressSync(content, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }),
    ),
  ]);
  return base;
}

/**
 * Neutralize any literal `</script` in JS being inlined into an HTML `<script>`
 * block: an embedded `</script>` (e.g. inside a string literal in a bundled
 * library) would otherwise terminate the inline script early and break the widget.
 * `<\/script` is identical JS but not an HTML end-tag — the same escape esbuild's
 * and webpack's own HTML inliners apply; the hand-rolled shell must do it too.
 */
function inlineScriptSafe(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script");
}

function renderShell(name: string, widgetBundle: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${name} widget</title>
  </head>
  <body>
    ${WIDGET_INJECT_SLOT}
    <div id="app"></div>
    ${WIDGET_VENDOR_SLOT}
    <script type="module">
${inlineScriptSafe(widgetBundle)}
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
