import type { PhotoUid, RecipeUid } from "../../../ids.js";
import type { Photo } from "./types.js";

import { TombstoneEntityStore } from "../../../entity/index.js";

/**
 * In-memory query layer for recipe photos, hydrated by the sync engine. Extends
 * `TombstoneEntityStore<Photo, PhotoUid>` (see `../entity/CLAUDE.md` for the base
 * class contract, pending-writes invariants, and tombstone invariants).
 *
 * Photos are a recipe-child entity (like meals and menu items): the owning
 * recipe is referenced by the plain-string `recipeUid` foreign key. This store
 * is the read/sync foundation; the write tools (`upload_recipe_photo` / `delete_recipe_photo`)
 * land in #169 and the gallery `order_flag`/`name` assignment is derived from
 * `getByRecipeUid`.
 */
export class PhotoStore extends TombstoneEntityStore<Photo, PhotoUid> {
  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    super(opts ?? {});
  }

  /**
   * Returns all non-deleted photos for a recipe, sorted ascending by
   * `orderFlag` (the gallery display order; `name` mirrors it 1-indexed, so
   * `name === String(orderFlag + 1)`). `recipeUid` is branded `RecipeUid`; the
   * comparison runs against the plain-string `Photo.recipeUid` wire field (a
   * brand is a string subtype), exactly like `MenuItemStore.getByMenuUid`.
   */
  getByRecipeUid(recipeUid: RecipeUid): Array<Photo> {
    const result: Array<Photo> = [];
    for (const photo of this._items.values()) {
      if (photo.deleted) continue;
      if (photo.recipeUid === recipeUid) result.push(photo);
    }
    result.sort((a, b) => a.orderFlag - b.orderFlag);
    return result;
  }
}
