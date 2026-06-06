import type { AisleUid } from "../../aisle/ids.js";
import type { GroceryItemUid, GroceryListUid } from "../ids.js";
import type { GroceryItem } from "./types.js";

import { EntityStore } from "../../../entity/index.js";

export class GroceryItemStore extends EntityStore<GroceryItem, GroceryItemUid> {
  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    super(opts ?? {});
  }

  /**
   * Returns all items whose listUid matches the given value.
   */
  getByListUid(listUid: GroceryListUid): Array<GroceryItem> {
    const result: Array<GroceryItem> = [];
    for (const item of this._items.values()) {
      if (item.listUid === listUid) result.push(item);
    }
    return result;
  }

  /**
   * Returns all items in the given list that have been
   * marked as purchased.
   */
  getPurchasedByList(listUid: GroceryListUid): Array<GroceryItem> {
    const result: Array<GroceryItem> = [];
    for (const item of this._items.values()) {
      if (item.listUid === listUid && item.purchased) result.push(item);
    }
    return result;
  }

  /**
   * How many UNPURCHASED items reference an aisle — `delete_aisle`'s guard count.
   * Purchased items deliberately don't count: they're shopping history, and a
   * delete guard must never block on state the user has no tool to fix
   * (ADR-0017). The rule lives here, named, so a future caller can't re-derive
   * it wrong.
   */
  countUnpurchasedInAisle(aisleUid: AisleUid): number {
    let count = 0;
    for (const item of this._items.values()) {
      if (item.aisleUid === aisleUid && !item.purchased) count++;
    }
    return count;
  }
}
