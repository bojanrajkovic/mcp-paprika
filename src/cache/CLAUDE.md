# Caching Layer

Last verified: 2026-05-23

## Files

- `recipe-store.ts` — In-memory cache for recipes and categories with CRUD operations and query methods
- `pantry-store.ts` — In-memory query layer for pantry items (replace-all semantics, no hashing)
- `disk/` — Persistence layer: `DiskCacheRoot` and per-entity subcaches. See `disk/CLAUDE.md` for the full contract.

## Purpose

Caches Paprika API responses to reduce API calls and improve response times for MCP tool invocations.

## Contracts

### RecipeStore

Core in-memory cache for recipes and categories with CRUD operations and query methods. Extends `EntityStore<Recipe, RecipeUid>` (see `../entity/CLAUDE.md` for the base class contract and pending-writes invariants).

**Construction:**

`new RecipeStore(opts?: { pendingWriteTtlMs?: number })` — `pendingWriteTtlMs` defaults to `60_000`; controls the TTL fallback for the pending-writes map (see `../entity/CLAUDE.md`).

**Exported Types:**

- `SearchOptions` - Configuration for recipe search (fields, offset, limit)
- `ScoredResult` - Search result with recipe and relevance score
- `TimeConstraints` - Time-based filtering constraints (maxPrepTime, maxCookTime, maxTotalTime)

**Methods:**

- `load(recipes, categories)` - Populate store with recipes and categories
- `get(uid) / getAll()` - Retrieve recipes by UID or all non-trashed recipes
- `set(recipe) / delete(uid)` - CRUD operations
- `size` (getter) - Count of non-trashed recipes
- `search(query, options?)` - Search recipes with tiered scoring and pagination
- `filterByIngredients(terms, mode, limit?)` - Filter recipes by ingredient presence (all/any)
- `filterByTime(constraints)` - Filter and sort recipes by duration constraints
- `findByName(title)` - Tiered name lookup (exact > starts-with > contains)
- Category operations: `getCategory()`, `getAllCategories()`, `setCategories()`, `resolveCategories()`
- Pending-writes (inherited from `EntityStore`; see `../entity/CLAUDE.md`): `markPendingUpsert(uid, at?)`, `markPendingDelete(uid, at?)`, `isPendingUpsert(uid)`, `isPendingDelete(uid)`, `clearPending(uid)`, `sweepPending(now?): number`, `pendingWriteCount` (getter)

### PantryStore

In-memory query layer for pantry items, hydrated by the sync engine. Extends `EntityStore<PantryItem, PantryItemUid>` (see `../entity/CLAUDE.md`). Intentionally simpler than `RecipeStore`: pantry items have no hash, no categories, and no time/ingredient filtering — just CRUD plus a tiered name lookup.

**Construction:**

`new PantryStore(opts?: { pendingWriteTtlMs?: number })` — starts empty with `hasSynced = false`. `pendingWriteTtlMs` defaults to `60_000`; controls the TTL fallback for the pending-writes map (see `../entity/CLAUDE.md`).

**Methods:**

| Method                        | Signature                                       | Description                                                                                     |
| ----------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `load(items)`                 | `(items: ReadonlyArray<PantryItem>): void`      | Clears existing items, repopulates from `items`, sets `hasSynced = true`                        |
| `get(uid)`                    | `(uid: PantryItemUid): PantryItem \| undefined` | Direct UID lookup                                                                               |
| `getAll()`                    | `(): Array<PantryItem>`                         | Returns all items (insertion order)                                                             |
| `set(item)`                   | `(item: PantryItem): void`                      | Upsert by `item.uid`                                                                            |
| `delete(uid)`                 | `(uid: PantryItemUid): void`                    | Removes the entry if present (no-op otherwise); records UID in the tombstone set when present   |
| `isTombstone(uid)`            | `(uid: PantryItemUid): boolean`                 | `true` if `uid` was soft-deleted via `delete()` since the last `load()` (in-session tombstone)  |
| `markPendingUpsert(uid, at?)` | `(uid: PantryItemUid, at?: number): void`       | Inherited from `EntityStore`; see `../entity/CLAUDE.md`                                         |
| `markPendingDelete(uid, at?)` | `(uid: PantryItemUid, at?: number): void`       | Inherited from `EntityStore`; see `../entity/CLAUDE.md`                                         |
| `isPendingUpsert(uid)`        | `(uid: PantryItemUid): boolean`                 | Inherited from `EntityStore`; see `../entity/CLAUDE.md`                                         |
| `isPendingDelete(uid)`        | `(uid: PantryItemUid): boolean`                 | Inherited from `EntityStore`; see `../entity/CLAUDE.md`                                         |
| `clearPending(uid)`           | `(uid: PantryItemUid): void`                    | Inherited from `EntityStore`; see `../entity/CLAUDE.md`                                         |
| `sweepPending(now?)`          | `(now?: number): number`                        | Inherited from `EntityStore`; see `../entity/CLAUDE.md`                                         |
| `size`                        | `number` getter                                 | Count of items                                                                                  |
| `hasSynced`                   | `boolean` getter                                | `true` after the first `load()` call (even when `items.length === 0`)                           |
| `pendingWriteCount`           | `number` getter                                 | Count of pending-write entries (test/diagnostic only)                                           |
| `findByIngredient(query)`     | `(query: string): Array<PantryItem>`            | Tiered case-insensitive lookup: exact match > starts-with > contains; at most one tier returned |

