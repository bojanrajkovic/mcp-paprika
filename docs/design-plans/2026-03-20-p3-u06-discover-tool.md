# Discover Recipes Tool Design

## Summary

The `discover_recipes` tool adds natural language semantic search to the MCP server. Where the existing `search_recipes` tool matches recipes by keyword, `discover_recipes` lets a user describe what they want in plain English — "something hearty for a cold night" or "a quick weeknight pasta" — and returns the recipes whose content is most semantically similar to that description. It does this by delegating to `VectorStore.search()`, which converts the query to an embedding vector and finds the nearest neighbours in the local Vectra index. The raw search results (uid + similarity score) are then enriched with live data from `RecipeStore` before being formatted as a numbered markdown list.

The tool is intentionally narrow in scope: it composes two already-built systems (`VectorStore` from P3-U04 and `RecipeStore` from Phase 2) without modifying either. It handles two edge cases specific to the vector-search context — a cold-start guard that prevents searching before the first sync, and silent filtering of recipes that appear in the vector index but have since been deleted from `RecipeStore`. Wiring this tool into the server entry point is deferred to P3-U08.

## Definition of Done

Register a `discover_recipes` MCP tool in `src/tools/discover.ts` that provides natural language semantic search over the recipe collection. The tool delegates to `VectorStore.search()` and enriches results with live recipe data from `RecipeStore`. It follows the existing tool registration pattern `(server, ctx)` with `VectorStore` as an injected third parameter, uses the cold-start guard, silently skips deleted recipes, and formats results as markdown with similarity percentage, categories, prep/cook time, and UID. Full test coverage following existing tool test patterns.

**Out of scope:** Entry point wiring (P3-U08), sync engine changes, VectorStore modifications.

## Acceptance Criteria

### p3-u06-discover-tool.AC1: Tool registration and input schema

- **p3-u06-discover-tool.AC1.1 Success:** Tool is registered with name `discover_recipes`
- **p3-u06-discover-tool.AC1.2 Success:** `query` parameter is required (string)
- **p3-u06-discover-tool.AC1.3 Success:** `topK` parameter is optional, integer, 1-20, defaults to 5

### p3-u06-discover-tool.AC2: Search and result formatting

- **p3-u06-discover-tool.AC2.1 Success:** `vectorStore.search(query, topK)` is called with both parameters from input
- **p3-u06-discover-tool.AC2.2 Success:** Each result includes recipe name with similarity as integer percentage (e.g., `92% match`)
- **p3-u06-discover-tool.AC2.3 Success:** Categories are resolved via `ctx.store.resolveCategories()` and displayed when present
- **p3-u06-discover-tool.AC2.4 Success:** `prepTime` and `cookTime` are displayed when present, omitted when null
- **p3-u06-discover-tool.AC2.5 Success:** Each result includes `UID: \`{uid}\``

### p3-u06-discover-tool.AC3: Empty and filtered results

- **p3-u06-discover-tool.AC3.1 Edge:** `search()` returns empty array → tool returns "No recipes found matching that description."
- **p3-u06-discover-tool.AC3.2 Edge:** All results map to deleted recipes (`store.get()` returns `undefined`) → tool returns "No recipes found matching that description."

### p3-u06-discover-tool.AC4: Deleted recipe handling

- **p3-u06-discover-tool.AC4.1 Success:** Results where `ctx.store.get(uid)` returns `undefined` are silently skipped
- **p3-u06-discover-tool.AC4.2 Success:** Remaining results are re-numbered sequentially (no gaps)

### p3-u06-discover-tool.AC5: Cold-start guard

- **p3-u06-discover-tool.AC5.1 Success:** When `ctx.store.size === 0`, tool returns the cold-start message without calling `vectorStore.search()`

## Glossary

