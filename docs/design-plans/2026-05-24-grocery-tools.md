# Grocery List MCP Tools Design

## Summary

This design adds grocery list management to mcp-paprika, an MCP server that bridges AI assistants to the Paprika recipe manager app. Paprika already manages grocery lists and items in its mobile and desktop clients; this work exposes that same data through 11 MCP tools and one resource template, letting an LLM agent read, create, and modify grocery lists on the user's behalf. The implementation introduces three new entity families — grocery lists, grocery items, and an ingredient catalog — each following the same layered architecture already established for pantry items and recipes: Zod schemas for wire parsing, typed in-memory stores, disk-cache persistence, Paprika API client methods, and sync engine integration.

The ingredient catalog deserves special mention: Paprika tracks which aisle each ingredient belongs to internally, and this design syncs that catalog bidirectionally. When an LLM adds a grocery item without specifying an aisle, the server auto-fills it from the catalog; when the LLM does specify an aisle, the catalog is updated so future adds inherit that preference. The `move_to_pantry` tool crosses entity boundaries — it creates a pantry item and then deletes the grocery item in a deliberate create-first order, so a failure mid-operation leaves a duplicate rather than losing the item entirely. The design is structured as seven sequential implementation phases, each building on the previous, and all tools are testable in isolation using msw-mocked Paprika API endpoints.

## Definition of Done

Implement the full MCP tool surface for grocery lists and grocery items, including sync engine integration, a resource template for grocery lists, and internal ingredient catalog sync for transparent aisle auto-resolution. All tools tested with msw fixtures derived from the #59 wire format captures.

**Deliverables:**

1. 11 MCP tools: `list_grocery_lists`, `read_grocery_list`, `create_grocery_list`, `rename_grocery_list`, `delete_grocery_list`, `add_grocery_item` (1..N batch), `update_grocery_item` (quantity, aisle, notes, purchased), `delete_grocery_item`, `move_to_pantry`, `clear_purchased`, `clear_all`
2. Resource template `paprika://grocery-list/{uid}` (Content class, inlines child items)
3. Grocery list and grocery item entity types, stores, disk cache subcaches, and Paprika client methods — following EntityStore/DiskCache patterns from #88/#89
4. Ingredient catalog (`/sync/groceryingredients/`) synced internally (read + write) powering aisle auto-resolution in `add_grocery_item`
5. Sync engine extended to poll grocery lists, grocery items, and ingredient catalog alongside existing entities
6. README and `docs/tools/` reference docs updated

**Success criteria:**

- All tools pass unit tests with msw fixtures; property-based tests on serialization edges
- `move_to_pantry` atomically deletes the grocery item and creates the pantry item (two-step sync to `/sync/groceries/` and `/sync/pantry/`)
- `add_grocery_item` auto-resolves aisles from the ingredient catalog when aisle is omitted
- Sync engine emits change events for grocery lists (Content class → `resourceListChanged()`)
- No MCP tool surface for the ingredient→aisle mapping (synced internally only)
- Ingredient consolidation handled naturally by the LLM using existing list visibility — no dedicated tool

**Out of scope:**

- Ingredient consolidation algorithm (LLM handles this naturally with list visibility)
- Item reordering within a list
- Apple Reminders / Siri integration
- MCP tool surface for the ingredient→aisle catalog (internal sync only)

## Acceptance Criteria

### grocery-tools.AC1: Type schemas and stores

