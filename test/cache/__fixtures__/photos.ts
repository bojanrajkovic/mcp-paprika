import type { Photo } from "../../../src/domains/recipe/photo/types.js";
import type { PhotoUid, RecipeUid } from "../../../src/ids.js";

let photoCounter = 0;

type PhotoOverrides = Partial<Omit<Photo, "recipeUid">> & { readonly recipeUid?: string };

/**
 * Builds a {@link Photo} for tests. Defaults satisfy the gallery invariant
 * `name === String(orderFlag + 1)` and `filename === "{uid}.jpg"`; pass
 * `overrides` to vary `recipeUid`, `orderFlag`, `deleted`, etc. The `recipeUid`
 * FK is loosened to a plain string and branded here.
 */
export function makePhoto(overrides?: PhotoOverrides): Photo {
  photoCounter++;
  const { recipeUid, ...rest } = overrides ?? {};
  const uid = (rest.uid ?? `photo-${String(photoCounter)}`) as PhotoUid;
  const orderFlag = rest.orderFlag ?? 0;
  return {
    uid,
    recipeUid: (recipeUid ?? "recipe-1") as RecipeUid,
    filename: `${uid}.jpg`,
    name: String(orderFlag + 1),
    orderFlag,
    hash: `hash-${String(photoCounter)}`,
    deleted: false,
    ...rest,
  };
}
