import type { PantryItem, PantryItemUid } from "../paprika/types.js";

export class PantryStore {
  private readonly _items: Map<PantryItemUid, PantryItem> = new Map();
  // Tombstones track UIDs that were soft-deleted via this client in the current
  // session, so `delete_pantry_item` can return a distinct "already deleted"
  // message for retried calls (server upserts by UID and the live-items map
  // alone can't distinguish "I deleted this" from "this never existed").
  // Cleared on `load()` since each sync's listPantry response is authoritative
  // (server filters out tombstones from the read-list, so post-sync we trust
  // the snapshot). Resurrection via `set()` clears the tombstone.
  private readonly _tombstones: Set<PantryItemUid> = new Set();
  private _hasSynced = false;

  load(items: ReadonlyArray<PantryItem>): void {
    this._items.clear();
    this._tombstones.clear();
    for (const item of items) {
      this._items.set(item.uid, item);
    }
    this._hasSynced = true;
  }

  get(uid: PantryItemUid): PantryItem | undefined {
    return this._items.get(uid);
  }

  getAll(): Array<PantryItem> {
    return [...this._items.values()];
  }

  set(item: PantryItem): void {
    this._items.set(item.uid, item);
    this._tombstones.delete(item.uid);
  }

  delete(uid: PantryItemUid): void {
    if (this._items.has(uid)) {
      this._tombstones.add(uid);
    }
    this._items.delete(uid);
  }

  /**
   * Returns true if `uid` was soft-deleted via this store in the current
   * session (since the last `load()`). Used by `delete_pantry_item` to give
   * idempotent retried-delete callers a clear "already deleted" signal.
   */
  isTombstone(uid: PantryItemUid): boolean {
    return this._tombstones.has(uid);
  }

  get size(): number {
    return this._items.size;
  }

  get hasSynced(): boolean {
    return this._hasSynced;
  }

  findByIngredient(query: string): Array<PantryItem> {
    const needle = query.toLowerCase();

    const exact: Array<PantryItem> = [];
    const prefix: Array<PantryItem> = [];
    const substring: Array<PantryItem> = [];

    for (const item of this._items.values()) {
      const hay = item.ingredient.toLowerCase();
      if (hay === needle) exact.push(item);
      else if (hay.startsWith(needle)) prefix.push(item);
      else if (hay.includes(needle)) substring.push(item);
    }

    if (exact.length > 0) return exact;
    if (prefix.length > 0) return prefix;
    return substring;
  }
}
