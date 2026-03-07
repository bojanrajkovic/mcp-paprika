# Recipe Query Store Implementation Plan

**Goal:** Add query methods (search, ingredient filtering, time filtering, name lookup) and property-based tests to the RecipeStore.

**Architecture:** Adds `search()`, `filterByIngredients()`, `filterByTime()`, and `findByName()` methods to the existing `RecipeStore` class. Introduces `SearchOptions`, `ScoredResult`, and `TimeConstraints` types as named exports. `filterByTime` imports `parseDuration` from `src/utils/duration.ts`.

**Tech Stack:** TypeScript 5.9, vitest, fast-check 4.5.3, luxon (Duration type via parseDuration)

**Scope:** 2 phases from original design (phase 2 of 2)

**Codebase verified:** 2026-03-07

---

## Acceptance Criteria Coverage

This phase implements and tests:

### recipe-query-store.AC3: Search method

- **recipe-query-store.AC3.1 Success:** Case-insensitive substring match finds recipes by name
- **recipe-query-store.AC3.2 Success:** With `fields: 'all'`, searches name, ingredients, description, and notes
- **recipe-query-store.AC3.3 Success:** Field scoping (e.g., `fields: 'ingredients'`) limits search to that field only
- **recipe-query-store.AC3.4 Success:** Scoring: exact name match=3, starts-with=2, name-contains=1, other-field-only=0
- **recipe-query-store.AC3.5 Success:** Results sorted by score descending, then name ascending within same score
- **recipe-query-store.AC3.6 Success:** Pagination with `offset` and `limit` applied after scoring and sorting
- **recipe-query-store.AC3.7 Edge:** Empty query string returns all non-trashed recipes (each scored 0)
- **recipe-query-store.AC3.8 Success:** Trashed recipes never appear in search results

### recipe-query-store.AC4: Ingredient filtering

- **recipe-query-store.AC4.1 Success:** `'all'` mode returns only recipes containing every search term
- **recipe-query-store.AC4.2 Success:** `'any'` mode returns recipes containing at least one search term
- **recipe-query-store.AC4.3 Success:** Matching is case-insensitive
- **recipe-query-store.AC4.4 Success:** `limit` parameter caps the number of results returned
- **recipe-query-store.AC4.5 Edge:** Empty terms array returns all non-trashed recipes
- **recipe-query-store.AC4.6 Success:** Trashed recipes never appear in filtered results

### recipe-query-store.AC5: Time filtering

- **recipe-query-store.AC5.1 Success:** Filters recipes by `maxPrepTime` constraint (in minutes)
- **recipe-query-store.AC5.2 Success:** Filters recipes by `maxCookTime` constraint (in minutes)
- **recipe-query-store.AC5.3 Success:** Filters recipes by `maxTotalTime` constraint (in minutes)
- **recipe-query-store.AC5.4 Success:** Multiple constraints applied simultaneously (all must pass)
- **recipe-query-store.AC5.5 Edge:** Recipes with unparseable time strings are kept in results (not excluded)
- **recipe-query-store.AC5.6 Success:** Results sorted by `totalTime` ascending (parsed values)
- **recipe-query-store.AC5.7 Edge:** Recipes with unparseable `totalTime` sort after all parseable recipes
- **recipe-query-store.AC5.8 Edge:** No constraints set returns all non-trashed recipes
- **recipe-query-store.AC5.9 Success:** Time parsing delegates to `parseDuration` from `src/utils/duration.ts`

### recipe-query-store.AC6: Name lookup

- **recipe-query-store.AC6.1 Success:** Exact case-insensitive match returns the matching recipe
- **recipe-query-store.AC6.2 Success:** Starts-with match used when no exact match exists
- **recipe-query-store.AC6.3 Success:** Contains match used when no starts-with match exists
- **recipe-query-store.AC6.4 Success:** Returns all matches at the first successful tier (e.g., two starts-with matches)
- **recipe-query-store.AC6.5 Edge:** No matches at any tier returns empty array
- **recipe-query-store.AC6.6 Success:** Only searches non-trashed recipes

### recipe-query-store.AC7: Module characteristics