### DiskCacheRoot

Persistence layer for every entity the server caches. Composed of one `DiskCache<T>` instance per entity (`recipes`, `categories`, `pantry`, `oauthClients`, `oauthTokens`) plus a one-shot legacy-index migration that runs on first boot to upgrade installs from the unified-index layout.

**Construction:** `new DiskCacheRoot(cacheDir: string, log?: Logger)`. Production passes `appLog.child({ component: "disk-cache" })`.

**Public API:** every subcache exposes `get`/`getAll`/`put`/`remove`/`flush`/`has`/`size`; the root exposes `init()` and `flush()`. Specialised entities add behaviour: `cache.recipes.diff(entries)` returns the added/changed/removed classification used by the sync loop; `cache.oauthClients.tryPut(client, max)` is the atomic DCR-cap check.

There is no `getAllCategories`, `removeCategory`, or category diff — categories use replace-all semantics and the on-disk files are read directly when needed.

See `disk/CLAUDE.md` for the full contract, on-disk layout, migration semantics, mutex model, per-entity invariants, and catch-site classification.

## Invariants

### RecipeStore

- `getAll()`, `size`, `search()`, `filterByIngredients()`, `filterByTime()`, and `findByName()` exclude trashed recipes (`inTrash: true`)
- `get(uid)` returns trashed recipes (direct UID lookup has no filtering)
- `search()` scoring tiers: exact name match (3) > starts-with (2) > contains (1) > other field match (0); ties broken by name alphabetically
- `filterByTime()` results are sorted by total time ascending (null total times sort last)
- `findByName()` returns at most one tier: exact matches, or starts-with matches, or contains matches

### PantryStore

- `hasSynced` is `false` until the first `load()` call; `pantryStartGuard()` (in `tools/pantry-helpers.ts`) returns `Err` until then
- `load()` clears existing items before populating, so it always reflects the latest API snapshot (replace-all semantics)
- `load([])` still flips `hasSynced` to `true` — an empty pantry is a valid synced state
- `findByIngredient()` returns at most one tier (exact > starts-with > contains); ties within a tier are returned in insertion order
- All read methods are pure (no I/O); the store is rehydrated from `cache.pantry.getAll()` on startup and refreshed by the sync engine
- The tombstone set survives sync cycles: `delete()` adds unconditionally; `set()` clears for that UID; `load(items)` clears only for UIDs present in `items` (resurrection). Tombstones for UIDs that stay absent from the snapshot persist, so delayed retries past a sync interval still get the idempotent "already deleted" signal. `delete()` tombstones even when the UID is absent from `_items` to defend against a sync-race in which `commitPantryItem`'s awaits let `syncOnce()` remove the UID before the local commit lands. After every `load()` and `set()`, the tombstone set is disjoint from `_items`

### Pending-writes (issue #57)

Both `RecipeStore` and `PantryStore` inherit pending-writes tracking from `EntityStore`. See `../entity/CLAUDE.md` for the full invariants. Key cache-layer points:

- Pending-writes is **separate from the pantry tombstone set**: tombstones drive the delete-tool's idempotent "already deleted" message; pending-writes shield the sync loop from rolling back or resurrecting in-flight writes.
- Clearing is **content-equality-based for upserts**: recipes clear when the canonical entry's hash matches the local cache; pantry items clear when the incoming item is field-wise equal via `pantryItemsEqual`. UID-presence-only clearing was rejected because the UID can appear in the canonical list with pre-write content while propagation is still in flight.
- The commit helpers (`commitRecipe` / `commitPantryItem`) wrap cache I/O in `try { … } catch { clearPending(uid); throw }` so a failed local commit doesn't leave a UID shielded for the full TTL window.

## Dependencies

- **Uses:** `entity/` (EntityStore base class and PendingWrite type), `paprika/types` (Recipe, Category, PantryItem types), `utils/duration` (parseDuration for time filtering)
- **Used by:**
  - `features/` (via `RecipeStore`)
  - `paprika/sync.ts` (via `cache.recipes.diff` / `cache.pantry` / `PantryStore` for diff and replace-all sync)
  - `tools/` and `resources/` (via `ctx.pantryStore` for pantry reads; `ctx.store` for recipe reads)
  - `server/build.ts` (constructs `DiskCacheRoot` with `getCacheDir()`, `RecipeStore`, and `PantryStore`)
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`
