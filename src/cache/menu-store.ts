import { TombstoneEntityStore } from "../entity/index.js";
import type { MenuUid } from "../ids.js";
import type { Menu } from "../menu/types.js";

export class MenuStore extends TombstoneEntityStore<Menu, MenuUid> {
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
  findByName(query: string): Array<Menu> {
    const needle = query.toLowerCase();
    const exact: Array<Menu> = [];
    const startsWith: Array<Menu> = [];
    const contains: Array<Menu> = [];

    for (const menu of this._items.values()) {
      const name = menu.name.toLowerCase();
      if (name === needle) exact.push(menu);
      else if (name.startsWith(needle)) startsWith.push(menu);
      else if (name.includes(needle)) contains.push(menu);
    }

    if (exact.length > 0) return exact;
    if (startsWith.length > 0) return startsWith;
    return contains;
  }
}
