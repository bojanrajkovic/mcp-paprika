import { createHash } from "node:crypto";
import sharp from "sharp";

import type { Photo, Recipe } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";

/** Longest edge (px) of the recipe thumbnail Paprika stores in `recipe.photo`. */
const THUMBNAIL_PX = 280;

/**
 * Normalizes arbitrary input image bytes (PNG/WEBP/GIF/JPEG/…) into the two
 * JPEGs Paprika stores per photo: a `full` image (→ the Photo entity /
 * `recipe.photo_large`) and a ~280px `thumbnail` (→ `recipe.photo`). Both are
 * re-encoded to JPEG because Paprika stores every photo as JPEG. `.rotate()`
 * bakes in EXIF orientation before the orientation tag is dropped.
 */
export async function normalizePhoto(input: Buffer): Promise<{ thumbnail: Buffer; full: Buffer }> {
  const full = await sharp(input).rotate().jpeg({ quality: 85 }).toBuffer();
  const thumbnail = await sharp(input)
    .rotate()
    .resize(THUMBNAIL_PX, THUMBNAIL_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { thumbnail, full };
}

/**
 * Uppercase hex SHA-256 of the given bytes — the casing Paprika emits. Used for
 * `recipe.photo_hash` (over the thumbnail bytes, verified exact) and the Photo
 * entity `hash` (over the full bytes — self-consistent, since Paprika stores the
 * client hash verbatim; exact app-interop hashing is tracked in #167).
 */
export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

/**
 * Persists a photo upload locally after the client's 3-request wire sequence:
 * the recipe (its `photo`/`photoLarge`/`photoHash` fields now set) and the new
 * Photo entity. Mark-pending-first ordering mirrors `commitRecipe`/`commitMeal`
 * so an in-flight sync that observes the cache mid-commit skips reconciling our
 * UIDs. No `resourceListChanged()` — the recipe resource renders `photoUrl`, not
 * `photo`/`photoLarge`, so a photo attach changes no rendered resource (like meals).
 */
export async function commitPhotoUpload(ctx: ServerContext, savedRecipe: Recipe, savedPhoto: Photo): Promise<void> {
  ctx.store.markPendingUpsert(savedRecipe.uid);
  ctx.photoStore.markPendingUpsert(savedPhoto.uid);
  try {
    await ctx.cache.recipes.put(savedRecipe);
    await ctx.cache.photos.put(savedPhoto);
    await ctx.cache.flush();
  } catch (e) {
    ctx.store.clearPending(savedRecipe.uid);
    ctx.photoStore.clearPending(savedPhoto.uid);
    throw e;
  }
  ctx.store.set(savedRecipe);
  ctx.photoStore.set(savedPhoto);
  await ctx.client.notifySync();
}

/**
 * Persists a photo soft-delete locally after the client's tombstone POST.
 * Mark-pending-delete-first, single flush, then store delete + notifySync. No
 * `resourceListChanged()` (same rationale as {@link commitPhotoUpload}).
 */
export async function commitPhotoDelete(ctx: ServerContext, savedPhoto: Photo): Promise<void> {
  ctx.photoStore.markPendingDelete(savedPhoto.uid);
  try {
    await ctx.cache.photos.remove(savedPhoto.uid);
    await ctx.cache.flush();
  } catch (e) {
    ctx.photoStore.clearPending(savedPhoto.uid);
    throw e;
  }
  ctx.photoStore.delete(savedPhoto.uid);
  await ctx.client.notifySync();
}
