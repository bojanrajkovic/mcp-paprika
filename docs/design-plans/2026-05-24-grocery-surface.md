# Grocery MCP Tool Surface Design

## Summary

This plan registers 11 MCP tools and one resource template for grocery list management, building on the infrastructure delivered by `2026-05-24-grocery-infra.md` (types, stores, client methods, sync engine). The tool surface covers the full lifecycle: list CRUD (`list_grocery_lists`, `read_grocery_list`, `create_grocery_list`, `rename_grocery_list`, `delete_grocery_list`), item CRUD with batch support (`add_grocery_item`, `update_grocery_item`, `delete_grocery_item`), cross-entity operations (`move_to_pantry` with create-first safety ordering), and batch operations (`clear_purchased`, `clear_all`). The `paprika://grocery-list/{uid}` resource template inlines all child items so a single resource read gives the user complete context.

`add_grocery_item` auto-resolves aisles from the ingredient catalog (synced in the infra plan) when the caller omits an aisle, and updates the catalog when an explicit aisle is provided. The tool description guides the LLM to check existing items before adding duplicates, delegating ingredient consolidation to the model's natural reasoning rather than implementing an algorithm. `move_to_pantry` accepts batch UIDs and uses create-first ordering — pantry items are created before grocery items are deleted — so partial failures leave duplicates rather than data loss.

## Definition of Done

Register the full MCP tool surface and resource template for grocery lists and items on top of the grocery infrastructure from `2026-05-24-grocery-infra.md`.

**Hard dependency:** `2026-05-24-grocery-infra.md` must be fully implemented before this plan begins. All stores, client methods, and sync paths must be operational.

**Deliverables:**

1. 11 MCP tools: `list_grocery_lists`, `read_grocery_list`, `create_grocery_list`, `rename_grocery_list`, `delete_grocery_list`, `add_grocery_item` (1..N batch), `update_grocery_item` (quantity, aisle, notes, purchased), `delete_grocery_item`, `move_to_pantry` (1..N batch), `clear_purchased`, `clear_all`
2. Resource template `paprika://grocery-list/{uid}` (Content class, inlines child items per `docs/mcp-surface-design.md`)
3. Shared helpers: `groceryStartGuard`, `commitGroceryList`, `commitGroceryItem`, markdown renderers
4. `docs/tools/` reference docs for all 11 grocery tools
5. README updated with grocery tool descriptions
6. All affected CLAUDE.md files updated

**Success criteria:**

- All tools pass unit tests with msw fixtures using `makeTestServer()` + `makeCtx()` pattern
- `add_grocery_item` auto-resolves aisles from the ingredient catalog when aisle is omitted
- `move_to_pantry` batch-creates pantry items first, then batch-deletes grocery items (create-first order)
- `clear_purchased` and `clear_all` send single batch POSTs
- Resource template renders metadata header with inlined items table
- Ingredient consolidation delegated to LLM via tool description guidance

**Out of scope:**

- Ingredient consolidation algorithm (LLM handles with list visibility)
- Item reordering within a list
- Apple Reminders / Siri integration
- MCP tool surface for the ingredient→aisle catalog (internal sync only)

## Acceptance Criteria

### grocery-surface.AC1: Grocery list tools

