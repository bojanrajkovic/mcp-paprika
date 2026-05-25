# MCP Tool Definitions

Last verified: 2026-05-24

> Pantry write tools (`add_pantry_item`, `update_pantry_item`) normalize any user-supplied `expirationDate` through `normalizePaprikaDate()` (`paprika/dates.ts`) before persisting. Accepts ISO 8601, `yyyy-MM-dd`, `yyyy/MM/dd`, or the already-Paprika `yyyy-MM-dd HH:mm:ss`. Unparseable input returns a `textResult` error to the LLM rather than writing garbage. `add_pantry_item` stamps `purchaseDate` via `paprikaDateToday()` (today at midnight, Paprika wire format) and generates UIDs as **uppercase** UUID v4 to match what Paprika.app emits.

Purpose: Defines MCP tools that AI assistants can invoke. Each tool file exports a `register*` function that takes `(server: McpServer, ctx: ServerContext)` and calls `server.registerTool()`. Tools with external dependencies (e.g., vector store) accept additional parameters after `ctx`.

## Registered Tools

### Discovery & Query Tools

| Tool                   | File              | Description                                                                           |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| `search_recipes`       | `search.ts`       | Full-text search by name, ingredients, or description                                 |
| `filter_by_ingredient` | `filter.ts`       | Filter recipes by ingredient (all/any mode)                                           |
| `filter_by_time`       | `filter.ts`       | Filter recipes by prep/cook/total time constraints                                    |
| `discover_recipes`     | `discover.ts`     | Semantic search via VectorStore (natural language)                                    |
| `list_categories`      | `categories.ts`   | List all categories with recipe counts                                                |
| `list_aisles`          | `aisles.ts`       | List all aisles sorted by orderFlag, with UID per aisle                               |
| `list_pantry`          | `pantry-list.ts`  | List all pantry items sorted alphabetically by ingredient                             |
| `list_grocery_lists`   | `grocery-list.ts` | List all grocery lists sorted alphabetically by name, with item counts                |
| `read_grocery_list`    | `grocery-list.ts` | Fetch grocery list by UID or name (tiered fuzzy match), returns list metadata + items |

### CRUD Tools

| Tool                  | File               | Description                                                                                                                                                                                                                                                                             |
| --------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_recipe`         | `read.ts`          | Fetch recipe by UID or title (exact/prefix/contains match)                                                                                                                                                                                                                              |
| `create_recipe`       | `create.ts`        | Create a new recipe with name, ingredients, directions, and optional fields                                                                                                                                                                                                             |
| `update_recipe`       | `update.ts`        | Update existing recipe — partial merge, categories fully replace when provided                                                                                                                                                                                                          |
| `delete_recipe`       | `delete.ts`        | Soft-delete recipe by UID (moves to trash, reversible in Paprika app)                                                                                                                                                                                                                   |
| `get_pantry_item`     | `pantry-get.ts`    | Fetch pantry item by UID or ingredient (fuzzy match, with disambiguation)                                                                                                                                                                                                               |
| `add_pantry_item`     | `pantry-add.ts`    | Add a new pantry item; rejects duplicate ingredients (case-insensitive exact match) with the existing UID                                                                                                                                                                               |
| `update_pantry_item`  | `pantry-update.ts` | Update existing pantry item — partial merge; `hasExpiration` is auto-derived when `expirationDate` is provided                                                                                                                                                                          |
| `delete_pantry_item`  | `pantry-delete.ts` | Soft-delete pantry item by UID; idempotent — retried calls return "already deleted" via the store's tombstone set                                                                                                                                                                       |
| `create_grocery_list` | `grocery-list.ts`  | Create a new grocery list; rejects duplicate names (case-insensitive exact match) with the existing UID                                                                                                                                                                                 |
| `rename_grocery_list` | `grocery-list.ts`  | Rename a grocery list; same-name is a no-op, rejects conflicts with other lists                                                                                                                                                                                                         |
| `delete_grocery_list` | `grocery-list.ts`  | Soft-delete grocery list by UID; idempotent — retried calls return "already deleted" via the store's tombstone set                                                                                                                                                                      |
| `add_grocery_items`   | `grocery-item.ts`  | Add 1..N items to a grocery list in a single batch POST; auto-resolves aisle from ingredient catalog or uses explicit aisle and updates catalog; `name` field is `"quantity ingredient"` or just `ingredient` when quantity empty; no duplicate guard — LLM-driven via tool description |
| `update_grocery_item` | `grocery-item.ts`  | Partial-merge update for a grocery item; recalculates `name` when `quantity` changes; `ingredient` is not updatable via this tool                                                                                                                                                       |

## Registration Pattern

Every tool file exports a single registration function. All tool logic accesses data through `ctx.store` (the `RecipeStore` on `ServerContext`), never by importing `paprika/` or `cache/` directly at runtime.

```typescript
import { coldStartGuard, textResult } from "./helpers.js";

