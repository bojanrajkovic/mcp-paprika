import type { Photo } from "../../photo/types.js";
import type { PhotoUid } from "../../ids.js";

let photoCounter = 0;

/**
 * Builds a {@link Photo} for tests. Defaults satisfy the gallery invariant
 * `name === String(orderFlag + 1)` and `filename === "{uid}.jpg"`; pass
 * `overrides` to vary `recipeUid`, `orderFlag`, `deleted`, etc.
 */
export function makePhoto(overrides?: Partial<Photo>): Photo {
  photoCounter++;
  const uid = (overrides?.uid ?? `photo-${String(photoCounter)}`) as PhotoUid;
  const orderFlag = overrides?.orderFlag ?? 0;
  return {
    uid,
    recipeUid: "recipe-1",
    filename: `${uid}.jpg`,
    name: String(orderFlag + 1),
    orderFlag,
    hash: `hash-${String(photoCounter)}`,
    deleted: false,
    ...overrides,
  };
}