- **grocery-surface.AC1.1 Success:** `list_grocery_lists` returns a markdown table of all non-deleted lists with names, UIDs, and item counts
- **grocery-surface.AC1.2 Success:** `read_grocery_list` accepts a UID and returns the list metadata plus all items as markdown
- **grocery-surface.AC1.3 Success:** `read_grocery_list` accepts a name string and resolves via tiered lookup (exact > starts-with > contains)
- **grocery-surface.AC1.4 Success:** `create_grocery_list` generates an uppercase UUID, saves with defaults (`isDefault: false`, `orderFlag: 0`, `remindersList: "Paprika"`), and returns the new list
- **grocery-surface.AC1.5 Success:** `rename_grocery_list` updates the name and saves the list
- **grocery-surface.AC1.6 Success:** `delete_grocery_list` sets `deleted: true` and saves without cascading to items
- **grocery-surface.AC1.7 Failure:** `create_grocery_list` rejects a duplicate name (case-insensitive) with the existing list's UID
- **grocery-surface.AC1.8 Failure:** `rename_grocery_list` rejects a name that conflicts with another existing list
- **grocery-surface.AC1.9 Failure:** `groceryStartGuard` blocks all list tools before first sync
- **grocery-surface.AC1.10 Edge:** `rename_grocery_list` with the same name as current is a no-op, returning the existing list
- **grocery-surface.AC1.11 Edge:** `delete_grocery_list` on an already-deleted list returns a tombstone-aware idempotent message (depends on `GroceryListStore` tombstone support from `grocery-infra.AC1.*`)

### grocery-surface.AC2: Grocery item tools

- **grocery-surface.AC2.1 Success:** `add_grocery_item` with a single item creates the item with correct `name` field (`"quantity ingredient"` when quantity present, just `ingredient` when empty)
- **grocery-surface.AC2.2 Success:** `add_grocery_item` with multiple items sends a single batch POST and commits each item
- **grocery-surface.AC2.3 Success:** `add_grocery_item` auto-resolves aisle from the ingredient catalog when aisle is omitted and a catalog entry exists
- **grocery-surface.AC2.4 Success:** `add_grocery_item` with an explicit aisle uses `ensureAisle()` and updates the ingredient catalog entry
- **grocery-surface.AC2.5 Success:** `update_grocery_item` performs partial merge — only provided fields change, all others retain store baseline values
- **grocery-surface.AC2.6 Success:** `update_grocery_item` with `purchased: true` toggles the purchased status
- **grocery-surface.AC2.7 Success:** `update_grocery_item` recalculates the `name` field when quantity or ingredient changes
- **grocery-surface.AC2.8 Success:** `delete_grocery_item` sets `deleted: true` and commits
- **grocery-surface.AC2.9 Failure:** `add_grocery_item` with an invalid `listUid` (list not found) returns an error before any API calls
- **grocery-surface.AC2.10 Failure:** `add_grocery_item` batch with any invalid item rejects the entire batch (all-or-nothing)
- **grocery-surface.AC2.11 Failure:** `update_grocery_item` with unknown UID returns "no item found"
- **grocery-surface.AC2.12 Failure:** `groceryStartGuard` blocks all item tools before first sync
- **grocery-surface.AC2.13 Edge:** `delete_grocery_item` on an already-deleted item returns a tombstone-aware idempotent message

### grocery-surface.AC3: Cross-entity and batch tools

- **grocery-surface.AC3.1 Success:** `move_to_pantry` with a single UID creates a pantry item (with `ingredient`, `aisle`, `aisleUid`, `purchaseDate: today`, `quantity: ""`) then deletes the grocery item
- **grocery-surface.AC3.2 Success:** `move_to_pantry` with multiple UIDs batch-creates pantry items first, then batch-deletes grocery items (create-first order)
- **grocery-surface.AC3.3 Success:** `clear_purchased` deletes all purchased items in the specified list via a single batch POST
- **grocery-surface.AC3.4 Success:** `clear_all` deletes all items in the specified list via a single batch POST
- **grocery-surface.AC3.5 Failure:** `move_to_pantry` with a tombstoned UID returns "already deleted" without touching pantry
- **grocery-surface.AC3.6 Failure:** `move_to_pantry` partial failure (pantry create succeeds, grocery delete fails) returns a structured message identifying the partial state
- **grocery-surface.AC3.7 Edge:** `clear_purchased` on a list with no purchased items returns an informational message, not an error
- **grocery-surface.AC3.8 Edge:** `clear_all` on an empty list returns an informational message, not an error

### grocery-surface.AC4: Resource surface and documentation

