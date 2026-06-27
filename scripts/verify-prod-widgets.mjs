// Verify that widgets still build-and-serve with PRODUCTION-only dependencies —
// run in CI after `pnpm build` then `pnpm prune --prod` (ADR-0019 C1, risk g).
//
// The build toolchain (esbuild, esbuild-svelte, svelte) and the apps SDK
// (@modelcontextprotocol/ext-apps) are build-time-only devDependencies: the
// server reads the finished widget HTML as a string and nothing on the runtime
// path may import them, or the container (which ships prod-only deps) crashes.
// This is the mechanical proof — it runs as plain node (no tsx; that is pruned
// too) against the built `dist/`, after devDependencies are gone.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_WIDGETS = join(ROOT, "dist", "widgets");

function fail(message) {
  process.stderr.write(`verify-prod-widgets FAILED: ${message}\n`);
  process.exit(1);
}

// 1. The build produced at least one widget that EXTERNALIZES the ext-apps runtime (ADR-0025): each
//    widget keeps a bare import for the serving layer's import map to resolve and must NOT inline the
//    runtime, and exactly one shared, content-hashed vendor module is emitted with its brotli + gzip
//    variants. (Enumerated, not a hardcoded name — survives the widget set changing.)
let allFiles = [];
try {
  allFiles = await readdir(DIST_WIDGETS);
} catch (err) {
  fail(`could not read dist/widgets — did \`pnpm build\` run? (${String(err)})`);
}
const htmlFiles = allFiles.filter((file) => file.endsWith(".html"));
const vendorFiles = allFiles.filter((file) => /^vendor-[0-9a-f]+\.js$/.test(file));
if (htmlFiles.length === 0) fail("dist/widgets contains no built widgets — `pnpm build` produced nothing to serve");
if (vendorFiles.length !== 1) {
  fail(`expected exactly one vendor-<hash>.js in dist/widgets, found ${vendorFiles.length} — the shared runtime`);
}
for (const ext of ["gz", "br"]) {
  if (!allFiles.includes(`${vendorFiles[0]}.${ext}`)) fail(`dist/widgets/${vendorFiles[0]}.${ext} is missing`);
}
for (const file of htmlFiles) {
  const html = await readFile(join(DIST_WIDGETS, file), "utf8");
  if (html.length < 1000) fail(`dist/widgets/${file} is suspiciously small (${html.length} bytes)`);
  if (!html.includes("@modelcontextprotocol/ext-apps")) {
    fail(`dist/widgets/${file} does not import the externalized ext-apps runtime`);
  }
  if (html.includes("globalThis.ExtApps")) {
    fail(`dist/widgets/${file} still inlines the ext-apps runtime (globalThis.ExtApps) — externalization regressed`);
  }
}

// 2. Importing the runtime widget path must NOT pull a pruned devDependency. A
//    leaked value import of esbuild/svelte/ext-apps throws ERR_MODULE_NOT_FOUND
//    here, now that devDependencies are gone. (ext-apps is referenced only
//    type-only in the preview module, so its import must have been erased.)
let loadWidgetArtifacts;
try {
  ({ loadWidgetArtifacts } = await import(join(ROOT, "dist/features/widgets/artifacts.js")));
  await import(join(ROOT, "dist/features/widgets/module.js"));
  await import(join(ROOT, "dist/transport/widget-preview.js"));
} catch (err) {
  fail(
    `a runtime import failed after \`pnpm prune --prod\` — a devDependency leaked onto the runtime path: ${String(err)}`,
  );
}

// 3. The runtime loader reads every built widget with no build toolchain present.
const silent = {
  warn() {},
  info() {},
  child() {
    return silent;
  },
};
const widgets = await loadWidgetArtifacts(DIST_WIDGETS, silent);
if (widgets.size !== htmlFiles.length) {
  fail(`loadWidgetArtifacts loaded ${widgets.size} widget(s), but dist/widgets has ${htmlFiles.length} HTML file(s)`);
}

process.stdout.write(`verify-prod-widgets OK: prod-only deps serve [${[...widgets.keys()].join(", ")}]\n`);
