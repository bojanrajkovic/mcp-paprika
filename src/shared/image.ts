/** Longest edge (px) of the recipe thumbnail Paprika stores in `recipe.photo`. */
export const THUMBNAIL_PX = 280;

/**
 * Produce just the ~280px thumbnail JPEG from arbitrary input image bytes. Used by
 * `generate_recipe_photo`'s preview (attach:false) path, which only needs the
 * thumbnail — calling this avoids the wasted full-resolution encode `normalizePhoto`
 * would also produce. `.rotate()` bakes in EXIF orientation before the tag is dropped.
 *
 * A pure Buffer→Buffer transform with no domain state, so it lives in `shared/` rather
 * than a domain. `sharp` is imported lazily so building the MCP server never eagerly
 * loads its native libvips binary — only a real photo operation pays that cost.
 */
export async function makeThumbnail(input: Buffer): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp(input)
    .rotate()
    .resize(THUMBNAIL_PX, THUMBNAIL_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}
