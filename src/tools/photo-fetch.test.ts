import { describe, it, expect } from "vitest";
import { MockAgent } from "undici";
import { fetchImageBytes } from "./photo-fetch.js";

// These tests drive the REAL undici fetch + dispatcher path (via a MockAgent),
// not a mocked global `fetch`. That matters: the SSRF fetch failed in prod with
// UND_ERR_INVALID_ARG because an undici Agent was passed to Node's *built-in*
// global fetch (a different undici copy). A msw/global-fetch mock never engages
// the dispatcher, so it can't catch that class of bug — these can.

describe("fetchImageBytes", () => {
  it("downloads through the undici dispatcher and returns bytes + content-type", async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const mock = new MockAgent();
    mock.disableNetConnect();
    mock
      .get("https://images.example")
      .intercept({ path: "/p.jpg" })
      .reply(200, bytes, {
        headers: { "content-type": "image/jpeg" },
      });

    const r = await fetchImageBytes("https://images.example/p.jpg", { dispatcher: mock });

    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.bytes.equals(bytes)).toBe(true);
      expect(r.contentType).toBe("image/jpeg");
    }
    await mock.close();
  });

  it("surfaces a non-2xx response as an error", async () => {
    const mock = new MockAgent();
    mock.get("https://images.example").intercept({ path: "/missing.jpg" }).reply(404, "nope");
    const r = await fetchImageBytes("https://images.example/missing.jpg", { dispatcher: mock });
    expect(r).toEqual({ error: expect.stringContaining("HTTP 404") });
    await mock.close();
  });

  it("enforces the size cap by streaming (aborts past maxBytes)", async () => {
    const mock = new MockAgent();
    mock.get("https://images.example").intercept({ path: "/big.jpg" }).reply(200, Buffer.alloc(5000));
    const r = await fetchImageBytes("https://images.example/big.jpg", { maxBytes: 1024, dispatcher: mock });
    expect(r).toEqual({ error: expect.stringContaining("too large") });
    await mock.close();
  });

  it("rejects a non-http(s) scheme before any fetch", async () => {
    const r = await fetchImageBytes("file:///etc/passwd");
    expect(r).toEqual({ error: expect.stringContaining("http(s)") });
  });

  it("rejects an invalid URL", async () => {
    const r = await fetchImageBytes("not a url");
    expect(r).toEqual({ error: expect.stringContaining("Invalid url") });
  });

  it("blocks a private/loopback IP-literal host before connecting", async () => {
    // IP-literal hosts are checked up front (they skip DNS), so no dispatcher is engaged.
    for (const u of ["http://127.0.0.1/x.jpg", "http://169.254.169.254/latest/meta-data", "http://[::1]/x.jpg"]) {
      const r = await fetchImageBytes(u);
      expect(r).toEqual({ error: expect.stringContaining("private or reserved") });
    }
  });
});
