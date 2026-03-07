# Recipe Query Store Design

## Summary

This document describes the `RecipeStore` module — a single class that combines in-memory storage with all query operations for recipe data. Currently, individual MCP tool handlers each retrieve the full recipe list and filter it themselves. `RecipeStore` consolidates that logic: instead of calling `getAll()` and looping, a tool handler calls one purpose-built method (`search`, `filterByIngredients`, `filterByTime`, or `findByName`) and receives ready-to-format results. The store is backed by two `Map` instances — one for recipes, one for categories — which is appropriate for the data volume Paprika manages locally.

The implementation is intentionally simple and fully synchronous. All query methods operate on in-memory data with no I/O, making them fast and easy to test. The public API is designed as a stable boundary: if the underlying storage needs to change in the future (for example, to SQLite), consumers are unaffected. The work is split into two phases — Phase 1 builds the CRUD and category operations, Phase 2 adds the scored search, ingredient filtering, time filtering, and tiered name lookup methods that tool handlers will call directly.

## Definition of Done

- A `RecipeStore` module at `src/cache/recipe-store.ts` that encapsulates both data storage and query operations — tool handlers call store methods like `search(query, fields)` and `filterByTime(constraints)` rather than calling `getAll()` and filtering themselves
- The store's public API is rich enough that Phase 2 tool handlers contain only MCP response formatting, not data access logic
- The underlying implementation uses Maps (proven sufficient at recipe scale), but the API boundary makes it possible to swap implementations later without changing consumers
- All 18 acceptance criteria from the original P1-U10 spec are still met (basic CRUD, cold-start guard, category resolution)
- Query methods are pure functions over in-memory data — no I/O, no async

## Acceptance Criteria

### recipe-query-store.AC1: CRUD operations

- **recipe-query-store.AC1.1 Success:** `load(recipes, categories)` populates both Maps correctly
- **recipe-query-store.AC1.2 Success:** `get(uid)` returns the recipe with matching UID
- **recipe-query-store.AC1.3 Success:** `get('nonexistent')` returns `undefined`
- **recipe-query-store.AC1.4 Success:** `getAll()` returns all recipes where `inTrash === false`
- **recipe-query-store.AC1.5 Success:** `getAll()` excludes recipes where `inTrash === true`
- **recipe-query-store.AC1.6 Success:** `set(recipe)` adds a new recipe; `get(recipe.uid)` retrieves it
- **recipe-query-store.AC1.7 Success:** `set(recipe)` overwrites an existing recipe with the same UID
- **recipe-query-store.AC1.8 Success:** `delete(uid)` removes the recipe; subsequent `get(uid)` returns `undefined`
- **recipe-query-store.AC1.9 Edge:** `delete('nonexistent')` does not throw
- **recipe-query-store.AC1.10 Success:** `size` returns 0 on a fresh store
- **recipe-query-store.AC1.11 Success:** `size` returns count of non-trashed recipes only
- **recipe-query-store.AC1.12 Success:** After `load()`, `size` reflects the number of non-trashed recipes in the input

### recipe-query-store.AC2: Category operations

- **recipe-query-store.AC2.1 Success:** `resolveCategories(['uid-1', 'uid-2'])` returns `['Name1', 'Name2']` when both exist
- **recipe-query-store.AC2.2 Success:** `resolveCategories(['uid-1', 'unknown'])` returns `['Name1']` (unknown UID dropped)
- **recipe-query-store.AC2.3 Edge:** `resolveCategories([])` returns `[]`
- **recipe-query-store.AC2.4 Success:** `setCategories(categories)` replaces all categories; `getCategory()` reflects the new set
- **recipe-query-store.AC2.5 Success:** `getAllCategories()` returns all categories in insertion order
- **recipe-query-store.AC2.6 Success:** `getCategory(uid)` returns the category with matching UID

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

## Glossary

