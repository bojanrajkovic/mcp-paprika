# Human Test Plan: p2-recipe-crud (Recipe CRUD Tools)

**Implementation plan:** `docs/implementation-plans/2026-03-14-p2-recipe-crud/`
**Base SHA:** `c6b148772628c158b292b54538d91f667920cd56`
**HEAD SHA:** `d524abdbe6a9323ed009abb9a1b9fe3287516416`
**Automated coverage:** 41/41 acceptance criteria (PASS)

---

## Prerequisites

- Node.js 24 installed (via mise)
- `pnpm install` completed successfully
- All automated tests passing: `pnpm test` (351 tests, 0 failures)
- Paprika account credentials configured in `.env`
- MCP server buildable: `pnpm build`

---

## Phase 1: read_recipe Tool Verification

| Step | Action                                                                                                                                                       | Expected                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1  | Start the MCP server via `pnpm dev`. Connect an MCP client. Invoke `read_recipe` with `{ uid: "<valid-recipe-uid>" }` using a UID from your Paprika library. | Response is a markdown document beginning with `# <recipe name>`, containing `## Ingredients` and `## Directions` sections. Category names (not UIDs) appear if the recipe has categories. |
| 1.2  | Invoke `read_recipe` with `{ title: "<exact recipe name>" }` using the full name of a recipe in your library.                                                | Returns the single matching recipe as a full markdown document.                                                                                                                            |
| 1.3  | Invoke `read_recipe` with `{ title: "<first few characters>" }` using a prefix that matches exactly one recipe.                                              | Returns the single matching recipe.                                                                                                                                                        |
| 1.4  | Invoke `read_recipe` with `{ title: "<common word>" }` where the word appears in multiple recipe names (e.g., "Chicken").                                    | Returns a disambiguation list showing each matching recipe's name and UID. No full recipe content (no `## Ingredients` sections).                                                          |
| 1.5  | Invoke `read_recipe` with `{ uid: "00000000-0000-0000-0000-000000000000" }` (a UID that does not exist).                                                     | Response text contains "not found" or similar error message.                                                                                                                               |
| 1.6  | Invoke `read_recipe` with `{ title: "XYZZY_NoSuchRecipe_12345" }`.                                                                                           | Response text contains "not found" or similar.                                                                                                                                             |
| 1.7  | Invoke `read_recipe` with `{}` (empty arguments).                                                                                                            | Response text instructs the caller to provide either `uid` or `title`.                                                                                                                     |
| 1.8  | Restart the MCP server freshly. Immediately (before the initial sync completes) invoke `read_recipe` with any arguments.                                     | Response contains "try again" — the cold-start guard fires.                                                                                                                                |

---

## Phase 2: create_recipe Tool Verification

| Step | Action                                                                                                                                                                                                                                                                                  | Expected                                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | Invoke `create_recipe` with `{ name: "Test Soup", ingredients: "water, salt, pepper", directions: "Boil water. Add salt and pepper." }`.                                                                                                                                                | Response is markdown with `# Test Soup`, `## Ingredients`, `## Directions`. The recipe appears in Paprika app after a sync. |
| 2.2  | Invoke `create_recipe` with all optional fields: `{ name: "Full Recipe", ingredients: "flour, sugar", directions: "Mix and bake", description: "A test recipe", servings: "4", prepTime: "10 min", cookTime: "30 min", notes: "Test note", categories: ["<existing category name>"] }`. | Response markdown includes description, servings, prep/cook time, notes, and category name.                                 |
| 2.3  | After step 2.1, open Paprika app and sync. Verify the "Test Soup" recipe exists with correct ingredients and directions. Verify optional fields not provided (description, notes, etc.) are blank/absent in Paprika.                                                                    | Recipe exists in Paprika. Optional fields are empty, not set to empty strings.                                              |
| 2.4  | Invoke `create_recipe` with `categories: ["<valid category>", "NonexistentCategory123"]`.                                                                                                                                                                                               | Response markdown shows a `Warning: category "NonexistentCategory123" not found` message. The valid category is assigned.   |
| 2.5  | Clean up: delete the test recipes created in steps 2.1–2.4 via the Paprika app.                                                                                                                                                                                                         | Recipes removed.                                                                                                            |

