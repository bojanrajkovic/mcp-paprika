import { isIP } from "node:net";

import type { Context } from "hono";
import { z } from "zod";

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
 * Where the real client IP comes from. `peer`: the socket only — the safe default
 * for a directly-exposed server, where any proxy header is client-forgeable.
 * `header`: a trusted front proxy sets `header` (lowercase), so read it.
 */
export const ClientIpSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("peer") }).readonly(),
  z.object({ kind: z.literal("header"), header: z.string().min(1) }).readonly(),
]);
export type ClientIpSource = z.infer<typeof ClientIpSourceSchema>;

/** The socket-only source: no front proxy is trusted. */
export const PEER_CLIENT_IP: ClientIpSource = { kind: "peer" };

/** The header a trusted proxy is assumed to set when `MCP_CLIENT_IP_HEADER` is unset. */
export const DEFAULT_CLIENT_IP_HEADER = "x-forwarded-for";

/**
 * The source for `MCP_TRUST_PROXY` + `MCP_CLIENT_IP_HEADER`. Without trust, every
 * header is client-forgeable, so the socket is the only answer whatever `header` is.
 */
export function clientIpSource(trustProxy: boolean, header: string | undefined): ClientIpSource {
  return trustProxy ? { kind: "header", header: header ?? DEFAULT_CLIENT_IP_HEADER } : PEER_CLIENT_IP;
}

/**
 * The real client IP. In `header` mode, the rightmost comma-separated entry of the
 * configured header: an appending proxy (`x-forwarded-for` behind most proxies)
 * adds the address it saw last, while every entry to its left came from the
 * client and can be forged. For a single-value header (`cf-connecting-ip`,
 * `fly-client-ip`) the rightmost entry is the whole value. A port is dropped, so
 * a per-connection source port can't mint a fresh rate-limit key. A missing,
 * empty, or non-IP entry falls back to the socket peer. `null` when nothing
 * resolves — no usable header AND no socket.
 */
export function clientAddress(c: Context, source: ClientIpSource): string | null {
  if (source.kind === "header") {
    const entry = c.req.header(source.header)?.split(",").at(-1)?.trim();
    const ip = entry === undefined ? null : ipOf(entry);
    if (ip !== null) return ip;
  }
  return peerAddress(c);
}

const BRACKETED_IPV6 = /^\[([^\]]+)\](?::\d+)?$/;
const IPV4_WITH_PORT = /^([\d.]+):\d+$/;

/** The IP in a proxy-header entry, minus any port (`1.2.3.4:5678`, `[2001:db8::1]:443`); `null` if it isn't one. */
function ipOf(entry: string): string | null {
  const host = BRACKETED_IPV6.exec(entry)?.[1] ?? IPV4_WITH_PORT.exec(entry)?.[1] ?? entry;
  return isIP(host) === 0 ? null : host;
}