- **MCP (Model Context Protocol):** The protocol this server implements. Clients call tools and read resources over a stdio transport; the server responds with structured data.
- **RecipeStore:** The central class being built. It owns both in-memory storage (two Maps) and all query methods for recipes and categories, serving as the sole data access boundary for MCP tool handlers.
- **Tool handler:** A function registered with the MCP server that handles one client-callable tool (e.g., "search recipes"). After this change, tool handlers contain only MCP response formatting — no data filtering logic.
- **UID:** Unique identifier — an opaque string assigned by Paprika to each recipe and category.
- **Trash / `inTrash`:** A soft-delete flag on a Recipe. Trashed recipes are excluded from all read and query operations except `get(uid)`.
- **`parseDuration`:** A utility in `src/utils/duration.ts` that converts free-form time strings (e.g., `"1 hr 30 min"`) into a Luxon Duration. Returns a `Result` because parsing can fail.
- **`ScoredResult`:** An interface pairing a Recipe with a numeric relevance score produced by the `search` method. Score values: 3=exact name match, 2=name starts-with, 1=name contains, 0=match in another field.
- **`TimeConstraints`:** Interface specifying upper bounds (in minutes) for prep, cook, and total time used by `filterByTime`.
- **Tiered lookup:** The strategy used by `findByName` — tries exact match, then starts-with, then contains, stopping at the first tier that returns at least one result.
- **neverthrow `Result<T, E>`:** A library type representing either success (`Ok<T>`) or failure (`Err<E>`) without throwing exceptions. Used for `parseDuration`; not used for infallible Map/Array operations in this module.
- **fast-check:** A property-based testing library that generates random inputs and verifies invariants hold for all of them. Used in `*.property.test.ts` files.
- **Fixture / `makeRecipe()`:** A test helper (factory function) that constructs a valid Recipe object with sensible defaults, accepting optional overrides.
- **Leaf module:** A module with no imports from other project modules. `recipe-store.ts` is not a leaf module because it imports `parseDuration`.

## Architecture

Single `RecipeStore` class in `src/cache/recipe-store.ts` backed by two `Map` instances (`Map<string, Recipe>` and `Map<string, Category>`). The class combines CRUD operations with query methods, serving as the sole data access boundary for all Phase 2 MCP tool handlers.

Tool handlers never iterate recipes themselves. They call a single store method (`search`, `filterByIngredients`, `filterByTime`, or `findByName`), receive results, and format them for MCP responses. This consolidates all filtering, scoring, and sorting logic in one place.

### Store Contract

```typescript
import type { Recipe, Category } from "../paprika/types.js";

export interface SearchOptions {
  fields?: "all" | "name" | "ingredients" | "description";
  offset?: number;
  limit?: number;
}

export interface ScoredResult {
  recipe: Recipe;
  score: number; // 3=exact name, 2=starts-with, 1=name-contains, 0=other-field
}

export interface TimeConstraints {
  maxPrepTime?: number; // minutes
  maxCookTime?: number; // minutes
  maxTotalTime?: number; // minutes
}

export class RecipeStore {
  // Lifecycle
  load(recipes: Recipe[], categories: Category[]): void;

  // Recipe CRUD
  get(uid: string): Recipe | undefined; // includes trashed
  getAll(): Recipe[]; // excludes trashed
  set(recipe: Recipe): void;
  delete(uid: string): void;
  get size(): number; // count of non-trashed

  // Category operations
  getCategory(uid: string): Category | undefined;
  getAllCategories(): Category[];
  setCategories(categories: Category[]): void;
  resolveCategories(categoryUids: string[]): string[];

  // Query methods
  search(query: string, options?: SearchOptions): ScoredResult[];
  filterByIngredients(terms: string[], mode: "all" | "any", limit?: number): Recipe[];
  filterByTime(constraints: TimeConstraints): Recipe[];
  findByName(title: string): Recipe[];
}
```

### Key Behaviors

**Trash asymmetry:** `get(uid)` returns trashed recipes (delete tool needs this). All other read operations and all query methods exclude trashed recipes.

