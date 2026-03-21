# Human Test Plan: discover_recipes Tool (p3-u06)

## Prerequisites

- Node.js 24 installed (via mise)
- `pnpm install` completed
- `pnpm test` passes (449 tests, 0 failures)
- Valid Paprika API credentials in `.env`
- Ollama running locally with `nomic-embed-text` model pulled (for vector store embedding)

## Phase 1: End-to-End Semantic Search

| Step | Action                                                                                                                                                      | Expected                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1    | Start the MCP server via `pnpm dev`                                                                                                                         | Server starts on stdio transport without errors                                                   |
| 2    | Trigger an initial sync (connect an MCP client, e.g. Claude Desktop)                                                                                        | Recipes sync from Paprika API; stderr logs show recipe count > 0                                  |
| 3    | Wait for vector store indexing to complete                                                                                                                  | Stderr logs indicate embedding indexing has finished                                              |
| 4    | Invoke `discover_recipes` with `query: "something spicy with chicken"`                                                                                      | Returns numbered list of semantically relevant recipes with match percentages, UIDs, and metadata |
| 5    | Verify result formatting: each entry has `N. **Recipe Name** — XX% match`, a `UID:` line with backtick-wrapped UID, and optional Prep/Cook/Categories lines | All formatting matches the specification                                                          |
| 6    | Invoke `discover_recipes` with `query: "something spicy"` and `topK: 2`                                                                                     | Returns at most 2 results                                                                         |
| 7    | Copy a UID from a discover result, then invoke `read_recipe` with that UID                                                                                  | The full recipe is returned, confirming the UID is valid and actionable                           |

## Phase 2: Edge Cases

| Step | Action                                                                                                                                         | Expected                                                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1    | Invoke `discover_recipes` with `query: "xyzzy nonsense query that matches nothing"`                                                            | Returns `"No recipes found matching that description."`                                                 |
| 2    | Start the server with an empty Paprika account (no recipes)                                                                                    | Server starts successfully                                                                              |
| 3    | Invoke `discover_recipes` with any query before sync completes                                                                                 | Returns cold-start message containing "try again"                                                       |
| 4    | Delete a recipe in the Paprika app, wait for next sync, then invoke `discover_recipes` with a query that would have matched the deleted recipe | The deleted recipe does not appear in results; remaining results are numbered sequentially without gaps |

## End-to-End: Discovery-to-Action Workflow

**Purpose:** Validate that `discover_recipes` integrates correctly with the rest of the tool suite as a natural entry point for recipe exploration.

**Steps:**

1. Connect an MCP client to the server and wait for sync + indexing to complete.
2. Invoke `discover_recipes` with `query: "quick weeknight dinner"`, `topK: 5`.
3. Verify results are sorted by similarity (highest percentage first).
4. Pick the top result's UID. Invoke `read_recipe` with that UID to confirm the full recipe loads.
5. Invoke `search_recipes` with the recipe name from step 4. Confirm the same recipe appears in text search results, validating consistency between semantic and keyword search.
6. Invoke `discover_recipes` with a more specific refinement, e.g., `query: "quick weeknight pasta under 30 minutes"`. Confirm the results narrow appropriately.

## Human Verification Required

The test-requirements document states: "None — all criteria are automatable." There are no mandatory human verification items. The manual steps above are supplementary end-to-end validation to confirm the tool works correctly against a live Paprika account and real embeddings.

## Traceability

| Acceptance Criterion          | Automated Test                                                         | Manual Step              |
| ----------------------------- | ---------------------------------------------------------------------- | ------------------------ |
| AC1.1 Tool registration       | `AC1.1: tool is registered with name discover_recipes`                 | Phase 1, Step 2-4        |
| AC1.2 `query` required        | Implicitly by all tests                                                | Phase 1, Step 4          |
| AC1.3 `topK` default/override | `AC1.3: topK defaults to 5` / `topK uses provided value`               | Phase 1, Step 6          |
| AC2.1 Search delegation       | `AC2.1: vectorStore.search is called with query and topK`              | Phase 1, Step 4          |
| AC2.2 Name + percentage       | `AC2.2: result includes recipe name with integer percentage match`     | Phase 1, Step 5          |
| AC2.3 Categories              | `AC2.3: categories are resolved...` / `categories line is absent...`   | Phase 1, Step 5          |
| AC2.4 Prep/Cook times         | `AC2.4: prepTime and cookTime are displayed...` / `omits...when null`  | Phase 1, Step 5          |
| AC2.5 UID format              | `AC2.5: result includes UID in backtick format`                        | Phase 1, Step 5 + Step 7 |
| AC3.1 Empty results           | `AC3.1: search returns empty array`                                    | Phase 2, Step 1          |
| AC3.2 All deleted             | `AC3.2: all results map to deleted recipes`                            | Phase 2, Step 4          |
| AC4.1 Skip deleted            | `AC4.1: silently skips deleted recipes`                                | Phase 2, Step 4          |
| AC4.2 Re-number               | `AC4.2: remaining results are re-numbered sequentially`                | Phase 2, Step 4          |
| AC5.1 Cold-start guard        | `AC5.1: empty store returns cold-start message without calling search` | Phase 2, Step 3          |
