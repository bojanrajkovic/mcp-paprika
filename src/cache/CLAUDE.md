# Caching Layer

Last verified: 2026-05-28

## Files

- `recipe-store.ts` — In-memory cache for recipes and categories with CRUD operations and query methods
- `pantry-store.ts` — In-memory query layer for pantry items (replace-all semantics, no hashing)
- `aisle-store.ts` — In-memory query layer for aisles (replace-all semantics, `resolveByName` for case-insensitive lookup)
- `grocery-list-store.ts` — In-memory query layer for grocery lists (EntityStore subclass; tombstones, `findByName`, `lastSyncedAt`)
- `grocery-item-store.ts` — In-memory query layer for grocery items (EntityStore subclass; tombstones, `getByListUid`, `getPurchasedByList`)
- `grocery-ingredient-store.ts` — In-memory lookup layer for grocery ingredients (plain class, not EntityStore; keyed by lowercase name; no pending-writes)
- `meal-store.ts` — In-memory query layer for meals (TombstoneEntityStore subclass; `getByRecipeUid`, `lastCookedAt`, `getInDateRange`)
- `meal-type-store.ts` — In-memory query layer for meal types (EntityStore subclass; `resolveByName` for case-insensitive lookup, like AisleStore)
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
- Sync metadata: `lastSyncedAt` (getter, `Date | null`), `setLastSyncedAt(at?)` — timestamp of last successful recipe sync; set by `SyncEngine.syncOnce()` after recipe reconciliation; used by recipe resource metadata header
- Pending-writes (inherited from `EntityStore`; see `../entity/CLAUDE.md`): `markPendingUpsert(uid, at?)`, `markPendingDelete(uid, at?)`, `isPendingUpsert(uid)`, `isPendingDelete(uid)`, `clearPending(uid)`, `sweepPending(now?): number`, `pendingWriteCount` (getter)

### PantryStore

In-memory query layer for pantry items, hydrated by the sync engine. Extends `TombstoneEntityStore<PantryItem, PantryItemUid>` (see `../entity/CLAUDE.md` for the base class contract, pending-writes invariants, and tombstone invariants).

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

### AisleStore

In-memory query layer for aisles, hydrated by the sync engine. Extends `EntityStore<Aisle, AisleUid>` (see `../entity/CLAUDE.md`). Replace-all semantics matching `PantryStore`.

**Construction:** `new AisleStore(opts?: { pendingWriteTtlMs?: number })` — starts empty with `hasSynced = false`.

**Methods:**

| Method             | Description                                                                            |
| ------------------ | -------------------------------------------------------------------------------------- | ---------- |
| `load(items)`      | Clears and repopulates from `items`, sets `hasSynced = true`                           |
| `getAll()`         | Returns all items (insertion order)                                                    |
| `set(aisle)`       | Upsert by `aisle.uid` (inherited from `EntityStore`)                                   |
| `resolveByName(n)` | Case-insensitive exact lookup; returns `Aisle                                          | undefined` |
| Pending-writes     | `markPendingUpsert`, `isPendingUpsert`, `clearPending`, `sweepPending` (all inherited) |

No delete branch — aisles are a reference catalog; auto-creation is a side-effect of pantry writes.

### GroceryListStore

In-memory query layer for grocery lists, hydrated by the sync engine. Extends `TombstoneEntityStore<GroceryList, GroceryListUid>` (see `../entity/CLAUDE.md` for the base class contract, pending-writes invariants, and tombstone invariants).

**Construction:** `new GroceryListStore(opts?: { pendingWriteTtlMs?: number })` — starts empty with `hasSynced = false`.

**Methods:**

