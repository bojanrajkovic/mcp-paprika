# Recipe CRUD Tools Design

## Summary

This work adds four MCP tools — `read_recipe`, `create_recipe`, `update_recipe`, and `delete_recipe` — that give AI assistants the ability to read and modify recipes in a user's Paprika account. Paprika is a recipe manager that stores its data in the cloud; this server acts as a bridge between an AI assistant and that account. Until now the server only supported read-only discovery (searching, filtering, listing categories). These four tools complete the core CRUD surface.

Each tool is implemented as a standalone TypeScript file under `src/tools/`, following the same registration pattern already established by the existing discovery tools. Read operations work entirely against the in-process `RecipeStore` (a local copy populated at startup) without making any network calls. Write operations (`create_recipe`, `update_recipe`, `delete_recipe`) call `PaprikaClient.saveRecipe()` to persist the change to the Paprika cloud API, then update both the in-process store and the on-disk cache through a shared `commitRecipe` helper, and finally notify the sync engine so other clients see the change. Deletion is implemented as a soft-delete (`inTrash: true`) rather than a hard removal. All four tools are guarded against running before the store has been populated by the background sync.

## Definition of Done

Four MCP tool files added under `src/tools/`, each exporting a `register*` function with signature `(server: McpServer, ctx: ServerContext): void`:

- **`read_recipe`** (`src/tools/read.ts`): Accepts a UID or title. UID lookup delegates to `ctx.store.get(uid)`; title lookup delegates to `ctx.store.findByName(title)` (tiered exact → startsWith → includes). Returns the recipe as markdown via `recipeToMarkdown`, or a not-found message.

- **`create_recipe`** (`src/tools/create.ts`): Accepts `name` (required), `ingredients` (required), `directions` (required), and optional fields. Generates a UUID for the new recipe, resolves any provided category names to UIDs, calls `ctx.client.saveRecipe()`, updates `ctx.store` and `ctx.cache`, then returns the created recipe as markdown.

- **`update_recipe`** (`src/tools/update.ts`): Accepts a UID and one or more fields to change. Fetches the current recipe from `ctx.store`, merges the provided fields, calls `ctx.client.saveRecipe()` + `ctx.client.notifySync()`, updates `ctx.store` and `ctx.cache`, then returns the updated recipe as markdown.

- **`delete_recipe`** (`src/tools/delete.ts`): Accepts a **UID only** (no fuzzy title matching — deletion is destructive). Fetches the recipe, sets `inTrash: true`, calls `ctx.client.saveRecipe()` + `ctx.client.notifySync()`, updates `ctx.store` and `ctx.cache`, then returns a confirmation message.

All four tools use `coldStartGuard(ctx)` and surface API errors as `textResult("Failed to ...: ${error.message}")`. Unit tests for all four tools use `vi.fn()` mock `PaprikaClient` methods.

## Acceptance Criteria

### p2-recipe-crud.AC1: read_recipe returns recipe content

- **p2-recipe-crud.AC1.1 Success:** UID lookup returns the recipe as markdown
- **p2-recipe-crud.AC1.2 Success:** Exact title match returns the single matching recipe as markdown
- **p2-recipe-crud.AC1.3 Success:** Partial title match (startsWith/includes) returns the recipe when exactly one match exists
- **p2-recipe-crud.AC1.4 Success:** Multiple title matches return a disambiguation list with name and UID for each
- **p2-recipe-crud.AC1.5 Failure:** UID not found returns a not-found message
- **p2-recipe-crud.AC1.6 Failure:** Title search with no matches returns a not-found message
- **p2-recipe-crud.AC1.7 Failure:** Neither uid nor title provided returns an error message
- **p2-recipe-crud.AC1.8 Failure:** Cold-start (store empty) returns cold-start guard error
- **p2-recipe-crud.AC1.9 Edge:** Both uid and title provided — uid takes precedence

### p2-recipe-crud.AC2: create_recipe creates and persists a new recipe

- **p2-recipe-crud.AC2.1 Success:** Required fields (name, ingredients, directions) creates a recipe returned as markdown
- **p2-recipe-crud.AC2.2 Success:** Optional fields provided are reflected in the returned recipe
- **p2-recipe-crud.AC2.3 Success:** Optional fields omitted default to null (not empty string)
- **p2-recipe-crud.AC2.4 Success:** Valid category names are resolved to UIDs and stored on the recipe
- **p2-recipe-crud.AC2.5 Success:** saveRecipe and notifySync are called exactly once each
- **p2-recipe-crud.AC2.6 Success:** store.set and cache.putRecipe called with the saved recipe
- **p2-recipe-crud.AC2.7 Failure:** Unrecognized category name is skipped and a warning appears in output
- **p2-recipe-crud.AC2.8 Failure:** saveRecipe throws — returns error message, store/cache not updated
- **p2-recipe-crud.AC2.9 Failure:** Cold-start guard fires before any API call

