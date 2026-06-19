import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Logger } from "pino";

/**
 * The directory holding the built `<name>.html` widgets, resolved from
 * `import.meta.url` so ONE computation works from both runtime layouts:
 *
 * - the built tree — `dist/features/widgets/artifacts.js`
 * - a tsx dev run  — `src/features/widgets/artifacts.ts`
 *
 * Both sit exactly three levels below the repo root, so `../../..` is the root in
 * either case, and the built widgets always live at `<root>/dist/widgets`. From
 * the built tree that is the natural sibling; from a dev run it points at the
 * repo's `dist/widgets`, which may be stale or absent (handled by degrading, see
 * {@link loadWidgetArtifacts}).
 */
export function widgetsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(resolve(here, "../../.."), "dist", "widgets");
}

/**
 * Load every built widget's HTML into an in-memory `name → html` map, read ONCE
 * at module construction so resource reads are pure memory lookups (never disk).
 *
 * A missing or empty directory DEGRADES — a warning plus an empty map — rather
 * than throwing: the kernel constructs every module regardless of transport, so a
 * hard failure here would brick the stdio transport and any dev server that has
 * not run `pnpm build:widgets`. The hard "widgets must exist" assertion lives in
 * CI (a `--prod` boot that serves a widget), not at every boot. A host that asks
 * for a widget that was not built gets a clean not-found from the resource.
 */
export async function loadWidgetArtifacts(dir: string, log: Logger): Promise<ReadonlyMap<string, string>> {
  let htmlFiles: readonly string[];
  try {
    htmlFiles = (await readdir(dir)).filter((name) => name.endsWith(".html"));
  } catch {
    log.warn(
      { dir },
      "widget artifact directory not found; widget resources will serve nothing (run pnpm build:widgets)",
    );
    return new Map();
  }
  if (htmlFiles.length === 0) {
    log.warn({ dir }, "no built widgets found; widget resources will serve nothing (run pnpm build:widgets)");
    return new Map();
  }
  const entries = await Promise.all(
    htmlFiles.map(async (file) => [file.replace(/\.html$/, ""), await readFile(join(dir, file), "utf8")] as const),
  );
  log.info({ count: entries.length }, "loaded widget artifacts");
  return new Map(entries);
}
