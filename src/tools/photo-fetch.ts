import { lookup as dnsLookup } from "node:dns";
import { isIP, type LookupFunction } from "node:net";

import ipaddr from "ipaddr.js";
// IMPORTANT: import `fetch` from undici (NOT the global fetch). The `ssrfAgent`
// dispatcher below is an undici `Agent` from THIS undici copy; passing it to
// Node's built-in global `fetch` (a different bundled undici) fails with
// `UND_ERR_INVALID_ARG: invalid onRequestStart method` because the two undici
// versions have incompatible handler interfaces. Using undici's own `fetch`
// keeps the dispatcher and the fetch on the same copy.
import { Agent, type Dispatcher, fetch as undiciFetch, type Response as UndiciResponse } from "undici";

import { toMessage } from "../utils/log.js";

/** Default cap for a single fetched image. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Default per-request fetch timeout. */
export const FETCH_TIMEOUT_MS = 15_000;

/**
 * True if an IP string (v4 or v6) is one we must never let the server fetch
 * (SSRF guard). Delegates classification to `ipaddr.js` — only `unicast`
 * (public) addresses are allowed; loopback, private, link-local, unique-local,
 * CGNAT, multicast, reserved, etc. are all blocked. IPv4-mapped IPv6 addresses
 * (in either the dotted `::ffff:127.0.0.1` or hex `::ffff:7f00:1` form) are
 * resolved to their embedded IPv4 and classified there, so a mapped loopback
 * can't slip through. Exported for direct unit testing of the classification.
 */
export function isBlockedIp(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return true; // unparseable → block
  }
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) return v6.toIPv4Address().range() !== "unicast";
  }
  return addr.range() !== "unicast";
}

/**
 * A DNS lookup that validates every resolved address against {@link isBlockedIp}
 * and errors BEFORE the socket connects if any is private/reserved. Wired into
 * {@link ssrfAgent} so the SAME resolution is used for validation AND the
 * connection — closing the DNS-rebinding (TOCTOU) gap that a separate pre-check
 * followed by `fetch()` (each doing its own lookup) would leave open.
 */
export const ssrfLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, options, (err, address, family) => {
    if (err !== null) {
      callback(err, "", 0);
      return;
    }
    const addresses = Array.isArray(address) ? address.map((a) => a.address) : [address];
    if (addresses.some((ip) => isBlockedIp(ip))) {
      callback(new Error("Refusing to connect to a private or reserved address (SSRF guard)."), "", 0);
      return;
    }
    callback(null, address, family);
  });
};

/**
 * Shared undici dispatcher whose connector resolves DNS through {@link ssrfLookup},
 * so a fetched URL's connection is pinned to an SSRF-validated address (rebinding-safe).
 */
const ssrfAgent = new Agent({ connect: { lookup: ssrfLookup } });

/** Reads a fetch body into a Buffer, aborting once `maxBytes` is exceeded (streaming, not post-hoc). */
async function readCapped(res: UndiciResponse, maxBytes: number): Promise<{ bytes: Buffer } | { error: string }> {
  const declared = res.headers.get("content-length");
  if (declared !== null && declared !== "" && Number(declared) > maxBytes) {
    return { error: `Image too large (${declared} bytes; max ${maxBytes.toString()}).` };
  }
  const reader = res.body?.getReader();
  if (reader === undefined) return { error: "Empty image response." };
  const chunks: Array<Buffer> = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return { error: `Image too large (exceeds ${maxBytes.toString()} bytes).` };
    }
    chunks.push(Buffer.from(value));
  }
  return { bytes: Buffer.concat(chunks) };
}

/**
 * SSRF-safe image fetch: validates the scheme and any IP-literal host, pins the
 * connection to an SSRF-validated address via {@link ssrfAgent} (DNS-rebinding
 * safe), blocks redirects (a redirect-to-private bypass), bounds the request
 * with a timeout, and streams the body with a hard size cap.
 *
 * Used by BOTH `upload_recipe_photo` (user/LLM-supplied URL) and `generate_recipe_photo`'s
 * restyle path (recipe `photoUrl` from synced data) — neither should be able to
 * make the server reach a private/internal address.
 */
export async function fetchImageBytes(
  url: string,
  opts?: { readonly maxBytes?: number; readonly timeoutMs?: number; readonly dispatcher?: Dispatcher },
): Promise<{ bytes: Buffer; contentType: string | null } | { error: string }> {
  const maxBytes = opts?.maxBytes ?? MAX_IMAGE_BYTES;
  const timeoutMs = opts?.timeoutMs ?? FETCH_TIMEOUT_MS;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: `Invalid url: ${url}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "Only http(s) image URLs are supported." };
  }
  // A bare IP-literal host skips DNS (undici connects directly, bypassing ssrfLookup),
  // so validate it here. Hostnames are validated rebinding-safe by ssrfAgent at connect.
  const literal = parsed.hostname.replace(/^\[(.+)\]$/, "$1");
  if (isIP(literal) !== 0 && isBlockedIp(literal)) {
    return { error: "URL resolves to a private or reserved address; refusing to fetch." };
  }

  let res: UndiciResponse;
  try {
    // `opts.dispatcher` is a test seam (inject an undici MockAgent); production
    // always uses the SSRF-validating ssrfAgent.
    res = await undiciFetch(parsed, {
      dispatcher: opts?.dispatcher ?? ssrfAgent,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { error: `Failed to download image: ${toMessage(e)}` };
  }
  if (!res.ok) return { error: `Failed to download image: HTTP ${res.status.toString()}` };

  const capped = await readCapped(res, maxBytes);
  if ("error" in capped) return capped;
  return { bytes: capped.bytes, contentType: res.headers.get("content-type") };
}