- **grocery-tools.AC1.1 Success:** A `GroceryList` round-trips through `GroceryListSchema` (snake_case wire) and `GroceryListStoredSchema` (camelCase disk) without loss
- **grocery-tools.AC1.2 Success:** A `GroceryItem` round-trips through `GroceryItemSchema` and `GroceryItemStoredSchema` without loss; `name` field preserves the `"quantity ingredient"` display format
- **grocery-tools.AC1.3 Success:** A `GroceryIngredient` round-trips through both schemas without loss
- **grocery-tools.AC1.4 Success:** Wire JSON with `deleted` omitted parses to `deleted: false` via `.optional().default(false)` on all three entities
- **grocery-tools.AC1.5 Success:** `GroceryItemStore.getByListUid(listUid)` returns only items matching the given `listUid`
- **grocery-tools.AC1.6 Success:** `GroceryItemStore.getPurchasedByList(listUid)` returns only purchased items for the given list
- **grocery-tools.AC1.7 Success:** `GroceryIngredientStore.lookupByName(name)` resolves case-insensitively and returns the ingredient with its `aisleUid`
- **grocery-tools.AC1.8 Success:** `GroceryListStore.findByName(query)` returns results in tiered priority: exact > starts-with > contains
- **grocery-tools.AC1.9 Success:** DiskCache entries for all three entities initialize, persist via `put`, and read back via `getAll`
- **grocery-tools.AC1.10 Edge:** `GroceryIngredientStore.lookupByName` returns `undefined` for unknown ingredient names

### grocery-tools.AC2: Client methods

- **grocery-tools.AC2.1 Success:** `listGroceryLists()` fetches fully-hydrated lists from `/api/v2/sync/grocerylists/` and parses via `GroceryListSchema`
- **grocery-tools.AC2.2 Success:** `listGroceryItems()` fetches items from `/api/v2/sync/groceries/` and parses via `GroceryItemSchema`
- **grocery-tools.AC2.3 Success:** `listGroceryIngredients()` fetches ingredients from `/api/v2/sync/groceryingredients/` and parses via `GroceryIngredientSchema`
- **grocery-tools.AC2.4 Success:** `saveGroceryList(list)` POSTs a single-element gzipped array to `/sync/grocerylists/` and returns the input list on `{result: true}`
- **grocery-tools.AC2.5 Success:** `saveGroceryItems(items)` POSTs an N-element gzipped array to `/sync/groceries/` and returns the input items on `{result: true}`
- **grocery-tools.AC2.6 Success:** `saveGroceryIngredient(ingredient)` POSTs to `/sync/groceryingredients/` and returns the input on success
- **grocery-tools.AC2.7 Success:** `savePantryItems(items)` accepts an array and existing callers work with `[item]`
- **grocery-tools.AC2.8 Failure:** Non-retryable HTTP errors (e.g., 400) throw `PaprikaAPIError` with `status` and `endpoint`
- **grocery-tools.AC2.9 Failure:** Retryable HTTP statuses (429, 500, 502, 503) trigger cockatiel retry+circuit policy

### grocery-tools.AC3: Sync engine integration

- **grocery-tools.AC3.1 Success:** Grocery list sync fetches, filters pending-writes, computes orphans, loads store, and writes to cache (replace-all pattern)
- **grocery-tools.AC3.2 Success:** Grocery item sync follows the same replace-all pattern independently from grocery list sync
- **grocery-tools.AC3.3 Success:** Ingredient catalog sync fetches, filters `deleted: true`, loads store, writes to cache (no pending-write filtering)
- **grocery-tools.AC3.4 Success:** `sync:complete` emits `GroceryListSyncResult` with `changeType: "grocery-lists"` containing correct `added`, `updated`, `removedUids`
- **grocery-tools.AC3.5 Success:** `sync:complete` emits `GroceryItemSyncResult` with `changeType: "grocery-items"` containing correct changes
- **grocery-tools.AC3.6 Success:** Subscriber calls `notifier.resourceListChanged()` when either grocery-lists or grocery-items events have non-empty changes
- **grocery-tools.AC3.7 Success:** `sweepPending` for both grocery stores runs in the finalization step
- **grocery-tools.AC3.8 Success:** Cold-start hydrates all three grocery stores from disk cache before first sync
- **grocery-tools.AC3.9 Edge:** Observation-based clearing for grocery pending-upserts works correctly (UID in canonical list → clear pending)

### grocery-tools.AC4: Grocery list tools

