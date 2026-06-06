# Entity Store

Last verified: 2026-06-05

The abstract base class for the in-memory stores: `EntityStore<T, UID>`. What it is and why it exists is in `docs/architecture.md` (Caching and sync); the source is the authority on which stores extend it (`GroceryIngredientStore`, keyed by ingredient name, is the one that doesn't). The generic constraints (`T extends { uid: UID }`, `UID extends string`) keep a `Recipe` store from being parameterized with a `PantryItemUid` at compile time and still admit Zod-branded UID subtypes. The rest of this file is the behavior that's easy to get wrong under concurrent sync.

**`commit.ts` is the shared write-commit protocol** every domain's `*Writes` chokepoint binds (#255/#246): mark-pending-first → cache ops → one flush per cache → clear-ALL-marks-on-failure → store apply → `onCommitted` effects → one `notifySync`. The per-domain chokepoints in each `module.ts` `.build` are one-line `commitEntities` bindings (recipe's photo upload uses the `commitSlices` multi-slice core); the protocol's invariants are pinned once in `commit.test.ts`, not per domain. The cache is structurally typed and the notify tail arrives as a thunk, so `src/entity` imports neither `src/cache` nor `src/paprika`.

## Invariants — Pending-writes

Every `EntityStore` subclass inherits a `Map<UID, PendingWrite>`. Sync consults it to skip reconciliation for UIDs whose canonical-list state from Paprika is still stale after a local write.

- `markPendingUpsert(uid)` and `markPendingDelete(uid)` overwrite any prior mark (last write wins).
- Upserts clear on content-equality observation; deletes never observation-clear (Paprika omits soft-deleted items, so absence is ambiguous). TTL is the only clearing mechanism for deletes.
- **TTL ≤ 0 disables tracking entirely:** `markPendingUpsert` and `markPendingDelete` become no-ops. Each module`s `.state`passes`pendingWriteTtlMs: 0`(via`resolvePendingWriteTtl`) when `config.sync.enabled === false`, so a no-sync process never accumulates marks. The default is `DEFAULT_PENDING_WRITE_TTL_MS` (60s), overridable per store via the constructor.
- `sweepPending(now?)` is the TTL fallback, called by the kernel`s `syncOnce` driver at the end of every cycle.
- `commit.ts` chains cache I/O as a `ResultAsync` whose `mapErr` runs `clearPending` on every marked UID before surfacing the error, so a failed local commit doesn't leave a UID shielded for the full TTL window — all-or-nothing deliberately, since the server save already succeeded and the next sync reconciles the temporary divergence.
- All pending-writes methods are pure in-memory and never throw.

## Gotchas

- `baseLoad()` sets `_hasSynced = true` unconditionally; an empty item array is a valid synced state.
- `markSynced()` is public and deliberately separate from `baseLoad()`: a store that bootstraps from disk per-item (recipe, via `set` + `markSynced`) marks itself synced without calling `baseLoad()`, which would overwrite the in-memory state it just hydrated.
- `EntityStore` provides a default public `load()` (`= baseLoad`); a subclass needing extra load-time work overrides `load()` and calls `baseLoad()`. Subclasses that override `set()` or `delete()` must call `super.set()` / `super.delete()`; the base versions update `_items`, and the UID is otherwise lost or retained incorrectly.
- `_items` is `protected`, not `private`, so a subclass can iterate it directly for a filtered view (the recipe trash filter, the pantry/grocery-item query methods) without re-boxing through `getAll()`.
