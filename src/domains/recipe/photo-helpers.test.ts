import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { DEFAULT_PHOTO_MAX_EDGE, normalizePhoto, resizePhotoJpeg, sha256Hex } from "./photo-helpers.js";

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

describe("resizePhotoJpeg", () => {
  const source = (): Promise<Buffer> =>
    sharp({ create: { width: 800, height: 400, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .png()
      .toBuffer();

  it("scales to a requested width, computing height proportionally", async () => {
    const out = await resizePhotoJpeg(await source(), { width: 200 });
    const meta = await sharp(out).metadata();
    expect(isJpeg(out)).toBe(true);
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(100); // 800×400 → width 200 → height 100
  });

  it("scales to a requested height, computing width proportionally", async () => {
    const out = await resizePhotoJpeg(await source(), { height: 100 });
    const meta = await sharp(out).metadata();
    expect(meta.height).toBe(100);
    expect(meta.width).toBe(200);
  });

  it("fits within a width×height box, preserving aspect", async () => {
    const out = await resizePhotoJpeg(await source(), { width: 100, height: 100 });
    const meta = await sharp(out).metadata();
    // 2:1 source fit inside 100×100 → 100×50, never exceeding either bound.
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(50);
  });

  it("caps the longest edge at the default when no dimensions are given", async () => {
    const big = await sharp({ create: { width: 4000, height: 2000, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png()
      .toBuffer();
    const meta = await sharp(await resizePhotoJpeg(big)).metadata();
    expect(meta.width).toBe(DEFAULT_PHOTO_MAX_EDGE);
  });

  it("does not enlarge a source smaller than the requested size", async () => {
    const small = await sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png()
      .toBuffer();
    const meta = await sharp(await resizePhotoJpeg(small, { width: 400 })).metadata();
    expect(meta.width).toBe(40);
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