- **grocery-tools.AC4.1 Success:** `list_grocery_lists` returns a markdown table of all non-deleted lists with names, UIDs, and item counts
- **grocery-tools.AC4.2 Success:** `read_grocery_list` accepts a UID and returns the list metadata plus all items as markdown
- **grocery-tools.AC4.3 Success:** `read_grocery_list` accepts a name string and resolves via tiered lookup (exact > starts-with > contains)
- **grocery-tools.AC4.4 Success:** `create_grocery_list` generates an uppercase UUID, saves with defaults (`isDefault: false`, `orderFlag: 0`, `remindersList: "Paprika"`), and returns the new list
- **grocery-tools.AC4.5 Success:** `rename_grocery_list` updates the name and saves the list
- **grocery-tools.AC4.6 Success:** `delete_grocery_list` sets `deleted: true` and saves without cascading to items
- **grocery-tools.AC4.7 Failure:** `create_grocery_list` rejects a duplicate name (case-insensitive) with the existing list's UID
- **grocery-tools.AC4.8 Failure:** `rename_grocery_list` rejects a name that conflicts with another existing list
- **grocery-tools.AC4.9 Failure:** `groceryStartGuard` blocks all list tools before first sync
- **grocery-tools.AC4.10 Edge:** `rename_grocery_list` with the same name as current is a no-op, returning the existing list
- **grocery-tools.AC4.11 Edge:** `delete_grocery_list` on an already-deleted list returns a tombstone-aware idempotent message

### grocery-tools.AC5: Grocery item tools

- **grocery-tools.AC5.1 Success:** `add_grocery_item` with a single item creates the item with correct `name` field (`"quantity ingredient"` when quantity present, just `ingredient` when empty)
- **grocery-tools.AC5.2 Success:** `add_grocery_item` with multiple items sends a single batch POST and commits each item
- **grocery-tools.AC5.3 Success:** `add_grocery_item` auto-resolves aisle from the ingredient catalog when aisle is omitted and a catalog entry exists
- **grocery-tools.AC5.4 Success:** `add_grocery_item` with an explicit aisle uses `ensureAisle()` and updates the ingredient catalog entry
- **grocery-tools.AC5.5 Success:** `update_grocery_item` performs partial merge — only provided fields change, all others retain store baseline values
- **grocery-tools.AC5.6 Success:** `update_grocery_item` with `purchased: true` toggles the purchased status
- **grocery-tools.AC5.7 Success:** `update_grocery_item` recalculates the `name` field when quantity or ingredient changes
- **grocery-tools.AC5.8 Success:** `delete_grocery_item` sets `deleted: true` and commits
- **grocery-tools.AC5.9 Failure:** `add_grocery_item` with an invalid `listUid` (list not found) returns an error before any API calls
- **grocery-tools.AC5.10 Failure:** `add_grocery_item` batch with any invalid item rejects the entire batch (all-or-nothing)
- **grocery-tools.AC5.11 Failure:** `update_grocery_item` with unknown UID returns "no item found"
- **grocery-tools.AC5.12 Failure:** `groceryStartGuard` blocks all item tools before first sync
- **grocery-tools.AC5.13 Edge:** `delete_grocery_item` on an already-deleted item returns a tombstone-aware idempotent message

### grocery-tools.AC6: Cross-entity and batch tools

- **grocery-tools.AC6.1 Success:** `move_to_pantry` with a single UID creates a pantry item (with `ingredient`, `aisle`, `aisleUid`, `purchaseDate: today`, `quantity: ""`) then deletes the grocery item
- **grocery-tools.AC6.2 Success:** `move_to_pantry` with multiple UIDs batch-creates pantry items first, then batch-deletes grocery items (create-first order)
- **grocery-tools.AC6.3 Success:** `clear_purchased` deletes all purchased items in the specified list via a single batch POST
- **grocery-tools.AC6.4 Success:** `clear_all` deletes all items in the specified list via a single batch POST
- **grocery-tools.AC6.5 Failure:** `move_to_pantry` with a tombstoned UID returns "already deleted" without touching pantry
- **grocery-tools.AC6.6 Failure:** `move_to_pantry` partial failure (pantry create succeeds, grocery delete fails) returns a structured message identifying the partial state
- **grocery-tools.AC6.7 Edge:** `clear_purchased` on a list with no purchased items returns an informational message, not an error
- **grocery-tools.AC6.8 Edge:** `clear_all` on an empty list returns an informational message, not an error