**Search scoring:** Name matches score higher (3=exact, 2=starts-with, 1=contains) than other-field matches (0). Results sort by score descending, then name ascending. When `fields` is set to a specific field, only that field is searched.

**Time filtering:** Uses `parseDuration` from `src/utils/duration.ts` to parse free-form time strings. Recipes with unparseable time fields are kept in results (unknown duration is not the same as too slow). Results sort by `totalTime` ascending, unparseable times last.

**Name lookup tiers:** `findByName` tries exact match first, then starts-with, then contains. Returns all matches from the first tier that produces results. Only searches non-trashed recipes.

**Ingredient matching:** Case-insensitive substring match against the `ingredients` text block. `'all'` mode requires every term present; `'any'` mode requires at least one.

## Existing Patterns

Investigation found the following patterns in the codebase:

- **Concrete class exports** — all modules export concrete classes, not interfaces. `RecipeStore` follows this. No dependency injection or abstract patterns exist.
- **Private constructor with static factory** — error classes use this pattern. Not applicable here since `RecipeStore` is instantiated directly.
- **Colocated tests** — test files sit next to source as `*.test.ts` and `*.property.test.ts`.
- **`readonly` properties** — used for immutable state on classes (e.g., `PaprikaAPIError.status`). The store's Map instances should be `private readonly`.
- **`.js` extensions in imports** — required by `moduleResolution: "NodeNext"`.
- **No `Result<T, E>` for infallible operations** — `parseDuration` uses `Result` because parsing can fail. The store's CRUD and query operations are infallible Map/Array operations, so plain return values are appropriate.

**New pattern introduced:** Test fixtures in `src/cache/__fixtures__/recipes.ts`. No fixture file pattern exists yet — this is the first module with enough test data to justify shared fixtures. Uses a factory function (`makeRecipe(overrides?)`) plus named constants for edge-case recipes.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Store Foundation

**Goal:** RecipeStore class with CRUD, category operations, and test infrastructure.

**Components:**

- `RecipeStore` class in `src/cache/recipe-store.ts` — lifecycle (`load`), recipe CRUD (`get`, `getAll`, `set`, `delete`, `size`), category operations (`getCategory`, `getAllCategories`, `setCategories`, `resolveCategories`)
- Test fixtures in `src/cache/__fixtures__/recipes.ts` — `makeRecipe()` factory, `makeCategory()` factory, named edge-case constants
- Tests in `src/cache/recipe-store.test.ts` — CRUD and category operation tests

**Dependencies:** P1-U02 (types) must be complete (it is).

**Done when:** All CRUD and category operations work. Tests pass for `recipe-query-store.AC1.*` and `recipe-query-store.AC2.*`.

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: Query Methods

**Goal:** Search, filtering, and lookup methods that absorb Phase 2 tool query logic.

**Components:**

- Supporting types in `src/cache/recipe-store.ts` — `SearchOptions`, `ScoredResult`, `TimeConstraints`
- Query methods on `RecipeStore` — `search`, `filterByIngredients`, `filterByTime`, `findByName`
- Tests in `src/cache/recipe-store.test.ts` — query method tests
- Property-based tests in `src/cache/recipe-store.property.test.ts` — invariant tests using fast-check

**Dependencies:** Phase 1 (CRUD layer must exist).

**Done when:** All query methods work with correct scoring, filtering, sorting, and pagination. Tests pass for `recipe-query-store.AC3.*` through `recipe-query-store.AC7.*`.

<!-- END_PHASE_2 -->

## Additional Considerations

**`parseDuration` reuse:** The `filterByTime` method imports `parseDuration` from `src/utils/duration.ts` rather than implementing its own time parser. This makes `recipe-store.ts` no longer a leaf module (it imports from both `paprika/types` and `utils/duration`). The `src/cache/CLAUDE.md` dependency documentation should reflect this.

**Future replaceability:** If recipe scale grows or query complexity increases, the `RecipeStore` class can be backed by SQLite (via `better-sqlite3`) or another in-memory store without changing its public API. The current Map implementation is a straightforward starting point that can be swapped transparently.
