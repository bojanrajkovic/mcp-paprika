# Caching Layer

Last verified: 2026-03-07

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

## Invariants

- `getAll()`, `size`, `search()`, `filterByIngredients()`, `filterByTime()`, and `findByName()` exclude trashed recipes (`inTrash: true`)
- `get(uid)` returns trashed recipes (direct UID lookup has no filtering)
- `search()` scoring tiers: exact name match (3) > starts-with (2) > contains (1) > other field match (0); ties broken by name alphabetically
- `filterByTime()` results are sorted by total time ascending (null total times sort last)
- `findByName()` returns at most one tier: exact matches, or starts-with matches, or contains matches

## Dependencies

- **Uses:** `paprika/types` (Recipe, Category types), `utils/duration` (parseDuration for time filtering)
- **Used by:** `features/`
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`
