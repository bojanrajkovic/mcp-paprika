import { EntityStore } from "../entity/index.js";
import type { GroceryItem, GroceryItemUid } from "../paprika/types.js";

export class GroceryItemStore extends EntityStore<GroceryItem, GroceryItemUid> {
  // Tombstones track UIDs that were soft-deleted via this client, so retried
  // delete calls receive an idempotent "already deleted" signal. Tombstones
  // persist across load() cycles, cleared only for UIDs that reappear in the
  // snapshot (resurrection). The tombstone set stays disjoint from _items
  // after every load() and set().
  private readonly _tombstones: Set<GroceryItemUid> = new Set();

  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    super(opts ?? {});
  }

  load(items: ReadonlyArray<GroceryItem>): void {
    this.baseLoad(items);
    // Un-tombstone any UID that came back in the snapshot (resurrection).
    for (const item of items) {
      this._tombstones.delete(item.uid);
    }
  }

  override set(item: GroceryItem): void {
    super.set(item);
    this._tombstones.delete(item.uid);
  }

  override delete(uid: GroceryItemUid): void {
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
  isTombstone(uid: GroceryItemUid): boolean {
    return this._tombstones.has(uid);
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
