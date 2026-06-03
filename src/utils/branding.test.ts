import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { BRANDING, FAVICON_PATH, iconPng, iconSvgDataUri } from "./branding.js";

describe("branding", () => {
  it("exposes a Paprika title and an https project URL", () => {
    expect(BRANDING.title).toBe("Paprika");
    expect(() => new URL(BRANDING.websiteUrl)).not.toThrow();
    expect(new URL(BRANDING.websiteUrl).protocol).toBe("https:");
  });

  it("serves the favicon under a stable path the AS metadata can point at", () => {
    expect(FAVICON_PATH).toBe("/favicon.png");
  });

  describe("iconSvgDataUri", () => {
    it("is a base64 image/svg+xml data URI", () => {
      expect(iconSvgDataUri()).toMatch(/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/);
    });

    it("decodes to the source SVG markup", () => {
      const b64 = iconSvgDataUri().replace("data:image/svg+xml;base64,", "");
      const svg = Buffer.from(b64, "base64").toString("utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain('viewBox="0 0 128 128"');
      expect(svg).toContain("<path"); // the "P" glyph
    });
  });

  describe("iconPng", () => {
    it("rasterizes to a 128×128 PNG", async () => {
      const png = await iconPng();
      // PNG magic number — proves sharp produced a real PNG, not an SVG passthrough.
      expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const meta = await sharp(png).metadata();
      expect(meta.format).toBe("png");
      expect(meta.width).toBe(128);
      expect(meta.height).toBe(128);
    });

    it("memoizes the rasterization across calls", () => {
      // Same promise identity — rasterized once per process, not per call.
      expect(iconPng()).toBe(iconPng());
    });

    it("optically centers the glyph (nudged down-and-right of bbox center)", async () => {
      // A "P" is up-left weighted, so the baked transform offsets it toward the
      // inked centroid; this guards that someone doesn't "fix" it back to plain
      // bounding-box centering (or break the scale). White glyph on the red tile.
      const N = 128;
      const { data } = await sharp(await iconPng())
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let minX = N;
      let maxX = -1;
      let minY = N;
      let maxY = -1;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = (y * N + x) * 4;
          if (data[i + 1]! > 180 && data[i + 2]! > 180) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const left = minX;
      const right = N - 1 - maxX;
      const top = minY;
      const bottom = N - 1 - maxY;
      expect(left).toBeGreaterThan(right); // shifted right
      expect(top).toBeGreaterThan(bottom); // shifted down
      // ...but still near-centered, never shoved to an edge (tolerant of rasterizer drift).
      for (const margin of [left, right, top, bottom]) {
        expect(margin).toBeGreaterThan(20);
        expect(margin).toBeLessThan(50);
      }
    });
  });
});
