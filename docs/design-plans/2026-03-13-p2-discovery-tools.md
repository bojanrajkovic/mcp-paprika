# Discovery Tools Design

## Summary

This design adds four read-only MCP tools — `search_recipes`, `filter_by_ingredient`, `filter_by_time`, and `list_categories` — that let AI assistants discover what recipes are in a user's Paprika library. The tools are thin wrappers: all query logic already lives in `RecipeStore`, an in-memory index built from the local disk cache. Each handler validates its inputs with a Zod schema, invokes the appropriate store method, formats the results as plain text, and returns the MCP wire response. No network calls are made at query time; the store is populated asynchronously during server startup.

The design enforces two cross-cutting patterns established by the P2-U02 shared helpers work: a cold-start guard that returns a structured error if the store is not yet populated (rather than returning empty results silently), and tool registration via `registerTool()` with a raw `ZodRawShape` rather than a wrapped `z.object()` schema. Implementation is split into three independent phases, one file each, so they can be executed in parallel by separate agents.

## Definition of Done

- A committed design document for four read-only discovery tools: `search_recipes`, `filter_by_ingredient`, `filter_by_time`, and `list_categories`
- Tool handlers in `src/tools/search.ts`, `src/tools/filter.ts`, and `src/tools/categories.ts` are thin shells that delegate business logic to existing `RecipeStore` methods (`search()`, `filterByIngredients()`, `filterByTime()`, `getAllCategories()`)
- Corrects unit-spec deviations: camelCase `Recipe` fields, `registerTool()` + raw ZodRawShape, `coldStartGuard` via `.match()`
- Implementation phases suitable for parallel execution by one or more agents

## Acceptance Criteria

### AC1: `search_recipes`

- **p2-discovery-tools.AC1.1 Success:** Non-empty store + matching query → returns formatted list of up to `limit` results
- **p2-discovery-tools.AC1.2 Success:** `limit` defaults to 20 when omitted
- **p2-discovery-tools.AC1.3 Success:** `limit` parameter caps result count (returns at most `limit` results)
- **p2-discovery-tools.AC1.4 Success:** Category names appear in formatted results (resolved via `store.resolveCategories`)
- **p2-discovery-tools.AC1.5 Failure:** Empty store → Err payload with retry instruction (cold-start guard)
- **p2-discovery-tools.AC1.6 Failure:** Non-empty store, no matching recipes → empty-result message (not an error)

### AC2: `filter_by_ingredient`

- **p2-discovery-tools.AC2.1 Success:** `mode="all"` → returns only recipes containing all listed ingredients
- **p2-discovery-tools.AC2.2 Success:** `mode="any"` → returns recipes containing any listed ingredient
- **p2-discovery-tools.AC2.3 Success:** `mode` defaults to `"all"` when omitted
- **p2-discovery-tools.AC2.4 Success:** `limit` defaults to 20 when omitted
- **p2-discovery-tools.AC2.5 Failure:** Empty store → cold-start Err payload
- **p2-discovery-tools.AC2.6 Failure:** No recipes match → empty-result message

### AC3: `filter_by_time`

- **p2-discovery-tools.AC3.1 Success:** `maxTotalTime` constraint returns only recipes with `totalTime` ≤ constraint
- **p2-discovery-tools.AC3.2 Success:** `maxPrepTime` constraint returns only recipes with `prepTime` ≤ constraint
- **p2-discovery-tools.AC3.3 Success:** `maxCookTime` constraint returns only recipes with `cookTime` ≤ constraint
- **p2-discovery-tools.AC3.4 Success:** Results ordered by total time ascending
- **p2-discovery-tools.AC3.5 Success:** `limit` applied post-store via `.slice(0, limit)` — at most `limit` results returned
- **p2-discovery-tools.AC3.6 Edge:** All three time constraints optional — tool accepts any combination (including all omitted, returning all recipes sorted by time up to limit)
- **p2-discovery-tools.AC3.7 Failure:** Empty store → cold-start Err payload
- **p2-discovery-tools.AC3.8 Failure:** No recipes match constraints → empty-result message

### AC4: `list_categories`