- **grocery-surface.AC4.1 Success:** `paprika://grocery-list/{uid}` resource read renders metadata header (UID, URI, Last synced) plus list name and items table
- **grocery-surface.AC4.2 Success:** Resource list returns all non-deleted grocery lists with display name and URI
- **grocery-surface.AC4.3 Success:** Resource items table shows ingredient, quantity, aisle, and purchased status per item
- **grocery-surface.AC4.4 Success:** `docs/tools/` contains one reference doc per grocery tool (11 total)
- **grocery-surface.AC4.5 Success:** README lists all grocery tools
- **grocery-surface.AC4.6 Failure:** Resource read for an unknown UID returns a clear error
- **grocery-surface.AC4.7 Success:** All CLAUDE.md files listed in Documents to Update table are updated accurately

## Glossary

- **MCP (Model Context Protocol)**: An open protocol that exposes server-defined tools and resources to AI model clients (Claude Desktop, Claude Mobile, etc.). Tools are callable functions; resources are readable data objects.
- **MCP tool**: A named function registered with an MCP server that an AI assistant can invoke. Tools here map to user-facing operations like `add_grocery_item` or `delete_grocery_list`.
- **Resource template**: An MCP resource whose URI contains a variable segment (e.g., `paprika://grocery-list/{uid}`). The server resolves the template to a specific entity when the client reads it.
- **Content / Data / Reference class**: The project's internal taxonomy for entity types (from `docs/mcp-surface-design.md`). Content entities (grocery lists, recipes) get MCP resource templates. Data entities (grocery items) are accessible only through tools. Reference entities (ingredient catalog) are synced internally and never exposed directly.
- **neverthrow**: A TypeScript library for railway-oriented error handling. Operations that can fail return `Result<T, E>` instead of throwing; the project convention is to chain results with `.match()` / `.andThen()`, never to inspect `.isOk()` / `.isErr()` imperatively.
- **`ensureAisle()`**: An internal helper (established in the pantry implementation) that resolves or creates an aisle record given a name string, returning the aisle's UID for use in item payloads.
- **`resourceListChanged()`**: An MCP notifier call that tells connected clients the list of available resources has changed, prompting them to re-fetch. Emitted after grocery list or item mutations so clients see up-to-date data.
- **Tombstone / soft-delete**: Rather than physically removing a record, setting `deleted: true` and retaining the entry. The store remembers deleted UIDs so repeat deletes return a stable idempotent message instead of "not found."
- **Pending writes**: Local mutations (creates, updates, deletes) that have been sent to the Paprika API but not yet confirmed by a sync cycle. The sync engine filters these out of replace-all loads so locally-committed changes are not overwritten by a stale fetch.
- **msw (Mock Service Worker)**: A testing library that intercepts `fetch` calls at the network layer and returns fixture responses, used here to unit-test client methods and tools without hitting the real Paprika API.
- **Gzipped multipart POST**: The wire format Paprika uses for write operations — entities are serialized to JSON, gzip-compressed, and submitted as a multipart form field. All save methods in the client follow this shape.
- **Cold-start hydration**: Loading entity stores from the on-disk cache at startup, before the first sync cycle completes, so the server can respond to tool calls immediately.

## Architecture

This plan registers 11 MCP tools and one resource template, consuming the stores, client methods, and sync engine delivered by `2026-05-24-grocery-infra.md`.

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

- **Commit helpers** (`src/tools/grocery-helpers.ts`) — `commitGroceryList(ctx, list)` and `commitGroceryItem(ctx, item)` follow `commitPantryItem`'s ordering: mark pending FIRST → cache → flush → store → notifySync. Both emit `resourceListChanged()` (items affect the list resource because it inlines children).
- **Start guard** (`src/tools/grocery-helpers.ts`) — `groceryStartGuard(ctx)` returns `Err<CallToolResult>` until both `groceryListStore.hasSynced` and `groceryItemStore.hasSynced`.
- **Markdown renderers** (`src/tools/grocery-helpers.ts`) — `groceryListToMarkdown(list, items[])` and `groceryItemToMarkdown(item)` for consistent tool output.
- **Resource template** (`src/resources/grocery-lists.ts`) — `paprika://grocery-list/{uid}` renders metadata header (UID, URI, Last synced) plus list name plus items table (ingredient, quantity, aisle, purchased).

