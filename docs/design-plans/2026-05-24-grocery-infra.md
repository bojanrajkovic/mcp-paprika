# Grocery Infrastructure Design

## Summary

This plan makes mcp-paprika aware of Paprika's grocery data by introducing three new entity families — grocery lists, grocery items, and the ingredient catalog — at the type, store, disk-cache, client, and sync-engine layers. No MCP tools or resources are registered; those are designed in `2026-05-24-grocery-surface.md` and depend on this plan landing first. The implementation follows the same layered architecture established for pantry items and recipes: dual Zod schemas for wire parsing, typed in-memory stores extending `EntityStore`, `DiskCache<T>` persistence, `PaprikaClient` read/write methods, and replace-all sync with pending-write filtering.

The ingredient catalog (`/sync/groceryingredients/`) is synced bidirectionally as a lightweight internal reference store (not an `EntityStore` subclass) mapping ingredient names to preferred aisle UIDs. This enables aisle auto-resolution in the tool surface plan. The existing `savePantryItem` is refactored to `savePantryItems` (batch-capable) as part of the client work, since `move_to_pantry` in the surface plan requires batch pantry writes.

## Definition of Done

Build the infrastructure that makes the server aware of grocery data — types, stores, disk cache, client methods, and sync engine integration — so the tool surface plan can register MCP tools on top of it.

**Deliverables:**

1. Grocery list, grocery item, and grocery ingredient entity types with branded UIDs and dual Zod schemas (wire + stored)
2. `GroceryListStore` and `GroceryItemStore` (EntityStore subclasses with tombstone support) plus `GroceryIngredientStore` (lightweight Map-based lookup)
3. Three new `DiskCache<T>` subcaches in `DiskCacheRoot` for persistence
4. Six new `PaprikaClient` methods: three reads (`listGroceryLists`, `listGroceryItems`, `listGroceryIngredients`) and three writes (`saveGroceryList`, `saveGroceryItems`, `saveGroceryIngredient`)
5. `savePantryItem` refactored to `savePantryItems` (batch); existing callers updated
6. `SyncEntityType` extended with `"grocery-lists" | "grocery-items"`; sync engine polls all three grocery entities with replace-all semantics
7. Cold-start hydration and `sync:complete` event emission for grocery entities

**Success criteria:**

- All types parse correctly via both wire and stored schemas; property-based tests on serialization edges
- Stores support CRUD, query (`getByListUid`, `getPurchasedByList`, `findByName`, `lookupByName`), and tombstone operations
- Client methods succeed against msw-mocked endpoints; existing pantry callers work with `savePantryItems`
- Sync engine fetches, filters pending-writes, computes orphans, loads stores, and emits correct `sync:complete` events
- `resourceListChanged()` fires when either grocery-lists or grocery-items events have non-empty changes

**Out of scope:**

- MCP tool registration (see `2026-05-24-grocery-surface.md`)
- Resource template registration
- Documentation updates for tools and resources
- Ingredient consolidation algorithm

## Acceptance Criteria

### grocery-infra.AC1: Type schemas and stores

- **grocery-infra.AC1.1 Success:** A `GroceryList` round-trips through `GroceryListSchema` (snake_case wire) and `GroceryListStoredSchema` (camelCase disk) without loss
- **grocery-infra.AC1.2 Success:** A `GroceryItem` round-trips through `GroceryItemSchema` and `GroceryItemStoredSchema` without loss; `name` field preserves the `"quantity ingredient"` display format
- **grocery-infra.AC1.3 Success:** A `GroceryIngredient` round-trips through both schemas without loss
- **grocery-infra.AC1.4 Success:** Wire JSON with `deleted` omitted parses to `deleted: false` via `.optional().default(false)` on all three entities
- **grocery-infra.AC1.5 Success:** `GroceryItemStore.getByListUid(listUid)` returns only items matching the given `listUid`
- **grocery-infra.AC1.6 Success:** `GroceryItemStore.getPurchasedByList(listUid)` returns only purchased items for the given list
- **grocery-infra.AC1.7 Success:** `GroceryIngredientStore.lookupByName(name)` resolves case-insensitively and returns the ingredient with its `aisleUid`
- **grocery-infra.AC1.8 Success:** `GroceryListStore.findByName(query)` returns results in tiered priority: exact > starts-with > contains
- **grocery-infra.AC1.9 Success:** DiskCache entries for all three entities initialize, persist via `put`, and read back via `getAll`
- **grocery-infra.AC1.10 Edge:** `GroceryIngredientStore.lookupByName` returns `undefined` for unknown ingredient names