| Method                  | Description                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load(items)`           | Clears and repopulates from `items`, sets `hasSynced = true`; un-tombstones resurrected UIDs                                                      |
| `get(uid)` / `getAll()` | Direct UID lookup or all items (inherited)                                                                                                        |
| `set(list)`             | Upsert by `list.uid`; clears tombstone for that UID                                                                                               |
| `delete(uid)`           | Tombstones the UID unconditionally; removes from `_items`                                                                                         |
| `isTombstone(uid)`      | `true` if `uid` was soft-deleted in this session                                                                                                  |
| `findByName(query)`     | Tiered case-insensitive lookup: exact > starts-with > contains; at most one tier                                                                  |
| `lastSyncedAt`          | `Date \| null` getter — timestamp of last successful grocery list sync                                                                            |
| `setLastSyncedAt(at?)`  | Sets `lastSyncedAt`; defaults to `new Date()`                                                                                                     |
| Pending-writes          | `markPendingUpsert`, `markPendingDelete`, `isPendingUpsert`, `isPendingDelete`, `clearPending`, `sweepPending` (all inherited from `EntityStore`) |

**Invariants:**

- Tombstone invariants: see `../entity/CLAUDE.md`
- `load([])` still flips `hasSynced` to `true`

### GroceryItemStore

In-memory query layer for grocery items, hydrated by the sync engine. Extends `TombstoneEntityStore<GroceryItem, GroceryItemUid>` (see `../entity/CLAUDE.md` for the base class contract, pending-writes invariants, and tombstone invariants).

**Construction:** `new GroceryItemStore(opts?: { pendingWriteTtlMs?: number })` — starts empty with `hasSynced = false`.

**Methods:**

| Method                        | Description                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `load(items)`                 | Clears and repopulates from `items`, sets `hasSynced = true`; un-tombstones resurrected UIDs                                   |
| `get(uid)` / `getAll()`       | Direct UID lookup or all items (inherited)                                                                                     |
| `set(item)`                   | Upsert by `item.uid`; clears tombstone for that UID                                                                            |
| `delete(uid)`                 | Tombstones the UID unconditionally; removes from `_items`                                                                      |
| `isTombstone(uid)`            | `true` if `uid` was soft-deleted in this session                                                                               |
| `getByListUid(listUid)`       | Returns all non-tombstoned items whose `listUid` matches the given value                                                       |
| `getPurchasedByList(listUid)` | Returns all non-tombstoned items in the given list with `purchased: true`                                                      |
| Pending-writes                | `markPendingUpsert`, `markPendingDelete`, `isPendingUpsert`, `isPendingDelete`, `clearPending`, `sweepPending` (all inherited) |

**Note:** `GroceryItemStore` has no `findByName` or `lastSyncedAt`.

**Invariants:**

- Tombstone invariants: see `../entity/CLAUDE.md`
- `getByListUid` and `getPurchasedByList` iterate `_items` directly (excludes tombstoned UIDs that were deleted via `delete()` before `load()`)

### GroceryIngredientStore

In-memory lookup layer for grocery ingredients. This is a **plain class**, NOT an `EntityStore` subclass. It has no pending-writes, no tombstones, and no `sweepPending`. Internal storage is `Map<string, GroceryIngredient>` keyed by **lowercase name** for case-insensitive lookup.

**Construction:** `new GroceryIngredientStore()` — no options. Starts empty with `hasSynced = false`.

**Methods:**

| Method               | Description                                                                          |
| -------------------- | ------------------------------------------------------------------------------------ |
| `load(items)`        | Clears map, re-populates keyed by `item.name.toLowerCase()`, sets `hasSynced = true` |
| `lookupByName(name)` | Case-insensitive exact lookup; returns `GroceryIngredient \| undefined`              |
| `getAll()`           | Returns all items as an array (insertion order by lowercase name)                    |
| `size`               | Getter; count of stored ingredients                                                  |
| `hasSynced`          | `boolean` getter; `true` after first `load()` call                                   |

**Invariants:**

- No `set`, `delete`, `get(uid)`, pending-writes, or tombstones — this store is replace-all only
- Names that differ only by case point to the same entry (last writer wins if there are duplicates from the server)
- `sweepPending()` does not exist on this class — the sync engine does not call it for ingredients

### MealStore

In-memory query layer for meals, hydrated by the sync engine. Extends `TombstoneEntityStore<Meal, MealUid>` (see `../entity/CLAUDE.md` for the base class contract, pending-writes invariants, and tombstone invariants).

**Construction:** `new MealStore(opts?: { pendingWriteTtlMs?: number })` — starts empty with `hasSynced = false`.

**Methods:**

| Method                             | Description                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load(items)`                      | Clears and repopulates from `items`, sets `hasSynced = true`                                                                                                                                                                                                                                                                                            |
| `get(uid)` / `getAll()`            | Direct UID lookup or all items (inherited)                                                                                                                                                                                                                                                                                                              |
| `getByRecipeUid(uid)`              | Returns all non-deleted, non-ingredient meals for a recipe UID                                                                                                                                                                                                                                                                                          |
| `lastCookedAt(uid)`                | Most recent meal date (Paprika wire format) for a recipe, or `null`; excludes `isIngredient: true` entries                                                                                                                                                                                                                                              |
| `getInDateRange(opts?)`            | Filtered query with optional `since`/`until` (DateTime), `recipeUid`, `typeUid`, `offset`, `limit`; date-descending                                                                                                                                                                                                                                     |
| `getMaxOrderFlagOn(date, typeUid)` | Returns the highest `orderFlag` among non-deleted, non-ingredient meals on `date` with matching `typeUid`; returns `null` when no matching meal exists. Used by `add_meals` to assign new flags. The `typeUid` parameter is `string \| null`; legacy meals with `typeUid: null` form their own bucket per date and never collide with non-null buckets. |
| Pending-writes                     | `markPendingUpsert`, `markPendingDelete`, `isPendingUpsert`, `isPendingDelete`, `clearPending`, `sweepPending` (all inherited)                                                                                                                                                                                                                          |

