import type { PantryItem, PantryItemUid } from "../paprika/types.js";

export class PantryStore {
  private readonly _items: Map<PantryItemUid, PantryItem> = new Map();
  // Tombstones track UIDs that were soft-deleted via this client, so
  // `delete_pantry_item` can return a distinct "already deleted" message for
  // retried calls (server upserts by UID and the live-items map alone can't
  // distinguish "I deleted this" from "this never existed"). Tombstones
  // persist across `load()` so delayed retries that span a sync cycle still
  // get the idempotent signal — `load()` only un-tombstones UIDs that are
  // now back in the live items list (i.e. resurrected by the server, e.g.,
  // un-deleted via another client). The tombstone set therefore stays
  // disjoint from `_items` after every load.
  private readonly _tombstones: Set<PantryItemUid> = new Set();
  private _hasSynced = false;

  load(items: ReadonlyArray<PantryItem>): void {
    this._items.clear();
    for (const item of items) {
      this._items.set(item.uid, item);
      // Resurrection: if this UID was previously tombstoned, the new live
      // entry supersedes the tombstone (item came back from the server).
      this._tombstones.delete(item.uid);
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
