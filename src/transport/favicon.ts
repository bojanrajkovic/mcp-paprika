import { Hono } from "hono";

import { FAVICON_PATH, iconPng } from "../utils/branding.js";

/**
 * A Hono router that serves the connector icon PNG at {@link FAVICON_PATH}.
 *
 * Mount this on the HTTP app *before* the `/mcp` bearer guard (and outside the
 * `app.auth` block) so it stays unauthenticated: Claude's connector flow fetches
 * the icon before the user authenticates, and the OAuth authorization-server
 * metadata `logo_uri` points here. The bytes are rasterized once and memoized in
 * `src/utils/branding.ts`.
 */
export function buildFaviconRouter(): Hono {
  const app = new Hono();
  app.get(FAVICON_PATH, async () => {
    const png = await iconPng();
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  });
  return app;
}
