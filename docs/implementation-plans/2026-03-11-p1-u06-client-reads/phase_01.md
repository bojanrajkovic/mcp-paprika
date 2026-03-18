# PaprikaClient Read Operations Implementation Plan — Phase 1

**Goal:** Add `listRecipes()` and `getRecipe()` public read methods to `PaprikaClient`, removing the P1-U05 suppression stubs that silenced the "unused variable" errors.

**Architecture:** Both methods delegate to the existing private `request<T>()` helper with appropriate Zod schemas from `./types.js`. No new dependencies needed — `z.array()` wraps the list schema inline. Removing the stubs is done atomically with adding the callers so TypeScript never sees the symbols as unused.

**Tech Stack:** TypeScript 5.9 (strict), Zod, Vitest, MSW v2 (`msw/node`)

**Scope:** Phase 1 of 2 from original design (phases 1–1)

**Codebase verified:** 2026-03-11

---

## Acceptance Criteria Coverage

This phase implements and tests:

### p1-u06-client-reads.AC1: listRecipes() returns a recipe entry list

- **p1-u06-client-reads.AC1.1 Success:** Returns `RecipeEntry[]` where each entry has `uid: RecipeUid` and `hash: string`, fetched from `/api/v2/sync/recipes/`
- **p1-u06-client-reads.AC1.2 Edge:** Returns `[]` when the API returns an empty result array

### p1-u06-client-reads.AC2: getRecipe() returns a full recipe by UID

- **p1-u06-client-reads.AC2.1 Success:** Returns a `Recipe` object with all fields in camelCase, fetched from `/api/v2/sync/recipe/{uid}/`
- **p1-u06-client-reads.AC2.2 Failure:** A non-2xx response propagates as `PaprikaAPIError`

### p1-u06-client-reads.AC5: P1-U05 suppression stubs are removed

- **p1-u06-client-reads.AC5.1:** The `@ts-expect-error` and `eslint-disable` comments on `API_BASE` are removed
- **p1-u06-client-reads.AC5.2:** The `@ts-expect-error` comment on `request()` is removed
- **p1-u06-client-reads.AC5.3:** TypeScript compiles with no errors after the changes

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Implement listRecipes() and getRecipe() in client.ts

**Verifies:** p1-u06-client-reads.AC1.1, p1-u06-client-reads.AC2.1, p1-u06-client-reads.AC5.1, p1-u06-client-reads.AC5.2, p1-u06-client-reads.AC5.3

**Files:**

- Modify: `src/paprika/client.ts`

**Current state** (confirmed by codebase inspection):

- `API_BASE` is declared at line 28 with two suppression comments on lines 26–27
- `request<T>()` has one suppression comment on line 84
- The only import from `./types.js` is `{ AuthResponseSchema }` (line 22)
- No public read methods exist

**Implementation — three edits to `src/paprika/client.ts`:**

**Edit 1 — Remove suppression comments on `API_BASE`.**

Current (lines 26–28):

```typescript
// @ts-expect-error API_BASE will be used by public methods in P1-U06 and P1-U07
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const API_BASE = "https://paprikaapp.com/api/v2/sync";
```

Replace with:

```typescript
const API_BASE = "https://paprikaapp.com/api/v2/sync";
```

**Edit 2 — Remove suppression comment on `request`.**

Current (line 84):

```typescript
  // @ts-expect-error request will be used by public methods in P1-U06 and P1-U07
  private async request<T>(
```

Replace with:

```typescript
  private async request<T>(
```

**Edit 3 — Extend the `./types.js` import and add two public methods.**

Current import (line 22):

```typescript
import { AuthResponseSchema } from "./types.js";
```

Replace with (split into type-only and value imports):

```typescript
import type { Recipe, RecipeEntry } from "./types.js";
import { AuthResponseSchema, RecipeEntrySchema, RecipeSchema } from "./types.js";
```

Then add the two public methods inside `PaprikaClient`, between `authenticate()` and the private `request<T>()` method:

```typescript
  async listRecipes(): Promise<Array<RecipeEntry>> {
    return this.request("GET", `${API_BASE}/recipes/`, z.array(RecipeEntrySchema));
  }

  async getRecipe(uid: string): Promise<Recipe> {
    return this.request("GET", `${API_BASE}/recipe/${uid}/`, RecipeSchema);
  }
```

**Verification:**

Run: `pnpm typecheck`
Expected: Exits with code 0. Zero TypeScript errors. The two `@ts-expect-error` directives that were suppressing "unused variable" errors are gone and no new errors introduced.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Tests for listRecipes() and getRecipe()

**Verifies:** p1-u06-client-reads.AC1.1, p1-u06-client-reads.AC1.2, p1-u06-client-reads.AC2.1, p1-u06-client-reads.AC2.2

