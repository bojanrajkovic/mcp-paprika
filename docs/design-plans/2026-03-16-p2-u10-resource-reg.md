# MCP Resource Registration Design

## Summary

This unit adds MCP resource support for recipes, complementing the existing tool layer. While MCP tools are called on-demand by the LLM during a conversation, MCP resources are a separate primitive: they are enumerable and readable by the MCP client, which can inject them directly into context without an explicit LLM tool call. This unit registers `paprika://recipe/{uid}` as a URI template so that any MCP client can list all non-trashed recipes and read individual ones as Markdown.

The implementation touches three files. A new `src/resources/recipes.ts` module registers a `ResourceTemplate` with the SDK, wiring list and read callbacks that delegate to the existing `RecipeStore` and `recipeToMarkdown()` formatter — the same data path and format already used by the read and search tools. The `commitRecipe` helper in `src/tools/helpers.ts` gains a single call to `ctx.server.sendResourceListChanged()` after every store write, which sends the SDK's built-in notification to all connected clients so they know to refresh their resource list. Because every write tool — create, update, and delete — already routes through `commitRecipe`, this single insertion covers all mutations with no per-tool changes. Test infrastructure in `tool-test-utils.ts` is extended first so the new notification call and the resource handlers can both be exercised under the existing stub-server pattern.

## Definition of Done

- `src/resources/recipes.ts` created — exports `registerRecipeResources(ctx: ServerContext)` that registers `paprika://recipe/{uid}` resources via the MCP SDK
- List handler returns all non-trashed recipes as browseable MCP resources; empty list when store is empty (no cold-start error)
- Read handler returns Markdown content with UID header using `recipeToMarkdown()`, throws `McpError` on missing UID
- `commitRecipe` in `helpers.ts` extended to call `ctx.server.sendResourceListChanged()` after `store.set()` so MCP clients are notified on every CRUD mutation
- Tests for all of the above, including `helpers.test.ts` updated to verify the new notification call

## Acceptance Criteria

### p2-u10-resource-reg.AC1: Recipe list is accessible as MCP resources

- **p2-u10-resource-reg.AC1.1 Success:** List handler returns all non-trashed recipes with `uri: "paprika://recipe/{uid}"`, `name: recipe.name`, and `mimeType: "text/markdown"` for each
- **p2-u10-resource-reg.AC1.2 Success:** List handler returns `{ resources: [] }` when the store is empty — no error, no cold-start guard fires
- **p2-u10-resource-reg.AC1.3 Success:** Recipes with `inTrash: true` are excluded from the list

### p2-u10-resource-reg.AC2: Individual recipes are readable as MCP resources

- **p2-u10-resource-reg.AC2.1 Success:** Read handler returns content with a UID header line (`` **UID:** `{uid}` ``) prepended to the recipe markdown for a valid UID
- **p2-u10-resource-reg.AC2.2 Success:** Category UIDs are resolved to display names in the markdown output
- **p2-u10-resource-reg.AC2.3 Success:** Response includes `mimeType: "text/markdown"` and `uri: uri.href` in the contents entry
- **p2-u10-resource-reg.AC2.4 Failure:** Read handler throws an error when the requested UID does not exist in the store

### p2-u10-resource-reg.AC3: CRUD mutations notify MCP clients via resource list change

- **p2-u10-resource-reg.AC3.1 Success:** `commitRecipe` calls `ctx.server.sendResourceListChanged()` exactly once per invocation
- **p2-u10-resource-reg.AC3.2 Success:** `sendResourceListChanged()` is called after `ctx.store.set()` — store is up to date when clients are notified
- **p2-u10-resource-reg.AC3.3 Success:** `sendResourceListChanged()` is called before `ctx.client.notifySync()` — notification order is `store.set` → `sendResourceListChanged` → `notifySync`

## Glossary

