import { EntityStore } from "../entity/index.js";
import type { PantryItem, PantryItemUid } from "../paprika/types.js";

export class PantryStore extends EntityStore<PantryItem, PantryItemUid> {
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

  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    super(opts ?? {});
  }

  load(items: ReadonlyArray<PantryItem>): void {
    this.baseLoad(items);
    // Un-tombstone any UID that came back in the snapshot (resurrection: item
    // returned from the server supersedes the local soft-delete).
    for (const item of items) {
      this._tombstones.delete(item.uid);
    }
  }

  override set(item: PantryItem): void {
    super.set(item);
    this._tombstones.delete(item.uid);
  }

  override delete(uid: PantryItemUid): void {
    // Always tombstone, regardless of whether `uid` is currently in `_items`.
    // The only caller is `commitPantryItem`'s delete branch (post-successful
    // savePantryItems), but several awaits separate the save from the local
    // commit; SyncEngine.syncOnce() can interleave a `load(...)` that wipes
    // the UID from `_items` before commit lands. Conditioning the tombstone
    // on `_items.has(uid)` would silently drop the idempotent retry signal
    // in exactly that race. Spurious tombstones from other callers are
    // acceptable: an extra "already deleted" message is harmless; a missing
    // one isn't.
    this._tombstones.add(uid);
    super.delete(uid);
  }

  /**
   * Returns true if `uid` was soft-deleted via this store in the current
   * session (since the last `load()`). Used by `delete_pantry_item` to give
   * idempotent retried-delete callers a clear "already deleted" signal.
   */
  isTombstone(uid: PantryItemUid): boolean {
    return this._tombstones.has(uid);
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
