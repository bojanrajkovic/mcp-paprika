import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { makeThumbnail } from "./image.js";

describe("makeThumbnail", () => {
  it("produces a ~280px JPEG thumbnail preserving aspect ratio", async () => {
    const png = await sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 9, g: 8, b: 7 } } })
      .png()
      .toBuffer();

    const thumb = await makeThumbnail(png);

    const meta = await sharp(thumb).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(280);
    // 1000x500 (2:1) → 280x140, aspect preserved.
    expect(meta.width).toBe(280);
    expect(meta.height).toBe(140);
  });
});