### p2-recipe-crud.AC3: update_recipe applies partial updates

- **p2-recipe-crud.AC3.1 Success:** Provided fields are updated; omitted fields retain their existing values
- **p2-recipe-crud.AC3.2 Success:** Providing categories replaces the existing category list entirely
- **p2-recipe-crud.AC3.3 Success:** Omitting categories leaves existing categories unchanged
- **p2-recipe-crud.AC3.4 Success:** saveRecipe and notifySync called with the merged recipe
- **p2-recipe-crud.AC3.5 Failure:** UID not found returns not-found message
- **p2-recipe-crud.AC3.6 Failure:** saveRecipe throws — returns error message
- **p2-recipe-crud.AC3.7 Failure:** Cold-start guard fires before store lookup

### p2-recipe-crud.AC4: delete_recipe soft-deletes by UID

- **p2-recipe-crud.AC4.1 Success:** Recipe is soft-deleted (inTrash: true) and confirmation returned
- **p2-recipe-crud.AC4.2 Success:** saveRecipe called with inTrash: true, notifySync called once
- **p2-recipe-crud.AC4.3 Success:** store.set and cache.putRecipe called with the trashed recipe
- **p2-recipe-crud.AC4.4 Failure:** UID not found returns not-found message
- **p2-recipe-crud.AC4.5 Failure:** Recipe already in trash returns 'already in trash' message
- **p2-recipe-crud.AC4.6 Failure:** saveRecipe throws — returns error message
- **p2-recipe-crud.AC4.7 Failure:** Cold-start guard fires before store lookup

## Glossary

- **MCP (Model Context Protocol)**: An open protocol that lets AI assistants invoke typed tools and read resources exposed by a server. This codebase implements one such server.
- **MCP tool**: A named, schema-validated callable endpoint registered with an MCP server. AI assistants discover and invoke tools by name; the server executes the handler and returns a structured result.
- **McpServer**: The SDK class from `@modelcontextprotocol/sdk` that manages the MCP wire protocol over stdio, handles tool/resource registration, and dispatches incoming calls.
- **ServerContext**: A plain immutable record (`{ client, cache, store, server }`) constructed once at startup and threaded through every tool and resource handler as a dependency-injection vehicle.
- **PaprikaClient**: The HTTP client for the Paprika cloud API. Wraps authenticated requests for reading and writing recipe data, category lists, and sync notifications.
- **RecipeStore**: An in-process query layer over the disk cache. Holds the current snapshot of all recipes and categories; supports UID lookup, fuzzy title search, and category resolution without network calls.
- **DiskCache**: The on-disk persistence layer. Stores serialized recipe data locally so the server survives restarts without a full re-sync from the cloud.
- **`coldStartGuard`**: A helper that returns an error result immediately if the `RecipeStore` has not yet been populated. Guards all four tools against operating on an empty or partial dataset.
- **cold-start**: The brief window after server launch before the background sync has finished populating the `RecipeStore` with data from the Paprika cloud.
- **`commitRecipe`**: A new shared helper that encapsulates the four-step write sequence: write to the disk cache, flush the cache to disk, update the in-process store, and notify the Paprika sync engine.
- **`resolveCategoryNames`**: A new shared helper that converts human-readable category display names (as an AI would supply them) into the opaque `CategoryUid` values the Paprika API requires. Uses a case-insensitive scan.
- **CategoryUid**: An opaque string identifier for a Paprika category, distinct from its human-readable display name.
- **soft-delete**: Marking a record as deleted (setting `inTrash: true`) without removing it from storage. The record remains in the Paprika database but is treated as trashed.
- **`saveRecipe`**: The `PaprikaClient` method used for both creating and updating recipes. Paprika's API uses a single upsert endpoint keyed on the recipe's UID.
- **`notifySync`**: A `PaprikaClient` method that signals the Paprika cloud to propagate the latest changes to other clients (e.g., the iOS or macOS Paprika app).
- **UUID**: A randomly generated universally unique identifier. `create_recipe` generates one to assign as the UID for each new recipe before calling `saveRecipe`.
- **title disambiguation**: When a fuzzy title search returns more than one recipe, the tool returns a list of matching name+UID pairs instead of guessing, letting the caller re-invoke with a specific UID.
- **`ZodRawShape`**: A plain object of Zod field definitions passed directly to `server.registerTool()` as the `inputSchema`. Distinct from a `z.object()` wrapper — the MCP SDK constructs the wrapper internally.
- **neverthrow `Result<T, E>`**: A type from the `neverthrow` library representing either a success value (`Ok<T>`) or a failure value (`Err<E>`). Used instead of throwing exceptions; always consumed with `.match()`, `.andThen()`, or `.map()`.
- **`vi.fn()`**: A Vitest utility that creates a mock function. Write tool tests inject mocks for `saveRecipe`, `notifySync`, `putRecipe`, and `flush` to verify call counts without hitting real APIs or disk.
- **`makeCtx`**: A test utility in `tool-test-utils.ts` that assembles a minimal `ServerContext` for use in unit tests. Extended in this work to accept an `overrides` parameter so write-tool tests can inject mock client and cache objects.