---

## Phase 3: update_recipe Tool Verification

| Step | Action                                                                                                                                              | Expected                                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 3.1  | Create a test recipe via `create_recipe` with known field values. Then invoke `update_recipe` with `{ uid: "<recipe uid>", name: "Updated Name" }`. | Response confirms update. The name changed. Other fields (ingredients, directions, servings, etc.) remain unchanged. |
| 3.2  | Invoke `update_recipe` with `{ uid: "<recipe uid>", categories: ["<different category>"] }`.                                                        | Categories are fully replaced. The old category is gone; the new one is assigned.                                    |
| 3.3  | Invoke `update_recipe` with `{ uid: "<recipe uid>", servings: "8" }` without providing `categories`.                                                | Servings updated. Categories remain from the previous step.                                                          |
| 3.4  | Invoke `update_recipe` with `{ uid: "nonexistent-uid", name: "New" }`.                                                                              | Response contains "not found" or similar error.                                                                      |
| 3.5  | Clean up: delete the test recipe via the Paprika app.                                                                                               | Recipe removed.                                                                                                      |

---

## Phase 4: delete_recipe Tool Verification

| Step | Action                                                                                                | Expected                                                                |
| ---- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 4.1  | Create a test recipe via `create_recipe`. Then invoke `delete_recipe` with `{ uid: "<recipe uid>" }`. | Response confirms deletion, includes recipe name and "trash".           |
| 4.2  | Open Paprika app and sync. Verify the recipe appears in the Trash.                                    | Recipe is in Paprika's Trash (soft-deleted, not permanently removed).   |
| 4.3  | Invoke `delete_recipe` again with the same UID (already trashed).                                     | Response states the recipe is "already in the trash". No API call made. |
| 4.4  | Invoke `delete_recipe` with `{ uid: "nonexistent-uid" }`.                                             | Response contains "not found" or similar error.                         |
| 4.5  | Clean up: permanently delete or restore the trashed recipe in Paprika app.                            | Trash cleared.                                                          |

---

## End-to-End: Full Recipe Lifecycle

**Purpose:** Validates the complete create-read-update-delete lifecycle works correctly end-to-end through the MCP server with a live Paprika account.

| Step  | Action                                                                                                                                                                                                                                          | Expected                                                                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E2E.1 | Wait for the MCP server initial sync to complete (store populated).                                                                                                                                                                             | Server logs indicate sync complete.                                                                                                                               |
| E2E.2 | `create_recipe` with `{ name: "E2E Test Recipe", ingredients: "flour, eggs, milk", directions: "Mix ingredients. Cook.", description: "End-to-end test", servings: "2", categories: ["<existing category>"] }`. Note the UID from the response. | Recipe created. Markdown response includes all provided fields.                                                                                                   |
| E2E.3 | `read_recipe` with `{ uid: "<uid from E2E.2>" }`.                                                                                                                                                                                               | Returns full markdown of the recipe just created, matching all fields.                                                                                            |
| E2E.4 | `read_recipe` with `{ title: "E2E Test Recipe" }`.                                                                                                                                                                                              | Same recipe returned via title lookup.                                                                                                                            |
| E2E.5 | `update_recipe` with `{ uid: "<uid>", servings: "6", notes: "Updated via MCP" }`.                                                                                                                                                               | Confirms update. Servings changed to 6, notes added. Name, ingredients, directions unchanged.                                                                     |
| E2E.6 | `read_recipe` with `{ uid: "<uid>" }` to verify the update persisted.                                                                                                                                                                           | Markdown shows `**Servings:** 6` and `## Notes` with "Updated via MCP". Original fields intact.                                                                   |
| E2E.7 | `delete_recipe` with `{ uid: "<uid>" }`.                                                                                                                                                                                                        | Confirms soft-deletion to trash.                                                                                                                                  |
| E2E.8 | `read_recipe` with `{ uid: "<uid>" }`.                                                                                                                                                                                                          | Behavior depends on whether trashed recipes are visible in the store. Verify the response is consistent (either shows the trashed recipe or returns "not found"). |
| E2E.9 | Sync Paprika app. Verify the recipe is in Trash. Restore or permanently delete it.                                                                                                                                                              | Recipe visible in Paprika Trash. Cleanup complete.                                                                                                                |