### grocery-infra.AC2: Client methods

- **grocery-infra.AC2.1 Success:** `listGroceryLists()` fetches fully-hydrated lists from `/api/v2/sync/grocerylists/` and parses via `GroceryListSchema`
- **grocery-infra.AC2.2 Success:** `listGroceryItems()` fetches items from `/api/v2/sync/groceries/` and parses via `GroceryItemSchema`
- **grocery-infra.AC2.3 Success:** `listGroceryIngredients()` fetches ingredients from `/api/v2/sync/groceryingredients/` and parses via `GroceryIngredientSchema`
- **grocery-infra.AC2.4 Success:** `saveGroceryList(list)` POSTs a single-element gzipped array to `/sync/grocerylists/` and returns the input list on `{result: true}`
- **grocery-infra.AC2.5 Success:** `saveGroceryItems(items)` POSTs an N-element gzipped array to `/sync/groceries/` and returns the input items on `{result: true}`
- **grocery-infra.AC2.6 Success:** `saveGroceryIngredient(ingredient)` POSTs to `/sync/groceryingredients/` and returns the input on success
- **grocery-infra.AC2.7 Success:** `savePantryItems(items)` accepts an array and existing callers work with `[item]`
- **grocery-infra.AC2.8 Failure:** Non-retryable HTTP errors (e.g., 400) throw `PaprikaAPIError` with `status` and `endpoint`
- **grocery-infra.AC2.9 Failure:** Retryable HTTP statuses (429, 500, 502, 503) trigger cockatiel retry+circuit policy

### grocery-infra.AC3: Sync engine integration

- **grocery-infra.AC3.1 Success:** Grocery list sync fetches, filters pending-writes, computes orphans, loads store, and writes to cache (replace-all pattern)
- **grocery-infra.AC3.2 Success:** Grocery item sync follows the same replace-all pattern independently from grocery list sync
- **grocery-infra.AC3.3 Success:** Ingredient catalog sync fetches, filters `deleted: true`, loads store, writes to cache (no pending-write filtering)
- **grocery-infra.AC3.4 Success:** `sync:complete` emits `GroceryListSyncResult` with `changeType: "grocery-lists"` containing correct `added`, `updated`, `removedUids`
- **grocery-infra.AC3.5 Success:** `sync:complete` emits `GroceryItemSyncResult` with `changeType: "grocery-items"` containing correct changes
- **grocery-infra.AC3.6 Success:** Subscriber calls `notifier.resourceListChanged()` when either grocery-lists or grocery-items events have non-empty changes
- **grocery-infra.AC3.7 Success:** `sweepPending` for both grocery stores runs in the finalization step
- **grocery-infra.AC3.8 Success:** Cold-start hydrates all three grocery stores from disk cache before first sync
- **grocery-infra.AC3.9 Edge:** Observation-based clearing for grocery pending-upserts works correctly (UID in canonical list → clear pending)

## Glossary

