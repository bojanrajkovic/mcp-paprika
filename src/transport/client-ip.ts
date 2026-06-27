import type { Context } from "hono";

/**
 * The immediate TCP peer address, read from the `node:http` `IncomingMessage`
 * that `@hono/node-server` attaches to `c.env`. Behind a reverse proxy this is
 * the PROXY's address, not the caller's; directly exposed, it is the caller's.
 * `null` under a Hono adapter that exposes no socket — the in-memory
 * `app.request()` used in tests, or a non-Node adapter.
 */
export function peerAddress(c: Context): string | null {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? null;
}

/**
 * The real client IP. With `trustProxy`, honor `x-forwarded-for` (RFC 7239:
 * comma-separated, the leftmost entry is the origin client) then
 * `cf-connecting-ip` — both set only by a trusted front proxy — before falling
 * back to the socket peer. WITHOUT `trustProxy`, only the socket peer is
 * trustworthy: a directly-exposed client can forge those headers, so they are
 * ignored (the same trust model the DCR rate limiter's key derivation uses).
 * `null` when nothing resolves — no proxy headers AND no socket.
 */
export function clientAddress(c: Context, trustProxy: boolean): string | null {
  if (trustProxy) {
    const xForwardedFor = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (xForwardedFor) return xForwardedFor;
    const cf = c.req.header("cf-connecting-ip");
    if (cf) return cf;
  }
  return peerAddress(c);
}
