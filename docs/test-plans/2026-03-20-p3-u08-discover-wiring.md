# Human Test Plan: P3-U08 Discover Wiring

## Prerequisites

- Local Ollama instance running with `nomic-embed-text` model pulled (`ollama pull nomic-embed-text`)
- Repository checked out at commit `e4fa3bec` or later on branch `brajkovic/p3-u08-discover-wiring`
- Dependencies installed: `pnpm install`
- All automated tests passing: `pnpm test` (expect 472 passing, 0 failing)
- A valid `.env` file with Paprika credentials and embeddings config:
  ```
  PAPRIKA_EMAIL=<your email>
  PAPRIKA_PASSWORD=<your password>
  EMBEDDINGS_BASE_URL=http://localhost:11434/v1
  EMBEDDINGS_MODEL=nomic-embed-text
  EMBEDDINGS_API_KEY=ollama
  ```

## Phase 1: Source-Level Ordering Verification (AC3.1)

| Step | Action                                                                     | Expected                                                                                                                                                                               |
| ---- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Open `src/index.ts`                                                        | File opens                                                                                                                                                                             |
| 2    | Locate the call to `await setupDiscoverFeature(server, ctx, sync, config)` | Found at line 97                                                                                                                                                                       |
| 3    | Locate the call to `await server.connect(new StdioServerTransport())`      | Found at line 108                                                                                                                                                                      |
| 4    | Confirm `setupDiscoverFeature` call appears BEFORE `server.connect`        | Line 97 < line 108. `setupDiscoverFeature` is awaited, meaning the sync event subscription inside it is registered before the transport connects and starts accepting client messages. |

## Phase 2: Non-Interference File Check (AC5.1)

| Step | Action                                              | Expected                                                             |
| ---- | --------------------------------------------------- | -------------------------------------------------------------------- |
| 1    | Run `git diff 468ec04..HEAD -- src/paprika/sync.ts` | No output (empty diff) — sync.ts is untouched by this implementation |

## Phase 3: End-to-End with Embeddings Enabled

Purpose: Validate that the full server starts, indexes recipes, and serves semantic search results when embeddings are configured.

| Step | Action                                                                              | Expected                                                                                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Ensure Ollama is running: `curl http://localhost:11434/api/tags`                    | Returns JSON with `nomic-embed-text` in the models list                                                                                                                                                    |
| 2    | Start the MCP server: `pnpm dev`                                                    | Stderr output includes `Semantic search: enabled` near the end of startup                                                                                                                                  |
| 3    | Wait for initial sync to complete                                                   | Stderr shows `Initial sync complete.` followed by `Semantic search: enabled`                                                                                                                               |
| 4    | Send `discover_recipes` tool call with `{"query": "chicken dinner"}` via MCP client | Returns a list of semantically similar recipes (not an error). If the store has recipes, results include recipe names and scores. If the store is empty, returns a message about no recipes being indexed. |
| 5    | Trigger a manual sync (or wait for the background sync interval)                    | Stderr does NOT show any `Vector index error` messages. If new recipes are added, subsequent `discover_recipes` calls return updated results.                                                              |
| 6    | Stop the server with Ctrl+C                                                         | Stderr shows `SIGINT received, shutting down...` and process exits cleanly                                                                                                                                 |

## Phase 4: End-to-End with Embeddings Disabled

Purpose: Validate that the server starts normally and all Phase 2 tools work when embeddings are not configured.

| Step | Action                                                                        | Expected                                                 |
| ---- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1    | Remove or comment out `EMBEDDINGS_*` variables from `.env`                    | Embeddings config is absent                              |
| 2    | Start the MCP server: `pnpm dev`                                              | Stderr output includes `Semantic search: disabled`       |
| 3    | Send any Phase 2 tool call (e.g., `search_recipes` with `{"query": "pasta"}`) | Returns results normally — no errors, no degradation     |
| 4    | Confirm `discover_recipes` tool is NOT listed in `tools/list` response        | The tool should not appear since embeddings are disabled |

