# Test Requirements: p2-u10-resource-reg

## Summary

This unit registers `paprika://recipe/{uid}` as an MCP resource, enabling MCP clients to list all non-trashed recipes and read individual ones as Markdown. It also extends `commitRecipe` to emit `sendResourceListChanged()` after every CRUD mutation so clients know to refresh.

Tests verify three concerns: (1) the list callback returns correctly shaped resource entries and handles empty stores and trashed recipes, (2) the read callback produces UID-prefixed Markdown with resolved categories and rejects missing UIDs, and (3) `commitRecipe` calls `sendResourceListChanged()` exactly once in the correct position relative to `store.set` and `notifySync`.

All acceptance criteria are fully automatable as unit tests. No human verification is required.

## Automated Tests

### AC1: Recipe list is accessible as MCP resources

#### p2-u10-resource-reg.AC1.1 [Success]

- **Test type:** unit
- **File:** `src/resources/recipes.test.ts`
- **What to verify:** When the store contains two non-trashed recipes, `callResourceList("recipes")` returns a `resources` array with two entries. Each entry has `uri: "paprika://recipe/{uid}"` (matching the recipe's UID), `name` matching `recipe.name`, and `mimeType: "text/markdown"`.
- **Test name pattern:** `"p2-u10-resource-reg.AC1.1: list handler returns all non-trashed recipes with correct uri, name, and mimeType"`
- **Implementation notes:** Uses `makeTestServer()` and `callResourceList()` from extended `tool-test-utils.ts`. Populates a real `RecipeStore` via `store.load()` with two recipes created by `makeRecipe()`.

#### p2-u10-resource-reg.AC1.2 [Success]

- **Test type:** unit
- **File:** `src/resources/recipes.test.ts`
- **What to verify:** When the store is empty (no recipes loaded), `callResourceList("recipes")` returns `{ resources: [] }` without throwing. This confirms no cold-start guard fires for resources.
- **Test name pattern:** `"p2-u10-resource-reg.AC1.2: list handler returns empty resources array when store is empty"`
- **Implementation notes:** Creates a `RecipeStore` with `store.load([], [])` (empty arrays). Asserts the result deeply equals `{ resources: [] }` and no exception is thrown.

#### p2-u10-resource-reg.AC1.3 [Success]

- **Test type:** unit
- **File:** `src/resources/recipes.test.ts`
- **What to verify:** When the store contains one non-trashed recipe and one trashed recipe (`inTrash: true`), `callResourceList("recipes")` returns only the non-trashed recipe. The trashed recipe's UID must not appear in the results.
- **Test name pattern:** `"p2-u10-resource-reg.AC1.3: list handler excludes trashed recipes"`
- **Implementation notes:** Uses `makeRecipe({ inTrash: true })` for the trashed recipe. This behavior is delegated to `RecipeStore.getAll()` which already filters trashed recipes, but the test confirms the resource layer does not re-include them.

### AC2: Individual recipes are readable as MCP resources

#### p2-u10-resource-reg.AC2.1 [Success]

- **Test type:** unit
- **File:** `src/resources/recipes.test.ts`
- **What to verify:** For a recipe with a known UID, `callResource("recipes", uid)` returns content where `contents[0].text` starts with `` **UID:** `{uid}` `` followed by a double newline and then the recipe markdown body.
- **Test name pattern:** `"p2-u10-resource-reg.AC2.1: read handler returns content with UID header prepended to recipe markdown"`
- **Implementation notes:** Creates a recipe with a specific UID (e.g., `"test-uid-1" as RecipeUid`), loads it into the store, and asserts the text starts with the UID header line. Also verifies the remainder matches `recipeToMarkdown()` output.

#### p2-u10-resource-reg.AC2.2 [Success]

- **Test type:** unit
- **File:** `src/resources/recipes.test.ts`
- **What to verify:** For a recipe with category UIDs assigned, the read handler resolves those UIDs to display names via `ctx.store.resolveCategories()` and includes them in the markdown output (e.g., `**Categories:** Desserts, Breakfast`). Raw category UIDs must not appear in the output.
- **Test name pattern:** `"p2-u10-resource-reg.AC2.2: read handler resolves category UIDs to display names in markdown"`
- **Implementation notes:** Uses `makeCategory()` to create categories with known UIDs and names, loads them into the store alongside a recipe whose `categories` array references those UIDs. Asserts the output text contains the human-readable category names.

#### p2-u10-resource-reg.AC2.3 [Success]

- **Test type:** unit
- **File:** `src/resources/recipes.test.ts`
- **What to verify:** The read handler's response includes `contents[0].mimeType === "text/markdown"` and `contents[0].uri` matching the `paprika://recipe/{uid}` URI (i.e., `uri.href`).
- **Test name pattern:** `"p2-u10-resource-reg.AC2.3: read handler response includes correct mimeType and uri"`
- **Implementation notes:** Can be combined with the AC2.1 test or kept separate. The URI assertion checks that `contents[0].uri === "paprika://recipe/{uid}"` where `{uid}` is the recipe's actual UID.

#### p2-u10-resource-reg.AC2.4 [Failure]

- **Test type:** unit
- **File:** `src/resources/recipes.test.ts`
- **What to verify:** When `callResource("recipes", "nonexistent-uid")` is called with a UID that does not exist in the store, the promise rejects with an `Error`. The error message should contain the missing UID string.
- **Test name pattern:** `"p2-u10-resource-reg.AC2.4: read handler throws error for missing UID"`
- **Implementation notes:** Uses Vitest's `await expect(...).rejects.toThrow()` pattern. The implementation throws a plain `Error` (not `McpError`) per the design decision -- the SDK converts uncaught handler errors to protocol errors.

### AC3: CRUD mutations notify MCP clients via resource list change

#### p2-u10-resource-reg.AC3.1 [Success]

- **Test type:** unit
- **File:** `src/tools/helpers.test.ts`
- **What to verify:** After calling `commitRecipe(ctx, saved)`, `ctx.server.sendResourceListChanged` has been called exactly once (`toHaveBeenCalledTimes(1)`).
- **Test name pattern:** `"p2-recipe-crud.AC-helpers.7: calls putRecipe, flush, store.set, sendResourceListChanged, and notifySync exactly once each"`
- **Implementation notes:** This extends the existing AC-helpers.7 test. The inline `ctx` object's `server` stub gains `sendResourceListChanged: vi.fn()` (replacing the current `server: {}`). The new mock is asserted alongside the four existing call-count assertions. The test does NOT use `makeTestServer()` -- it constructs an inline context with individual mocks, consistent with the existing pattern in `helpers.test.ts`.

#### p2-u10-resource-reg.AC3.2 [Success]

- **Test type:** unit
- **File:** `src/tools/helpers.test.ts`
- **What to verify:** In the call-order tracking test, `sendResourceListChanged` appears after `storeSet` in the recorded `callOrder` array. This confirms the in-process store is updated before clients are notified to re-list.
- **Test name pattern:** `"p2-recipe-crud.AC-helpers.8: call order is putRecipe -> flush -> storeSet -> sendResourceListChanged -> notifySync"`
- **Implementation notes:** This extends the existing AC-helpers.8 test. A `mockSendResourceListChanged` spy is added that pushes `"sendResourceListChanged"` to the `callOrder` array. The expected order changes from `["putRecipe", "flush", "storeSet", "notifySync"]` to `["putRecipe", "flush", "storeSet", "sendResourceListChanged", "notifySync"]`. The `server` stub gains the new mock (replacing `server: {}`).

#### p2-u10-resource-reg.AC3.3 [Success]

- **Test type:** unit
- **File:** `src/tools/helpers.test.ts`
- **What to verify:** In the same call-order tracking test (AC-helpers.8), `sendResourceListChanged` appears before `notifySync`. This confirms notification order is `store.set` -> `sendResourceListChanged` -> `notifySync`.
- **Test name pattern:** Same test as AC3.2 -- `"p2-recipe-crud.AC-helpers.8: call order is putRecipe -> flush -> storeSet -> sendResourceListChanged -> notifySync"`
- **Implementation notes:** AC3.2 and AC3.3 are verified by the same assertion (`expect(callOrder).toEqual([...])`) since the full five-element order array implicitly asserts both that `sendResourceListChanged` follows `storeSet` (AC3.2) and precedes `notifySync` (AC3.3). A third existing test (AC-helpers.9) only needs its server stub fixed to include `sendResourceListChanged: vi.fn()` to prevent a runtime error -- no new assertion is needed there.

## Human Verification

No acceptance criteria require human verification. All behaviors are exercised through unit tests:

- **AC1 (list handler):** The list callback is invoked directly via `callResourceList()` on the stub server, which captures the `ResourceTemplate.listCallback` registered during `registerRecipeResources()`. No live MCP transport is needed.
- **AC2 (read handler):** The read callback is invoked directly via `callResource()` on the stub server, which calls the `readCallback` passed to `server.registerResource()`. Markdown content is deterministic and string-assertable.
- **AC3 (commitRecipe notification):** The `sendResourceListChanged` spy is a `vi.fn()` on the inline server stub. Call count and ordering are asserted via standard Vitest mock APIs.
- **Entry-point wiring** (`registerRecipeResources` called from `src/index.ts`) is explicitly out of scope for this unit per the Phase 3 implementation plan. It will be covered in a later unit that assembles the entry point.