### grocery-tools.AC7: Resource surface and documentation

- **grocery-tools.AC7.1 Success:** `paprika://grocery-list/{uid}` resource read renders metadata header (UID, URI, Last synced) plus list name and items table
- **grocery-tools.AC7.2 Success:** Resource list returns all non-deleted grocery lists with display name and URI
- **grocery-tools.AC7.3 Success:** Resource items table shows ingredient, quantity, aisle, and purchased status per item
- **grocery-tools.AC7.4 Success:** `docs/tools/` contains one reference doc per grocery tool (11 total)
- **grocery-tools.AC7.5 Success:** README lists all grocery tools
- **grocery-tools.AC7.6 Failure:** Resource read for an unknown UID returns a clear error
- **grocery-tools.AC7.7 Success:** All CLAUDE.md files listed in Documents to Update table are updated accurately

## Glossary

- **MCP (Model Context Protocol)**: An open protocol that exposes server-defined tools and resources to AI model clients (Claude Desktop, Claude Mobile, etc.). Tools are callable functions; resources are readable data objects.
- **MCP tool**: A named function registered with an MCP server that an AI assistant can invoke. Tools here map to user-facing operations like `add_grocery_item` or `delete_grocery_list`.
- **Resource template**: An MCP resource whose URI contains a variable segment (e.g., `paprika://grocery-list/{uid}`). The server resolves the template to a specific entity when the client reads it.
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
- **msw (Mock Service Worker)**: A testing library that intercepts `fetch` calls at the network layer and returns fixture responses, used here to unit-test client methods and tools without hitting the real Paprika API.
- **cockatiel**: A resilience library providing retry and circuit-breaker policies, used on Paprika API calls to handle transient failures (429, 5xx) without crashing the server.
- **neverthrow**: A TypeScript library for railway-oriented error handling. Operations that can fail return `Result<T, E>` instead of throwing; the project convention is to chain results with `.match()` / `.andThen()`, never to inspect `.isOk()` / `.isErr()` imperatively.
- **Gzipped multipart POST**: The wire format Paprika uses for write operations — entities are serialized to JSON, gzip-compressed, and submitted as a multipart form field. All save methods in the client follow this shape.
- **`ensureAisle()`**: An internal helper (established in the pantry implementation) that resolves or creates an aisle record given a name string, returning the aisle's UID for use in item payloads.
- **Orphan cleanup**: During a replace-all sync, items that exist locally but are absent from the remote fetch are considered deleted server-side and removed from the local store.
- **`resourceListChanged()`**: An MCP notifier call that tells connected clients the list of available resources has changed, prompting them to re-fetch. Emitted after grocery list or item mutations so clients see up-to-date data.
- **Cold-start hydration**: Loading entity stores from the on-disk cache at startup, before the first sync cycle completes, so the server can respond to tool calls immediately.
- **Content / Data / Reference class**: The project's internal taxonomy for entity types. Content entities (grocery lists, recipes) get MCP resource templates. Data entities (grocery items) are accessible only through tools. Reference entities (ingredient catalog) are synced internally and never exposed directly.

## Architecture

Grocery tool support introduces three Paprika entity families — grocery lists, grocery items, and the ingredient catalog — each with types, stores, disk cache, client methods, and sync integration. The tool surface totals 11 MCP tools plus one resource template. The wire format flows through two primary endpoints (`/sync/grocerylists/`, `/sync/groceries/`) and one reference endpoint (`/sync/groceryingredients/`), all using the same gzipped-JSON-array multipart POST shape as pantry writes.

**Entity classification (from `docs/mcp-surface-design.md`):**

