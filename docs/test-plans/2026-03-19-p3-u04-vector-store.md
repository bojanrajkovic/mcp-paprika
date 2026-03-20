# Human Test Plan: Vector Store (p3-u04-vector-store)

## Prerequisites

- Node.js 24 installed (managed via mise)
- Dependencies installed: `pnpm install`
- All automated tests passing: `pnpm test`

## Phase 1: Initialization and Corruption Recovery

| Step | Action                                                                                                                                                       | Expected                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 1.1  | Run `pnpm test -- src/features/vector-store.test.ts` and inspect the "VectorStore init" describe block output                                                | All 5 init tests pass (AC1.1 through AC1.4)                                                                        |
| 1.2  | Run `pnpm test -- src/features/vector-store.test.integration.ts` and inspect "First-run initialization" test                                                 | Integration test confirms `vectors/` directory created on disk in a real temp directory                            |
| 1.3  | Review `src/features/vector-store.ts` lines 89-109 (`init()` method) and confirm the try/catch for Vectra corruption creates a `.bak` copy before recreating | Code uses `cp()` to back up to `${vectorsDir}.bak`, then calls `createIndex({ version: 1, deleteIfExists: true })` |
| 1.4  | Review `_loadHashIndex()` (lines 111-142) and confirm both corruption paths (invalid JSON and schema mismatch) call `_backupFile()` before resetting         | Both catch blocks call `_backupFile()` which renames the corrupt file to `.bak`                                    |

## Phase 2: Indexing Pipeline

| Step | Action                                                                                                             | Expected                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 2.1  | Run `pnpm test -- src/features/vector-store.test.ts` and inspect "VectorStore indexRecipes" block                  | All 7 indexing tests pass (AC2.1 through AC2.6)                                                  |
| 2.2  | Review `indexRecipes()` (lines 154-217) and confirm the batch embedding loop chunks at `BATCH_SIZE = 500`          | Lines 185-189 slice `toEmbed` into chunks of `BATCH_SIZE` and call `embedBatch` per chunk        |
| 2.3  | Review the atomic write in `_persistHashes()` (lines 227-237) and confirm it follows write-to-tmp + rename pattern | Creates a timestamped `.tmp` file, writes JSON, calls `fh.sync()`, then `rename()` to final path |
| 2.4  | Confirm `indexRecipe()` (line 219-221) is a thin wrapper over `indexRecipes()` passing a single-element array      | Single-line delegation confirmed                                                                 |

## Phase 3: Search

| Step | Action                                                                                                                                   | Expected                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 3.1  | Run integration tests and inspect "Search with ordering by similarity"                                                                   | Test indexes 3 recipes with distinct ingredients, searches, and validates descending score order and correct `SemanticResult` shape |
| 3.2  | Review `search()` (lines 239-247) and confirm it calls `embed()` on the query, then `queryItems()`, and maps results to `SemanticResult` | Method embeds query string, passes vector and topK to Vectra, maps results extracting `id`, `score`, and `recipeName` from metadata |

## Phase 4: Removal

| Step | Action                                                                                                           | Expected                                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 4.1  | Run integration test "Removal removes from search results"                                                       | Indexes 2 recipes, removes one, confirms it no longer appears in search results         |
| 4.2  | Review `removeRecipe()` (lines 249-255) and confirm it only persists hashes when the uid was actually in the map | `if (uid in this._hashes)` guard prevents unnecessary disk writes for non-existent UIDs |

## End-to-End: Full Lifecycle Scenario

1. Run `pnpm test -- src/features/vector-store.test.integration.ts` — all 6 integration tests should pass.
2. Inspect "Hash persistence across VectorStore restarts" test — validates index, destroy, recreate, and skip unchanged recipes.
3. Inspect "Removal removes from search results" test — validates Vectra deletion and hash map cleanup work together.

## Traceability

| Acceptance Criterion                  | Automated Test            | Manual Step           |
| ------------------------------------- | ------------------------- | --------------------- |
| AC1.1 init creates index              | Unit + Integration        | Steps 1.1, 1.2        |
| AC1.2 init loads existing state       | Unit                      | Step 1.1              |
| AC1.3 corrupt hash-index recovery     | Unit (2 tests)            | Steps 1.1, 1.4        |
| AC1.4 corrupt Vectra recovery         | Unit                      | Steps 1.1, 1.3        |
| AC2.1 embed and upsert changed        | Unit + Integration        | Steps 2.1, 2.2        |
| AC2.2 skip unchanged                  | Unit + Integration        | Step 2.1              |
| AC2.3 correct IndexingResult          | Unit                      | Step 2.1              |
| AC2.4 persist hash map                | Unit                      | Steps 2.1, 2.3        |
| AC2.5 empty array no-op               | Unit                      | Step 2.1              |
| AC2.6 hash persistence across restart | Unit + Integration        | Steps 2.1, E2E step 2 |
| AC3.1 SemanticResult shape            | Unit + Integration        | Steps 3.1, 3.2        |
| AC3.2 descending score order          | Unit + Integration        | Step 3.1              |
| AC3.3 empty index returns []          | Unit + Integration        | Step 3.1              |
| AC4.1 remove from Vectra + hash map   | Unit + Integration        | Steps 4.1, E2E step 3 |
| AC4.2 persist after removal           | Unit                      | Step 4.2              |
| AC4.3 remove non-existent no-op       | Unit                      | Step 4.1              |
| AC5.1 stable SHA-256                  | Unit + Property (3 tests) | Step 1.1              |
| AC5.2 directions excluded             | Unit                      | Step 2.1              |
| AC5.3 ingredients included            | Unit                      | Step 2.1              |
