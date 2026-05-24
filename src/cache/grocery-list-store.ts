import { EntityStore } from "../entity/index.js";
import type { GroceryList, GroceryListUid } from "../paprika/types.js";

export class GroceryListStore extends EntityStore<GroceryList, GroceryListUid> {
  // Tombstones track UIDs that were soft-deleted via this client, so retried
  // delete calls receive an idempotent "already deleted" signal. Tombstones
  // persist across load() cycles, cleared only for UIDs that reappear in the
  // snapshot (resurrection). The tombstone set stays disjoint from _items
  // after every load() and set().
  private readonly _tombstones: Set<GroceryListUid> = new Set();
  private _lastSyncedAt: Date | null = null;

  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    super(opts ?? {});
  }

  load(items: ReadonlyArray<GroceryList>): void {
    this.baseLoad(items);
    // Un-tombstone any UID that came back in the snapshot (resurrection).
    for (const item of items) {
      this._tombstones.delete(item.uid);
    }
  }

  override set(item: GroceryList): void {
    super.set(item);
    this._tombstones.delete(item.uid);
  }

  override delete(uid: GroceryListUid): void {
    // Always tombstone, regardless of whether uid is currently in _items.
    // Several awaits can separate a save from the local commit, allowing a
    // sync cycle to remove the UID from _items first. Conditioning the
    // tombstone on _items.has(uid) would silently drop the idempotent signal
    // in exactly that race.
    this._tombstones.add(uid);
    super.delete(uid);
  }

  /**
   * Returns true if `uid` was soft-deleted via this store in the current
   * session. Used to give idempotent retried-delete callers a clear "already
   * deleted" signal.
   */
  isTombstone(uid: GroceryListUid): boolean {
    return this._tombstones.has(uid);
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