- **p2-discovery-tools.AC4.1 Success:** Returns all categories with non-trashed recipe count per category
- **p2-discovery-tools.AC4.2 Success:** Categories sorted alphabetically by name
- **p2-discovery-tools.AC4.3 Success:** Category with zero matching non-trashed recipes appears in list with count 0
- **p2-discovery-tools.AC4.4 Failure:** Empty store → cold-start Err payload
- **p2-discovery-tools.AC4.5 Edge:** Store populated with recipes but no categories → returns appropriate empty message

### AC5: Cross-cutting

- **p2-discovery-tools.AC5.1:** All four tools registered via `registerTool()` with raw `ZodRawShape` (not `z.object()`)
- **p2-discovery-tools.AC5.2:** All four tool handlers use `coldStartGuard(ctx).match(okFn, errFn)` pattern
- **p2-discovery-tools.AC5.3:** No handler calls `PaprikaClient` directly — zero network calls in any tool

## Glossary

- **MCP (Model Context Protocol):** The open protocol this server implements. It defines how AI assistants call tools and read resources over a structured wire format (here: stdio). Tools are callable functions; resources are readable data sources.
- **`McpServer`:** The MCP SDK class that manages the server side of the protocol connection — handles tool registration, request dispatch, and the stdio transport.
- **`CallToolResult`:** The MCP SDK type for a tool's return value. At minimum it contains a `content` array of typed content blocks (text, image, etc.).
- **`registerTool()`:** An MCP SDK method on `McpServer` that registers a callable tool. Accepts a raw `ZodRawShape` for the input schema — the SDK wraps it in `z.object()` internally.
- **`ZodRawShape`:** The plain object literal passed to `z.object()`, e.g. `{ query: z.string() }`. Distinct from the `ZodObject` schema produced by calling `z.object()` on it.
- **Zod:** A TypeScript schema declaration and validation library. Schemas describe the shape of data; `.parse()` / `.safeParse()` validate input at runtime.
- **neverthrow:** A TypeScript library for railway-oriented error handling. `Result<T, E>` is either `Ok<T>` (success) or `Err<E>` (failure). `.match(okFn, errFn)` is the idiomatic way to consume a `Result` — imperative `.isOk()` / `.isErr()` checks are banned in this codebase.
- **`Result<T, E>`:** The core neverthrow type. A value that is either a success (`Ok`) holding a `T` or a failure (`Err`) holding an `E`. Treated as an opaque monad — always consumed via `.match()`, `.andThen()`, or `.map()`.
- **`ServerContext`:** A plain immutable record (`{ client, cache, store, server }`) constructed once at startup and passed by reference into every tool and resource registration function. Acts as a dependency injection container.
- **`RecipeStore`:** An in-memory index of recipes and categories loaded from the disk cache. Provides query methods (`search`, `filterByIngredients`, `filterByTime`, `getAllCategories`, etc.) used by all four tools in this design.
- **`DiskCache`:** The persistence layer that stores recipe and category JSON on disk between server restarts. `RecipeStore` is populated from it at startup.
- **`ScoredResult`:** The type returned by `RecipeStore.search()` — a `{ recipe, score }` pair where `score` reflects match quality (exact name = 3, starts-with = 2, contains = 1, other field = 0).
- **`TimeConstraints`:** A `RecipeStore` type with optional `maxPrepTime`, `maxCookTime`, and `maxTotalTime` fields. The tool handler accepts human-readable duration strings and the store resolves them internally via `parseDuration`.
- **cold-start guard (`coldStartGuard`):** A helper in `src/tools/helpers.ts` that checks whether the `RecipeStore` has any recipes. Returns `Ok<void>` when the store is ready; returns `Err<CallToolResult>` with a "try again in a few seconds" message when the store is still empty. Prevents tools from returning misleading empty results before the initial sync completes.
- **`textResult()`:** A helper that wraps a plain string in the MCP `CallToolResult` envelope: `{ content: [{ type: "text", text }] }`.
- **`recipeToMarkdown()`:** A helper in `src/tools/helpers.ts` that renders a `Recipe` object as human-readable markdown, including optional fields only when present.
- **`parseDuration`:** A utility (wrapping `parse-duration` and `luxon`) that parses human-readable time strings like `"30 minutes"` or `"1 hr 15 min"` into a duration, returning a `Result`.
- **Pattern C (cold-start guard pattern):** The specific `coldStartGuard(ctx).match(asyncOkFn, errFn)` call structure, where the Ok branch is `async` and returns `Promise<CallToolResult>` while the Err branch returns a bare `CallToolResult` — both are resolved correctly by the surrounding `async` handler.
- **Thin handler / shell:** A tool handler that contains no business logic of its own — it only validates inputs, calls a store method, and formats the output.
- **stdio transport:** The inter-process communication channel this MCP server uses. Any stray output to stdout (e.g., a `console.log`) corrupts the protocol wire format.
- **`inTrash`:** A boolean field on the `Recipe` type indicating soft-deleted recipes. All `RecipeStore` query methods exclude trashed recipes automatically.
- **snake_case / camelCase field names:** Paprika's cloud API returns recipe fields in snake_case (e.g., `prep_time`). The Zod ingestion schema transforms them to camelCase (e.g., `prepTime`) on ingest. Any specs referencing snake_case names should be read as their camelCase equivalents.