- **MCP (Model Context Protocol):** The open protocol this server implements. Defines a wire format and capability model for connecting LLMs to external tools and data sources over a transport such as stdio.
- **MCP resource:** A named, addressable piece of content that an MCP client can list and read. Distinct from a tool: resources are browseable by the client and injected into context passively, whereas tools are invoked explicitly by the LLM.
- **MCP tool:** A callable function registered with the MCP server and invoked by the LLM during a conversation turn. The existing recipe CRUD and search capabilities are implemented as tools.
- **`ResourceTemplate`:** An SDK class from `@modelcontextprotocol/sdk/server/mcp.js` that pairs a URI template string (e.g., `paprika://recipe/{uid}`) with list and read callbacks.
- **URI template:** A URL pattern using `{variable}` placeholders, here `paprika://recipe/{uid}`. The SDK parses an incoming URI against the template and extracts variable values as a `Record<string, string>`.
- **`sendResourceListChanged()`:** An SDK method on `McpServer` that emits a protocol-level notification telling connected clients that the resource list has changed and they should re-list. Returns `void` synchronously.
- **`commitRecipe`:** A shared async helper in `src/tools/helpers.ts` that performs the full write pipeline for any recipe mutation: buffer to disk cache, flush to disk, update the in-process store, and trigger cloud sync. All write tools call it instead of duplicating this sequence.
- **`ServerContext`:** A plain immutable record (`{ client, cache, store, server }`) constructed once at startup and passed by reference into every tool and resource registration function. Acts as the dependency injection vehicle for the server.
- **`RecipeStore`:** The in-process store abstraction over `DiskCache`. Holds the working set of recipes in memory and exposes query methods (`getAll`, `get`, `resolveCategories`, etc.) used by both tools and resources.
- **`recipeToMarkdown()`:** A shared helper that renders a `Recipe` object plus resolved category names into a Markdown string. Used by both the `read_recipe` tool and the new resource read handler to keep the LLM-facing format consistent.
- **cold-start guard:** A check (`coldStartGuard()`) used by tool handlers to return a user-friendly error when the in-process store has not yet received its first sync from the Paprika cloud. Resources intentionally skip this guard — an empty list is valid behavior.
- **`notifySync()`:** A method on `PaprikaClient` that signals the Paprika cloud to propagate a locally committed change to other devices. Called after every write via `commitRecipe`.
- **`inTrash`:** A boolean field on a `Recipe` indicating soft-deletion. Trashed recipes remain in the store but are excluded from resource lists (and most tool results).
- **`vi.fn()`:** A Vitest utility for creating a no-op spy/mock function whose call count and arguments can be asserted in tests.
- **`McpError`:** The SDK's structured error type for protocol-level failures. Throwing one from a resource handler produces a well-formed error response to the client rather than an unhandled crash.

## Architecture

MCP distinguishes between tools (invoked by the LLM) and resources (listed/read by the MCP client and injected into context). Resources are registered via `ResourceTemplate` from `@modelcontextprotocol/sdk/server/mcp.js`, which pairs a URI template string with separate list and read callbacks.

Three components change in this unit:

- **`src/resources/recipes.ts`** — new file; exports `registerRecipeResources(server: McpServer, ctx: ServerContext): void`. Constructs a `ResourceTemplate` for `"paprika://recipe/{uid}"` with a list callback, then calls `server.registerResource()` with a read callback.
- **`src/tools/helpers.ts`** — `commitRecipe` gains one synchronous call: `ctx.server.sendResourceListChanged()` after `ctx.store.set(saved)`. Because `sendResourceListChanged()` returns `void`, no `await` is needed. Placement after `store.set` guarantees the in-process store is current before clients are told to re-list.
- **`src/tools/tool-test-utils.ts`** — `makeTestServer()` extended to capture resource handlers alongside tool handlers, expose `sendResourceListChanged` as a `vi.fn()` on the stub server, and return a `callResource(name, uid)` helper.

**List callback** (`async (extra) => { resources: [...] }`): calls `ctx.store.getAll()` (already excludes trashed recipes), maps each recipe to `{ uri: "paprika://recipe/{uid}", name: recipe.name, mimeType: "text/markdown" }`. Returns `{ resources: [...] }` as required by the SDK.

