import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { makeThumbnail, normalizePhoto, sha256Hex } from "./photo-helpers.js";

const isJpeg = (b: Buffer): boolean => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

describe("normalizePhoto", () => {
  it("re-encodes a PNG input to two JPEGs (full + thumbnail)", async () => {
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .png()
      .toBuffer();

    const { thumbnail, full } = await normalizePhoto(png);

    expect(isJpeg(full)).toBe(true);
    expect(isJpeg(thumbnail)).toBe(true);
  });

  it("bounds the thumbnail to ~280px on its longest edge while preserving the full image size", async () => {
    const png = await sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png()
      .toBuffer();

    const { thumbnail, full } = await normalizePhoto(png);

    const thumbMeta = await sharp(thumbnail).metadata();
    const fullMeta = await sharp(full).metadata();
    expect(Math.max(thumbMeta.width ?? 0, thumbMeta.height ?? 0)).toBeLessThanOrEqual(280);
    expect(fullMeta.width).toBe(1000);
    expect(fullMeta.height).toBe(500);
  });

  it("caps the full image's longest edge to maxFullEdge, preserving aspect ratio", async () => {
    // 4096x2048 (2:1) is the kind of oversized output an image-gen model can emit.
    const png = await sharp({ create: { width: 4096, height: 2048, channels: 3, background: { r: 5, g: 6, b: 7 } } })
      .png()
      .toBuffer();

    const { full } = await normalizePhoto(png, { maxFullEdge: 2048 });

    const fullMeta = await sharp(full).metadata();
    expect(fullMeta.width).toBe(2048);
    expect(fullMeta.height).toBe(1024);
  });

  it("does not enlarge a sub-cap image when maxFullEdge is set", async () => {
    const png = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 1, g: 1, b: 1 } } })
      .png()
      .toBuffer();

    const { full } = await normalizePhoto(png, { maxFullEdge: 2048 });

    const fullMeta = await sharp(full).metadata();
    expect(fullMeta.width).toBe(512);
    expect(fullMeta.height).toBe(512);
  });
});

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

describe("sha256Hex", () => {
  it("is deterministic and uppercase hex (the casing Paprika emits)", () => {
    const a = sha256Hex(Buffer.from("paprika"));
    const b = sha256Hex(Buffer.from("paprika"));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9A-F]{64}$/);
  });
});
