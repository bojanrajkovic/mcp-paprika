// Pending-write bookkeeping (issue #57). Tracks just-written items so sync
// can skip reconciling them against a stale canonical list
// (Paprika omits soft-deleted items, and a sync cycle issued before a write
// returns a list missing that write's UID). Upserts clear on observation
// (UID appears in canonical list with matching content); deletes rely on
// the TTL because Paprika gives no observable "I propagated your delete"
// signal — absence is ambiguous between propagated and not-yet-propagated.
export type PendingWrite = { kind: "upsert" | "delete"; at: number };

const DEFAULT_PENDING_WRITE_TTL_MS = 60_000;

// T extends { uid: UID } enforces that every entity carries a uid field whose
// type is exactly UID — prevents EntityStore<Recipe, PantryItemUid> mismatches
// at compile time. UID extends string accommodates Zod-branded subtypes.
export abstract class EntityStore<T extends { uid: UID }, UID extends string> {
  protected readonly _items: Map<UID, T> = new Map();
  private readonly _pendingWrites: Map<UID, PendingWrite> = new Map();
  private _hasSynced = false;
  private readonly _pendingWriteTtlMs: number;

  constructor({ pendingWriteTtlMs = DEFAULT_PENDING_WRITE_TTL_MS }: { pendingWriteTtlMs?: number } = {}) {
    this._pendingWriteTtlMs = pendingWriteTtlMs;
  }

  protected getUid(item: T): UID {
    return item.uid;
  }

  get hasSynced(): boolean {
    return this._hasSynced;
  }

  markSynced(): void {
    this._hasSynced = true;
  }

  get(uid: UID): T | undefined {
    return this._items.get(uid);
  }

  getAll(): T[] {
    return [...this._items.values()];
  }

  set(item: T): void {
    this._items.set(this.getUid(item), item);
  }

  delete(uid: UID): void {
    this._items.delete(uid);
  }

  get size(): number {
    return this._items.size;
  }

  /** Replace all items with `items`, marking the store synced. */
  load(items: ReadonlyArray<T>): void {
    this.baseLoad(items);
  }

  // The public `load()` calls this; a subclass needing extra load-time work
  // overrides `load()` and calls this for the base repopulation.
  protected baseLoad(items: ReadonlyArray<T>): void {
    this._items.clear();
    for (const item of items) this._items.set(this.getUid(item), item);
    this._hasSynced = true;
  }

  markPendingUpsert(uid: UID, at = Date.now()): void {
    // TTL <= 0 disables pending-write tracking entirely. Used when the
    // background sync loop is disabled — without periodic syncOnce calls to
    // sweep, marks would accumulate indefinitely (codex P2, PR #92).
    if (this._pendingWriteTtlMs <= 0) return;
    this._pendingWrites.set(uid, { kind: "upsert", at });
  }

  markPendingDelete(uid: UID, at = Date.now()): void {
    if (this._pendingWriteTtlMs <= 0) return;
    this._pendingWrites.set(uid, { kind: "delete", at });
  }

  isPendingUpsert(uid: UID): boolean {
    return this._pendingWrites.get(uid)?.kind === "upsert";
  }

  isPendingDelete(uid: UID): boolean {
    return this._pendingWrites.get(uid)?.kind === "delete";
  }

  clearPending(uid: UID): void {
    this._pendingWrites.delete(uid);
  }

  sweepPending(now = Date.now()): number {
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
