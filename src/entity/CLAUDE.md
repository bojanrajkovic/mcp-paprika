# Entity Store

Last verified: 2026-05-24

## Purpose

Provides `EntityStore<T, UID>`, a typed abstract base class that eliminates duplicate pending-writes and sync-state plumbing across in-memory entity stores (RecipeStore, PantryStore, AisleStore, GroceryListStore, and GroceryItemStore). Without it, each store duplicates the same `Map<UID, PendingWrite>` TTL-sweep pattern and `hasSynced` flag.

`GroceryIngredientStore` does **NOT** extend `EntityStore` — it is a plain class with no pending-writes, no tombstones, and no `sweepPending`. It is keyed by lowercase ingredient name rather than UID.

## Contracts

- **Exposes:** `EntityStore<T extends { uid: UID }, UID extends string>` abstract class; `PendingWrite` type
- **Guarantees:** generic constraint `T extends { uid: UID }` prevents `EntityStore<Recipe, PantryItemUid>` mismatches at compile time; `UID extends string` accommodates Zod-branded subtypes
- **Expects:** subclasses call `baseLoad(items)` from their own `load()` and add entity-specific side effects after (e.g., tombstone clearing, category population)

## Dependencies

- **Uses:** nothing within the project (no imports from `paprika/`, `cache/`, `tools/`, etc.)
- **Used by:** `cache/recipe-store.ts`, `cache/pantry-store.ts`, `cache/aisle-store.ts`, `cache/grocery-list-store.ts`, `cache/grocery-item-store.ts`
- **NOT used by:** `cache/grocery-ingredient-store.ts` (plain class; see Purpose above)
- **Boundary:** must remain import-free relative to the rest of the project

## Key Decisions

- `DEFAULT_PENDING_WRITE_TTL_MS = 60_000`: centralised here so all stores share the same default; overridable per-store via constructor
- `markSynced()` is a public method, not implicit in `baseLoad()`, so transports that bootstrap the store from disk can mark it synced without calling `baseLoad` (which would overwrite in-memory state)
- `_items` is `protected` (not `private`) so subclasses can iterate it directly without re-boxing via `getAll()` when they need a filtered view (RecipeStore's trash filter, PantryStore's tombstone-aware iteration)

## Invariants — Pending-writes

`RecipeStore`, `PantryStore`, `AisleStore`, `GroceryListStore`, and `GroceryItemStore` all inherit a `Map<UID, PendingWrite>` from `EntityStore`. The sync engine consults it to skip reconciliation for UIDs whose canonical-list state from Paprika is still stale after a local write.

- `markPendingUpsert(uid)` and `markPendingDelete(uid)` overwrite any prior mark (last write wins).
- Upserts clear on content-equality observation; deletes never observation-clear (Paprika omits soft-deleted items — absence is ambiguous). TTL is the only clearing mechanism for deletes.
- **TTL ≤ 0 disables tracking entirely:** `markPendingUpsert`/`markPendingDelete` become no-ops. `buildAppContext` passes `pendingWriteTtlMs: 0` when `config.sync.enabled === false` to prevent unbounded accumulation.
- `sweepPending(now?)` is the TTL fallback, called by `SyncEngine.syncOnce()` at the end of every cycle.
- Commit helpers wrap cache I/O in `try { … } catch { clearPending(uid); throw }` so a failed local commit doesn't leave a UID shielded for the full TTL window.
- All pending-writes methods are pure in-memory and never throw.

## Gotchas

- `baseLoad()` sets `_hasSynced = true` unconditionally — an empty item array is a valid synced state.
- Subclasses that override `set()` or `delete()` must call `super.set()` / `super.delete()`; the base versions update `_items` and the UID is otherwise lost or retained incorrectly.
