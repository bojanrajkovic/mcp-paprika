import { createHash, randomUUID } from "node:crypto";

import { PhotoUidSchema, type Photo, type Recipe } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";

/** Longest edge (px) of the recipe thumbnail Paprika stores in `recipe.photo`. */
const THUMBNAIL_PX = 280;

/**
 * Longest edge (px) AI-generated `full` images are capped to before upload.
 * Shared by `generate_photo` (attach path) and `upload_photo` (generation_token
 * source) so a previewed-then-saved image gets the same cap as a directly
 * generated-and-attached one — see `NormalizePhotoOptions.maxFullEdge`.
 */
export const GENERATED_MAX_FULL_EDGE = 2048;

/** Options for {@link normalizePhoto}. */
export interface NormalizePhotoOptions {
  /**
   * Cap the `full` image's longest edge to this many pixels (preserving aspect,
   * no enlargement). Omit to keep the source resolution (the original
   * `upload_photo` behavior — a user-supplied image is left at native size).
   *
   * `generate_photo` sets this because image-generation models emit wildly
   * different native sizes (1024²–4096², and Seedream's "1K" is already 2048²);
   * a fixed cap keeps uploads "fairly small" regardless of which model the
   * caller picked, deterministically, rather than trusting each model's
   * inconsistent `image_size` knob.
   */
  readonly maxFullEdge?: number;
}

/**
 * Normalizes arbitrary input image bytes (PNG/WEBP/GIF/JPEG/…) into the two
 * JPEGs Paprika stores per photo: a `full` image (→ the Photo entity /
 * `recipe.photo_large`) and a ~280px `thumbnail` (→ `recipe.photo`). Both are
 * re-encoded to JPEG because Paprika stores every photo as JPEG. `.rotate()`
 * bakes in EXIF orientation before the orientation tag is dropped.
 *
 * By default the `full` image keeps its source resolution; pass
 * `opts.maxFullEdge` to cap it (see {@link NormalizePhotoOptions}).
 *
 * `sharp` is imported lazily so building the MCP server never eagerly loads its
 * native libvips binary — only a real photo upload pays that cost (keeps stdio /
 * HTTP startup fast for the common no-photo path).
 */
export async function normalizePhoto(
  input: Buffer,
  opts?: Readonly<NormalizePhotoOptions>,
): Promise<{ thumbnail: Buffer; full: Buffer }> {
  const { default: sharp } = await import("sharp");

  // Decode once: `.clone()` snapshots the rotated input so the full and thumbnail
  // pipelines share it, and `Promise.all` lets libvips encode both in parallel.
  const base = sharp(input).rotate();

  const fullPipeline = base.clone();
  if (opts?.maxFullEdge !== undefined) {
    fullPipeline.resize(opts.maxFullEdge, opts.maxFullEdge, { fit: "inside", withoutEnlargement: true });
  }
  const thumbnailPipeline = base
    .clone()
    .resize(THUMBNAIL_PX, THUMBNAIL_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 });

  const [full, thumbnail] = await Promise.all([
    fullPipeline.jpeg({ quality: 85 }).toBuffer(),
    thumbnailPipeline.toBuffer(),
  ]);
  return { thumbnail, full };
}

/**
 * Produce just the ~280px thumbnail JPEG. Used by `generate_photo`'s preview
 * (attach:false) path, which only needs the thumbnail — calling this avoids the
 * wasted full-resolution encode that {@link normalizePhoto} would also produce.
 */
export async function makeThumbnail(input: Buffer): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp(input)
    .rotate()
    .resize(THUMBNAIL_PX, THUMBNAIL_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
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
 * Build the Photo entity + photo-bearing recipe from already-normalized bytes,
 * run the client's verified 3-request upload sequence, and commit locally.
 * Returns the created Photo.
 *
 * `order_flag`/`name` are auto-assigned from the synced gallery (max + 1), never
 * caller-supplied — the same convention `add_meals` uses for `order_flag`. Two
 * UIDs are generated: a thumbnail UID (→ `recipe.photo`) and the Photo entity
 * UID (→ `recipe.photo_large`). Shared by `upload_photo` and `generate_photo`.
 *
 * Callers MUST gate on `ctx.photoStore.hasSynced` first — the order_flag derives
 * from the gallery, so attaching before the photo catalog syncs could collide.
 */
export async function attachPhotoToRecipe(
  ctx: ServerContext,
  recipe: Readonly<Recipe>,
  thumbnail: Buffer,
  full: Buffer,
): Promise<Photo> {
  const existing = ctx.photoStore.getByRecipeUid(recipe.uid);
  const orderFlag = existing.length > 0 ? Math.max(...existing.map((p) => p.orderFlag)) + 1 : 0;
  const photoUid = PhotoUidSchema.parse(randomUUID().toUpperCase());
  const thumbnailUid = randomUUID().toUpperCase();

  const photo: Photo = {
    uid: photoUid,
    recipeUid: recipe.uid,
    filename: `${photoUid}.jpg`,
    name: String(orderFlag + 1),
    orderFlag,
    hash: sha256Hex(full),
    deleted: false,
  };
  const recipeWithPhoto: Recipe = {
    ...recipe,
    photo: `${thumbnailUid}.jpg`,
    photoLarge: `${photoUid}.jpg`,
    photoHash: sha256Hex(thumbnail),
  };

  // uploadPhoto stamps the recipe's content hash (photo/photo_large/photo_hash are
  // hashed fields) and returns the hashed recipe — commit that so the cache matches
  // what was POSTed and the next sync doesn't re-fetch it (#167).
  const savedRecipe = await ctx.client.uploadPhoto(recipeWithPhoto, photo, thumbnail, full);
  await commitPhotoUpload(ctx, savedRecipe, photo);
  return photo;
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