- **Paprika**: A third-party recipe manager app (iOS, macOS, Android) with a private sync API. This server reverse-engineers and wraps that API.
- **Wire format**: The JSON structure Paprika's sync API sends and receives over HTTP — snake_case field names, soft-delete flags, gzipped payloads.
- **Zod schema**: A TypeScript-first runtime schema validator. Used here in pairs: one schema for the Paprika wire format (snake_case → camelCase transform) and one for the on-disk stored format (camelCase, no transform).
- **Branded UID**: A TypeScript nominal type wrapping a `string` so that a `GroceryListUid` cannot be accidentally passed where a `GroceryItemUid` is expected, even though both are strings at runtime.
- **EntityStore**: The project's in-memory store base class, providing CRUD operations, pending-write tracking, and tombstone support for a single entity type.
- **Tombstone / soft-delete**: Rather than physically removing a record, setting `deleted: true` and retaining the entry. The store remembers deleted UIDs so repeat deletes return a stable idempotent message instead of "not found."
- **Pending writes**: Local mutations (creates, updates, deletes) that have been sent to the Paprika API but not yet confirmed by a sync cycle. The sync engine filters these out of replace-all loads so locally-committed changes are not overwritten by a stale fetch.
- **DiskCache / DiskCacheRoot**: The project's persistence layer. `DiskCacheRoot` holds one `DiskCache<T>` instance per entity type; each subcache reads and writes JSON files under the XDG data directory.
- **AppContext / SessionContext**: Process-wide and per-MCP-session dependency containers, respectively. Stores, the Paprika client, and the notifier all live on `AppContext` and are injected into tools.
- **SyncEngine**: The background polling loop that periodically fetches all entity types from Paprika's sync endpoints, reconciles them against local state, and emits typed `sync:complete` events.
- **Replace-all pattern**: The sync strategy where the engine fetches the full remote list, computes additions/removals by diffing against the current store, and replaces local state wholesale — as opposed to fetching only deltas.
- **Orphan cleanup**: During a replace-all sync, items that exist locally but are absent from the remote fetch are considered deleted server-side and removed from the local store.
- **Cold-start hydration**: Loading entity stores from the on-disk cache at startup, before the first sync cycle completes, so the server can respond to tool calls immediately.
- **`resourceListChanged()`**: An MCP notifier call that tells connected clients the list of available resources has changed, prompting them to re-fetch. Emitted after grocery list or item mutations so clients see up-to-date data.
- **msw (Mock Service Worker)**: A testing library that intercepts `fetch` calls at the network layer and returns fixture responses, used here to unit-test client methods without hitting the real Paprika API.
- **cockatiel**: A resilience library providing retry and circuit-breaker policies, used on Paprika API calls to handle transient failures (429, 5xx) without crashing the server.
- **Gzipped multipart POST**: The wire format Paprika uses for write operations — entities are serialized to JSON, gzip-compressed, and submitted as a multipart form field. All save methods in the client follow this shape.
- **Content / Data / Reference class**: The project's internal taxonomy for entity types (from `docs/mcp-surface-design.md`). Content entities (grocery lists, recipes) get MCP resource templates. Data entities (grocery items) are accessible only through tools. Reference entities (ingredient catalog) are synced internally and never exposed directly.

## Architecture

This plan introduces three Paprika entity families at the infrastructure layers only — no MCP tools or resources are registered here.

**Entity classification (from `docs/mcp-surface-design.md`):**

| Entity             | Class     | Resource                       | Tool Surface                                         |
| ------------------ | --------- | ------------------------------ | ---------------------------------------------------- |
| Grocery list       | Content   | `paprika://grocery-list/{uid}` | list, read, create, rename, delete                   |
| Grocery item       | Data      | —                              | add (batch), update, delete, move_to_pantry, clear\* |
| Grocery ingredient | Reference | —                              | None (internal sync only)                            |

**Key components:**

- **Type schemas** (`src/paprika/types.ts`) — Three new branded UIDs (`GroceryListUid`, `GroceryItemUid`, `GroceryIngredientUid`). Dual Zod schemas per entity: wire `*Schema` (snake_case → camelCase transform) and stored `*StoredSchema` (camelCase, no transform). `SyncEntityType` extended with `"grocery-lists" | "grocery-items"`.
- **GroceryListStore** (`src/cache/grocery-list-store.ts`) — Extends `EntityStore<GroceryList, GroceryListUid>`. Tombstone support for soft-delete idempotency. `lastSyncedAt` getter for resource metadata. `findByName(query)` for tiered name lookup (exact > starts-with > contains).
- **GroceryItemStore** (`src/cache/grocery-item-store.ts`) — Extends `EntityStore<GroceryItem, GroceryItemUid>`. Tombstone support. Adds `getByListUid(listUid): GroceryItem[]` for resource rendering and `getPurchasedByList(listUid): GroceryItem[]` for `clear_purchased`.
- **GroceryIngredientStore** (`src/cache/grocery-ingredient-store.ts`) — Lightweight lookup store, NOT an `EntityStore` subclass. Internal `Map<string, GroceryIngredient>` keyed by lowercase ingredient name. Methods: `load(items[])`, `lookupByName(name): GroceryIngredient | undefined`. No pending-writes.
- **DiskCacheRoot additions** (`src/cache/disk/root.ts`) — Three new `DiskCache<T>` instances: `groceryLists`, `groceryItems`, `groceryIngredients`. Plain base class, no subclasses needed.
- **AppContext additions** (`src/server/app-context.ts`) — Three new readonly fields: `groceryListStore`, `groceryItemStore`, `groceryIngredientStore`.
- **PaprikaClient methods** (`src/paprika/client.ts`) — Three read methods (`listGroceryLists`, `listGroceryItems`, `listGroceryIngredients`), two write methods (`saveGroceryList`, `saveGroceryItems`), one reference write (`saveGroceryIngredient`). Existing `savePantryItem` refactored to `savePantryItems` (batch); existing callers pass `[item]`.
- **SyncEngine** (`src/paprika/sync.ts`) — Three new sync paths after pantry (grocery lists, grocery items, ingredient catalog). Two new `sync:complete` events per cycle. Both grocery event types trigger `resourceListChanged()` via subscriber in `buildAppContext`.