## Architecture

Four read-only MCP tools implemented as thin handlers in three files. Each file exports a single registration function. All business logic lives in `RecipeStore` — tool handlers only validate inputs, invoke store methods, and format results.

**Files:**

- `src/tools/search.ts` — exports `registerSearchTool(server, ctx)`, registers `search_recipes`
- `src/tools/filter.ts` — exports `registerFilterTools(server, ctx)`, registers `filter_by_ingredient` and `filter_by_time`
- `src/tools/categories.ts` — exports `registerCategoryTools(server, ctx)`, registers `list_categories`

**Cold-start guard pattern (Pattern C):**

Every handler uses:

```typescript
return coldStartGuard(ctx).match(
  () => {
    /* async body — awaited by outer async handler */
  },
  (guard) => guard,
);
```

The outer handler is `async`, but `coldStartGuard` is synchronous. The `.match()` branches return either a `Promise<CallToolResult>` (Ok branch) or a `CallToolResult` (Err branch). TypeScript resolves the union correctly because the outer `async` function wraps both in a Promise.

**Store delegation:**

| Tool                   | Store call                                      | Post-processing                                |
| ---------------------- | ----------------------------------------------- | ---------------------------------------------- |
| `search_recipes`       | `store.search(query, { limit })`                | None needed — store paginates                  |
| `filter_by_ingredient` | `store.filterByIngredients(terms, mode, limit)` | None needed — store applies limit              |
| `filter_by_time`       | `store.filterByTime(constraints)`               | `.slice(0, limit)` — store returns all matches |
| `list_categories`      | `store.getAllCategories()` + `store.getAll()`   | Count recipes per category                     |

**Formatter helpers:**

Each file contains private formatter functions — not exported, not shared across files. This avoids cross-file coupling for what are purely presentational concerns.

**Input schemas use raw ZodRawShape** (the object inside `z.object()`) passed to `registerTool()`. Do not wrap in `z.object()` — the SDK does that internally.

## Existing Patterns

Implementation of P2-U02 established the patterns this design follows:

- `registerTool(server, name, description, inputShape, handler)` — from `docs/verified-api.md`; `inputShape` is a raw `ZodRawShape` object, not a `z.object()` schema
- `coldStartGuard(ctx).match(okFn, errFn)` — from `src/tools/helpers.ts`; returns `Result<void, ReturnType<typeof textResult>>`
- `textResult(text)` — wraps a string in the MCP wire response envelope
- `recipeToMarkdown(recipe, categoryNames)` — renders a `Recipe` as markdown; `categoryNames` must be pre-resolved from `store.resolveCategories(recipe.categories)`
- Tool registration functions co-located in `src/tools/` alongside `helpers.ts`

No existing search/filter/category tool implementations exist yet — these three files are new.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: `search_recipes` (`src/tools/search.ts`)