**Files:**

- Modify: `src/paprika/client.test.ts`

**Current state** (confirmed by codebase inspection):

- The file already has module-level `const server = setupServer()` — do NOT add another
- `beforeAll`, `afterEach`, `afterAll` lifecycle hooks already set up — do NOT duplicate
- Existing imports: `PaprikaAuthError` from `./errors.js`, `PaprikaClient` from `./client.js`, `ZodError` from `zod`
- Naming convention: `"p1-u05-client-auth.AC1.1 - <description>"` — follow this pattern with the `p1-u06-client-reads` prefix

**Edit 1 — Add `PaprikaAPIError` to the errors import.**

Current (line 6):

```typescript
import { PaprikaAuthError } from "./errors.js";
```

Replace with:

```typescript
import { PaprikaAPIError, PaprikaAuthError } from "./errors.js";
```

**Edit 2 — Add a URL constant alongside `AUTH_URL` at the top of the file.**

After the existing `const AUTH_URL = ...` line, add:

```typescript
const API_BASE = "https://paprikaapp.com/api/v2/sync";
```

**Edit 3 — Add a `makeSnakeCaseRecipe` helper and two new `describe` blocks** inside the file.

**Helper — add after the `const API_BASE = ...` constant**, before the outer `describe` block. This helper is also used in Phase 2, so defining it here avoids duplication:

```typescript
function makeSnakeCaseRecipe(uid: string): object {
  return {
    uid,
    hash: `hash-${uid}`,
    name: `Recipe ${uid}`,
    categories: [],
    ingredients: "eggs, flour",
    directions: "Mix and bake.",
    description: null,
    notes: null,
    prep_time: null,
    cook_time: null,
    total_time: null,
    servings: null,
    difficulty: null,
    rating: 0,
    created: "2024-01-01T00:00:00Z",
    image_url: "",
    photo: null,
    photo_hash: null,
    photo_large: null,
    photo_url: null,
    source: null,
    source_url: null,
    on_favorites: false,
    in_trash: false,
    is_pinned: false,
    on_grocery_list: false,
    scale: null,
    nutritional_info: null,
  };
}
```

**Add two new `describe` blocks inside the outer `describe("PaprikaClient", ...)` block**, after the existing authentication `describe` block.

**Block 1 — listRecipes() tests:**

```typescript
describe("p1-u06-client-reads.AC1: listRecipes() returns a recipe entry list", () => {
```

- `it("p1-u06-client-reads.AC1.1 - ...")`: register `http.get(`${API_BASE}/recipes/`, ...)` returning `HttpResponse.json({ result: [{ uid: "uid-1", hash: "h1" }, { uid: "uid-2", hash: "h2" }] })`. Create a fresh `PaprikaClient`, call `await client.listRecipes()`, assert the returned array has length 2, first entry has `uid === "uid-1"` and `hash === "h1"`.

- `it("p1-u06-client-reads.AC1.2 - ...")`: handler returns `HttpResponse.json({ result: [] })`. Call `await client.listRecipes()`, assert the returned array is empty (`[]`).

**Block 2 — getRecipe() tests:**

```typescript
describe("p1-u06-client-reads.AC2: getRecipe() returns a full recipe by UID", () => {
```

- `it("p1-u06-client-reads.AC2.1 - ...")`: register `http.get(`${API_BASE}/recipe/test-uid/`, ...)` returning `HttpResponse.json({ result: makeSnakeCaseRecipe("test-uid") })`. Call `await client.getRecipe("test-uid")`, assert the returned object has camelCase field names — verify at minimum: `recipe.name === "Recipe test-uid"`, `recipe.prepTime` (not `prep_time`), `recipe.onFavorites` (not `on_favorites`), `recipe.imageUrl` (not `image_url`).

- `it("p1-u06-client-reads.AC2.2 - ...")`: register `http.get(`${API_BASE}/recipe/not-found/`, ...)` returning `HttpResponse.json({}, { status: 404 })`. Call `client.getRecipe("not-found")` and expect it to reject with `PaprikaAPIError`. Use the same try/catch pattern as the existing AC1.4 tests (lines 99–115 in client.test.ts):
  ```typescript
  try {
    await client.getRecipe("not-found");
    expect.fail("Should have thrown PaprikaAPIError");
  } catch (error) {
    expect(error).toBeInstanceOf(PaprikaAPIError);
  }
  ```

**Verification:**

Run: `pnpm test`
Expected: All tests pass. The 4 new tests for AC1.1, AC1.2, AC2.1, AC2.2 show as green.

**Commit:**

```bash
git add src/paprika/client.ts src/paprika/client.test.ts
git commit -m "feat(paprika): add listRecipes() and getRecipe() read methods"
```

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

---

## Final Verification

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All three commands exit with code 0.