| Entity             | Class     | Resource                       | Tool Surface                                         |
| ------------------ | --------- | ------------------------------ | ---------------------------------------------------- |
| Grocery list       | Content   | `paprika://grocery-list/{uid}` | list, read, create, rename, delete                   |
| Grocery item       | Data      | —                              | add (batch), update, delete, move_to_pantry, clear\* |
| Grocery ingredient | Reference | —                              | None (internal sync only)                            |

**Data flow — writes:**

```
create/rename/delete_grocery_list
  → build GroceryList with deleted: false or true
  → ctx.client.saveGroceryList(list)        // single-element array POST /sync/grocerylists/
  → commitGroceryList(ctx, saved)
       ├─ if saved.deleted:
       │    markPendingDelete → cache.remove → flush → store.delete → notifySync
       └─ else:
            markPendingUpsert → cache.put → flush → store.set → notifySync
       └─ always: notifier.resourceListChanged()

add/update/delete_grocery_item, clear_purchased, clear_all
  → build GroceryItem(s) with deleted: false or true
  → ctx.client.saveGroceryItems(items[])    // N-element array POST /sync/groceries/
  → commitGroceryItem(ctx, saved) per item
       ├─ if saved.deleted:
       │    markPendingDelete → cache.remove → flush → store.delete → notifySync
       └─ else:
            markPendingUpsert → cache.put → flush → store.set → notifySync
       └─ always: notifier.resourceListChanged()  (items affect list resource)

move_to_pantry (uids[])
  → build PantryItem[] from GroceryItem fields
  → ctx.client.savePantryItems(pantryItems)  // CREATE FIRST — /sync/pantry/
  → commitPantryItem(ctx, saved) per item
  → ctx.client.saveGroceryItems(items.map(i => {...i, deleted: true}))  // THEN DELETE
  → commitGroceryItem(ctx, deleted) per item
```

**Key components:**

- **Type schemas** (`src/paprika/types.ts`) — Three new branded UIDs (`GroceryListUid`, `GroceryItemUid`, `GroceryIngredientUid`). Dual Zod schemas per entity: wire `*Schema` (snake_case → camelCase transform) and stored `*StoredSchema` (camelCase, no transform). `SyncEntityType` extended with `"grocery-lists" | "grocery-items"`.
- **GroceryListStore** (`src/cache/grocery-list-store.ts`) — Extends `EntityStore<GroceryList, GroceryListUid>`. Tombstone support for soft-delete idempotency. `lastSyncedAt` getter for resource metadata. `findByName(query)` for tiered name lookup (exact > starts-with > contains).
- **GroceryItemStore** (`src/cache/grocery-item-store.ts`) — Extends `EntityStore<GroceryItem, GroceryItemUid>`. Tombstone support. Adds `getByListUid(listUid): GroceryItem[]` for resource rendering and `getPurchasedByList(listUid): GroceryItem[]` for `clear_purchased`.
- **GroceryIngredientStore** (`src/cache/grocery-ingredient-store.ts`) — Lightweight lookup store, NOT an `EntityStore` subclass. Internal `Map<string, GroceryIngredient>` keyed by lowercase ingredient name. Methods: `load(items[])`, `lookupByName(name): GroceryIngredient | undefined`. No pending-writes.
- **DiskCacheRoot additions** (`src/cache/disk/root.ts`) — Three new `DiskCache<T>` instances: `groceryLists`, `groceryItems`, `groceryIngredients`. Plain base class, no subclasses needed.
- **AppContext additions** (`src/server/app-context.ts`) — Three new readonly fields: `groceryListStore`, `groceryItemStore`, `groceryIngredientStore`.
- **PaprikaClient methods** (`src/paprika/client.ts`) — Three read methods (`listGroceryLists`, `listGroceryItems`, `listGroceryIngredients`), two write methods (`saveGroceryList`, `saveGroceryItems`), one reference write (`saveGroceryIngredient`). Existing `savePantryItem` refactored to `savePantryItems` (batch); existing callers pass `[item]`.
- **SyncEngine** (`src/paprika/sync.ts`) — Three new sync paths after pantry (grocery lists, grocery items, ingredient catalog). Two new `sync:complete` events per cycle. Both grocery event types trigger `resourceListChanged()` via subscriber in `buildAppContext`.
- **Resource template** (`src/resources/grocery-lists.ts`) — `paprika://grocery-list/{uid}` with metadata header and inlined items table.