**Goal:** Implement and register the `search_recipes` tool.

**Components:**

- `src/tools/search.ts` — registration function `registerSearchTool(server, ctx)` that registers `search_recipes` with input schema `{ query: z.string(), limit: z.number().int().positive().max(50).optional().default(20) }`. Handler delegates to `ctx.store.search(query, { limit })` and formats each `ScoredResult` using a local `formatSearchHit(result, categoryNames)` helper. Category names resolved via `ctx.store.resolveCategories(recipe.categories)`.
- `src/tools/search.test.ts` — unit tests covering all `p2-discovery-tools.AC1.*` criteria: populated store returns results, empty store returns cold-start Err payload, zero matches returns empty-result message, limit is respected.

**Dependencies:** P2-U02 (`src/tools/helpers.ts` with `coldStartGuard`, `textResult`, `recipeToMarkdown`)

**Done when:** `pnpm test` passes for `search.test.ts`, covering all AC1 criteria.

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: `filter_by_ingredient` + `filter_by_time` (`src/tools/filter.ts`)

**Goal:** Implement and register both filter tools.

**Components:**

- `src/tools/filter.ts` — registration function `registerFilterTools(server, ctx)` that registers two tools:
  - `filter_by_ingredient`: input `{ ingredients: z.array(z.string()).min(1), mode: z.enum(["all","any"]).default("all"), limit: z.number().int().positive().max(50).optional().default(20) }`. Delegates to `ctx.store.filterByIngredients(ingredients, mode, limit)`.
  - `filter_by_time`: input `{ maxPrepTime: z.string().optional(), maxCookTime: z.string().optional(), maxTotalTime: z.string().optional(), limit: z.number().int().positive().max(50).optional().default(20) }`. Delegates to `ctx.store.filterByTime({ maxPrepTime, maxCookTime, maxTotalTime })` then `.slice(0, limit)`. Time strings passed directly to `filterByTime` — the store uses `parseDuration` internally.
  - Both tools share a local `formatRecipeList(recipes, store)` formatter.
- `src/tools/filter.test.ts` — unit tests covering all `p2-discovery-tools.AC2.*` and `p2-discovery-tools.AC3.*` criteria.

**Dependencies:** Phase 1 (verifies registration pattern), P2-U02 helpers.

**Done when:** `pnpm test` passes for `filter.test.ts`, covering all AC2 and AC3 criteria.

<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->

### Phase 3: `list_categories` (`src/tools/categories.ts`)

**Goal:** Implement and register the `list_categories` tool.

**Components:**

- `src/tools/categories.ts` — registration function `registerCategoryTools(server, ctx)` that registers `list_categories` with no inputs (`{}`). Handler calls `ctx.store.getAllCategories()` and `ctx.store.getAll()` to compute recipe counts per category, returning a sorted list (alphabetically by name). Uses a local `formatCategoryList(categories, recipeCounts)` formatter.
- `src/tools/categories.test.ts` — unit tests covering all `p2-discovery-tools.AC4.*` criteria: populated store with category counts, empty store cold-start Err, store with no categories.

**Dependencies:** Phase 1 (verifies registration pattern), P2-U02 helpers.

**Done when:** `pnpm test` passes for `categories.test.ts`, covering all AC4 criteria.

<!-- END_PHASE_3 -->

## Additional Considerations

**`filterByTime` limit:** `RecipeStore.filterByTime()` returns all matching recipes sorted by total time ascending. Unlike `search()` and `filterByIngredients()`, it does not accept a `limit` parameter. Tool handlers must apply `.slice(0, limit)` after the store call.

**Field names:** The `Recipe` type uses camelCase throughout (`prepTime`, `cookTime`, `totalTime`, `inTrash`, `nutritionalInfo`, `sourceUrl`, etc.) — the Zod schema transforms snake_case wire format on ingest. Any unit specs referencing snake_case field names should be treated as referring to the camelCase equivalents.

**Test isolation:** Tests use plain-object `ServerContext` stubs (construct a `RecipeStore`, call `store.load()` with fixture data, pass in context). No network mocking required — these tools make zero API calls.
