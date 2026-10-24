import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { clientAddress, type ClientIpSource, clientIpSource, PEER_CLIENT_IP } from "./client-ip.js";

const PEER: ClientIpSource = { kind: "peer" };
const XFF: ClientIpSource = { kind: "header", header: "x-forwarded-for" };
const CF: ClientIpSource = { kind: "header", header: "cf-connecting-ip" };

/** Resolve the client address for one request, with `peer` as the socket's remote address. */
async function resolve(source: ClientIpSource, headers: Record<string, string>, peer?: string): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.text(clientAddress(c, source) ?? "<none>"));
  const env = peer === undefined ? undefined : { incoming: { socket: { remoteAddress: peer } } };
  const res = await app.request("/", { headers }, env);
  return res.text();
}

describe("clientAddress", () => {
  it("peer mode ignores every proxy header and reads the socket", async () => {
    await expect(
      resolve(PEER, { "x-forwarded-for": "203.0.113.5", "cf-connecting-ip": "203.0.113.6" }, "10.0.0.1"),
    ).resolves.toBe("10.0.0.1");
  });

  it("takes the rightmost x-forwarded-for entry, so a client-forged leftmost entry is ignored", async () => {
    // An appending proxy turns a forged "1.2.3.4" into "1.2.3.4, <real client>".
    await expect(resolve(XFF, { "x-forwarded-for": "1.2.3.4, 203.0.113.5" })).resolves.toBe("203.0.113.5");
  });

  it("trims whitespace around the entry", async () => {
    await expect(resolve(XFF, { "x-forwarded-for": "1.2.3.4 ,  203.0.113.5  " })).resolves.toBe("203.0.113.5");
  });

  it("reads only the configured header", async () => {
    await expect(resolve(CF, { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" })).resolves.toBe(
      "203.0.113.7",
    );
  });

  it("falls back to the socket peer when the configured header is missing or empty", async () => {
    await expect(resolve(XFF, {}, "10.0.0.2")).resolves.toBe("10.0.0.2");
    await expect(resolve(XFF, { "x-forwarded-for": " , " }, "10.0.0.2")).resolves.toBe("10.0.0.2");
  });

  it("returns null when neither the header nor a socket resolves", async () => {
    await expect(resolve(XFF, {})).resolves.toBe("<none>");
  });

  it("drops a port, so a per-connection source port can't mint a fresh key", async () => {
    await expect(resolve(XFF, { "x-forwarded-for": "203.0.113.5:51234" })).resolves.toBe("203.0.113.5");
    await expect(resolve(XFF, { "x-forwarded-for": "[2001:db8::1]:443" })).resolves.toBe("2001:db8::1");
  });

  it("accepts a bare IPv6 entry", async () => {
    await expect(resolve(XFF, { "x-forwarded-for": "198.51.100.1, 2001:db8::1" })).resolves.toBe("2001:db8::1");
  });

  it("falls back to the socket peer when the entry isn't an IP", async () => {
    await expect(resolve(XFF, { "x-forwarded-for": "unknown" }, "10.0.0.3")).resolves.toBe("10.0.0.3");
  });
});

describe("clientIpSource", () => {
  it("is the socket without trust, whatever header is configured", () => {
    expect(clientIpSource(false, undefined)).toEqual(PEER_CLIENT_IP);
    expect(clientIpSource(false, "cf-connecting-ip")).toEqual(PEER_CLIENT_IP);
  });

  it("reads x-forwarded-for when trusted with no header configured", () => {
    expect(clientIpSource(true, undefined)).toEqual(XFF);
  });

  it("reads the configured header when trusted", () => {
    expect(clientIpSource(true, "cf-connecting-ip")).toEqual(CF);
  });
});
