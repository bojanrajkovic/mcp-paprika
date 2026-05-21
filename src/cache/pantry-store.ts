import type { PantryItem, PantryItemUid } from "../paprika/types.js";

// Pending-write bookkeeping (issue #57). Tracks just-written items so the
// SyncEngine can skip reconciling them against a stale canonical list
// (Paprika omits soft-deleted items, and a sync cycle issued before a write
// returns a list missing that write's UID). Upserts clear on observation
// (UID appears in canonical list with deleted !== true); deletes rely on
// the TTL because Paprika gives no observable "I propagated your delete"
// signal — absence is ambiguous between propagated and not-yet-propagated.
type PendingWriteKind = "upsert" | "delete";

type PendingWrite = {
  readonly kind: PendingWriteKind;
  readonly at: number;
};

const DEFAULT_PENDING_WRITE_TTL_MS = 60_000;

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
  private readonly _pendingWrites: Map<PantryItemUid, PendingWrite> = new Map();
  private readonly _pendingWriteTtlMs: number;
  private _hasSynced = false;

  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    this._pendingWriteTtlMs = opts?.pendingWriteTtlMs ?? DEFAULT_PENDING_WRITE_TTL_MS;
  }

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
    // Always tombstone, regardless of whether `uid` is currently in `_items`.
    // The only caller is `commitPantryItem`'s delete branch (post-successful
    // savePantryItem), but several awaits separate the save from the local
    // commit; SyncEngine.syncOnce() can interleave a `load(...)` that wipes
    // the UID from `_items` before commit lands. Conditioning the tombstone
    // on `_items.has(uid)` would silently drop the idempotent retry signal
    // in exactly that race. Spurious tombstones from other callers are
    // acceptable: an extra "already deleted" message is harmless; a missing
    // one isn't.
    this._tombstones.add(uid);
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

  markPendingUpsert(uid: PantryItemUid, at: number = Date.now()): void {
    // TTL <= 0 disables pending-write tracking entirely. Used when the
    // background sync loop is disabled — without periodic syncOnce calls to
    // sweep, marks would accumulate indefinitely (codex P2, PR #92).
    if (this._pendingWriteTtlMs <= 0) return;
    this._pendingWrites.set(uid, { kind: "upsert", at });
  }

  markPendingDelete(uid: PantryItemUid, at: number = Date.now()): void {
    if (this._pendingWriteTtlMs <= 0) return;
    this._pendingWrites.set(uid, { kind: "delete", at });
  }

  isPendingUpsert(uid: PantryItemUid): boolean {
    return this._pendingWrites.get(uid)?.kind === "upsert";
  }

  isPendingDelete(uid: PantryItemUid): boolean {
    return this._pendingWrites.get(uid)?.kind === "delete";
  }

  clearPending(uid: PantryItemUid): void {
    this._pendingWrites.delete(uid);
  }

  sweepPending(now: number = Date.now()): number {
    let removed = 0;
    for (const [uid, entry] of this._pendingWrites) {
      if (now - entry.at >= this._pendingWriteTtlMs) {
        this._pendingWrites.delete(uid);
        removed += 1;
      }
    }
    return removed;
  }

  get pendingWriteCount(): number {
    return this._pendingWrites.size;
  }
}
