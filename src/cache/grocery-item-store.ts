import { TombstoneEntityStore } from "../entity/index.js";
import type { GroceryItem, GroceryItemUid } from "../paprika/types.js";

export class GroceryItemStore extends TombstoneEntityStore<GroceryItem, GroceryItemUid> {
  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    super(opts ?? {});
  }

  /**
   * Returns all non-tombstoned items whose listUid matches the given value.
   */
  getByListUid(listUid: string): Array<GroceryItem> {
    const result: Array<GroceryItem> = [];
    for (const item of this._items.values()) {
      if (item.listUid === listUid) result.push(item);
    }
    return result;
  }

  /**
   * Returns all non-tombstoned items in the given list that have been
   * marked as purchased.
   */
  getPurchasedByList(listUid: string): Array<GroceryItem> {
    const result: Array<GroceryItem> = [];
    for (const item of this._items.values()) {
      if (item.listUid === listUid && item.purchased) result.push(item);
    }
    return result;
  }
}
