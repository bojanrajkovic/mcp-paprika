import { describe, expect, it } from "vitest";

import { FAVICON_PATH } from "../utils/branding.js";
import { buildFaviconRouter } from "./favicon.js";

describe("favicon route", () => {
  it("serves a PNG at FAVICON_PATH with image/png and a cache header", async () => {
    const res = await buildFaviconRouter().request(FAVICON_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("max-age");
    const bytes = new Uint8Array(await res.arrayBuffer());
    // PNG magic number — a real rasterized PNG, not a passthrough.
    expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("does not handle other paths", async () => {
    const res = await buildFaviconRouter().request("/elsewhere");
    expect(res.status).toBe(404);
  });
});
