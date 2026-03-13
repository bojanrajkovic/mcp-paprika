# Paprika API Client

Last verified: 2026-03-12

## Files

- `types.ts` — Zod schemas and TypeScript types for Paprika API wire format
- `errors.ts` — Error class hierarchy for API operations
- `client.ts` — Typed HTTP client for Paprika Cloud Sync API (auth, recipe/category reads, recipe writes, resilient requests)

## Purpose

HTTP client for the Paprika Cloud Sync API. Handles authentication, request formatting, and response parsing for recipe data.

## Contracts

### Type Definitions (types.ts)

**Branded UIDs:**

- `RecipeUid` — Branded string type for recipe identifiers, validated by `RecipeUidSchema`
- `CategoryUid` — Branded string type for category identifiers, validated by `CategoryUidSchema`

**Entry Types:**

- `RecipeEntry` — `{uid: RecipeUid, hash: string}`
- `CategoryEntry` — `{uid: CategoryUid, hash: string}`

**Object Types (API responses with snake_case → camelCase transforms):**

- `Recipe` — Full recipe object with 28 fields; output of `RecipeStoredSchema` and `RecipeSchema`
- `Category` — Category with `uid`, `name`, `orderFlag`, `parentUid`; output of `CategoryStoredSchema` and `CategorySchema`
- `AuthResponse` — Authentication response `{result: {token: string}}`; output of `AuthResponseSchema`

**Domain Types:**

- `RecipeInput` — Recipe creation/update input (requires `name`, `ingredients`, `directions`; excludes `uid`, `hash`, `created`)
- `SyncResult` — `{added: Recipe[], updated: Recipe[], removedUids: string[]}`
- `DiffResult` — `{added: string[], changed: string[], removed: string[]}`

### Zod Schemas

**Wire Format Schemas** (accept snake_case input, transform to camelCase):

- `RecipeSchema` — Validates and transforms full recipe objects from API (snake_case input → camelCase Recipe)
- `CategorySchema` — Validates and transforms category objects from API (snake_case input → camelCase Category)
- `AuthResponseSchema` — Validates authentication responses

**Stored Format Schemas** (validate camelCase JSON from disk, no transform):

- `RecipeStoredSchema` — Validates camelCase recipe JSON read from disk (no transform)
- `CategoryStoredSchema` — Validates camelCase category JSON read from disk (no transform)

**Entry and UID Schemas:**

- Entry schemas: `RecipeEntrySchema`, `CategoryEntrySchema`
- UID schemas: `RecipeUidSchema`, `CategoryUidSchema`

### Error Hierarchy (errors.ts)

Three-class hierarchy, all supporting ES2024 `ErrorOptions` for cause chaining:

- `PaprikaError` — Base class for all Paprika-related errors
- `PaprikaAuthError extends PaprikaError` — Authentication failures (default message: "Authentication failed")
- `PaprikaAPIError extends PaprikaError` — HTTP errors; carries `readonly status: number` and `readonly endpoint: string`; message formatted as `"message (HTTP status from endpoint)"`

### PaprikaClient (client.ts)

Typed HTTP client wrapping the Paprika Cloud Sync API.

**Exports:**

- `PaprikaClient` — class with `authenticate()`, recipe/category read methods, recipe write methods, and private `request<T>()`

**Construction:**

- `new PaprikaClient(email: string, password: string)` — stores credentials, no I/O

**Public API:**

- `authenticate(): Promise<void>` — POSTs form-encoded credentials to v1 login endpoint, stores JWT token
- `listRecipes(): Promise<Array<RecipeEntry>>` — fetches lightweight recipe list from `/api/v2/sync/recipes/`
- `getRecipe(uid: string): Promise<Recipe>` — fetches full recipe details from `/api/v2/sync/recipe/{uid}/`
- `getRecipes(uids: ReadonlyArray<string>): Promise<Array<Recipe>>` — fans out to `getRecipe()` with bulkhead(5) concurrency limit
- `listCategories(): Promise<Array<Category>>` — fetches category list, then hydrates each with bulkhead(5) concurrency limit independent of recipe bulkhead
- `saveRecipe(recipe: Readonly<Recipe>): Promise<Recipe>` — serializes recipe to camelCase-to-snake_case JSON, gzip-compresses, POSTs as `FormData` with `data.gz` attachment
- `deleteRecipe(uid: RecipeUid): Promise<void>` — soft-delete: fetches recipe, sets `inTrash: true`, saves, then calls `notifySync()`
- `notifySync(): Promise<void>` — POSTs to `/api/v2/sync/notify/` to trigger cloud sync propagation

**Private API:**

- `buildRecipeFormData(recipe: Readonly<Recipe>): FormData` — converts recipe to snake_case JSON, gzip-compresses, wraps in FormData with `data.gz` blob
- `request<T>(method, url, schema, body?): Promise<T>` — authenticated v2 API calls with:
  - Bearer token header (when token exists)
  - Cockatiel retry (429, 500, 502, 503) + circuit breaker (5 consecutive failures)
  - 401 re-auth retry (single attempt)
  - Response envelope unwrapping (`{ result: T }` → `T`)
  - Zod schema validation of inner value

**Dependencies:**

- **Uses:** `node:zlib` (gzip compression), `zod` (response validation), `cockatiel` (retry + circuit breaker + bulkhead), `./types.js` (schemas), `./errors.js` (error classes)
- **Used by:** `features/`, `tools/`, `resources/`
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`

## Dependencies

- **Uses:** `zod` (validation), `cockatiel` (resilience), `type-fest` (type utilities)
- **Used by:** `features/`, `tools/`, `resources/`
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`
