# Paprika API Client

Last verified: 2026-05-08

## Files

- `types.ts` — Zod schemas and TypeScript types for Paprika API wire format
- `errors.ts` — Error class hierarchy for API operations
- `client.ts` — Typed HTTP client for Paprika Cloud Sync API (auth, recipe/category/pantry reads, recipe and pantry writes, resilient requests)
- `dates.ts` — Pure helpers for Paprika's pantry-wire date format (`yyyy-MM-dd HH:mm:ss`): `formatPaprikaDate(Date)`, `paprikaDateToday()`, `normalizePaprikaDate(string)` (accepts ISO 8601 / date-only / already-Paprika; returns `null` on unparseable input)
- `sync.ts` — Background sync engine for polling and syncing recipes/categories with Paprika Cloud

## Purpose

HTTP client for the Paprika Cloud Sync API. Handles authentication, request formatting, and response parsing for recipe data.

## Contracts

### Type Definitions (types.ts)

**Branded UIDs:**

- `RecipeUid` — Branded string type for recipe identifiers, validated by `RecipeUidSchema`
- `CategoryUid` — Branded string type for category identifiers, validated by `CategoryUidSchema`
- `PantryItemUid` — Branded string type for pantry item identifiers, validated by `PantryItemUidSchema`

**Entry Types:**

- `RecipeEntry` — `{uid: RecipeUid, hash: string}`
- `CategoryEntry` — `{uid: CategoryUid, hash: string}`

**Object Types (API responses with snake_case → camelCase transforms):**

- `Recipe` — Full recipe object with 28 fields; output of `RecipeStoredSchema` and `RecipeSchema`
- `Category` — Category with `uid`, `name`, `orderFlag`, `parentUid`; output of `CategoryStoredSchema` and `CategorySchema`
- `PantryItem` — Pantry inventory item with 12 fields (`uid`, `ingredient`, `quantity`, `aisle`, `aisleUid`, `expirationDate`, `hasExpiration`, `inStock`, `purchaseDate`, `locationUid`, `notes`, `deleted`); output of `PantryItemStoredSchema` and `PantryItemSchema`. The `deleted` field is `optional().default(false)` on both schemas — read responses may omit it for live items, but the parsed object always carries a concrete boolean.
- `AuthResponse` — Authentication response `{result: {token: string}}`; output of `AuthResponseSchema`

**Domain Types:**

- `RecipeInput` — Recipe creation/update input (requires `name`, `ingredients`, `directions`; excludes `uid`, `hash`, `created`)
- `SyncResult` — `{added: Recipe[], updated: Recipe[], removedUids: string[]}`
- `DiffResult` — `{added: string[], changed: string[], removed: string[]}`

### Zod Schemas

**Wire Format Schemas** (accept snake_case input, transform to camelCase):

- `RecipeSchema` — Validates and transforms full recipe objects from API (snake_case input → camelCase Recipe)
- `CategorySchema` — Validates and transforms category objects from API (snake_case input → camelCase Category)
- `PantryItemSchema` — Validates and transforms pantry items from API (snake_case input → camelCase PantryItem)
- `AuthResponseSchema` — Validates authentication responses

**Stored Format Schemas** (validate camelCase JSON from disk, no transform):