## Architecture

Four MCP tools extending `src/tools/` with recipe CRUD capabilities. Each is a standalone file exporting a single `register*` function.

**Registration pattern** (identical to existing tools):

```typescript
export function registerReadTool(server: McpServer, ctx: ServerContext): void;
export function registerCreateTool(server: McpServer, ctx: ServerContext): void;
export function registerUpdateTool(server: McpServer, ctx: ServerContext): void;
export function registerDeleteTool(server: McpServer, ctx: ServerContext): void;
```

**Data access flow:**

- Read-only operations (`read_recipe`) touch only `ctx.store` — no network calls, no cache writes.
- Write operations (`create_recipe`, `update_recipe`, `delete_recipe`) call `ctx.client.saveRecipe()`, then commit to local state via `commitRecipe()`.

**New shared helpers added to `src/tools/helpers.ts`:**

```typescript
// Persists a saved recipe to cache and store, then triggers cloud sync
async function commitRecipe(ctx: ServerContext, saved: Recipe): Promise<void>;
// cache.putRecipe(saved, saved.hash)  [void/sync — not awaited]
// await cache.flush()
// store.set(saved)
// await client.notifySync()

// Resolves category display names to CategoryUid values
function resolveCategoryNames(
  all: Array<Category>,
  names: Array<string>,
): { uids: Array<CategoryUid>; unknown: Array<string> };
// Case-insensitive linear scan; unknown names returned for caller to warn about
```

**Test utility extension in `src/tools/tool-test-utils.ts`:**

```typescript
// Backward-compatible: existing read-tool tests pass no overrides
function makeCtx(
  store: RecipeStore,
  server: McpServer,
  overrides: Partial<Pick<ServerContext, "client" | "cache">> = {},
): ServerContext;
```

Write tool tests inject `{ saveRecipe: vi.fn(), notifySync: vi.fn() }` and `{ putRecipe: vi.fn(), flush: vi.fn() }` via the overrides parameter.

**Input schemas** (ZodRawShape — raw shape objects, not `z.object()` wrappers):

