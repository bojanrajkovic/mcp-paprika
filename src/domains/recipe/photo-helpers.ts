import { createHash } from "node:crypto";

import { THUMBNAIL_PX } from "../../shared/image.js";

/**
 * Longest edge (px) AI-generated `full` images are capped to before upload.
 * Shared by `generate_recipe_photo` (attach path) and `upload_recipe_photo` (generation_token
 * source) so a previewed-then-saved image gets the same cap as a directly
 * generated-and-attached one — see `NormalizePhotoOptions.maxFullEdge`.
 */
export const GENERATED_MAX_FULL_EDGE = 2048;

/** Options for {@link normalizePhoto}. */
export interface NormalizePhotoOptions {
  /**
   * Cap the `full` image's longest edge to this many pixels (preserving aspect,
   * no enlargement). Omit to keep the source resolution (the original
   * `upload_recipe_photo` behavior — a user-supplied image is left at native size).
   *
   * `generate_recipe_photo` sets this because image-generation models emit wildly
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
 * Uppercase hex SHA-256 of the given bytes — the casing Paprika emits. Used for
 * `recipe.photo_hash` (over the thumbnail bytes, verified exact) and the Photo
 * entity `hash` (over the full bytes — self-consistent, since Paprika stores the
 * client hash verbatim; exact app-interop hashing is tracked in #167).
 */
export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}