**Cross-entity operation — `move_to_pantry`:**

The two-step create-first order ensures the worst failure mode is duplication (item in both grocery and pantry) rather than data loss (item in neither). The grocery item's `ingredient`, `aisle`, and `aisleUid` carry over directly; `quantity` maps to empty string (pantry tracks quantity differently); `purchaseDate` defaults to today via `paprikaDateToday()`.

**Ingredient catalog integration in `add_grocery_item`:**

When the caller omits an aisle, the tool consults `groceryIngredientStore.lookupByName(ingredient)` to auto-fill the aisle from the user's prior assignments. When an explicit aisle is provided, the tool updates the catalog entry via `saveGroceryIngredient`, maintaining round-trip fidelity with the Paprika app. The tool description guides the LLM to check existing items via `read_grocery_list` before adding, delegating ingredient consolidation to the model's reasoning.

## Existing Patterns

| New component                             | Pattern source                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `commitGroceryList` / `commitGroceryItem` | `commitPantryItem` in `src/tools/pantry-helpers.ts` (pending → cache → flush → store → notify) |
| `groceryStartGuard`                       | `pantryStartGuard` in `src/tools/pantry-helpers.ts`                                            |
| Tool registration                         | `registerAddPantryItemTool` in `src/tools/pantry-add.ts`                                       |
| Soft-delete via `deleted` flag            | `delete_pantry_item` in `src/tools/pantry-delete.ts`                                           |
| Tombstone-aware idempotency               | `PantryStore._tombstones` pattern                                                              |
| Resource rendering                        | `src/resources/recipes.ts` (metadata header + body content)                                    |
| Tiered name lookup                        | `PantryStore.findByIngredient` (exact > starts-with > contains)                                |
| Partial-merge update                      | `update_pantry_item` in `src/tools/pantry-update.ts`                                           |

**Divergences from existing patterns:**

| Aspect              | Existing pattern                     | Grocery design                                                                    |
| ------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| Batch adds          | One item per tool call               | `add_grocery_item` accepts 1..N items in a single call                            |
| Cross-entity tool   | Tools operate on one entity type     | `move_to_pantry` writes to both grocery and pantry endpoints                      |
| Duplicate rejection | `add_pantry_item` rejects duplicates | `add_grocery_item` allows duplicates (tool description guides LLM to check first) |

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Grocery list tools and helpers

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

**Dependencies:** `grocery-infra` fully implemented (types, stores, client, sync all operational)

**Done when:** All five list tools register and handle documented cases (create, rename, delete, duplicate rejection, tiered lookup, start guard). Covers `grocery-surface.AC1.*`.

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: Grocery item tools with ingredient catalog integration

**Goal:** Register the three grocery item tools with aisle auto-resolution from the ingredient catalog.

**Components:**

- `registerAddGroceryItemTool` in `src/tools/grocery-item.ts` — accepts `listUid` + `items[]` (1..N). For each item: auto-resolves aisle from `groceryIngredientStore.lookupByName()` when omitted, uses `ensureAisle()` when explicit. Constructs `name` field as `"quantity ingredient"`. Updates ingredient catalog on aisle assignment via `saveGroceryIngredient`. Tool description guides LLM to check for existing ingredients before adding.
- `registerUpdateGroceryItemTool` — accepts `uid` + partial fields (quantity, aisle, instruction, purchased). Recalculates `name` on qty/ingredient change.
- `registerDeleteGroceryItemTool` — soft-delete, tombstone idempotency (PantryStore pattern)
- All wired in `buildMcpServer`
- Tests covering batch add, single add, aisle auto-resolution, catalog update, partial merge, purchased toggle, delete idempotency