**Read callback** (`async (uri: URL, variables: Record<string, string>, extra) => ...`): extracts `variables.uid`, looks up the recipe via `ctx.store.get(uid)`, throws a plain `Error` on miss (the SDK converts uncaught handler errors to protocol errors). On success, resolves category names via `ctx.store.resolveCategories(recipe.categories)`, formats content as `` **UID:** `{uid}` `` prepended to `recipeToMarkdown(recipe, categoryNames)`, and returns `{ contents: [{ uri: uri.href, mimeType: "text/markdown", text: content }] }`.

The `commitRecipe` change covers all four CRUD tools (create, update, delete, plus sync-triggered updates) with no per-tool modifications.

## Existing Patterns

All tool files follow the registration pattern `register*Tool(server: McpServer, ctx: ServerContext): void` — this design applies the identical signature to `registerRecipeResources`. Data is accessed exclusively through `ctx.store`, consistent with the tool boundary documented in `src/tools/CLAUDE.md`.

The read format (Markdown) aligns with tool responses: `search_recipes`, `read_recipe`, `create_recipe`, etc. all return Markdown via `recipeToMarkdown()`. Resources use the same function, keeping the LLM-facing representation consistent whether a recipe arrives via tool call or resource read.

Test utilities in `src/tools/tool-test-utils.ts` already provide `makeTestServer()` and `makeCtx()` for tool tests. Extending the same file avoids fragmenting test infrastructure across two utility files.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Extend test utilities

**Goal:** Prepare `makeTestServer()` to support resource handler capture and expose `sendResourceListChanged` as a mockable function. This is prerequisite for the test changes in Phase 2 and Phase 3.

**Components:**

- `src/tools/tool-test-utils.ts` — add `resourceHandlers` map, add `registerResource` stub method to server, add `sendResourceListChanged: vi.fn()` to server stub, add `callResource(name: string, uid: string)` to return value, export `sendResourceListChanged` reference for assertion in tests

**Dependencies:** None

**Done when:** `pnpm build` succeeds; existing tool tests (`src/tools/*.test.ts`) continue to pass

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: Update `commitRecipe` and its tests

**Goal:** Add `ctx.server.sendResourceListChanged()` to `commitRecipe` and update the corresponding test to assert it is called in the correct position.

**Components:**

- `src/tools/helpers.ts` — insert `ctx.server.sendResourceListChanged()` after `ctx.store.set(saved)`, before `await ctx.client.notifySync()`
- `src/tools/helpers.test.ts` — add assertion that `sendResourceListChanged` was called exactly once, after `store.set` and before `notifySync`, in the existing `commitRecipe` success test

**Dependencies:** Phase 1 (extended `makeTestServer()` provides `sendResourceListChanged` mock)

**Done when:** `helpers.test.ts` passes with the new assertion; covers `p2-u10-resource-reg.AC3.1`, `AC3.2`, `AC3.3`

<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->

### Phase 3: Implement `src/resources/recipes.ts` and tests

**Goal:** Create the resource registration module and its full test suite.

**Components:**

- `src/resources/recipes.ts` — `registerRecipeResources(server: McpServer, ctx: ServerContext): void` with `ResourceTemplate`, list callback, and read callback as specified in Architecture
- `src/resources/recipes.test.ts` — tests for list and read handlers using extended `makeTestServer()` and `makeCtx()`

**Dependencies:** Phase 1 (test utilities), Phase 2 (commitRecipe change complete — no functional dependency, but logical sequencing)

**Done when:** All tests in `recipes.test.ts` pass; covers `p2-u10-resource-reg.AC1.1–AC1.3` and `AC2.1–AC2.4`

<!-- END_PHASE_3 -->

## Additional Considerations

**Empty store during list:** No cold-start guard. An empty store returns an empty resource list — this is correct behavior, not an error. The list grows automatically once the initial sync completes.

**`sendResourceListChanged` covers all mutations:** Since every CRUD write tool routes through `commitRecipe`, adding the notification there covers create, update, and delete without any per-tool changes. The sync engine's store updates (when pulling remote changes) are handled separately and are out of scope for this unit.