export function registerMyTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "tool_name",
    {
      description: "...",
      inputSchema: {
        /* zod */
      },
    },
    async (args) => {
      return coldStartGuard(ctx).match(
        async () => {
          /* store is ready */ return textResult("result");
        },
        (guard) => guard,
      );
    },
  );
}
```

**Variant: external dependencies.** Tools that require services beyond `ServerContext` accept additional constructor-injected parameters. Example: `registerDiscoverTool(server, ctx, vectorStore: VectorStore)` receives the vector store instance from `index.ts`.

## Logger pattern

Each `register*Tool(server, ctx)` creates its own component-scoped child logger at the top of the function body:

```typescript
const log = ctx.log.child({ component: "<mcp-tool-name>" });
```

Component names match the MCP tool name in snake_case (e.g., `add_pantry_item`, `create_recipe`). The child is captured in the handler closures and lives for the session lifetime.

Catch sites use pino's structured method form: `log.error({ err, ...identifyingFields }, "operation failed")`. The identifying fields are the request-scope keys available before the failure (e.g., `uid`, `ingredient`, `name`) — not the full args object. The user-facing `textResult` keeps a human-readable message; the structured record is separate.

Error-level records fan out to connected MCP clients automatically via the multistream (error ≥ default `notifyLevel: "warn"`).

## Shared Helpers

### `helpers.ts`

Utilities imported by recipe tool handlers from `./helpers.js`.

- **`textResult(text)`** -- Wraps a string in the MCP `CallToolResult` envelope.
- **`coldStartGuard(ctx)`** -- Returns `Ok<void>` when store is synced, `Err<CallToolResult>` when empty. Always use `.match()` to handle both branches.
- **`recipeToMarkdown(recipe, categoryNames)`** -- Renders a full recipe as markdown. Resolve categories via `ctx.store.resolveCategories()` before calling. Omits empty optional fields.
- **`commitRecipe(ctx, saved)`** -- Persists a saved recipe to cache and store, triggers cloud sync. Order: `ctx.store.markPendingUpsert(saved.uid)` or `markPendingDelete(saved.uid)` based on `saved.inTrash` (sync, FIRST) → `cache.recipes.put` (async) → `cache.flush` (async) → `store.set` (sync) → `ctx.notifier.resourceListChanged()` (sync) → `notifySync` (async). The pending-write mark is set BEFORE any cache I/O so an in-flight sync cycle that observes the cache mid-commit (between awaits) still sees the pending-write flag and skips reconciling our UID. See `cache/CLAUDE.md` Pending-writes section. Called by all write tools after `ctx.client.saveRecipe()`.
- **`resolveCategoryNames(all, names)`** -- Resolves human-readable category display names to UIDs. Case-insensitive linear scan. Returns `{ uids, unknown }` for warnings.

### `aisle-helpers.ts`

Utilities for aisle resolution imported by pantry write tools from `./aisle-helpers.js`.

- **`aisleStartGuard(ctx)`** — Returns `Ok<void>` when `ctx.aisleStore.hasSynced`, `Err<CallToolResult>` otherwise. Used by `list_aisles`.
- **`commitAisle(ctx, aisle)`** — Upsert-only commit: `markPendingUpsert(uid)` (sync, FIRST) → `cache.aisles.put` (async) → `cache.flush` (async) → `aisleStore.set` (sync) → `notifySync` (async). Wraps cache I/O in try/catch that calls `clearPending(uid)` on failure. No delete branch — aisles are never deleted from the server-side via this server.
- **`ensureAisle(ctx, name)`** — Resolves an aisle display name to `{ aisle: string, aisleUid: string }`. Empty string → `{aisle: "", aisleUid: ""}` without I/O. Found in store → `{aisle: match.name, aisleUid: match.uid}` without I/O. Not found → auto-creates via `client.saveAisle()` using an uppercase UUID v4 UID (matching Paprika.app's wire format for user-created aisles; built-in default aisles use 64-char uppercase hex). Called by `add_pantry_item` and `update_pantry_item` write tools.

### `pantry-helpers.ts`

Utilities imported by pantry tool handlers from `./pantry-helpers.js`.

- **`pantryStartGuard(ctx)`** -- Returns `Ok<void>` when pantry is synced, `Err<CallToolResult>` when not yet synced. Always use `.match()` to handle both branches.
- **`pantryItemToMarkdown(item)`** -- Renders a pantry item as markdown with ingredient, UID, and in-stock status (always rendered) plus quantity, aisle, expiration date, purchase date, and notes when present (omits empty strings and `null` optional fields).
- **`commitPantryItem(ctx, saved)`** -- Persists a saved pantry item to the local cache and store, then triggers cloud sync. Branches on `saved.deleted`: the upsert branch calls `pantryStore.markPendingUpsert(saved.uid)` (sync, FIRST) → `cache.pantry.put` (async) → `cache.flush` (async) → `pantryStore.set` (sync) → `notifySync` (async); the delete branch calls `pantryStore.markPendingDelete(saved.uid)` (sync, FIRST) → `cache.pantry.remove` (async) → `cache.flush` (async) → `pantryStore.delete` (sync) → `notifySync` (async). The pending-write mark is set BEFORE any cache I/O so an in-flight sync cycle that observes the cache mid-commit still sees the pending-write flag and skips reconciling our UID (see `cache/CLAUDE.md` Pending-writes section). Called by all pantry write tools after `ctx.client.savePantryItems()`. Do NOT call `ctx.client.notifySync()` separately in the tool handler — `commitPantryItem` already calls it. No `resourceListChanged()` is emitted — pantry items have no resource surface.

### `grocery-item.ts`

Exports `registerAddGroceryItemsTool` and `registerUpdateGroceryItemTool`. Key design notes:

- **Batch-add semantics:** `add_grocery_items` accepts `listUid` + `items` array (1..N). Aisle resolution and ingredient catalog updates happen in the validation phase (all-or-nothing) before the single `ctx.client.saveGroceryItems(builtItems)` batch POST. The returned array is iterated for `commitGroceryItem` per item.
- **Ingredient catalog update:** When an explicit `aisle` is provided, the handler calls `ctx.client.saveGroceryIngredient(...)` to update (or create) the catalog entry. **The local `GroceryIngredientStore` is NOT updated** — it has no `set` method (replace-all only). The catalog reflects the new aisle on next sync cycle.
- **`name` denormalization:** The `name` field stores `"${quantity} ${ingredient}"` when quantity is non-empty, just `"${ingredient}"` when empty. Recalculated on update.
- **No duplicate guard:** Unlike `add_pantry_item`, there is no code-level duplicate-ingredient check. The tool description instructs the LLM to call `read_grocery_list` before adding.

### `grocery-helpers.ts`

Utilities imported by grocery list tool handlers from `./grocery-helpers.js`.

- **`groceryStartGuard(ctx)`** -- Returns `Ok<void>` when both `ctx.groceryListStore.hasSynced` and `ctx.groceryItemStore.hasSynced` are true, `Err<CallToolResult>` otherwise. Both stores must be synced because `read_grocery_list` inlines items. Always use `.match()` to handle both branches.
- **`commitGroceryList(ctx, saved)`** -- Persists a saved grocery list to the local cache and store, then triggers cloud sync. Branches on `saved.deleted`: the upsert branch calls `groceryListStore.markPendingUpsert(saved.uid)` (sync, FIRST) → `cache.groceryLists.put` (async) → `cache.flush` (async) → `groceryListStore.set` (sync) → `ctx.notifier.resourceListChanged()` (sync) → `notifySync` (async); the delete branch calls `groceryListStore.markPendingDelete(uid)` (sync, FIRST) → `cache.groceryLists.remove` (async) → `cache.flush` (async) → `groceryListStore.delete` (sync) → `ctx.notifier.resourceListChanged()` (sync) → `notifySync` (async). Unlike `commitPantryItem`, both branches call `ctx.notifier.resourceListChanged()` after the store mutation — grocery lists have an MCP resource surface (pantry items do not). The pending-write mark is set BEFORE any cache I/O; cache I/O is wrapped in try/catch that calls `clearPending(uid)` on failure. Called by all grocery list write tools after `ctx.client.saveGroceryList()`.
- **`commitGroceryItem(ctx, saved)`** -- Same pattern as `commitGroceryList` but operates on `groceryItemStore` and `cache.groceryItems`. Also calls `ctx.notifier.resourceListChanged()` after the store mutation because items are inlined in the list resource surface.
- **`groceryListToMarkdown(list, items)`** -- Renders a grocery list as markdown. Outputs the list name as H1, UID, item count, then a markdown table of items (ingredient, quantity, aisle, purchased status). Empty string fields render as `—`.
- **`groceryItemToMarkdown(item)`** -- Renders a single grocery item as markdown. Outputs ingredient as H1, UID, list UID, then conditionally quantity, aisle, purchased status, and instruction/notes when non-empty.

## Testing (`tool-test-utils.ts`)

Shared test utilities for direct tool handler invocation without a real MCP server.

- **`makeTestServer()`** -- Returns a stub `McpServer` that captures tool and resource handlers. Exposes `callTool(name, args)`, `callResourceList(name)`, `callResource(name, uid)`, and a `sendResourceListChanged` spy on the server stub itself. **Note:** `commitRecipe` routes resource-list notifications through `ctx.notifier` instead of `ctx.server.sendResourceListChanged()`. Tests asserting on commit-path notifications should spy on the notifier (see `makeStubNotifier()` below); the `makeTestServer().sendResourceListChanged` spy only fires for direct `server.sendResourceListChanged()` calls, which are no longer made from helper code. `commitPantryItem` does not emit `resourceListChanged` — pantry items have no resource surface.
- **`makeStubNotifier()`** -- Returns `{ notifier, resourceListChanged, loggingMessage }`. The `notifier` satisfies the `Notifier` interface and is wired with `vi.fn()` spies; assert on the returned spies (e.g. `expect(resourceListChanged).toHaveBeenCalledTimes(1)`). Pass `notifier` into `makeCtx(..., { notifier })` for any test that exercises `commitRecipe`/`SyncEngine` notification behavior.
- **`makeCtx(store, server, overrides?)`** -- Creates a minimal `ServerContext` with a real `RecipeStore` and stub `client`/`cache`/`pantryStore`/`vectorStore`/`notifier`. Overrides accept `client`, `cache`, `pantryStore`, `vectorStore`, and `notifier`. Write-tool tests pass `{ client, cache }` with mocked `saveRecipe`/`notifySync` and a nested cache mock like `{ recipes: { put }, flush }` (or `{ pantry: { put, remove }, flush }`) cast to `DiskCacheRoot`, plus a `notifier` from `makeStubNotifier()` when asserting on notifications. If no `notifier` is provided, a no-op notifier is used. `vectorStore` defaults to `null`.
- **`getText(result)`** -- Extracts the text string from a `CallToolResult`.

## Boundaries

- Tool handlers **must not** import client or cache modules from `paprika/` or `cache/` at runtime -- access data through `ctx.store` and `ctx.client` on `ServerContext`.
- Runtime imports of **Zod schemas** from `paprika/types.js` are allowed (e.g., `RecipeUidSchema` for input validation at tool boundaries).
- `import type` from `paprika/` and `cache/` is allowed (no runtime footprint).
- Runtime imports from `utils/` are allowed (cross-cutting utilities, e.g., `parseDuration`).

## Dependencies

- **Used by:** `src/server/build.ts` (`buildMcpServer` registers all 22 tools per server instance; `registerDiscoverTool` only when `app.vectorStore !== null`)
- **Uses:** `types/` (ServerContext alias) and `server/` (`SessionContext`, `Notifier` types), `utils/` (parseDuration -- runtime), `paprika/types.ts` (Zod schemas at runtime + type-only imports), `cache/recipe-store.ts` (type-only imports), `features/vector-store.ts` (type-only imports for `VectorStore`, `SemanticResult`)
