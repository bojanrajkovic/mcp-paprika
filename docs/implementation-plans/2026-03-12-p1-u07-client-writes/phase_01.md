# PaprikaClient Write Operations — Phase 1: Encoding Pipeline and `saveRecipe`

**Goal:** Add camelCase→snake_case serialization, gzip encoding, and `saveRecipe` to `PaprikaClient`.

**Architecture:** Module-level pure function `recipeToApiPayload` handles 28-field camelCase→snake_case
mapping; private `buildRecipeFormData` wraps it with gzip+FormData; public `saveRecipe` POSTs via the
existing `request<T>()` helper and returns a camelCase `Recipe` from the server response.

**Tech Stack:** Node.js 24 (`node:zlib` gzipSync), Fetch API globals (Blob, FormData), Zod (RecipeSchema
for response parsing), MSW `msw/node` for test interception, Vitest.

**Scope:** 2 phases from original design (phase 1 of 2)

**Codebase verified:** 2026-03-12

---

## Acceptance Criteria Coverage

This phase implements and tests:

### p1-u07-client-writes.AC1: saveRecipe encodes and POSTs correctly

- **p1-u07-client-writes.AC1.1 Success:** POST sent to `/api/v2/sync/recipe/{uid}/` where uid matches the recipe's uid field
- **p1-u07-client-writes.AC1.2 Success:** FormData `data` field decompresses (gunzip) to valid JSON with snake_case keys (e.g., `prep_time`, `on_favorites`, `in_trash`)
- **p1-u07-client-writes.AC1.3 Success:** All 28 Recipe fields are present in the decompressed payload — no fields dropped
- **p1-u07-client-writes.AC1.4 Success:** Server response deserialized and returned as a camelCase `Recipe`
- **p1-u07-client-writes.AC1.5 Failure:** Non-2xx response from POST throws `PaprikaAPIError`

### p1-u07-client-writes.AC4: TypeScript hygiene

- **p1-u07-client-writes.AC4.1:** `pnpm typecheck` exits 0 with no suppressions added
- **p1-u07-client-writes.AC4.2:** All three public methods have explicit return type annotations (phase 1 covers `saveRecipe`; `notifySync` and `deleteRecipe` are in phase 2)

---

## Codebase State (Verified)

Before implementing, understand the current codebase:

- **`src/paprika/client.ts`**: `PaprikaClient` class at line 61. Key constants:
  - `API_BASE = "https://paprikaapp.com/api/v2/sync"` (line 28)
  - `request<T>()` private method signature (lines 109–114):
    ```typescript
    private async request<T>(
      method: "GET" | "POST",
      url: string,
      schema: ZodType<T, ZodTypeDef, unknown>,
      body?: FormData | URLSearchParams,
    ): Promise<T>
    ```
  - Note the parameter order: `method, url, schema, body?` — schema comes **before** body.
  - Existing imports at top: `zod`, `cockatiel`, `./types.js`, `./errors.js` — **no** `node:zlib` yet.

- **`src/paprika/types.ts`**: `Recipe` type (line 60) derived from `RecipeStoredSchema`. The 28 fields in camelCase match exactly the 28 snake_case fields in `RecipeSchema`'s input (lines 66–95). The transform (lines 96–128) is the reverse of what `recipeToApiPayload` must do.

- **`src/paprika/client.test.ts`**: MSW test patterns.
  - `makeSnakeCaseRecipe(uid: string): object` helper at line 11 — produces all 28 snake_case fields.
  - `server = setupServer()` at line 44, with `beforeAll/afterEach/afterAll` lifecycle (lines 46–56).
  - Tests add per-test handlers via `server.use(http.post(url, handler))`.
  - Error tests use `try/catch` with `expect.fail("Should have thrown")` inside the try block.
  - Test names follow the pattern: `"p1-u07-client-writes.AC1.1 - [description]"`.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Implement `recipeToApiPayload`, `buildRecipeFormData`, and `saveRecipe`

**Verifies:** p1-u07-client-writes.AC4.1, p1-u07-client-writes.AC4.2 (implementation side)

**Files:**

- Modify: `src/paprika/client.ts`

**Implementation:**

**Step 1: Add `node:zlib` import**

At the top of `src/paprika/client.ts`, add the `gzipSync` import. Place it before the `cockatiel` import (Node builtins first):

```typescript
import { gzipSync } from "node:zlib";
```

**Step 2: Update the file-level JSDoc comment**

The existing JSDoc at lines 1–9 says "Category write methods are deferred to P1-U07." Update it to:

```typescript
/**
 * Typed HTTP client for the Paprika Cloud Sync API.
 *
 * Encapsulates authentication against the v1 login endpoint
 * and resilient request execution against the v2 data endpoint.
 *
 * Provides recipe and category read methods, plus write methods
 * added in P1-U07 (saveRecipe, deleteRecipe, notifySync).
 */
```

**Step 3: Add `recipeToApiPayload` module-level pure function**

Place this function **before** the `PaprikaClient` class definition (after the `const RETRYABLE_STATUSES` line and the policy constants, before `export class PaprikaClient`). This is a module-level function, not exported:

```typescript
function recipeToApiPayload(recipe: Readonly<Recipe>): Record<string, unknown> {
  return {
    uid: recipe.uid,
    hash: recipe.hash,
    name: recipe.name,
    categories: recipe.categories,
    ingredients: recipe.ingredients,
    directions: recipe.directions,
    description: recipe.description,
    notes: recipe.notes,
    prep_time: recipe.prepTime,
    cook_time: recipe.cookTime,
    total_time: recipe.totalTime,
    servings: recipe.servings,
    difficulty: recipe.difficulty,
    rating: recipe.rating,
    created: recipe.created,
    image_url: recipe.imageUrl,
    photo: recipe.photo,
    photo_hash: recipe.photoHash,
    photo_large: recipe.photoLarge,
    photo_url: recipe.photoUrl,
    source: recipe.source,
    source_url: recipe.sourceUrl,
    on_favorites: recipe.onFavorites,
    in_trash: recipe.inTrash,
    is_pinned: recipe.isPinned,
    on_grocery_list: recipe.onGroceryList,
    scale: recipe.scale,
    nutritional_info: recipe.nutritionalInfo,
  };
}
```

This mirrors `RecipeSchema`'s `.transform()` in reverse — same 28 fields, same explicit enumeration, no generics or reflection. Count them: uid, hash, name, categories, ingredients, directions, description, notes (8) + prep_time, cook_time, total_time, servings, difficulty, rating, created (7) + image_url, photo, photo_hash, photo_large, photo_url (5) + source, source_url, on_favorites, in_trash, is_pinned, on_grocery_list, scale, nutritional_info (8) = 28 total.

**Step 4: Add `buildRecipeFormData` private method**

Add inside `PaprikaClient`, after the `listCategories` method and before `request<T>()`. This is a private method:

```typescript
private buildRecipeFormData(recipe: Readonly<Recipe>): FormData {
  const payload = recipeToApiPayload(recipe);
  const json = JSON.stringify(payload);
  const compressed = gzipSync(json);
  const blob = new Blob([compressed]);
  const formData = new FormData();
  formData.append("data", blob, "data.gz");
  return formData;
}
```

- `gzipSync` is from `node:zlib`. It accepts a string and returns a `Buffer` (UTF-8 encoding is handled internally).
- `Blob` and `FormData` are Node 24 globals — no import needed.
- The field name `"data"` and filename `"data.gz"` match the Paprika API's multipart encoding contract.

**Step 5: Add `saveRecipe` public method**

Add inside `PaprikaClient`, after `listCategories` and before `buildRecipeFormData`. Public methods before private methods:

```typescript
async saveRecipe(recipe: Readonly<Recipe>): Promise<Recipe> {
  const formData = this.buildRecipeFormData(recipe);
  return this.request("POST", `${API_BASE}/recipe/${recipe.uid}/`, RecipeSchema, formData);
}
```

- URL constructed as `${API_BASE}/recipe/${recipe.uid}/` — matches the existing `getRecipe` URL pattern.
- `recipe.uid` is a branded `RecipeUid` (extends string) — template literal coerces it to string at runtime.
- `RecipeSchema` parses the server's snake_case response envelope and transforms to camelCase `Recipe`.

**Step 6: Verify typecheck**

```bash
pnpm typecheck
```

Expected: exits 0 with no errors. If you see errors about `Blob` or `FormData` not being found, they are Node 24 globals — check that `@tsconfig/node24` is in the tsconfig extends chain.

**Step 7: Commit**