- **recipe-query-store.AC7.1 Success:** TypeScript compiles with no errors
- **recipe-query-store.AC7.2 Success:** No I/O operations — all methods are synchronous in-memory operations
- **recipe-query-store.AC7.3 Success:** All methods are synchronous (no `async`, no `Promise`)
- **recipe-query-store.AC7.4 Success:** Imports only from `paprika/types.ts` and `utils/duration.ts` (plus npm packages)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Supporting types and search method

**Verifies:** recipe-query-store.AC3.1, recipe-query-store.AC3.2, recipe-query-store.AC3.3, recipe-query-store.AC3.4, recipe-query-store.AC3.5, recipe-query-store.AC3.6, recipe-query-store.AC3.7, recipe-query-store.AC3.8

**Files:**

- Modify: `src/cache/recipe-store.ts` (add types and search method)
- Modify: `src/cache/recipe-store.test.ts` (add search tests)

**Implementation:**

Add these exported types to `src/cache/recipe-store.ts` (above the class):

```typescript
export type SearchOptions = {
  readonly fields?: "all" | "name" | "ingredients" | "description";
  readonly offset?: number;
  readonly limit?: number;
};

export type ScoredResult = {
  readonly recipe: Recipe;
  readonly score: number;
};
```

Add the `search` method to `RecipeStore`. Key behavioral details:

1. **Default `fields` is `"all"`** — searches `name`, `ingredients`, `description`, and `notes`.
2. **`description` and `notes` are `string | null`** — must null-check before calling `.toLowerCase()`.
3. **Scoring applies only to name matches:** exact=3, starts-with=2, contains=1. Other-field matches score 0.
4. **When `fields` is a specific field (not `"all"`):** only that field is searched. If it's `"name"`, scoring still applies. If it's `"ingredients"` or `"description"`, score is always 0 (no name match).
5. **Empty query returns all non-trashed recipes** with score 0.
6. **Sort:** score descending, then `recipe.name` ascending (locale-insensitive `localeCompare`).
7. **Pagination:** `offset` defaults to 0, `limit` defaults to no limit. Applied after sort.

```typescript
search(query: string, options?: SearchOptions): Array<ScoredResult> {
  const fields = options?.fields ?? "all";
  const offset = options?.offset ?? 0;
  const limit = options?.limit;
  const lowerQuery = query.toLowerCase();

  const results: Array<ScoredResult> = [];

  for (const recipe of this.recipes.values()) {
    if (recipe.inTrash) continue;

    if (lowerQuery === "") {
      results.push({ recipe, score: 0 });
      continue;
    }

    const lowerName = recipe.name.toLowerCase();
    let score = -1;

    if (fields === "all" || fields === "name") {
      if (lowerName === lowerQuery) {
        score = 3;
      } else if (lowerName.startsWith(lowerQuery)) {
        score = 2;
      } else if (lowerName.includes(lowerQuery)) {
        score = 1;
      }
    }

    if (score === -1 && (fields === "all" || fields === "ingredients")) {
      if (recipe.ingredients.toLowerCase().includes(lowerQuery)) {
        score = 0;
      }
    }

    if (score === -1 && (fields === "all" || fields === "description")) {
      if (recipe.description?.toLowerCase().includes(lowerQuery)) {
        score = 0;
      }
    }

    if (score === -1 && fields === "all") {
      if (recipe.notes?.toLowerCase().includes(lowerQuery)) {
        score = 0;
      }
    }

    if (score >= 0) {
      results.push({ recipe, score });
    }
  }

  results.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.recipe.name.localeCompare(b.recipe.name);
  });

  const sliced = limit !== undefined
    ? results.slice(offset, offset + limit)
    : results.slice(offset);

  return sliced;
}
```

**Important details for implementor:**

- `recipe.name` and `recipe.ingredients` are always `string` (non-nullable)
- `recipe.description` and `recipe.notes` are `string | null` — use optional chaining (`?.toLowerCase()`)
- When `fields === "name"`, only the name field is searched. The scoring tiers (exact/starts-with/contains) only apply to name matches.
- When `fields === "ingredients"` or `fields === "description"`, those fields produce score 0 since scoring is name-based.
- The `notes` field is only searched when `fields === "all"` (not separately selectable per the `SearchOptions` type)

**Testing:**

Tests must verify each AC listed above. Add a new `describe` block for AC3 in `src/cache/recipe-store.test.ts`.

Test mapping:

- AC3.1: Load recipes with different names, search for a substring — matching recipes returned
- AC3.2: Recipe with query term only in `description`, search with `fields: 'all'` — found. Separately, recipe with query term only in `notes`, search with `fields: 'all'` — also found with score 0. Both `description` and `notes` search paths must be verified individually.
- AC3.3: Recipe with term in name AND ingredients, search with `fields: 'ingredients'` — found, but recipe with term only in name is NOT returned
- AC3.4: Load 3 recipes: one with exact name match, one starts-with, one contains. Verify scores are 3, 2, 1 respectively. Load a 4th with term only in ingredients — score 0.
- AC3.5: Same data as AC3.4, verify results come back in order: score 3, then 2, then 1, then 0. For same score, sorted alphabetically by name.
- AC3.6: Load 5 matching recipes, search with `offset: 1, limit: 2` — returns 2 results starting from index 1
- AC3.7: Search with `""` — returns all non-trashed recipes, each with score 0
- AC3.8: Load trashed recipe, search for its name — not returned

**Verification:**

Run: `pnpm typecheck`
Expected: No type errors

Run: `pnpm test`
Expected: All tests pass

**Commit:** `feat(cache): add search method with scoring and pagination`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: filterByIngredients method

**Verifies:** recipe-query-store.AC4.1, recipe-query-store.AC4.2, recipe-query-store.AC4.3, recipe-query-store.AC4.4, recipe-query-store.AC4.5, recipe-query-store.AC4.6

**Files:**

- Modify: `src/cache/recipe-store.ts` (add filterByIngredients method)
- Modify: `src/cache/recipe-store.test.ts` (add ingredient filtering tests)

**Implementation:**

Add to `RecipeStore`:

```typescript
filterByIngredients(
  terms: ReadonlyArray<string>,
  mode: "all" | "any",
  limit?: number,
): Array<Recipe> {
  const recipes = this.getAll();

  if (terms.length === 0) {
    return limit !== undefined ? recipes.slice(0, limit) : recipes;
  }

  const lowerTerms = terms.map((t) => t.toLowerCase());

  const matched = recipes.filter((recipe) => {
    const lowerIngredients = recipe.ingredients.toLowerCase();
    if (mode === "all") {
      return lowerTerms.every((term) => lowerIngredients.includes(term));
    }
    return lowerTerms.some((term) => lowerIngredients.includes(term));
  });

  return limit !== undefined ? matched.slice(0, limit) : matched;
}
```

**Important details for implementor:**

- `recipe.ingredients` is always `string` (non-nullable) — no null check needed
- `getAll()` already excludes trashed recipes — reuse it for the base collection
- `terms` parameter is `ReadonlyArray<string>` — match the existing pattern of readonly parameters
- The `limit` parameter is optional — when undefined, return all matches

**Testing:**

Add a `describe` block for AC4 in the test file.

Test mapping:

- AC4.1: Recipe has "flour, sugar, butter". Search `['flour', 'sugar']` with `'all'` — found. Search `['flour', 'chocolate']` with `'all'` — not found.
- AC4.2: Search `['flour', 'chocolate']` with `'any'` — found (has flour).
- AC4.3: Search `['FLOUR']` — matches "flour" in ingredients
- AC4.4: 3 recipes match, limit=2 — returns only 2
- AC4.5: Empty terms array — returns all non-trashed recipes
- AC4.6: Trashed recipe with matching ingredients — not returned

**Verification:**

Run: `pnpm typecheck`
Expected: No type errors

Run: `pnpm test`
Expected: All tests pass

**Commit:** `feat(cache): add ingredient filtering with all/any modes`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->

### Task 3: filterByTime method

**Verifies:** recipe-query-store.AC5.1, recipe-query-store.AC5.2, recipe-query-store.AC5.3, recipe-query-store.AC5.4, recipe-query-store.AC5.5, recipe-query-store.AC5.6, recipe-query-store.AC5.7, recipe-query-store.AC5.8, recipe-query-store.AC5.9

**Files:**

- Modify: `src/cache/recipe-store.ts` (add TimeConstraints type, filterByTime method, parseDuration import)
- Modify: `src/cache/recipe-store.test.ts` (add time filtering tests)

**Implementation:**

Add the import at the top of `src/cache/recipe-store.ts`:

```typescript
import { parseDuration } from "../utils/duration.js";
```

Add the exported type:

```typescript
export type TimeConstraints = {
  readonly maxPrepTime?: number;
  readonly maxCookTime?: number;
  readonly maxTotalTime?: number;
};
```

Add the `filterByTime` method to `RecipeStore`. This is the most complex method due to the interplay of nullable fields, parseable/unparseable times, and sorting:

1. **`prepTime`, `cookTime`, `totalTime` are `string | null`** — null fields don't fail constraints (a null field means the duration is unknown, not zero).
2. **Unparseable time strings are kept** — if `parseDuration` returns `Err`, the recipe is NOT excluded. The principle is: unknown duration is not the same as "too slow."
3. **A constraint only excludes a recipe if the field is non-null, parseable, AND exceeds the constraint.**
4. **Sort by `totalTime` ascending** — parsed values first, unparseable/null values sort last.
5. **No constraints = return all non-trashed recipes** (still sorted by totalTime).

```typescript
filterByTime(constraints: TimeConstraints): Array<Recipe> {
  const recipes = this.getAll();

  const hasConstraints =
    constraints.maxPrepTime !== undefined ||
    constraints.maxCookTime !== undefined ||
    constraints.maxTotalTime !== undefined;

  const filtered = hasConstraints
    ? recipes.filter((recipe) => {
        if (constraints.maxPrepTime !== undefined && recipe.prepTime !== null) {
          const parsed = parseDuration(recipe.prepTime);
          if (parsed.isOk() && parsed.value.as("minutes") > constraints.maxPrepTime) {
            return false;
          }
        }
        if (constraints.maxCookTime !== undefined && recipe.cookTime !== null) {
          const parsed = parseDuration(recipe.cookTime);
          if (parsed.isOk() && parsed.value.as("minutes") > constraints.maxCookTime) {
            return false;
          }
        }
        if (constraints.maxTotalTime !== undefined && recipe.totalTime !== null) {
          const parsed = parseDuration(recipe.totalTime);
          if (parsed.isOk() && parsed.value.as("minutes") > constraints.maxTotalTime) {
            return false;
          }
        }
        return true;
      })
    : recipes;

  return filtered.toSorted((a, b) => {
    const aMinutes = parseTotalTimeMinutes(a.totalTime);
    const bMinutes = parseTotalTimeMinutes(b.totalTime);

    if (aMinutes === null && bMinutes === null) return 0;
    if (aMinutes === null) return 1;
    if (bMinutes === null) return -1;
    return aMinutes - bMinutes;
  });
}
```

Add a private helper function (outside the class, or as a module-level function):

```typescript
function parseTotalTimeMinutes(totalTime: string | null): number | null {
  if (totalTime === null) return null;
  const result = parseDuration(totalTime);
  if (result.isErr()) return null;
  return result.value.as("minutes");
}
```

**Important details for implementor:**

- Import `parseDuration` from `"../utils/duration.js"` (with `.js` extension)
- `parseDuration` returns `Result<Duration, DurationParseError>` from neverthrow — use `.isOk()` / `.isErr()` and `.value`
- Use `.as("minutes")` on the Luxon `Duration` to get minutes as a number
- Use `.toSorted()` (ES2023, non-mutating) instead of `.sort()` to avoid mutating the array from `getAll()`
- The `parseTotalTimeMinutes` helper avoids repeating parse logic in the sort comparator
- Each constraint is checked independently — a recipe is excluded only if a field is non-null, parseable, AND exceeds the constraint

**Testing:**

Add a `describe` block for AC5 in the test file. Create test recipes with specific time values using the `makeRecipe` fixture factory.

Test mapping:

- AC5.1: Recipe with `prepTime: "30 min"`, constraint `maxPrepTime: 20` — excluded. Recipe with `prepTime: "10 min"` — included.
- AC5.2: Same pattern for `cookTime` / `maxCookTime`
- AC5.3: Same pattern for `totalTime` / `maxTotalTime`
- AC5.4: Recipe with `prepTime: "10 min"`, `cookTime: "60 min"`. Constraints `maxPrepTime: 15, maxCookTime: 30` — excluded (cookTime exceeds). Both must pass.
- AC5.5: Recipe with `totalTime: "not a real time"` — kept in results (unparseable = unknown, not excluded)
- AC5.6: Recipes with `totalTime: "60 min"`, `totalTime: "30 min"`, `totalTime: "45 min"` — sorted as 30, 45, 60
- AC5.7: Recipe with unparseable `totalTime` sorts after recipes with parseable `totalTime`. Recipe with `totalTime: null` also sorts last.
- AC5.8: Empty constraints `{}` — returns all non-trashed recipes (still sorted by totalTime)
- AC5.9: This is implicitly tested by all above tests since `parseDuration` is the parser. Optionally verify by checking that colon format `"1:30"` (90 min) works correctly.

**Verification:**

Run: `pnpm typecheck`
Expected: No type errors

Run: `pnpm test`
Expected: All tests pass

**Commit:** `feat(cache): add time-based recipe filtering with duration parsing`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->

### Task 4: findByName method

**Verifies:** recipe-query-store.AC6.1, recipe-query-store.AC6.2, recipe-query-store.AC6.3, recipe-query-store.AC6.4, recipe-query-store.AC6.5, recipe-query-store.AC6.6

**Files:**

- Modify: `src/cache/recipe-store.ts` (add findByName method)
- Modify: `src/cache/recipe-store.test.ts` (add name lookup tests)

**Implementation:**

Add the `findByName` method to `RecipeStore`. Uses a tiered lookup strategy — tries exact match first, then starts-with, then contains. Returns all matches at the first tier that produces results.

```typescript
findByName(title: string): Array<Recipe> {
  const recipes = this.getAll();
  const lowerTitle = title.toLowerCase();

  const exact = recipes.filter(
    (r) => r.name.toLowerCase() === lowerTitle,
  );
  if (exact.length > 0) return exact;

  const startsWith = recipes.filter(
    (r) => r.name.toLowerCase().startsWith(lowerTitle),
  );
  if (startsWith.length > 0) return startsWith;

  const contains = recipes.filter(
    (r) => r.name.toLowerCase().includes(lowerTitle),
  );
  return contains;
}
```

**Important details for implementor:**

- `recipe.name` is always `string` (non-nullable) — no null check needed
- All comparisons are case-insensitive (`.toLowerCase()` both sides)
- Returns ALL matches at the first successful tier, not just the first match
- If no tier produces results, returns empty array (the `contains` filter result is empty)
- `getAll()` already excludes trashed recipes

**Testing:**

Add a `describe` block for AC6 in the test file.

Test mapping:

- AC6.1: Load recipe named "Chocolate Cake", `findByName("chocolate cake")` — returns it (case-insensitive exact match)
- AC6.2: Load "Chocolate Cake" and "Chocolate Chip Cookies", `findByName("chocolate c")` — returns both (starts-with match, since no exact match)
- AC6.3: Load "Dark Chocolate Cake", `findByName("chocolate")` — returns it (contains match, since no exact or starts-with match)
- AC6.4: Load "Apple Pie" and "Apple Strudel", `findByName("apple")` — returns both (two starts-with matches)
- AC6.5: `findByName("nonexistent recipe name")` — returns empty array
- AC6.6: Load trashed recipe named "Trashed Chocolate", `findByName("chocolate")` — does not return the trashed recipe

**Verification:**

Run: `pnpm typecheck`
Expected: No type errors

Run: `pnpm test`
Expected: All tests pass

**Commit:** `feat(cache): add tiered name lookup method`

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-6) -->

<!-- START_TASK_5 -->

### Task 5: Module characteristics tests and CLAUDE.md update

**Verifies:** recipe-query-store.AC7.1, recipe-query-store.AC7.2, recipe-query-store.AC7.3, recipe-query-store.AC7.4

**Files:**

- Modify: `src/cache/recipe-store.test.ts` (add module characteristics tests)
- Modify: `src/cache/CLAUDE.md` (add `utils/duration` dependency)

**Implementation:**

Add a `describe` block for AC7 in the test file.

Follow the pattern from `src/utils/duration.test.ts:198-223` which tests module characteristics by reading source files:

```typescript
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
```

Test mapping:

- AC7.1: Verified implicitly by `pnpm typecheck` succeeding. No test needed — TypeScript compiler is the verifier.
- AC7.2: Read `src/cache/recipe-store.ts` source file, verify it does not contain I/O imports like `fs`, `http`, `net`, `child_process`, `fetch`.
- AC7.3: Read the source file, verify no `async` keyword appears by asserting `expect(source).not.toMatch(/\basync\b/)`. Separately verify `expect(source).not.toMatch(/Promise/)`. This follows the assertion pattern from `src/utils/duration.test.ts:219-220`.
- AC7.4: Read the source file, verify all relative imports match only `"../paprika/types.js"` and `"../utils/duration.js"`. Use regex to find all `from "..` patterns and verify they are exactly these two.

**CLAUDE.md update:**

Update the Dependencies section in `src/cache/CLAUDE.md` to reflect that `recipe-store.ts` now imports from `utils/duration`:

```markdown
## Dependencies

- **Uses:** `paprika/types` (Recipe, Category types), `utils/duration` (parseDuration for time filtering)
- **Used by:** `features/`
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`
```

**Verification:**

Run: `pnpm test`
Expected: All tests pass

Run: `pnpm typecheck`
Expected: No type errors

**Commit:** `test(cache): add module characteristics tests for RecipeStore`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->

### Task 6: Property-based tests

**Verifies:** recipe-query-store.AC3.5, recipe-query-store.AC3.8, recipe-query-store.AC4.6, recipe-query-store.AC5.5, recipe-query-store.AC6.6 (invariant verification across random inputs)

**Files:**

- Create: `src/cache/recipe-store.property.test.ts`

**Implementation:**

Create property-based tests following the pattern in `src/utils/duration.property.test.ts`. Import fast-check as `fc`. Create a `RecipeStore` instance and populate it with recipes in each property.

```typescript
import { describe, it, expect } from "vitest";
import fc from "fast-check";
```

Import `makeRecipe` from `./__fixtures__/recipes.js` and `RecipeStore` from `./recipe-store.js`.

Properties to test:

1. **Search result ordering invariant:** For any non-empty query string, search results are always sorted by score descending, then name ascending.
   - Generator: `fc.string({ minLength: 1, maxLength: 20 })`
   - Load a fixed set of ~5 recipes with varying names
   - For each generated query, call `search(query)`
   - Verify: for consecutive results `[i]` and `[i+1]`, either `results[i].score > results[i+1].score`, or `results[i].score === results[i+1].score && results[i].recipe.name <= results[i+1].recipe.name`

2. **Trashed recipes never appear in search:** For any query, search results never contain trashed recipes.
   - Generator: `fc.string({ minLength: 0, maxLength: 20 })`
   - Load recipes including trashed ones
   - Verify: every result recipe has `inTrash === false`

3. **Trashed recipes never appear in filterByIngredients:** For any ingredient term, filtered results never contain trashed recipes.
   - Generator: `fc.string({ minLength: 1, maxLength: 20 })`
   - Load recipes including trashed ones
   - Call `filterByIngredients([term], 'any')`
   - Verify: every result has `inTrash === false`

4. **filterByTime keeps unparseable recipes:** Recipes with unparseable time strings are never excluded by time constraints.
   - Generator: `fc.integer({ min: 1, max: 1000 })` for constraint values
   - Load recipes including one with `totalTime: "not parseable"`
   - Call `filterByTime({ maxTotalTime: constraint })`
   - Verify: the unparseable recipe is always in results

5. **findByName never returns trashed recipes:** For any search title, findByName results never contain trashed recipes.
   - Generator: `fc.string({ minLength: 1, maxLength: 20 })`
   - Load recipes including trashed ones
   - Verify: every result has `inTrash === false`

**Important details for implementor:**

- Create a fresh `RecipeStore` inside each `fc.property()` callback (or use `beforeEach` with a shared store loaded before assertions)
- Use `makeRecipe()` with overrides to create test recipes — pass branded UIDs using `as RecipeUid` cast
- Keep generators simple — the goal is to verify invariants, not to generate complex recipe structures
- Follow the existing pattern: `fc.assert(fc.property(generator, (value) => { ... expect(...) }))`

**Verification:**

Run: `pnpm test`
Expected: All tests pass including property-based tests

Run: `pnpm lint`
Expected: No lint errors

**Commit:** `test(cache): add property-based tests for RecipeStore query methods`

<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_C -->
