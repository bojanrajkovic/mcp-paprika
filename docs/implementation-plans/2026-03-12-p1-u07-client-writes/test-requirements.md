# PaprikaClient Write Operations -- Test Requirements

Maps every acceptance criterion from the `p1-u07-client-writes` design plan to either an
automated test or a documented human-verification step.

All automated tests live in `src/paprika/client.test.ts` and use the MSW/Vitest stack
established by earlier units. Tests follow the existing naming convention:
`"p1-u07-client-writes.ACx.y - [description]"`.

---

## Automated Tests

| Criterion ID                 | Test Type  | Test File                    | Description                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `p1-u07-client-writes.AC1.1` | Unit (MSW) | `src/paprika/client.test.ts` | Register an `http.post` handler at `${API_BASE}/recipe/${uid}/` and call `saveRecipe(recipe)`. Verify the handler is reached and the request URL contains the recipe's `uid`. If MSW does not match the URL, the test fails with an unhandled-request error, which is itself proof the URL was wrong.                                                                                                              |
| `p1-u07-client-writes.AC1.2` | Unit (MSW) | `src/paprika/client.test.ts` | Intercept the POST FormData body, extract the `"data"` blob, decompress with `gunzipSync`, parse JSON, and assert that snake_case keys (`prep_time`, `cook_time`, `total_time`, `image_url`, `on_favorites`, `in_trash`, `is_pinned`, `on_grocery_list`, `nutritional_info`) are present. Assert camelCase equivalents (`prepTime`, `imageUrl`, `onFavorites`) are absent. Combined with AC1.3 into a single test. |
| `p1-u07-client-writes.AC1.3` | Unit (MSW) | `src/paprika/client.test.ts` | Same intercepted payload as AC1.2. Assert `Object.keys(payload).length === 28` to confirm no fields were dropped during the `recipeToApiPayload` mapping. Combined with AC1.2 into a single test.                                                                                                                                                                                                                  |
| `p1-u07-client-writes.AC1.4` | Unit (MSW) | `src/paprika/client.test.ts` | Handler returns `HttpResponse.json({ result: makeSnakeCaseRecipe(uid) })`. Assert the returned `Recipe` object has camelCase properties (`prepTime`, `onFavorites`, `imageUrl`) and does not have snake_case properties (`prep_time`). Confirms `RecipeSchema` parses the server response.                                                                                                                         |
| `p1-u07-client-writes.AC1.5` | Unit (MSW) | `src/paprika/client.test.ts` | Handler returns `HttpResponse.json({}, { status: 422 })`. Use the `try/catch` + `expect.fail("Should have thrown PaprikaAPIError")` pattern. Assert the caught error is `instanceof PaprikaAPIError`.                                                                                                                                                                                                              |
| `p1-u07-client-writes.AC2.1` | Unit (MSW) | `src/paprika/client.test.ts` | Register three handlers: GET recipe (returns the recipe), POST recipe (captures and decompresses FormData payload), POST notify (flags call). Call `deleteRecipe(uid)`. Assert the decompressed payload contains `in_trash: true`.                                                                                                                                                                                 |
| `p1-u07-client-writes.AC2.2` | Unit (MSW) | `src/paprika/client.test.ts` | Same three-handler setup as AC2.1. Assert the notify-POST boolean flag is `true` after `deleteRecipe` resolves. Combined with AC2.1 into a single test.                                                                                                                                                                                                                                                            |
| `p1-u07-client-writes.AC2.3` | Unit (MSW) | `src/paprika/client.test.ts` | Register GET recipe handler returning 404 and POST notify handler with a boolean flag. Do NOT register a save-recipe POST handler (MSW returns 500 for unhandled routes, catching accidental calls). Use `try/catch` + `expect.fail` pattern. Assert error is `instanceof PaprikaAPIError`. Assert notify flag is `false` (no subsequent POST was made).                                                           |
| `p1-u07-client-writes.AC3.1` | Unit (MSW) | `src/paprika/client.test.ts` | Register `http.post` at `${API_BASE}/notify/` with a boolean flag, returning `HttpResponse.json({ result: {} })`. Call `notifySync()`. Assert the flag is `true`.                                                                                                                                                                                                                                                  |
| `p1-u07-client-writes.AC3.2` | Unit (MSW) | `src/paprika/client.test.ts` | Capture the return value of `await client.notifySync()`. Assert it is `undefined` (TypeScript `void` is `undefined` at runtime).                                                                                                                                                                                                                                                                                   |