**Note:** `getByRecipeUid` and `lastCookedAt` filter out `isIngredient: true` entries — prep-work entries don't count as "cooked." `getInDateRange` also excludes ingredient entries. The `recipeUid` parameter is `string` (not branded `RecipeUid`) because `Meal.recipeUid` is `string | null`. The `typeUid` filter compares against `Meal.typeUid` which is also `string | null` — meals with `typeUid: null` (older entries predating Paprika's mealtypes catalog) only match when no `typeUid` filter is set.

### MealTypeStore

In-memory query layer for meal types, hydrated by the sync engine. Extends `EntityStore<MealType, MealTypeUid>` (see `../entity/CLAUDE.md`). Replace-all semantics matching `AisleStore`.

**Construction:** `new MealTypeStore(opts?: { pendingWriteTtlMs?: number })` — starts empty with `hasSynced = false`.

**Methods:**

| Method             | Description                                                    |
| ------------------ | -------------------------------------------------------------- |
| `load(items)`      | Clears and repopulates from `items`, sets `hasSynced = true`   |
| `getAll()`         | Returns all items (insertion order)                            |
| `resolveByName(n)` | Case-insensitive exact lookup; returns `MealType \| undefined` |

No delete or tombstone support — meal types are a reference catalog.

### DiskCacheRoot

Persistence layer for every entity the server caches. Composed of one `DiskCache<T>` instance per entity (`recipes`, `categories`, `pantry`, `aisles`, `oauthClients`, `oauthTokens`, `groceryLists`, `groceryItems`, `groceryIngredients`, `meals`, `mealTypes`) plus a one-shot legacy-index migration that runs on first boot to upgrade installs from the unified-index layout.

**Construction:** `new DiskCacheRoot(cacheDir: string, log?: Logger)`. Production passes `appLog.child({ component: "disk-cache" })`.

**Public API:** every subcache exposes `get`/`getAll`/`put`/`remove`/`flush`/`has`/`size`; the root exposes `init()` and `flush()`. Specialised entities add behaviour: `cache.recipes.diff(entries)` returns the added/changed/removed classification used by the sync loop; `cache.oauthClients.tryPut(client, max)` is the atomic DCR-cap check. The grocery subcaches (`cache.groceryLists`, `cache.groceryItems`, `cache.groceryIngredients`) and meal subcaches (`cache.meals`, `cache.mealTypes`) are plain `DiskCache<T>` instances with no special subclass.

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
- Tombstone invariants: see `../entity/CLAUDE.md` — PantryStore inherits all tombstone behaviour from `TombstoneEntityStore`

### Pending-writes (issue #57)

`RecipeStore`, `PantryStore`, `AisleStore`, `GroceryListStore`, `GroceryItemStore`, `MealStore`, and `MealTypeStore` all inherit pending-writes tracking from `EntityStore`. `GroceryIngredientStore` does NOT inherit from `EntityStore` and has no pending-writes. See `../entity/CLAUDE.md` for the full invariants. Key cache-layer points:

- Pending-writes is **separate from the pantry tombstone set**: tombstones drive the delete-tool's idempotent "already deleted" message; pending-writes shield the sync loop from rolling back or resurrecting in-flight writes.
- Clearing is **content-equality-based for upserts**: recipes clear when the canonical entry's hash matches the local cache; pantry items clear when the incoming item is field-wise equal via `pantryItemsEqual`. UID-presence-only clearing was rejected because the UID can appear in the canonical list with pre-write content while propagation is still in flight.
- The commit helpers (`commitRecipe` / `commitPantryItem`) wrap cache I/O in `try { … } catch { clearPending(uid); throw }` so a failed local commit doesn't leave a UID shielded for the full TTL window.

## Dependencies

- **Uses:** `entity/` (EntityStore, TombstoneEntityStore base classes and PendingWrite type), `paprika/types` (Recipe, Category, PantryItem, GroceryList, GroceryItem, GroceryIngredient types), `utils/duration` (parseDuration for time filtering)
- **Used by:**
  - `features/` (via `RecipeStore`)
  - `paprika/sync.ts` (via `cache.recipes.diff` / `cache.pantry` / `PantryStore` / `GroceryListStore` / `GroceryItemStore` / `GroceryIngredientStore` for diff and replace-all sync)
  - `tools/` (via `ctx.pantryStore` for pantry reads; `ctx.store` for recipe reads) and `resources/` (via `ctx.store` for recipe reads only)
  - `server/build.ts` (constructs `DiskCacheRoot` with `getCacheDir()`, `RecipeStore`, `PantryStore`, `AisleStore`, `GroceryListStore`, `GroceryItemStore`, and `GroceryIngredientStore`)
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`