**Cross-entity operation — `move_to_pantry`:**

The two-step create-first order ensures the worst failure mode is duplication (item in both grocery and pantry) rather than data loss (item in neither). The grocery item's `ingredient`, `aisle`, and `aisleUid` carry over directly; `quantity` maps to empty string (pantry tracks quantity differently); `purchaseDate` defaults to today via `paprikaDateToday()`.

**Ingredient catalog integration:**

The ingredient catalog (`/sync/groceryingredients/`) maps ingredient names to preferred aisle UIDs. `add_grocery_item` consults `groceryIngredientStore.lookupByName(ingredient)` when the caller omits an aisle, auto-filling the aisle from the user's prior assignments. When an item is added with an explicit aisle, the catalog entry is created or updated via `saveGroceryIngredient`, maintaining round-trip fidelity with the Paprika app.

## Existing Patterns

This design follows established patterns from the pantry and recipe implementations:

| New component                             | Pattern source                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GroceryListStore`                        | `PantryStore` in `src/cache/pantry-store.ts` (EntityStore subclass with tombstones)             |
| `GroceryItemStore`                        | `PantryStore` with added query methods (`getByListUid`, `getPurchasedByList`)                   |
| `GroceryIngredientStore`                  | `AisleStore` in `src/cache/aisle-store.ts` (lightweight reference, replace-all)                 |
| DiskCache subcache entries                | Pantry/aisles entries in `DiskCacheRoot` (plain `DiskCache<T>`, no subclass)                    |
| `saveGroceryList` / `saveGroceryItems`    | `savePantryItem` in `src/paprika/client.ts` (gzip multipart, `z.boolean()` envelope)            |
| `commitGroceryList` / `commitGroceryItem` | `commitPantryItem` in `src/tools/pantry-helpers.ts` (pending → cache → flush → store → notify)  |
| `groceryStartGuard`                       | `pantryStartGuard` in `src/tools/pantry-helpers.ts`                                             |
| Grocery list sync path                    | Pantry sync path in `src/paprika/sync.ts` (replace-all with pending-write filtering)            |
| Grocery item sync path                    | Pantry sync path (same pattern, independent entity)                                             |
| Ingredient catalog sync path              | Aisle sync path in `src/paprika/sync.ts` (replace-all, simpler — no pending-writes for catalog) |
| Dual Zod schemas                          | `PantryItemSchema` / `PantryItemStoredSchema` in `src/paprika/types.ts`                         |
| Tool registration                         | `registerAddPantryItemTool` in `src/tools/pantry-add.ts`                                        |
| Soft-delete via `deleted` flag            | `delete_pantry_item` in `src/tools/pantry-delete.ts`                                            |
| Tombstone-aware idempotency               | `PantryStore._tombstones` pattern                                                               |
| Resource rendering                        | `src/resources/recipes.ts` (metadata header + body content)                                     |

**Divergences from existing patterns:**

| Aspect                     | Existing pattern                     | Grocery design                                                                    |
| -------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| Batch writes               | Single-element array always          | `saveGroceryItems` accepts N-element arrays natively                              |
| `savePantryItems` refactor | `savePantryItem` wraps in `[item]`   | Renamed to `savePantryItems`, accepts `ReadonlyArray`; callers pass `[item]`      |
| Ingredient catalog store   | All stores extend `EntityStore`      | `GroceryIngredientStore` is a plain class with `Map`, no pending-writes           |
| Cross-entity tool          | Tools operate on one entity type     | `move_to_pantry` writes to both grocery and pantry endpoints                      |
| Duplicate rejection        | `add_pantry_item` rejects duplicates | `add_grocery_item` allows duplicates (tool description guides LLM to check first) |

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

**Done when:** Types parse correctly (wire and stored formats), stores support CRUD + query operations, DiskCache entries initialize and persist, AppContext compiles with new fields. Covers `grocery-tools.AC1.*`.

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

**Done when:** All client methods succeed against msw-mocked endpoints, pantry callers work with refactored `savePantryItems`, all gates pass. Covers `grocery-tools.AC2.*`.

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

**Done when:** Sync engine fetches grocery lists, items, and ingredients; stores are populated; events emit correctly; resource notifications fire on changes; pending-writes sweep runs. Covers `grocery-tools.AC3.*`.

<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->

### Phase 4: Grocery list tools and helpers

**Goal:** Register the five grocery list tools and shared helper functions.

**Components:**

- `groceryStartGuard(ctx)`, `commitGroceryList(ctx, list)`, `commitGroceryItem(ctx, item)`, `groceryListToMarkdown`, `groceryItemToMarkdown` in `src/tools/grocery-helpers.ts`
- `registerListGroceryListsTool` — returns all lists as markdown table with item counts
- `registerReadGroceryListTool` — accepts UID or name (tiered lookup), returns list metadata + items
- `registerCreateGroceryListTool` — accepts name, generates uppercase UUID, rejects duplicate names
- `registerRenameGroceryListTool` — accepts uid + newName, rejects conflicts, no-op if same name
- `registerDeleteGroceryListTool` — soft-delete, tombstone idempotency, no cascade
- All registered in `src/tools/grocery-list.ts`, wired in `buildMcpServer`
- Tests using `makeTestServer()` + `makeCtx()` pattern

**Dependencies:** Phases 1-3 (types, client, sync — sync required for `groceryStartGuard`)

**Done when:** All five list tools register and handle documented cases (create, rename, delete, duplicate rejection, tiered lookup, start guard). Covers `grocery-tools.AC4.*`.

<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->

### Phase 5: Grocery item tools with ingredient catalog integration

**Goal:** Register the three grocery item tools with aisle auto-resolution from the ingredient catalog.

**Components:**

- `registerAddGroceryItemTool` in `src/tools/grocery-item.ts` — accepts `listUid` + `items[]` (1..N). For each item: auto-resolves aisle from `groceryIngredientStore.lookupByName()` when omitted, uses `ensureAisle()` when explicit. Constructs `name` field as `"quantity ingredient"`. Updates ingredient catalog on aisle assignment via `saveGroceryIngredient`. Tool description guides LLM to check for existing ingredients before adding.
- `registerUpdateGroceryItemTool` — accepts `uid` + partial fields (quantity, aisle, instruction, purchased). Recalculates `name` on qty/ingredient change.
- `registerDeleteGroceryItemTool` — soft-delete, tombstone idempotency (PantryStore pattern)
- All wired in `buildMcpServer`
- Tests covering batch add, single add, aisle auto-resolution, catalog update, partial merge, purchased toggle, delete idempotency

**Dependencies:** Phases 1-4 (types, client, sync, helpers)

**Done when:** All three item tools handle documented cases, aisle auto-resolution works from ingredient catalog, catalog updates on aisle assignment, batch adds save as single POST. Covers `grocery-tools.AC5.*`.

<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->

### Phase 6: Cross-entity and batch tools

**Goal:** Register `move_to_pantry`, `clear_purchased`, and `clear_all` tools.

**Components:**

- `registerMoveToPantryTool` in `src/tools/grocery-move.ts` — accepts `uids[]` (1..N). Create-first order: builds pantry items from grocery item fields → `savePantryItems(batch)` → `commitPantryItem` per item → `saveGroceryItems(batch deleted:true)` → `commitGroceryItem` per item. Tombstone check first. Structured partial-failure message on grocery delete failure.
- `registerClearPurchasedTool` in `src/tools/grocery-clear.ts` — accepts `listUid`. Filters `groceryItemStore.getPurchasedByList(listUid)`. Batch-deletes via `saveGroceryItems`. Informational message on empty results.
- `registerClearAllTool` — same pattern, all items in the list
- All wired in `buildMcpServer`
- Tests covering batch move, partial failure, empty clear, tombstone check

**Dependencies:** Phases 1-5 (full item tool surface + pantry client for move)

**Done when:** `move_to_pantry` creates pantry items then deletes grocery items in correct order, `clear_purchased` and `clear_all` batch-delete correctly, edge cases handled. Covers `grocery-tools.AC6.*`.

<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->

### Phase 7: Resource surface and documentation

**Goal:** Register the `paprika://grocery-list/{uid}` resource and update all documentation.

