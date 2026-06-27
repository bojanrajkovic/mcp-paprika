import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Logger } from "pino";

import { EXT_APPS_SPECIFIER } from "./shared/server-caps-key.js";

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

/** Locate the single content-hashed vendor module the build emits (`vendor-<hash>.js`), if present. */
async function findVendorFile(dir: string): Promise<string | null> {
  const files = await readdir(dir).catch(() => [] as string[]);
  return files.find((f) => /^vendor-[0-9a-f]+\.js$/.test(f)) ?? null;
}

/** The `<script type="importmap">` that points the bare ext-apps specifier at `target`. */
function importMapScript(target: string): string {
  return `<script type="importmap">${JSON.stringify({ imports: { [EXT_APPS_SPECIFIER]: target } })}</script>`;
}

/**
 * How a served widget's HTML resolves its externalized ext-apps runtime (ADR-0025): the
 * `<script type="importmap">` injected into `WIDGET_VENDOR_SLOT`, plus the `_meta.ui.csp` value (when
 * the runtime is a cross-origin URL the host must allowlist).
 */
export interface VendorImportMap {
  /** The full `<script type="importmap">…</script>` for the vendor slot. */
  readonly importMap: string;
  /** `_meta.ui.csp` for the served content item — present only when the vendor is a self-hosted URL (HTTP). */
  readonly csp: { readonly resourceDomains: readonly string[] } | undefined;
}

/**
 * Build the import map a `resources/read` injects, transport-conditionally (ADR-0025):
 *
 * - **HTTP** (`publicUrl` set) — point the specifier at the self-hosted, `immutable`-cached
 *   `{origin}/widgets/vendor-<hash>.js` (served by {@link buildWidgetVendorRouter}), and allowlist
 *   that origin via `_meta.ui.csp.resourceDomains` so the host's iframe CSP admits it under `script-src`.
 * - **stdio** (no `publicUrl`) — no HTTP server on a local pipe, so inline the vendor bytes as a
 *   `data:` URL module: self-contained and offline-capable, exactly like the old inlined runtime.
 *   No `csp` (a `data:` URL needs no origin allowlist).
 *
 * Returns `null` when no vendor file is present (degrades with the rest of the widget surface).
 */
export async function loadVendorImportMap(
  dir: string,
  publicUrl: string | undefined,
  log: Logger,
): Promise<VendorImportMap | null> {
  const filename = await findVendorFile(dir);
  if (filename === null) {
    log.warn({ dir }, "no widget vendor file found; widgets will not resolve the ext-apps runtime");
    return null;
  }
  if (publicUrl !== undefined) {
    // Build the URL from the FULL publicUrl (trailing-slash-stripped at parse), like the OAuth routes'
    // `${publicUrl}/oauth/callback` — so a path-prefixed deployment (`https://host/paprika`) resolves
    // through the proxy prefix. The CSP source must be a bare ORIGIN (scheme+host+port), so resolve
    // that separately; the browser's fetch origin matches it regardless of any path.
    return {
      importMap: importMapScript(`${publicUrl}/widgets/${filename}`),
      csp: { resourceDomains: [new URL(publicUrl).origin] },
    };
  }
  const bytes = await readFile(join(dir, filename));
  return { importMap: importMapScript(`data:text/javascript;base64,${bytes.toString("base64")}`), csp: undefined };
}

/** The vendor module's bytes and its content-hashed filename, with the pre-built brotli/gzip variants. */
export interface VendorBytes {
  readonly filename: string;
  readonly raw: Uint8Array<ArrayBuffer>;
  readonly gzip: Uint8Array<ArrayBuffer> | null;
  readonly brotli: Uint8Array<ArrayBuffer> | null;
}

/** Copy a Node `Buffer` into a plain-`ArrayBuffer`-backed `Uint8Array` (what Hono's `c.body` accepts). */
function toBytes(buf: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
}

/**
 * Load the self-hosted vendor module and its pre-compressed siblings for the HTTP route
 * ({@link buildWidgetVendorRouter}). Returns `null` when no vendor file is present (the route then
 * 404s, mirroring the empty-artifacts degrade). The `.gz`/`.br` are best-effort: a missing variant
 * just narrows what the route can serve, never fails the load.
 */
export async function loadVendorBytes(dir: string): Promise<VendorBytes | null> {
  const filename = await findVendorFile(dir);
  if (filename === null) return null;
  const [raw, gzip, brotli] = await Promise.all([
    readFile(join(dir, filename)),
    readFile(join(dir, `${filename}.gz`)).catch(() => null),
    readFile(join(dir, `${filename}.br`)).catch(() => null),
  ]);
  return { filename, raw: toBytes(raw), gzip: gzip && toBytes(gzip), brotli: brotli && toBytes(brotli) };
}