- `RecipeStoredSchema` — Validates camelCase recipe JSON read from disk (no transform)
- `CategoryStoredSchema` — Validates camelCase category JSON read from disk (no transform)
- `PantryItemStoredSchema` — Validates camelCase pantry item JSON read from disk (no transform)

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
- `listPantry(): Promise<Array<PantryItem>>` — fetches fully-hydrated pantry items from `/api/v2/sync/pantry/` (no entry/detail split; all items are complete objects)
- `saveRecipe(recipe: Readonly<Recipe>): Promise<Recipe>` — serializes recipe to camelCase-to-snake_case JSON, gzip-compresses, POSTs as `FormData` with `data.gz` attachment
- `savePantryItem(item: Readonly<PantryItem>): Promise<PantryItem>` — serializes pantry item to camelCase-to-snake_case JSON wrapped in a single-element array, gzip-compresses, POSTs as `FormData` with field `data` filename `file` to the **collection URL** `/api/v2/sync/pantry/` (NO UID in path — diverges from `saveRecipe`). Returns the input item on success (Paprika responds with `{result: true}`, not the saved object). All operations (add, update, soft-delete) use this same endpoint and body shape; the soft-delete is expressed by toggling `deleted: true` on the item. Paprika upserts by `uid` — POSTing with an unknown UID creates the item.
- `deleteRecipe(uid: RecipeUid): Promise<void>` — soft-delete: fetches recipe, sets `inTrash: true`, saves, then calls `notifySync()`
- `notifySync(): Promise<void>` — POSTs to `/api/v2/sync/notify/` to trigger cloud sync propagation

**Private API:**

- `buildRecipeFormData(recipe: Readonly<Recipe>): FormData` — converts recipe to snake_case JSON, gzip-compresses, wraps in FormData with `data.gz` blob
- `buildPantryFormData(item: Readonly<PantryItem>): FormData` — converts pantry item to snake_case JSON via `pantryItemToApiPayload`, gzip-compresses, wraps in FormData with `data.gz` blob
- `request<T>(method, url, schema, body?): Promise<T>` — authenticated v2 API calls with:
  - Bearer token header (when token exists)
  - Cockatiel retry (429, 500, 502, 503) + circuit breaker (5 consecutive failures)
  - 401 re-auth retry (single attempt)
  - Response envelope unwrapping (`{ result: T }` → `T`)
  - Zod schema validation of inner value

**Pantry write wire format** (verified 2026-05-08 against macOS Paprika.app v3.8.4 build:41 via mitmproxy):