**Components:**

- `registerGroceryListResources(server, ctx)` in `src/resources/grocery-lists.ts` — resource list returns all non-deleted lists with URI; resource read renders metadata header + list name + items table
- Resource registered in `buildMcpServer` alongside recipe resources
- `docs/tools/` reference docs for all 11 grocery tools (one markdown file each)
- README updated with grocery tool descriptions
- CLAUDE.md files updated per Documents to Update table

**Dependencies:** Phases 1-6 (full tool surface must exist for doc accuracy)

**Done when:** Resource template renders correctly with inlined items, docs accurately describe all tools, all quality gates pass. Covers `grocery-tools.AC7.*`.

<!-- END_PHASE_7 -->

## Additional Considerations

**Wire format `name` field derivation.** Grocery items carry both `ingredient` (the base identifier) and `name` (a client-generated display string). Paprika.app formats `name` as `"quantity ingredient"` when quantity is present, or just `ingredient` when empty. `add_grocery_item` and `update_grocery_item` follow this convention to maintain visual consistency with items added via the Paprika app.

**Ingredient catalog round-trip fidelity.** The ingredient catalog drives Paprika.app's auto-aisle feature. Syncing it read+write ensures aisle assignments made via MCP carry forward to future adds (both MCP and in-app), and vice versa. Without the write path, MCP-originated aisle assignments would be lost on the next sync cycle.