**Dependencies:** Phase 1 (helpers and list tools operational)

**Done when:** All three item tools handle documented cases, aisle auto-resolution works from ingredient catalog, catalog updates on aisle assignment, batch adds save as single POST. Covers `grocery-surface.AC2.*`.

<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->

### Phase 3: Cross-entity and batch tools

**Goal:** Register `move_to_pantry`, `clear_purchased`, and `clear_all` tools.

**Components:**

- `registerMoveToPantryTool` in `src/tools/grocery-move.ts` — accepts `uids[]` (1..N). Create-first order: builds pantry items from grocery item fields → `savePantryItems(batch)` → `commitPantryItem` per item → `saveGroceryItems(batch deleted:true)` → `commitGroceryItem` per item. Tombstone check first. Structured partial-failure message on grocery delete failure.
- `registerClearPurchasedTool` in `src/tools/grocery-clear.ts` — accepts `listUid`. Filters `groceryItemStore.getPurchasedByList(listUid)`. Batch-deletes via `saveGroceryItems`. Informational message on empty results.
- `registerClearAllTool` — same pattern, all items in the list
- All wired in `buildMcpServer`
- Tests covering batch move, partial failure, empty clear, tombstone check

**Dependencies:** Phases 1-2 (helpers, list tools, item tools)

**Done when:** `move_to_pantry` creates pantry items then deletes grocery items in correct order, `clear_purchased` and `clear_all` batch-delete correctly, edge cases handled. Covers `grocery-surface.AC3.*`.

<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->

### Phase 4: Resource surface and documentation

**Goal:** Register the `paprika://grocery-list/{uid}` resource and update all documentation.

**Components:**

- `registerGroceryListResources(server, ctx)` in `src/resources/grocery-lists.ts` — resource list returns all non-deleted lists with URI; resource read renders metadata header + list name + items table
- Resource registered in `buildMcpServer` alongside recipe resources
- `docs/tools/` reference docs for all 11 grocery tools (one markdown file each)
- README updated with grocery tool descriptions
- CLAUDE.md files updated per Documents to Update table

**Dependencies:** Phases 1-3 (full tool surface must exist for doc accuracy)

**Done when:** Resource template renders correctly with inlined items, docs accurately describe all tools, all quality gates pass. Covers `grocery-surface.AC4.*`.

<!-- END_PHASE_4 -->

## Additional Considerations

**`move_to_pantry` quantity mapping.** Grocery items use `quantity` for shopping amounts ("2 lbs", "1 dozen"). Pantry items use `quantity` for stock tracking. These are semantically different, so `move_to_pantry` sets the pantry item's `quantity` to empty string rather than carrying over the grocery quantity. The pantry item inherits `ingredient`, `aisle`, and `aisleUid` directly.

**No cascade on list delete.** The wire captures from #59 show that deleting a grocery list does NOT emit item deletes — Paprika handles item cleanup server-side. `delete_grocery_list` soft-deletes the list only; items become orphans that the sync engine removes on the next cycle.

**Batch validation strategy.** `add_grocery_item` validates all items in the batch (list UID exists, aisle resolution, field normalization) before making any API calls. If any item fails validation, the entire batch is rejected. This avoids partial saves that would be difficult for the LLM to reason about.

## Documents to Update

| Document                  | Change                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md` (root)        | Add grocery tools to project structure overview                                                                                  |
| `src/tools/CLAUDE.md`     | Add all 11 grocery tools to registered tools table; add `commitGroceryList`, `commitGroceryItem`, `groceryStartGuard` to helpers |
| `src/resources/CLAUDE.md` | Add `paprika://grocery-list/{uid}` resource template documentation                                                               |
| `src/server/CLAUDE.md`    | Update `buildMcpServer` to document grocery tool and resource registration                                                       |