- Endpoint: `POST /api/v2/sync/pantry/` (collection URL, NO UID in path — diverges from `saveRecipe` which uses `/sync/recipe/{uid}/`)
- Body: gzipped JSON `Array<PantryItemWire>` (single-element array even for one item; Paprika.app batches when multiple changes happen quickly)
- Multipart: field name `data`, filename `file`, content-type `application/octet-stream`
- Date format: `yyyy-MM-dd HH:mm:ss` (no T, no timezone, no fractional seconds) — see `src/paprika/dates.ts` for helpers
- UID: uppercase UUID v4 (Paprika is case-insensitive but its app emits uppercase)
- All operations use the same shape: add, update, and soft-delete are differentiated only by item content; soft-delete sets `deleted: true`. The `aisleUid` is a 64-char uppercase hex string (Paprika's aisle catalog ID, NOT a UUID).

**Dependencies:**

- **Uses:** `node:zlib` (gzip compression), `zod` (response validation), `cockatiel` (retry + circuit breaker + bulkhead), `./types.js` (schemas), `./errors.js` (error classes)
- **Used by:** `features/`, `tools/`, `resources/`
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`

### SyncEngine (sync.ts)

Background polling loop that keeps local cache and in-memory store synchronized with Paprika Cloud Sync API.

**Exports:**

- `SyncEngine` — class with `start()`, `stop()`, `syncOnce()`, and `events` getter

**Construction:**

- `new SyncEngine(context: ServerContext, intervalMs: number)` — creates a new engine with specified polling interval; does not start automatically

**Public API:**

- `start(): void` — begins async polling loop at `intervalMs` interval; no-op if already running
- `stop(): void` — aborts loop via AbortController; no-op if not running
- `syncOnce(): Promise<void>` — runs one full sync cycle (recipe diff-and-fetch, category replace-all, cache flush, MCP notification, logging); never throws
- `events` getter — returns `Pick<SyncEventEmitter, "on" | "off">` for subscribing to events:
  - `sync:complete` event fires with `SyncResult` payload (recipes added, updated, and removed UIDs) on successful cycle
  - `sync:error` event fires with `Error` on cycle failure

**Algorithm (syncOnce):**

1. **Recipe sync (diff-and-fetch):**
   - Fetches lightweight recipe entries from server via `client.listRecipes()`
   - Diffs against disk cache via `cache.diffRecipes(entries)` → `{ added, changed, removed }`
   - Fetches only changed recipes: `client.getRecipes([...added, ...changed])`
   - Writes each fetched recipe to cache: `cache.putRecipe(recipe, recipe.hash)` and to store: `store.set(recipe)`
   - Removes deleted recipes (concurrent): `Promise.all(removed.map(uid => cache.removeRecipe(uid)))` and `store.delete(uid)`

2. **Category sync (replace-all):**
   - Fetches all categories: `client.listCategories()` → fully hydrated `Array<Category>`
   - Replaces store categories: `store.setCategories(categories)`
   - Writes each category to cache: `cache.putCategory(category, category.uid)` (hash placeholder)

3. **Pantry sync (replace-all with orphan cleanup):**
   - Fetches all pantry items: `client.listPantry()` → fully hydrated `Array<PantryItem>`
   - Computes orphan UIDs (cached but not in API response) via Set difference: `cachedUids - incomingUids`
   - Computes new UIDs (in API response but not cached): `incomingUids - cachedUids`
   - Computes updated UIDs (UID present in both sets, but field-wise content differs) via `pantryItemsEqual()` — pantry items have no hash field, so content edits to existing UIDs (quantity, in-stock, notes, etc.) are detected by direct field comparison
   - Removes orphans concurrently: `Promise.all(orphanUids.map(uid => cache.removePantryItem(uid)))`
   - Loads all items into store (unconditionally): `pantryStore.load(pantryItems)` (sets `hasSynced = true` even when empty)
   - Writes each item to cache: `cache.putPantryItem(item)` for all items (even unchanged ones, ensuring updates propagate)
   - Logs orphan count when > 0

4. **Finalization:**
   - Flushes cache once: `await cache.flush()`
   - Sends MCP resource notification if recipe OR pantry changes exist: `server.sendResourceListChanged()` (called if any added/changed/removed/orphaned detected)
   - Emits `sync:complete` with `SyncResult` (always emitted, even for no-change cycles)
   - Logs success: `server.sendLoggingMessage({ level: "info", data: "..." })`

5. **Error handling (all wrapped in try/catch):**
   - Catches any thrown error (API failures, cache errors, store errors)
   - Logs error: `server.sendLoggingMessage({ level: "error", data: "..." })` (wrapped in try/catch; logging may throw if disconnected)
   - Emits `sync:error` with the Error
   - Never re-throws — returns normally

**Invariants:**

- `syncOnce()` never throws — errors are caught, logged, and emitted as events
- `start()` when already running is a no-op (no duplicate loops via `_ac` check)
- `stop()` when not running is a no-op (no-op if `_ac` is null)
- Recipe or pantry changes trigger `sendResourceListChanged()`; no-change cycles do not. Recipe changes are detected via `diffRecipes` (hash-based: `added`, `changed`, `removed`); pantry changes are detected via Set difference for added/orphaned UIDs and `pantryItemsEqual()` for same-UID content edits
- Cache is flushed exactly once per cycle (single `await cache.flush()` after all mutations)
- Removed recipes are deleted concurrently via `Promise.all()` for efficiency
- Orphaned pantry items are deleted concurrently via `Promise.all()` for efficiency
- Loop respects AbortController signal and cleanly exits on `stop()`
- `pantryStore.load(items)` is called unconditionally even when `items.length === 0`, setting `hasSynced = true` after first sync

**Dependencies:**

- **Uses:** `ServerContext` (client, cache, store, server), `mitt` (event emitter), `node:timers/promises` (scheduler.wait), `./types.js` (Recipe, RecipeUid, SyncResult, DiffResult)
- **Used by:** entry point (P2-U12), Phase 3 event subscribers
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`

## Dependencies

- **Uses:** `zod` (validation), `cockatiel` (resilience), `type-fest` (type utilities)
- **Used by:** `features/`, `tools/`, `resources/`
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`
