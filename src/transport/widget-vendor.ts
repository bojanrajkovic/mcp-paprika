import { Hono } from "hono";
import type { Logger } from "pino";

import { loadVendorBytes, widgetsDir } from "../features/widgets/artifacts.js";

/**
 * Serves the ONE shared, content-hashed widget vendor module (`@modelcontextprotocol/ext-apps` +
 * the MCP SDK + zod) the HTTP transport externalizes (ADR-0025). A served widget's import map points
 * `@modelcontextprotocol/ext-apps` at `GET /widgets/vendor-<hash>.js` here; the host's iframe fetches
 * it ONCE and `immutable`-caches it across every widget and session.
 *
 * Unauthenticated, mounted BEFORE the `/mcp` bearer guard (favicon-style): the iframe fetches it with
 * no bearer token, and it carries no secret (just ext-apps' public runtime). The route exact-matches
 * the content-hashed filename and 404s anything else — no path traversal, no arbitrary `dist/` read.
 *
 * Compression is pre-built (brotli-11 + gzip at `pnpm build:widgets`), so the route negotiates on
 * `Accept-Encoding` and serves ~60 KB (br) with zero per-request CPU. The bytes load ONCE at
 * construction (the file is immutable); a missing vendor file degrades to an all-404 router, matching
 * the empty-artifacts degrade in {@link loadWidgetArtifacts}.
 */
export async function buildWidgetVendorRouter(log: Logger, opts: { readonly dir?: string } = {}): Promise<Hono> {
  const dir = opts.dir ?? widgetsDir();
  const vendor = await loadVendorBytes(dir);
  const app = new Hono();

  if (vendor === null) {
    log.warn({ dir }, "no widget vendor file; /widgets vendor route will 404 (run pnpm build:widgets)");
    return app;
  }

  // Content-hashed → safe to cache for a year and never revalidate; the hash changes when ext-apps does.
  const headers = (encoding?: string): Record<string, string> => ({
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "public, max-age=31536000, immutable",
    vary: "accept-encoding",
    // A classic cross-origin `<script src>` needs no CORS, but the header is free insurance if a host
    // ever loads the import-map target as a module (which would) — and matches the S0 CSP note.
    "access-control-allow-origin": "*",
    ...(encoding !== undefined && { "content-encoding": encoding }),
  });

  app.get("/widgets/:file", (c) => {
    if (c.req.param("file") !== vendor.filename) return c.notFound();
    const accept = c.req.header("accept-encoding") ?? "";
    // ponytail: token presence, not q-values — browsers send `gzip, deflate, br` without `q=0` refusals.
    if (vendor.brotli !== null && /\bbr\b/.test(accept)) return c.body(vendor.brotli, 200, headers("br"));
    if (vendor.gzip !== null && /\bgzip\b/.test(accept)) return c.body(vendor.gzip, 200, headers("gzip"));
    return c.body(vendor.raw, 200, headers());
  });

  return app;
}