---

## Traceability

| Acceptance Criterion | Automated Test                                          | Manual Step |
| -------------------- | ------------------------------------------------------- | ----------- |
| AC1.1                | `read.test.ts` — UID lookup + category name test        | 1.1         |
| AC1.2                | `read.test.ts` — exact title match                      | 1.2         |
| AC1.3                | `read.test.ts` — starts-with + contains match           | 1.3         |
| AC1.4                | `read.test.ts` — disambiguation list                    | 1.4         |
| AC1.5                | `read.test.ts` — UID not found                          | 1.5         |
| AC1.6                | `read.test.ts` — title no matches                       | 1.6         |
| AC1.7                | `read.test.ts` — neither uid nor title                  | 1.7         |
| AC1.8                | `read.test.ts` — cold-start guard                       | 1.8         |
| AC1.9                | `read.test.ts` — UID precedence over title              | —           |
| AC2.1                | `create.test.ts` — required fields → markdown           | 2.1         |
| AC2.2                | `create.test.ts` — optional fields in response          | 2.2         |
| AC2.3                | `create.test.ts` — omitted fields default to null       | 2.3         |
| AC2.4                | `create.test.ts` — category names → UIDs                | 2.2         |
| AC2.5                | `create.test.ts` — saveRecipe/notifySync called once    | —           |
| AC2.6                | `create.test.ts` — store.set/cache.putRecipe with saved | —           |
| AC2.7                | `create.test.ts` — unknown category warning             | 2.4         |
| AC2.8                | `create.test.ts` — saveRecipe throws → error            | —           |
| AC2.9                | `create.test.ts` — cold-start guard                     | —           |
| AC3.1                | `update.test.ts` — partial update, omitted retained     | 3.1         |
| AC3.2                | `update.test.ts` — categories replaced entirely         | 3.2         |
| AC3.3                | `update.test.ts` — omitting categories leaves unchanged | 3.3         |
| AC3.4                | `update.test.ts` — saveRecipe/notifySync once           | —           |
| AC3.5                | `update.test.ts` — UID not found                        | 3.4         |
| AC3.6                | `update.test.ts` — saveRecipe throws → error            | —           |
| AC3.7                | `update.test.ts` — cold-start guard                     | —           |
| AC4.1                | `delete.test.ts` — soft-delete + confirmation           | 4.1         |
| AC4.2                | `delete.test.ts` — saveRecipe with inTrash:true         | —           |
| AC4.3                | `delete.test.ts` — store.set/cache.putRecipe            | 4.2         |
| AC4.4                | `delete.test.ts` — UID not found                        | 4.4         |
| AC4.5                | `delete.test.ts` — already in trash                     | 4.3         |
| AC4.6                | `delete.test.ts` — saveRecipe throws → error            | —           |
| AC4.7                | `delete.test.ts` — cold-start guard                     | —           |
| AC-helpers.1         | `helpers.test.ts` — exact name match                    | —           |
| AC-helpers.2         | `helpers.test.ts` — case-insensitive match              | —           |
| AC-helpers.3         | `helpers.test.ts` — unrecognized name in unknown        | —           |
| AC-helpers.4         | `helpers.test.ts` — mixed known/unknown                 | —           |
| AC-helpers.5         | `helpers.test.ts` — empty names array                   | —           |
| AC-helpers.6         | `helpers.test.ts` — empty categories array              | —           |
| AC-helpers.7         | `helpers.test.ts` — all four called once                | —           |
| AC-helpers.8         | `helpers.test.ts` — call order verification             | —           |
| AC-helpers.9         | `helpers.test.ts` — store.set with saved recipe         | —           |