## Phase 5: Error Isolation Live Test

Purpose: Validate that embedding failures do not crash the server or affect sync.

| Step | Action                                                                              | Expected                                                                                                     |
| ---- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1    | Start the server with embeddings configured and Ollama running                      | `Semantic search: enabled` in stderr                                                                         |
| 2    | Stop Ollama while the server is running: `systemctl stop ollama` (or `ollama stop`) | Ollama becomes unavailable                                                                                   |
| 3    | Trigger a sync (wait for background interval or force one)                          | Stderr shows `Vector index error: ...` message but the server does NOT crash. Sync cycle completes normally. |
| 4    | Restart Ollama: `systemctl start ollama`                                            | Ollama becomes available again                                                                               |
| 5    | Trigger another sync                                                                | Indexing succeeds without error. The server recovered gracefully.                                            |

## Human Verification Required

| Criterion                                       | Why Manual                                                                                                         | Steps                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| AC3.1 - Sync subscription before server.connect | Source-level ordering constraint in the entry point; impractical to integration-test full `main()` with real stdio | Phase 1 above: visually confirm line ordering in `src/index.ts`                 |
| AC5.1 - sync.ts not modified                    | File-level constraint on the diff, not runtime behavior                                                            | Phase 2 above: run `git diff` on `src/paprika/sync.ts` and confirm empty output |

## Traceability

| Acceptance Criterion                     | Automated Test                                   | Manual Step           |
| ---------------------------------------- | ------------------------------------------------ | --------------------- |
| AC1.1 - Tool registered                  | `discover-feature.test.ts` "AC1.1"               | Phase 3 Step 4        |
| AC1.2 - Tool not registered              | `discover-feature.test.ts` "AC1.2"               | Phase 4 Step 4        |
| AC1.3 - Logs "enabled"                   | `discover-feature.test.ts` "AC1.3"               | Phase 3 Step 2        |
| AC1.4 - Logs "disabled"                  | `discover-feature.test.ts` "AC1.4"               | Phase 4 Step 2        |
| AC2.1 - EmbeddingClient init             | `discover-feature.test.ts` "AC2.1" + integration | Phase 3 Step 2        |
| AC2.2 - VectorStore init                 | `discover-feature.test.ts` "AC2.2" + integration | Phase 3 Step 2        |
| AC2.3 - init before register             | `discover-feature.test.ts` "AC2.3" + integration | Phase 3 Step 3        |
| AC2.4 - registerDiscoverTool args        | `discover-feature.test.ts` "AC2.4"               | Phase 3 Step 4        |
| AC3.1 - Subscription ordering            | N/A                                              | Phase 1 (code review) |
| AC3.2 - Index on sync:complete           | `discover-feature.test.ts` "AC3.2" + integration | Phase 3 Step 5        |
| AC3.3 - Remove on sync:complete          | `discover-feature.test.ts` "AC3.3" + integration | Phase 3 Step 5        |
| AC3.4 - No-op on empty sync              | `discover-feature.test.ts` "AC3.4"               | —                     |
| AC4.1 - indexRecipes error isolated      | `discover-feature.test.ts` "AC4.1"               | Phase 5 Step 3        |
| AC4.2 - removeRecipe error isolated      | `discover-feature.test.ts` "AC4.2"               | Phase 5 Step 3        |
| AC4.3 - Recovery after error             | `discover-feature.test.ts` "AC4.3"               | Phase 5 Steps 4-5     |
| AC5.1 - sync.ts unmodified               | N/A                                              | Phase 2 (git diff)    |
| AC5.2 - Phase 2 tools with embeddings    | All `src/tools/*.test.ts` (472 tests pass)       | Phase 3 Step 3        |
| AC5.3 - Phase 2 tools without embeddings | All `src/tools/*.test.ts` (472 tests pass)       | Phase 4 Step 3        |