---

## Human Verification

| Criterion ID                 | Justification                                                                                                                                                                                             | Manual Verification Approach                                                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p1-u07-client-writes.AC4.1` | `pnpm typecheck` is a build-time command, not a runtime assertion. While CI runs it automatically on every PR, the test suite itself does not invoke the TypeScript compiler.                             | Run `pnpm typecheck` and confirm exit code 0. Inspect the diff for any added `@ts-ignore`, `@ts-expect-error`, or `as any` suppressions -- none should be present. CI enforces this via the `ci.yml` workflow.                     |
| `p1-u07-client-writes.AC4.2` | Explicit return type annotations are a code-style property verified by reading the source, not by a runtime test. TypeScript does not emit metadata about whether an annotation was explicit or inferred. | Inspect `src/paprika/client.ts` and confirm the three public method signatures include explicit return type annotations: `saveRecipe(...): Promise<Recipe>`, `deleteRecipe(...): Promise<void>`, `notifySync(...): Promise<void>`. |

---

## Test Grouping by Describe Block

The tests are organized into three `describe` blocks inside the outer `describe("PaprikaClient", ...)`:

1. **`describe("p1-u07-client-writes.AC1: saveRecipe encodes and POSTs correctly")`** -- Phase 1, Task 2
   - AC1.1: POST to correct URL
   - AC1.2 + AC1.3: FormData encoding (snake_case keys, 28 fields) -- combined into one test
   - AC1.4: Response deserialized as camelCase `Recipe`
   - AC1.5: Non-2xx throws `PaprikaAPIError`

2. **`describe("p1-u07-client-writes.AC3: notifySync propagates changes")`** -- Phase 2, Task 2
   - AC3.1: POST to `/notify/`
   - AC3.2: Returns void

3. **`describe("p1-u07-client-writes.AC2: deleteRecipe soft-deletes via trash flag")`** -- Phase 2, Task 4
   - AC2.1 + AC2.2: Happy path (in_trash: true in payload, notifySync called) -- combined into one test
   - AC2.3: 404 from `getRecipe` throws, no subsequent POST

---

## Test Dependencies and Helpers

| Dependency                          | Purpose                                                                                 | Phase Introduced |
| ----------------------------------- | --------------------------------------------------------------------------------------- | ---------------- |
| `gunzipSync` from `node:zlib`       | Decompress intercepted FormData payload for encoding assertions                         | Phase 1          |
| `RecipeSchema` from `./types.js`    | Parse snake_case fixture into typed `Recipe` for `saveRecipe` input                     | Phase 1          |
| `RecipeUidSchema` from `./types.js` | Create branded `RecipeUid` values for `deleteRecipe` input                              | Phase 2          |
| `Recipe` type from `./types.js`     | Type annotation for `makeCamelCaseRecipe` helper return                                 | Phase 1          |
| `makeCamelCaseRecipe(uid)` helper   | Produces a typed `Recipe` by running `makeSnakeCaseRecipe` through `RecipeSchema.parse` | Phase 1          |

---

## Coverage Summary

| Criterion | Verification Method | Phase             |
| --------- | ------------------- | ----------------- |
| AC1.1     | Automated           | Phase 1           |
| AC1.2     | Automated           | Phase 1           |
| AC1.3     | Automated           | Phase 1           |
| AC1.4     | Automated           | Phase 1           |
| AC1.5     | Automated           | Phase 1           |
| AC2.1     | Automated           | Phase 2           |
| AC2.2     | Automated           | Phase 2           |
| AC2.3     | Automated           | Phase 2           |
| AC3.1     | Automated           | Phase 2           |
| AC3.2     | Automated           | Phase 2           |
| AC4.1     | Human + CI          | Phase 1 + Phase 2 |
| AC4.2     | Human               | Phase 1 + Phase 2 |

All 12 acceptance criteria are covered. 10 are verified by automated unit tests using MSW/Vitest.
2 are verified by human inspection (with CI enforcement for AC4.1).
