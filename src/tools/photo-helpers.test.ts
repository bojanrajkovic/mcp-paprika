import { describe, it, expect, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import sharp from "sharp";

import { makeServerContext } from "../__fixtures__/app-context.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { makePhoto } from "../cache/__fixtures__/photos.js";
import { normalizePhoto, sha256Hex, commitPhotoUpload, commitPhotoDelete } from "./photo-helpers.js";

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
});

describe("sha256Hex", () => {
  it("is deterministic and uppercase hex (the casing Paprika emits)", () => {
    const a = sha256Hex(Buffer.from("paprika"));
    const b = sha256Hex(Buffer.from("paprika"));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe("commitPhotoUpload", () => {
  it("marks both pending BEFORE cache I/O, flushes once, sets both stores, and notifies sync", async () => {
    const order: Array<string> = [];
    const recipeMarkPending = vi.fn(() => order.push("recipe.markPending"));
    const photoMarkPending = vi.fn(() => order.push("photo.markPending"));
    const recipePut = vi.fn(async () => void order.push("recipe.put"));
    const photoPut = vi.fn(async () => void order.push("photo.put"));
    const flush = vi.fn(async () => void order.push("flush"));
    const recipeSet = vi.fn(() => order.push("recipe.set"));
    const photoSet = vi.fn(() => order.push("photo.set"));
    const notifySync = vi.fn(async () => void order.push("notifySync"));

    const ctx = makeServerContext({
      store: fromAny({ markPendingUpsert: recipeMarkPending, set: recipeSet, clearPending: vi.fn() }),
      photoStore: fromAny({ markPendingUpsert: photoMarkPending, set: photoSet, clearPending: vi.fn() }),
      cache: fromAny({ recipes: { put: recipePut }, photos: { put: photoPut }, flush }),
      client: fromAny({ notifySync }),
    });

    await commitPhotoUpload(ctx, makeRecipe(), makePhoto());

    expect(order).toEqual([
      "recipe.markPending",
      "photo.markPending",
      "recipe.put",
      "photo.put",
      "flush",
      "recipe.set",
      "photo.set",
      "notifySync",
    ]);
  });

  it("clears BOTH pending marks and rethrows when cache I/O fails", async () => {
    const recipeClear = vi.fn();
    const photoClear = vi.fn();
    const ctx = makeServerContext({
      store: fromAny({ markPendingUpsert: vi.fn(), set: vi.fn(), clearPending: recipeClear }),
      photoStore: fromAny({ markPendingUpsert: vi.fn(), set: vi.fn(), clearPending: photoClear }),
      cache: fromAny({
        recipes: { put: vi.fn() },
        photos: { put: vi.fn() },
        flush: vi.fn().mockRejectedValue(new Error("disk full")),
      }),
      client: fromAny({ notifySync: vi.fn() }),
    });

    await expect(commitPhotoUpload(ctx, makeRecipe(), makePhoto())).rejects.toThrow("disk full");
    expect(recipeClear).toHaveBeenCalledTimes(1);
    expect(photoClear).toHaveBeenCalledTimes(1);
  });
});

describe("commitPhotoDelete", () => {
  it("marks pending-delete first, removes from cache, flushes, deletes from store, and notifies", async () => {
    const order: Array<string> = [];
    const ctx = makeServerContext({
      photoStore: fromAny({
        markPendingDelete: vi.fn(() => order.push("markPendingDelete")),
        delete: vi.fn(() => order.push("delete")),
        clearPending: vi.fn(),
      }),
      cache: fromAny({
        photos: { remove: vi.fn(async () => void order.push("remove")) },
        flush: vi.fn(async () => void order.push("flush")),
      }),
      client: fromAny({ notifySync: vi.fn(async () => void order.push("notifySync")) }),
    });

    await commitPhotoDelete(ctx, makePhoto({ deleted: true }));

    expect(order).toEqual(["markPendingDelete", "remove", "flush", "delete", "notifySync"]);
  });
});