**Ingredient catalog integration:**

The ingredient catalog (`/sync/groceryingredients/`) maps ingredient names to preferred aisle UIDs. It is synced bidirectionally: reads populate `GroceryIngredientStore` for aisle auto-resolution (consumed by the tool surface plan's `add_grocery_item`), and writes update the catalog when an item is added with an explicit aisle assignment. Without the write path, MCP-originated aisle assignments would be lost on the next sync cycle.

## Existing Patterns

| New component                          | Pattern source                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GroceryListStore`                     | `PantryStore` in `src/cache/pantry-store.ts` (EntityStore subclass with tombstones)             |
| `GroceryItemStore`                     | `PantryStore` with added query methods (`getByListUid`, `getPurchasedByList`)                   |
| `GroceryIngredientStore`               | `AisleStore` in `src/cache/aisle-store.ts` (lightweight reference, replace-all)                 |
| DiskCache subcache entries             | Pantry/aisles entries in `DiskCacheRoot` (plain `DiskCache<T>`, no subclass)                    |
| `saveGroceryList` / `saveGroceryItems` | `savePantryItem` in `src/paprika/client.ts` (gzip multipart, `z.boolean()` envelope)            |
| Grocery list sync path                 | Pantry sync path in `src/paprika/sync.ts` (replace-all with pending-write filtering)            |
| Grocery item sync path                 | Pantry sync path (same pattern, independent entity)                                             |
| Ingredient catalog sync path           | Aisle sync path in `src/paprika/sync.ts` (replace-all, simpler — no pending-writes for catalog) |
| Dual Zod schemas                       | `PantryItemSchema` / `PantryItemStoredSchema` in `src/paprika/types.ts`                         |

**Divergences from existing patterns:**

| Aspect                     | Existing pattern                   | Grocery design                                                               |
| -------------------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| Batch writes               | Single-element array always        | `saveGroceryItems` accepts N-element arrays natively                         |
| `savePantryItems` refactor | `savePantryItem` wraps in `[item]` | Renamed to `savePantryItems`, accepts `ReadonlyArray`; callers pass `[item]` |
| Ingredient catalog store   | All stores extend `EntityStore`    | `GroceryIngredientStore` is a plain class with `Map`, no pending-writes      |

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Types and stores

**Goal:** Define grocery entity types, branded UIDs, stores, disk cache entries, and AppContext wiring.

**Components:**

- Branded UIDs (`GroceryListUid`, `GroceryItemUid`, `GroceryIngredientUid`) and dual Zod schemas in `src/paprika/types.ts`
- `SyncEntityType` extended with `"grocery-lists" | "grocery-items"`, new result types added to `AnySyncResult`
- `GroceryListStore` in `src/cache/grocery-list-store.ts` — EntityStore subclass with tombstones, `findByName`, `lastSyncedAt`
- `GroceryItemStore` in `src/cache/grocery-item-store.ts` — EntityStore subclass with tombstones, `getByListUid`, `getPurchasedByList`
- `GroceryIngredientStore` in `src/cache/grocery-ingredient-store.ts` — lightweight Map-based store
- Three new `DiskCache<T>` instances in `DiskCacheRoot` (`groceryLists`, `groceryItems`, `groceryIngredients`)
- AppContext and SessionContext updated with three new store fields
- `buildAppContext` constructs the three stores and passes them through

**Dependencies:** None (first phase)

**Done when:** Types parse correctly (wire and stored formats), stores support CRUD + query operations, DiskCache entries initialize and persist, AppContext compiles with new fields. Covers `grocery-infra.AC1.*`.

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: Client methods

**Goal:** Add Paprika client methods for grocery list, item, and ingredient CRUD, and refactor `savePantryItem` to batch.

**Components:**

- `listGroceryLists()`, `listGroceryItems()`, `listGroceryIngredients()` read methods in `src/paprika/client.ts`
- `saveGroceryList(list)`, `saveGroceryItems(items[])`, `saveGroceryIngredient(ingredient)` write methods
- `groceryListToApiPayload`, `groceryItemToApiPayload`, `groceryIngredientToApiPayload` converters (camelCase → snake_case)
- Private `buildGroceryListFormData`, `buildGroceryItemsFormData` helpers
- Refactor `savePantryItem` → `savePantryItems(items: ReadonlyArray<Readonly<PantryItem>>)`; update three existing callers in `pantry-add.ts`, `pantry-update.ts`, `pantry-delete.ts` to pass `[item]`
- msw handlers for the three grocery sync endpoints
- Tests in `src/paprika/client.test.ts` for all new methods

**Dependencies:** Phase 1 (types and schemas)

**Done when:** All client methods succeed against msw-mocked endpoints, pantry callers work with refactored `savePantryItems`, all gates pass. Covers `grocery-infra.AC2.*`.

<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->

### Phase 3: Sync engine integration

**Goal:** Extend `SyncEngine.syncOnce()` with grocery list, grocery item, and ingredient catalog sync paths.

**Components:**

- Grocery list sync path in `src/paprika/sync.ts` (replace-all with pending-write filtering, orphan cleanup)
- Grocery item sync path (same pattern, independent entity)
- Ingredient catalog sync path (replace-all, no pending-writes, filter `deleted: true`)
- Two new `sync:complete` event emissions: `GroceryListSyncResult` and `GroceryItemSyncResult`
- Subscriber wiring in `buildAppContext`: both grocery event types → `notifier.resourceListChanged()` when changes non-empty
- `sweepPending` for `groceryListStore` and `groceryItemStore` in finalization step
- Cold-start hydration of all three stores from disk cache in `buildAppContext`

**Dependencies:** Phases 1-2 (stores and client methods)

**Done when:** Sync engine fetches grocery lists, items, and ingredients; stores are populated; events emit correctly; resource notifications fire on changes; pending-writes sweep runs. Covers `grocery-infra.AC3.*`.

<!-- END_PHASE_3 -->

## Additional Considerations

**Wire format `name` field derivation.** Grocery items carry both `ingredient` (the base identifier) and `name` (a client-generated display string). Paprika.app formats `name` as `"quantity ingredient"` when quantity is present, or just `ingredient` when empty. The tool surface plan's `add_grocery_item` and `update_grocery_item` follow this convention.

**Ingredient catalog round-trip fidelity.** The ingredient catalog drives Paprika.app's auto-aisle feature. Syncing it read+write ensures aisle assignments made via MCP carry forward to future adds (both MCP and in-app), and vice versa. Without the write path, MCP-originated aisle assignments would be lost on the next sync cycle.

## Documents to Update

| Document                   | Change                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLAUDE.md` (root)         | Add grocery stores and disk cache entries to project structure overview                                                                          |
| `src/paprika/CLAUDE.md`    | Add grocery entity schemas; document `listGrocery*`, `saveGrocery*` client methods; document `savePantryItems` refactor; add grocery wire format |
| `src/cache/CLAUDE.md`      | Add `GroceryListStore`, `GroceryItemStore`, `GroceryIngredientStore` contracts                                                                   |
| `src/cache/disk/CLAUDE.md` | Add grocery subcache entries to DiskCacheRoot documentation and on-disk layout                                                                   |
| `src/server/CLAUDE.md`     | Add three grocery stores to AppContext table; update `buildAppContext` construction order; add grocery event subscribers                         |
| `src/entity/CLAUDE.md`     | Note `GroceryListStore` and `GroceryItemStore` as additional EntityStore subclasses                                                              |