| Tool            | Required                                       | Optional                                                                                                                                                |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_recipe`   | one of `uid` or `title` (validated in handler) | both are optional in schema                                                                                                                             |
| `create_recipe` | `name`, `ingredients`, `directions`            | `description`, `notes`, `servings`, `prepTime`, `cookTime`, `totalTime`, `categories`, `source`, `sourceUrl`, `difficulty`, `rating`, `nutritionalInfo` |
| `update_recipe` | `uid`                                          | all content fields from `create_recipe`                                                                                                                 |
| `delete_recipe` | `uid`                                          | none                                                                                                                                                    |

**Category resolution** (`create_recipe`, `update_recipe` only): accepts category names as strings, resolves to `CategoryUid` values via case-insensitive scan of `ctx.store.getAllCategories()`. Unrecognized names are skipped with a warning prepended to the output. For `update_recipe`, providing `categories` fully replaces the existing list; omitting `categories` preserves it unchanged.

**Title disambiguation** (`read_recipe` only): `store.findByName(title)` returns recipes from the first matching tier (exact → startsWith → includes). When multiple recipes match, the tool returns a disambiguation list of name + UID pairs rather than guessing which one was intended.

## Existing Patterns

All four tools follow the pattern established by `src/tools/search.ts`, `src/tools/filter.ts`, and `src/tools/categories.ts`:

- `coldStartGuard(ctx).match(okFn, errFn)` wraps every handler — guards against store not yet populated
- `textResult(text)` wraps all string outputs into `CallToolResult`
- `recipeToMarkdown(recipe, categoryNames)` renders full recipe output; category names resolved via `ctx.store.resolveCategories(recipe.categories)`
- Tool tests use `makeTestServer()` + `makeCtx(store, server)` + `callTool(name, args)` from `tool-test-utils.ts`

The write tools introduce the first use of `ctx.client` and `ctx.cache` from tool handlers. Prior tools are read-only and access only `ctx.store`. The `commitRecipe` helper encapsulates the consistent 4-step write sequence so each tool handler doesn't repeat it.

`client.deleteRecipe()` (which fetches from the API, sets `inTrash: true`, saves, and calls `notifySync`) is intentionally not used here. It does not update `ctx.store` or `ctx.cache`, making it unsuitable for tools that must keep local state consistent.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Shared Helpers and Test Utilities

**Goal:** Add `commitRecipe` and `resolveCategoryNames` to `helpers.ts`, extend `makeCtx` in `tool-test-utils.ts`. These are prerequisites for all write tools.

**Components:**

- `src/tools/helpers.ts` — add `commitRecipe(ctx, saved)` and `resolveCategoryNames(all, names)`
- `src/tools/tool-test-utils.ts` — extend `makeCtx` signature with optional `overrides` parameter

**Dependencies:** None (extends existing files)

**Done when:** `pnpm build` succeeds; existing tests for `search_recipes`, `filter_by_*`, and `list_categories` continue to pass unchanged

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: `read_recipe` Tool

**Goal:** Implement and test `read_recipe` — UID lookup and fuzzy title search.

**Components:**

- `src/tools/read.ts` — `registerReadTool(server, ctx)` registering the `read_recipe` MCP tool
- `src/tools/read.test.ts` — unit tests covering all ACs for `read_recipe`

**Dependencies:** Phase 1

**Done when:** Tests pass covering `p2-recipe-crud.AC1.*` (UID lookup, title search, disambiguation, cold-start guard, neither-provided error)

<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->

### Phase 3: `delete_recipe` Tool

**Goal:** Implement and test `delete_recipe` — UID-only soft-delete with local state update.

**Components:**

- `src/tools/delete.ts` — `registerDeleteTool(server, ctx)` registering the `delete_recipe` MCP tool
- `src/tools/delete.test.ts` — unit tests covering all ACs for `delete_recipe`

**Dependencies:** Phase 1 (`commitRecipe` helper)

**Done when:** Tests pass covering `p2-recipe-crud.AC4.*` (UID lookup, already-trashed guard, saveRecipe/notifySync called, store/cache updated, not-found case)

<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->

### Phase 4: `create_recipe` Tool

**Goal:** Implement and test `create_recipe` — UUID generation, category resolution, POST to API, local state update.

**Components:**

- `src/tools/create.ts` — `registerCreateTool(server, ctx)` registering the `create_recipe` MCP tool
- `src/tools/create.test.ts` — unit tests covering all ACs for `create_recipe`

**Dependencies:** Phase 1 (`commitRecipe`, `resolveCategoryNames`)

**Done when:** Tests pass covering `p2-recipe-crud.AC2.*` (required fields, optional fields with null defaults, category resolution, unknown category warning, saveRecipe/notifySync called, API error surfaced)

<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->

### Phase 5: `update_recipe` Tool

**Goal:** Implement and test `update_recipe` — partial merge over existing recipe, save, and local state update.

**Components:**

- `src/tools/update.ts` — `registerUpdateTool(server, ctx)` registering the `update_recipe` MCP tool
- `src/tools/update.test.ts` — unit tests covering all ACs for `update_recipe`

**Dependencies:** Phase 1 (`commitRecipe`, `resolveCategoryNames`); Phase 2 and 3 complete (validates full write flow)

**Done when:** Tests pass covering `p2-recipe-crud.AC3.*` (partial merge preserves unset fields, categories replace on update, not-found case, saveRecipe/notifySync called, API error surfaced)

<!-- END_PHASE_5 -->

## Additional Considerations

**`client.deleteRecipe()` is not used.** That method fetches a recipe from the API and marks it trashed, but does not update `ctx.store` or `ctx.cache`. The `delete_recipe` tool fetches from the local store and calls `saveRecipe` directly, keeping all state consistent.

**`cache.putRecipe()` is synchronous and void.** Do not `await` it. The subsequent `await cache.flush()` is what writes to disk.

**`commitRecipe` calls `notifySync`.** Tool handlers must not call `notifySync` again after `commitRecipe` — that would trigger two sync notifications per write.

**Cold-start guard on all four tools.** Until the sync engine populates the store, `read_recipe` would return stale results and write operations would operate on incomplete data. `coldStartGuard` returns an error result early in all cases.