```bash
git add src/paprika/client.ts
git commit -m "feat(paprika): add saveRecipe with gzip-encoded FormData write path"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Tests for `saveRecipe`

**Verifies:** p1-u07-client-writes.AC1.1, p1-u07-client-writes.AC1.2, p1-u07-client-writes.AC1.3, p1-u07-client-writes.AC1.4, p1-u07-client-writes.AC1.5

**Files:**

- Modify: `src/paprika/client.test.ts`

**Implementation:**

**Step 1: Add new imports to the top of `src/paprika/client.test.ts`**

Add these two imports alongside the existing imports:

```typescript
import { gunzipSync } from "node:zlib";
import { RecipeSchema } from "./types.js";
```

- `gunzipSync` is needed in the encoding-correctness test to decompress the FormData payload.
- `RecipeSchema` is needed to parse a snake_case recipe fixture into a typed `Recipe` for use as input to `saveRecipe`.

**Step 2: Add a `makeCamelCaseRecipe` helper function**

Add this helper directly after the existing `makeSnakeCaseRecipe` function (around line 43, before `const server = setupServer()`):

```typescript
function makeCamelCaseRecipe(uid: string): Recipe {
  return RecipeSchema.parse(makeSnakeCaseRecipe(uid));
}
```

This creates a properly typed `Recipe` with branded `RecipeUid` by reusing the existing snake_case fixture and running it through the production schema. Import `Recipe` from `./types.js` if not already imported.

Note: the existing import line `import type { Category, Recipe, RecipeEntry } from "./types.js"` is in `client.ts`, not in `client.test.ts`. Add the import to `client.test.ts`:

```typescript
import type { Recipe } from "./types.js";
```

**Step 3: Add the `saveRecipe` test describe block**

Add a new `describe` block inside the outer `describe("PaprikaClient", ...)` block, after the last existing `describe` block. The full block structure to add:

```typescript
describe("p1-u07-client-writes.AC1: saveRecipe encodes and POSTs correctly", () => {
  // AC1.1: POST sent to correct URL
  it("...", ...)

  // AC1.2 + AC1.3: FormData encodes correctly (snake_case + 28 fields)
  it("...", ...)

  // AC1.4: Server response deserialized as camelCase Recipe
  it("...", ...)

  // AC1.5: Non-2xx throws PaprikaAPIError
  it("...", ...)
});
```

**Testing — what each test must verify:**

**p1-u07-client-writes.AC1.1** — POST sent to correct URL:

- Register an `http.post` handler at `` `${API_BASE}/recipe/${uid}/` `` that captures `request.url` and returns `HttpResponse.json({ result: makeSnakeCaseRecipe(uid) })`
- Call `client.saveRecipe(makeCamelCaseRecipe(uid))`
- Assert that the handler was reached (the request URL matched exactly — if it doesn't, MSW will return a network error and the test will fail with an unhandled request error rather than a test assertion failure, which is sufficient proof but you may also capture and assert the URL explicitly)

**p1-u07-client-writes.AC1.2 and AC1.3** — FormData encoding correctness (combine into one test):

- Register an `http.post` handler that reads the FormData from the intercepted request:
  1. `const formData = await request.formData()`
  2. `const dataBlob = formData.get("data")` — will be a `Blob`
  3. `const arrayBuffer = await (dataBlob as Blob).arrayBuffer()`
  4. `const decompressed = gunzipSync(Buffer.from(arrayBuffer))`
  5. `const payload = JSON.parse(decompressed.toString()) as Record<string, unknown>`
  6. Capture `payload` in a closure variable
- After `client.saveRecipe(...)` resolves:
  - **AC1.2**: Assert specific snake_case keys exist: `prep_time`, `cook_time`, `total_time`, `image_url`, `on_favorites`, `in_trash`, `is_pinned`, `on_grocery_list`, `nutritional_info`. Assert their camelCase equivalents do NOT exist: `prepTime`, `imageUrl`, `onFavorites`.
  - **AC1.3**: Assert `Object.keys(payload).length === 28`

**p1-u07-client-writes.AC1.4** — Response deserialized as camelCase `Recipe`:

- Register handler returning `HttpResponse.json({ result: makeSnakeCaseRecipe(uid) })`
- Assert the returned value has camelCase properties (e.g., `result.prepTime`, `result.onFavorites`, `result.imageUrl`) and does NOT have snake_case properties (e.g., no `prep_time` key on the result)

**p1-u07-client-writes.AC1.5** — Non-2xx throws `PaprikaAPIError`:

- Register handler returning `HttpResponse.json({}, { status: 422 })`
- Use the `try/catch` with `expect.fail("Should have thrown PaprikaAPIError")` pattern (matches existing error tests at lines 260–275)
- Assert `error instanceof PaprikaAPIError`

**Step 4: Run tests**

```bash
pnpm test
```

Expected: all existing tests still pass, plus the 4 new `saveRecipe` tests pass.

**Step 5: Run typecheck**

```bash
pnpm typecheck
```

Expected: exits 0.

**Step 6: Commit**

```bash
git add src/paprika/client.test.ts
git commit -m "test(paprika): add saveRecipe tests covering AC1.1–AC1.5"
```

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
