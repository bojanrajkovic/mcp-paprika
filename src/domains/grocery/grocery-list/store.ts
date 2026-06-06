import type { GroceryListUid } from "../ids.js";
import type { GroceryList } from "./types.js";

import { EntityStore } from "../../../entity/index.js";

export class GroceryListStore extends EntityStore<GroceryList, GroceryListUid> {
  private _lastSyncedAt: Date | null = null;

  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    super(opts ?? {});
  }

  get lastSyncedAt(): Date | null {
    return this._lastSyncedAt;
  }

  setLastSyncedAt(at: Date = new Date()): void {
    this._lastSyncedAt = at;
  }

  /**
   * Tiered case-insensitive name lookup: exact > starts-with > contains.
   * Returns items from at most one tier. Excludes deleted items (they are
   * removed from _items by delete() before this is called).
   */
  findByName(query: string): Array<GroceryList> {
    const needle = query.toLowerCase();
    const exact: Array<GroceryList> = [];
    const startsWith: Array<GroceryList> = [];
    const contains: Array<GroceryList> = [];

    for (const list of this._items.values()) {
      const name = list.name.toLowerCase();
      if (name === needle) exact.push(list);
      else if (name.startsWith(needle)) startsWith.push(list);
      else if (name.includes(needle)) contains.push(list);
    }

    if (exact.length > 0) return exact;
    if (startsWith.length > 0) return startsWith;
    return contains;
  }
}
