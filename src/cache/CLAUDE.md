# Caching Layer

Last verified: 2026-03-11

## Files

- `recipe-store.ts` — In-memory cache for recipes and categories with CRUD operations and query methods
- `disk-cache.ts` — Persistent disk cache for the Paprika recipe library between server restarts

## Purpose

Caches Paprika API responses to reduce API calls and improve response times for MCP tool invocations.

## Contracts

### RecipeStore

Core in-memory cache for recipes and categories with CRUD operations and query methods.

**Exported Types:**

- `SearchOptions` - Configuration for recipe search (fields, offset, limit)
- `ScoredResult` - Search result with recipe and relevance score
- `TimeConstraints` - Time-based filtering constraints (maxPrepTime, maxCookTime, maxTotalTime)

**Methods:**

- `load(recipes, categories)` - Populate store with recipes and categories
- `get(uid) / getAll()` - Retrieve recipes by UID or all non-trashed recipes
- `set(recipe) / delete(uid)` - CRUD operations
- `size` (getter) - Count of non-trashed recipes
- `search(query, options?)` - Search recipes with tiered scoring and pagination
- `filterByIngredients(terms, mode, limit?)` - Filter recipes by ingredient presence (all/any)
- `filterByTime(constraints)` - Filter and sort recipes by duration constraints
- `findByName(title)` - Tiered name lookup (exact > starts-with > contains)
- Category operations: `getCategory()`, `getAllCategories()`, `setCategories()`, `resolveCategories()`

### DiskCache

Persistence layer for the Paprika recipe library. Stores full recipe and category JSON on disk and maintains an in-memory index (`uid → hash`) for efficient sync diffing. Must be initialised with `init()` before any other method is called. All writes are deferred: `put*()` buffers to memory; `flush()` writes everything atomically.

**Construction:**

`new DiskCache(cacheDir: string, log?: (msg: string) => void)`

- `cacheDir` — absolute path to the cache directory (typically from `getCacheDir()` in `src/utils/xdg.ts`)
- `log` — optional log callback injected by the entry point; defaults to a no-op

**Lifecycle:**

| Method    | Signature           | Description                                                                       |
| --------- | ------------------- | --------------------------------------------------------------------------------- |
| `init()`  | `(): Promise<void>` | Creates `recipes/` and `categories/` subdirs; loads or recovers `index.json`      |
| `flush()` | `(): Promise<void>` | Writes all pending files (fsynced), commits index atomically via temp-then-rename |

**Recipe methods:**

| Method                    | Signature                                | Description                                                                   |
| ------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| `getRecipe(uid)`          | `(uid: string): Promise<Recipe \| null>` | Returns pending entry or reads/validates from disk; `null` on miss            |
| `putRecipe(recipe, hash)` | `(recipe: Recipe, hash: string): void`   | Buffers to pending map; updates `_index` in memory; no file I/O               |
| `removeRecipe(uid)`       | `(uid: string): Promise<void>`           | Deletes file (idempotent); removes from `_index` and pending map              |
| `getAllRecipes()`         | `(): Promise<Array<Recipe>>`             | Merges pending map with all `.json` files in `recipes/`; pending shadows disk |

**Category methods:**

| Method                        | Signature                                  | Description                                                        |
| ----------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `getCategory(uid)`            | `(uid: string): Promise<Category \| null>` | Returns pending entry or reads/validates from disk; `null` on miss |
| `putCategory(category, hash)` | `(category: Category, hash: string): void` | Buffers to pending map; updates `_index` in memory; no file I/O    |

**Diff methods (synchronous):**

| Method                    | Signature                                             | Description                                                                      |
| ------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| `diffRecipes(entries)`    | `(entries: ReadonlyArray<RecipeEntry>): DiffResult`   | Classifies remote entries vs local recipe index into `added`/`changed`/`removed` |
| `diffCategories(entries)` | `(entries: ReadonlyArray<CategoryEntry>): DiffResult` | Same algorithm applied to category index                                         |

## Invariants

### RecipeStore

- `getAll()`, `size`, `search()`, `filterByIngredients()`, `filterByTime()`, and `findByName()` exclude trashed recipes (`inTrash: true`)
- `get(uid)` returns trashed recipes (direct UID lookup has no filtering)
- `search()` scoring tiers: exact name match (3) > starts-with (2) > contains (1) > other field match (0); ties broken by name alphabetically
- `filterByTime()` results are sorted by total time ascending (null total times sort last)
- `findByName()` returns at most one tier: exact matches, or starts-with matches, or contains matches

### DiskCache

- `DiskCache` requires `init()` before `flush()`, `getAllRecipes()`, `putRecipe()`, `removeRecipe()`, `putCategory()`, `diffRecipes()`, or `diffCategories()` — calling any of these before `init()` throws
- `flush()` must be called after each batch of `put*()` calls to persist data to disk; until then, data lives only in memory and will be lost on restart
- `getAllRecipes()` merges pending (not-yet-flushed) entries with disk files; pending entries shadow disk for the same UID
- There is no `removeCategory()` or `getAllCategories()` — categories are always re-synced from the API; the cache only stores them for diffing
- `diffRecipes()` and `diffCategories()` reflect `putRecipe()`/`putCategory()` calls immediately (before `flush()`) because `put*()` updates `_index` in memory

## Dependencies

- **Uses:** `paprika/types` (Recipe, Category types), `utils/duration` (parseDuration for time filtering), Node.js built-in fs/promises
- **Used by:** `features/` (via RecipeStore), P2-U11 sync engine (via DiskCache), P2-U12 entry point (constructs DiskCache with `getCacheDir()` and injects log callback)
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`
