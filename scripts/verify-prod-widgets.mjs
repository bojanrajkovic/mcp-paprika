// Verify that widgets still build-and-serve with PRODUCTION-only dependencies —
// run in CI after `pnpm build` then `pnpm prune --prod` (ADR-0019 C1, risk g).
//
// The build toolchain (esbuild, esbuild-svelte, svelte) and the apps SDK
// (@modelcontextprotocol/ext-apps) are build-time-only devDependencies: the
// server reads the finished widget HTML as a string and nothing on the runtime
// path may import them, or the container (which ships prod-only deps) crashes.
// This is the mechanical proof — it runs as plain node (no tsx; that is pruned
// too) against the built `dist/`, after devDependencies are gone.
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_WIDGETS = join(ROOT, "dist", "widgets");

function fail(message) {
  process.stderr.write(`verify-prod-widgets FAILED: ${message}\n`);
  process.exit(1);
}

// 1. The build produced a self-contained demo widget.
let demo;
try {
  demo = await readFile(join(DIST_WIDGETS, "demo.html"), "utf8");
} catch (err) {
  fail(`could not read dist/widgets/demo.html — did \`pnpm build\` run? (${String(err)})`);
}
if (demo.length < 1000) fail(`dist/widgets/demo.html is suspiciously small (${demo.length} bytes)`);
if (!demo.includes("globalThis.ExtApps")) fail("dist/widgets/demo.html is missing the inlined ext-apps runtime");

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

// 3. The runtime loader reads the built widgets with no build toolchain present.
const silent = {
  warn() {},
  info() {},
  child() {
    return silent;
  },
};
const widgets = await loadWidgetArtifacts(DIST_WIDGETS, silent);
if (!widgets.has("demo")) fail("loadWidgetArtifacts did not load the demo widget from dist/widgets");

process.stdout.write(`verify-prod-widgets OK: prod-only deps serve [${[...widgets.keys()].join(", ")}]\n`);
