import { createHash } from "node:crypto";
import type { Recipe } from "../recipe/types.js";

/**
 * Computes Paprika's client-owned recipe content hash locally, so writes can send
 * the correct `hash` instead of `""` (which forces the next sync to re-fetch the
 * recipe to reconcile). Reverse-engineered from the shipped `Paprika.framework`'s
 * `Recipe.hashValues` getter and verified against real framework output (#167).
 *
 * Algorithm:
 *
 *   hash = UPPERCASE_HEX( SHA256( NSJSONSerialization(hashValues, options: 0) ) )
 *
 * `hashValues` is a JSON **array** (not an object) of 27 fields sorted
 * alphabetically by their wire key. Per-field rules, all confirmed against the
 * framework:
 *
 * - `categories` → the category UIDs sorted ascending by plain code-unit order
 *   (`Array.prototype.sort()`), emitted as a nested array. The live framework
 *   canonicalizes its category Set to this order regardless of insertion order.
 * - `hash` → always `null`. It is self-referential; the framework blanks it before
 *   hashing. (Feeding the stored hash back in is why our old `hash: ""` never matched.)
 * - `in_trash` / `deleted` → always `false`. The hash is trash-independent (#125:
 *   Paprika echoes the existing hash unchanged across trash/hard-delete flips), so
 *   these are pinned false to keep the hash purely content-based.
 * - `image_url`, `photo`, `photo_hash`, `photo_large`, `scale` → emitted **as-is**
 *   (the stored value: `null` stays `null`, `""` stays `""`). No coercion.
 * - Every other string field → `value ?? ""` (the framework stores these as `""`
 *   when empty, never `null`).
 * - `rating` → integer; `is_pinned` / `on_favorites` → booleans.
 *
 * Serialization matches `NSJSONSerialization` with `options: 0`: compact, UTF-8,
 * and — the one place Node's `JSON.stringify` diverges from Foundation — forward
 * slashes escaped (`/` → `\/`). Slashes only ever appear inside string values, so a
 * global replace on the serialized output is exact.
 */
export function computeRecipeHash(recipe: Readonly<Recipe>): string {
  // Order matters: alphabetical by wire key. Do not reorder.
  const hashValues: ReadonlyArray<unknown> = [
    [...recipe.categories].sort(), // categories
    recipe.cookTime ?? "", // cook_time
    recipe.created, // created
    false, // deleted (trash-independent)
    recipe.description ?? "", // description
    recipe.difficulty ?? "", // difficulty
    recipe.directions, // directions (schema coerces null → "")
    null, // hash (blanked)
    recipe.imageUrl, // image_url (as-is)
    false, // in_trash (trash-independent)
    recipe.ingredients, // ingredients (schema coerces null → "")
    recipe.isPinned, // is_pinned
    recipe.name, // name
    recipe.notes ?? "", // notes
    recipe.nutritionalInfo ?? "", // nutritional_info
    recipe.onFavorites, // on_favorites
    recipe.photo, // photo (as-is)
    recipe.photoHash, // photo_hash (as-is)
    recipe.photoLarge, // photo_large (as-is)
    recipe.prepTime ?? "", // prep_time
    recipe.rating, // rating
    recipe.scale, // scale (as-is)
    recipe.servings ?? "", // servings
    recipe.source ?? "", // source
    recipe.sourceUrl ?? "", // source_url
    recipe.totalTime ?? "", // total_time
    recipe.uid, // uid
  ];

  // NSJSONSerialization(options: 0) escapes forward slashes; JSON.stringify does not.
  const serialized = JSON.stringify(hashValues).replaceAll("/", "\\/");
  return createHash("sha256").update(serialized, "utf8").digest("hex").toUpperCase();
}
