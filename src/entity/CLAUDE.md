# Entity Store

Last verified: 2026-06-02

Two abstract base classes for the in-memory stores: `EntityStore<T, UID>` and its soft-delete subclass `TombstoneEntityStore<T, UID>`. What they are and why they exist is in `docs/architecture.md` (Caching and sync); the source is the authority on which stores extend them (`GroceryIngredientStore`, keyed by ingredient name, is the one that extends neither). The generic constraints (`T extends { uid: UID }`, `UID extends string`) keep a `Recipe` store from being parameterized with a `PantryItemUid` at compile time and still admit Zod-branded UID subtypes. The rest of this file is the behavior that's easy to get wrong under concurrent sync.

## Invariants — Pending-writes

Every `EntityStore` subclass inherits a `Map<UID, PendingWrite>`. The sync engine consults it to skip reconciliation for UIDs whose canonical-list state from Paprika is still stale after a local write.

- `markPendingUpsert(uid)` and `markPendingDelete(uid)` overwrite any prior mark (last write wins).
- Upserts clear on content-equality observation; deletes never observation-clear (Paprika omits soft-deleted items, so absence is ambiguous). TTL is the only clearing mechanism for deletes.
- **TTL ≤ 0 disables tracking entirely:** `markPendingUpsert` and `markPendingDelete` become no-ops. `buildAppContext` passes `pendingWriteTtlMs: 0` when `config.sync.enabled === false`, so a no-sync process never accumulates marks. The default is `DEFAULT_PENDING_WRITE_TTL_MS` (60s), overridable per store via the constructor.
- `sweepPending(now?)` is the TTL fallback, called by `SyncEngine.syncOnce()` at the end of every cycle.
- Commit helpers wrap cache I/O in `try { … } catch { clearPending(uid); throw }`, so a failed local commit doesn't leave a UID shielded for the full TTL window.
- All pending-writes methods are pure in-memory and never throw.

## Invariants — Tombstones (TombstoneEntityStore)

Every `TombstoneEntityStore` subclass inherits tombstone tracking for soft-delete idempotency.

- `delete(uid)` tombstones unconditionally, even when `uid` is absent from `_items`. Several awaits can separate a save from the local commit, and a sync cycle can wipe the UID from `_items` in that window; conditioning on `_items.has(uid)` would silently drop the idempotent retry signal in exactly that race.
- `set(item)` clears the tombstone for `item.uid` (resurrection via upsert).
- `load(items)` clears tombstones for UIDs that reappear in the snapshot (resurrection via sync); tombstones for absent UIDs persist across cycles, so a delayed retry still gets the idempotent "already deleted" signal.
- After every `load()` and `set()`, the tombstone set is disjoint from `_items`.
- `isTombstone(uid)` is the only public read surface for the tombstone set; `_tombstones` is private, not protected.

## Gotchas

- `baseLoad()` sets `_hasSynced = true` unconditionally; an empty item array is a valid synced state.
- `markSynced()` is public and deliberately separate from `baseLoad()`: a transport that bootstraps a store from disk marks it synced without calling `baseLoad()`, which would overwrite the in-memory state it just hydrated.
- Subclasses that override `set()` or `delete()` must call `super.set()` / `super.delete()`; the base versions update `_items`, and the UID is otherwise lost or retained incorrectly.
- `TombstoneEntityStore.load()` is **not** an `override`: `EntityStore` does not declare `load()`, and each store owns its `load()` signature.
- `_items` is `protected`, not `private`, so a subclass can iterate it directly for a filtered view (the recipe trash filter, the pantry/grocery-item query methods) without re-boxing through `getAll()`.