- **MCP tool:** A callable function registered with the MCP server. The LLM invokes it by name with structured arguments; the tool returns text or structured content.
- **`ServerContext` (`ctx`):** Shared object passed to every tool handler containing `RecipeStore`, `McpServer`, and other server-wide state. Lightweight dependency-injection container.
- **`RecipeStore`:** In-memory store of recipes loaded from the Paprika API. Authoritative source of live recipe data during a server session.
- **`VectorStore`:** Local vector index (backed by Vectra) storing recipe embeddings. Provides semantic search via `search(query, topK)`.
- **Vectra:** Local, file-based vector database for Node.js. Stores embedding vectors on disk and performs nearest-neighbour search without a remote service.
- **Semantic search:** Search that matches by meaning rather than exact keywords. A query is embedded into a vector and compared against pre-indexed vectors to find closest matches.
- **`SemanticResult`:** Return type of `VectorStore.search()` — `{ uid, score, recipeName }` where score is cosine similarity (0–1).
- **`topK`:** Maximum number of search results to return. Optional integer parameter defaulting to 5, capped at 20.
- **Cold-start guard:** Guard that detects when `RecipeStore` is empty (server has not yet completed first sync) and returns a "please sync first" message instead of attempting the operation.
- **neverthrow `Result<T, E>`:** Type-safe alternative to thrown exceptions. Handled via `.match()` combinator, never via `.isOk()`/`.isErr()` imperative checks.
- **`textResult()`:** Helper from `src/tools/helpers.ts` that wraps a string in the MCP content envelope expected by the SDK.
- **Feature gating (P3-U08):** The forthcoming entry-point change that conditionally registers `registerDiscoverTool` only when embedding configuration is present.
- **`resolveCategories()`:** `RecipeStore` method mapping an array of `CategoryUid` values to human-readable names.

## Architecture

Single-file MCP tool registration that composes two existing systems: `VectorStore` for semantic search and `RecipeStore` for live recipe data enrichment.

**Data flow:** User query → `VectorStore.search(query, topK)` → `SemanticResult[]` (uid + score + recipeName) → enrich each result via `RecipeStore.get(uid)` → format as markdown → return via `textResult()`.

**Registration contract:**

```typescript
export function registerDiscoverTool(server: McpServer, ctx: ServerContext, vectorStore: VectorStore): void;
```

`VectorStore` is injected as a third parameter rather than added to `ServerContext` because it is optional — the tool is only registered when embedding configuration exists (feature gating in P3-U08). The caller decides whether to register; the tool itself assumes the vector store is initialized.

**Cold-start guard:** Applied before searching. If `RecipeStore` is empty (pre-sync), the tool returns early with the standard sync message. This prevents returning vector search results that can't be enriched with live data.

**Deleted recipe handling:** Between indexing runs, a recipe may be deleted from `RecipeStore` while its vector remains in Vectra. `RecipeStore.get(uid)` returns `undefined` for these. The tool silently skips them and re-numbers remaining results sequentially.

## Existing Patterns

This design follows the established tool patterns from Phase 2:

- **Registration signature:** `(server: McpServer, ctx: ServerContext)` — all 8 existing tools use this pattern. The `VectorStore` parameter is additive, not a deviation. Verified at `src/tools/search.ts:8`, `src/tools/filter.ts:11`, `src/tools/create.ts:9`.
- **Cold-start guard:** `coldStartGuard(ctx).match(async () => ..., (guard) => guard)` — idiomatic neverthrow `.match()`, never imperative `.isOk()`/`.isErr()`. Verified at `src/tools/search.ts:27-40`.
- **Input schema:** Flat object with Zod fields per property, not nested `z.object()`. Verified at `src/tools/search.ts:14-24`.
- **Result formatting:** `textResult()` wrapper from `src/tools/helpers.ts:6-8`. Markdown output with recipe metadata.
- **Test approach:** `makeTestServer()` + `makeCtx()` + `getText()` from `src/tools/tool-test-utils.ts`. Direct handler invocation without a real MCP server.

**No new patterns introduced.** The only addition is the third `vectorStore` parameter, which follows the same dependency injection approach described in the Phase 3 architecture doc for `registerPhotoTool`.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Tool Registration and Result Formatting

**Goal:** Implement `registerDiscoverTool` with full search → enrich → format pipeline and comprehensive tests.

**Components:**

- `src/tools/discover.ts` — tool registration function with cold-start guard, VectorStore search delegation, RecipeStore enrichment, deleted recipe filtering, and markdown formatting
- `src/tools/discover.test.ts` — unit tests using `makeTestServer()` pattern with mocked VectorStore

**Dependencies:** VectorStore (P3-U04, complete), Phase 2 tools (complete)

**Done when:** Tool registers correctly, returns formatted markdown for matching recipes, handles empty results and deleted recipes, cold-start guard works, all tests pass for ACs covered by this phase.

<!-- END_PHASE_1 -->

## Additional Considerations

**Error propagation:** If `VectorStore.search()` throws (e.g., embedding API failure), the error propagates to the MCP framework, which returns it to the client as a tool error. No special error handling is needed in the tool itself — this matches how other tools handle `RecipeStore` failures.

**`inputSchema` note:** The spec uses `z.object()` for the input schema, but the existing codebase uses flat Zod fields. This design follows the existing flat pattern to stay consistent.