**`move_to_pantry` quantity mapping.** Grocery items use `quantity` for shopping amounts ("2 lbs", "1 dozen"). Pantry items use `quantity` for stock tracking. These are semantically different, so `move_to_pantry` sets the pantry item's `quantity` to empty string rather than carrying over the grocery quantity. The pantry item inherits `ingredient`, `aisle`, and `aisleUid` directly.

**No cascade on list delete.** The wire captures from #59 show that deleting a grocery list does NOT emit item deletes — Paprika handles item cleanup server-side. `delete_grocery_list` soft-deletes the list only; items become orphans that the sync engine removes on the next cycle.

**Batch validation strategy.** `add_grocery_item` validates all items in the batch (list UID exists, aisle resolution, field normalization) before making any API calls. If any item fails validation, the entire batch is rejected. This avoids partial saves that would be difficult for the LLM to reason about.

## Documents to Update

| Document                   | Change                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md` (root)         | Add grocery tools to project structure overview; add grocery stores and disk cache entries to component list                                                         |
| `src/paprika/CLAUDE.md`    | Add grocery entity schemas; document `listGrocery*`, `saveGrocery*` client methods; document `savePantryItems` refactor; add grocery wire format section             |
| `src/cache/CLAUDE.md`      | Add `GroceryListStore`, `GroceryItemStore`, `GroceryIngredientStore` contracts                                                                                       |
| `src/cache/disk/CLAUDE.md` | Add grocery subcache entries to DiskCacheRoot documentation and on-disk layout                                                                                       |
| `src/tools/CLAUDE.md`      | Add all 11 grocery tools to registered tools table; add `commitGroceryList`, `commitGroceryItem`, `groceryStartGuard` to helpers; document `savePantryItems` rename  |
| `src/server/CLAUDE.md`     | Add `groceryListStore`, `groceryItemStore`, `groceryIngredientStore` to AppContext table; update `buildAppContext` construction order; add grocery event subscribers |
| `src/resources/CLAUDE.md`  | Add `paprika://grocery-list/{uid}` resource template documentation                                                                                                   |
| `src/entity/CLAUDE.md`     | Note `GroceryListStore` and `GroceryItemStore` as additional EntityStore subclasses                                                                                  |
