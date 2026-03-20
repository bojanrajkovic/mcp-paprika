# Human Test Plan: Embedding Client (p3-u03-embeddings)

## Prerequisites

- Node.js 24 with pnpm 10.30.3 installed (via mise)
- `pnpm install` completed
- `pnpm test` passing (390 tests, 0 failures)
- An OpenAI-compatible embedding API endpoint available (e.g., OpenAI, local Ollama with embedding model, or LiteLLM proxy)

## Phase 1: EmbeddingClient HTTP Contract

| Step | Action                                                                                                                                                                        | Expected                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1    | Configure embedding settings: set `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL` (e.g., `https://api.openai.com/v1`), `EMBEDDING_MODEL` (e.g., `text-embedding-3-small`) in `.env` | Configuration loads without error                                                       |
| 2    | Call `embedBatch(["hello world", "test"])` against the real API                                                                                                               | Returns an array of exactly 2 embedding vectors, each a `number[]` of consistent length |
| 3    | Call `embed("single text")` against the real API                                                                                                                              | Returns a single `number[]` vector of the same dimensionality as step 2                 |
| 4    | Access `client.dimensions` after a successful call                                                                                                                            | Returns the dimensionality (e.g., 1536 for `text-embedding-3-small`)                    |

## Phase 2: Resilience Behavior (Observational)

| Step | Action                                                                                 | Expected                                                                                         |
| ---- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1    | Temporarily point `EMBEDDING_BASE_URL` to a non-existent host and call `embed("test")` | Call fails after retry attempts (observable delay of several seconds due to exponential backoff) |
| 2    | Set `EMBEDDING_API_KEY` to an invalid value and call `embed("test")`                   | `EmbeddingAPIError` thrown immediately with status 401, no retry delay                           |
| 3    | Restore valid configuration and call `embed("test")`                                   | Succeeds, confirming the client recovers                                                         |

## Phase 3: recipeToEmbeddingText Output Quality

| Step | Action                                                                                                                                    | Expected                                                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Call `recipeToEmbeddingText` with a fully-populated recipe (name, description, ingredients, notes) and categories `["Italian", "Dinner"]` | Output is multi-line text: recipe name on first line, then "Description: ...", "Categories: Italian, Dinner", "Ingredients: ...", "Notes: ..." separated by blank lines |
| 2    | Inspect the output for any mention of directions content                                                                                  | Directions are absent from the output                                                                                                                                   |
| 3    | Call with a minimal recipe (only name, all other fields null/empty, no categories)                                                        | Output is just the recipe name with no blank lines or empty labels                                                                                                      |
| 4    | Visually review the text for suitability as embedding input: is it readable? Does it capture the recipe's identity for semantic search?   | Text should be concise, relevant, and free of structural noise                                                                                                          |

## End-to-End: Embedding a Real Recipe

**Purpose:** Validate that the full pipeline -- from recipe data through text conversion to API call -- produces meaningful embeddings that could support semantic search.

**Steps:**

1. Load a recipe from the Paprika cache (or create one via `makeRecipe` with realistic data: "Pasta Carbonara", description "Classic Roman pasta dish with eggs and guanciale", ingredients "spaghetti, eggs, pecorino romano, guanciale, black pepper", notes "Use guanciale, not pancetta", categories `["Italian", "Pasta", "Dinner"]`).
2. Call `recipeToEmbeddingText(recipe, categoryNames)` and inspect the output string.
3. Pass the output string to `client.embed(text)`.
4. Verify the returned vector is a `number[]` of expected dimensionality.
5. Repeat with a semantically different recipe (e.g., "Chocolate Chip Cookies" with baking categories).
6. Confirm both embeddings have the same dimensionality but different values (cosine similarity should be noticeably less than 1.0).

## Human Verification Required

The test-requirements document states "None -- all criteria are covered by automated tests." No manual-only acceptance criteria exist. The steps above are supplementary end-to-end and integration checks for confidence.

## Traceability

| Acceptance Criterion                                    | Automated Test             | Manual Step     |
| ------------------------------------------------------- | -------------------------- | --------------- |
| AC1.1 - POST with correct body/headers                  | `embeddings.test.ts` AC1.1 | Phase 1, Step 2 |
| AC1.2 - embed returns single vector                     | `embeddings.test.ts` AC1.2 | Phase 1, Step 3 |
| AC1.3 - trailing slash stripped                         | `embeddings.test.ts` AC1.3 | -- (unit-only)  |
| AC1.4 - Zod validation                                  | `embeddings.test.ts` AC1.4 | -- (unit-only)  |
| AC2.1 - 429 retry                                       | `embeddings.test.ts` AC2.1 | Phase 2, Step 1 |
| AC2.2 - 500/502/503 retry                               | `embeddings.test.ts` AC2.2 | Phase 2, Step 1 |
| AC2.3 - circuit breaker                                 | `embeddings.test.ts` AC2.3 | Phase 2, Step 1 |
| AC3.1 - 400 no retry                                    | `embeddings.test.ts` AC3.1 | Phase 2, Step 2 |
| AC3.2 - 401 no retry                                    | `embeddings.test.ts` AC3.2 | Phase 2, Step 2 |
| AC3.3 - malformed response ZodError                     | `embeddings.test.ts` AC3.3 | -- (unit-only)  |
| AC4.1 - dimensions after embed                          | `embeddings.test.ts` AC4.1 | Phase 1, Step 4 |
| AC4.2 - dimensions before embed throws                  | `embeddings.test.ts` AC4.2 | -- (unit-only)  |
| AC5.1 - includes name/desc/categories/ingredients/notes | `embeddings.test.ts` AC5.1 | Phase 3, Step 1 |
| AC5.2 - excludes directions                             | `embeddings.test.ts` AC5.2 | Phase 3, Step 2 |
| AC5.3 - omits null/empty fields                         | `embeddings.test.ts` AC5.3 | Phase 3, Step 3 |
| AC5.4 - empty categories no label                       | `embeddings.test.ts` AC5.4 | Phase 3, Step 3 |
