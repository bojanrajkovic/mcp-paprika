# Paprika API Client

Last verified: 2026-05-30

## Files

- `types.ts` — Zod schemas and TypeScript types for Paprika API wire format (includes Meal and MealType entities)
- `errors.ts` — Error class hierarchy for API operations
- `client.ts` — Typed HTTP client for Paprika Cloud Sync API (auth, recipe/category/pantry/grocery reads, recipe/pantry/grocery writes, resilient requests)
- `dates.ts` — Pure helpers for Paprika's pantry-wire date format (`yyyy-MM-dd HH:mm:ss`): `formatPaprikaDate(Date)`, `paprikaDateToday()`, `normalizePaprikaDate(string)` (accepts ISO 8601 / date-only / already-Paprika; returns `null` on unparseable input)
- `sync.ts` — Background sync engine for polling and syncing recipes/categories with Paprika Cloud

## Purpose

HTTP client for the Paprika Cloud Sync API. Handles authentication, request formatting, and response parsing for recipe data.

## Contracts

### Type Definitions (types.ts)

**Branded UIDs:**

`RecipeUidSchema`, `PantryItemUidSchema`, `GroceryListUidSchema`, and `GroceryItemUidSchema` are `z.string().min(1).brand(...)` — the non-empty constraint is part of the brand, so it applies uniformly to entity primary-key `uid` fields and to tool input fields without per-site `.min(1)`. `AisleUidSchema` stays deliberately unconstrained (it doubles as a "no aisle" empty sentinel and accepts two ID formats). Foreign-key reference fields (`listUid`, `aisleUid`, meal `recipeUid`/`typeUid`) are plain `z.string()` in the entity schemas, not the branded schemas, and are unaffected.

- `RecipeUid` — Branded string type for recipe identifiers, validated by `RecipeUidSchema` (non-empty)
- `CategoryUid` — Branded string type for category identifiers, validated by `CategoryUidSchema`
- `PantryItemUid` — Branded string type for pantry item identifiers, validated by `PantryItemUidSchema` (non-empty)
- `AisleUid` — Branded string type for aisle identifiers, validated by `AisleUidSchema` (unconstrained `z.string().brand()`; accepts both 64-char uppercase hex used by Paprika's default aisles and uppercase UUID v4 used by user-created aisles)
- `GroceryListUid` — Branded string type for grocery list identifiers, validated by `GroceryListUidSchema` (non-empty)
- `GroceryItemUid` — Branded string type for grocery item identifiers, validated by `GroceryItemUidSchema` (non-empty)
- `GroceryIngredientUid` — Branded string type for grocery ingredient identifiers, validated by `GroceryIngredientUidSchema`
- `MealUid` — Branded string type for meal identifiers, validated by `MealUidSchema`
- `MealTypeUid` — Branded string type for meal type identifiers, validated by `MealTypeUidSchema`
- `MenuUid` — Branded string type for menu identifiers, validated by `MenuUidSchema` (non-empty)
- `MenuItemUid` — Branded string type for menu item identifiers, validated by `MenuItemUidSchema` (non-empty)

**Entry Types:**

- `RecipeEntry` — `{uid: RecipeUid, hash: string}`
- `CategoryEntry` — `{uid: CategoryUid, hash: string}`

**Object Types (API responses with snake_case → camelCase transforms):**

- `Recipe` — Full recipe object with 29 fields; output of `RecipeStoredSchema` and `RecipeSchema`. The `deleted` field is `optional().default(false)` on both schemas (same pattern as the other entities) — GET responses omit it for live recipes, but the parsed object always carries a concrete boolean. `deleted: true` alongside `inTrash: true` is the empty-trash (hard-delete) tombstone.
- `Category` — Category with `uid`, `name`, `orderFlag`, `parentUid`; output of `CategoryStoredSchema` and `CategorySchema`
- `PantryItem` — Pantry inventory item with 11 fields (`uid`, `ingredient`, `quantity`, `aisle`, `aisleUid`, `expirationDate`, `hasExpiration`, `inStock`, `purchaseDate`, `notes`, `deleted`); output of `PantryItemStoredSchema` and `PantryItemSchema`. The `deleted` field is `optional().default(false)` on both schemas — read responses may omit it for live items, but the parsed object always carries a concrete boolean. Wire `aisle_uid` is `z.string().nullable()`, coerced to `""` by the read transform; the stored `aisleUid` is always a string. **Note:** the wire format also carries `location_uid` (referencing the `pantrylocations` entity type), but `PantryItemSchema` does not parse it. The `pantrylocations` sync endpoint returns 404 as of May 2026.
- `Aisle` — Aisle catalog entry with `uid`, `name`, `orderFlag`, `deleted`; output of `AisleStoredSchema` and `AisleSchema`. The `deleted` field is `optional().default(false)`.
- `GroceryList` — Grocery list with `uid`, `name`, `orderFlag`, `isDefault`, `remindersList`, `deleted`; output of `GroceryListStoredSchema` and `GroceryListSchema`. The `deleted` field is `optional().default(false)`.
- `GroceryItem` — Grocery list item with 13 fields (`uid`, `name`, `ingredient`, `aisle`, `aisleUid`, `listUid`, `purchased`, `deleted`, `orderFlag`, `quantity`, `instruction`, `recipe`, `separate`); output of `GroceryItemStoredSchema` and `GroceryItemSchema`. The `deleted` field is `optional().default(false)`; `recipe` is `string | null`. **Wire `aisle_uid` is `z.string().nullable()`, coerced to `""` (no-aisle sentinel) by the read transform; the stored `aisleUid` is always a string.**
- `GroceryIngredient` — Grocery ingredient catalog entry with `uid`, `name`, `aisleUid`, `deleted`; output of `GroceryIngredientStoredSchema` and `GroceryIngredientSchema`. The `deleted` field is `optional().default(false)`. **Wire `aisle_uid` is `z.string().nullable()`, coerced to `""`; rows that coerce to `""` are dropped by the sync layer (see Ingredient catalog sync) — a no-aisle ingredient carries no memory.**
- `Meal` — Meal planner entry with 10 fields (`uid`, `recipeUid`, `name`, `date`, `type`, `typeUid`, `orderFlag`, `isIngredient`, `scale`, `deleted`); output of `MealStoredSchema` and `MealSchema`. `recipeUid` is `string | null` (not branded RecipeUid — wire format doesn't guarantee recipe exists). `typeUid` is `string | null` — older meals predating Paprika's mealtypes catalog carry `null`; in that case `type` (integer) maps to `MealType.originalType`. `deleted` is `optional().default(false)`.
- `MealType` — Meal type catalog entry with 8 fields (`uid`, `name`, `color`, `orderFlag`, `originalType`, `exportAllDay`, `exportTime`, `deleted`); output of `MealTypeStoredSchema` and `MealTypeSchema`. The `deleted` field is `optional().default(false)` — GET responses omit it for live items, but the soft-delete wire format POSTs it as `true` (same pattern as aisles/grocery entities). `exportTime` is `number` (seconds since midnight: `28800` for 08:00, `64800` for 18:00). `originalType` is `number | null` — built-in types carry the integer mapping to one of the four defaults (Breakfast=0, Lunch=1, Dinner=2, Snacks=3); user-created custom types carry `null`. None of these are used by the read-only history feature directly, but the sync layer filters `deleted: true` before loading into `mealTypeStore`.
- `Menu` — Saved meal plan with 6 fields (`uid`, `name`, `days`, `orderFlag`, `notes`, `deleted`); output of `MenuStoredSchema` and `MenuSchema`. `days` is the menu's total day span (1-indexed). `uid` is branded `MenuUid`. The `deleted` field is `optional().default(false)`.
- `MenuItem` — One planned recipe within a menu, with 8 fields (`uid`, `menuUid`, `recipeUid`, `name`, `day`, `typeUid`, `orderFlag`, `deleted`); output of `MenuItemStoredSchema` and `MenuItemSchema`. `uid` is branded `MenuItemUid`. `menuUid` is `string | null` — a cascade-deleted menuitem carries `menu_uid: null` on the wire (the menu's soft-delete nulls the back-reference); it is plain `z.string().nullable()`, not branded. `recipeUid` is `string | null` (defensive read — wire does not guarantee a recipe link). `day` is the 1-indexed day within the menu's span; `name` is the denormalized recipe display name. The `deleted` field is `optional().default(false)`.
- `AuthResponse` — Authentication response `{result: {token: string}}`; output of `AuthResponseSchema`

**Domain Types:**

- `RecipeInput` — Recipe creation/update input (requires `name`, `ingredients`, `directions`; excludes `uid`, `hash`, `created`)
- `EntityChanges<T>` — `{added: ReadonlyArray<T>, updated: ReadonlyArray<T>, removedUids: ReadonlyArray<string>}` — change set for one entity type
- `SyncEntityType` — `"recipes" | "pantry" | "grocery-lists" | "grocery-items" | "menus" | "menu-items"` — closed union of entity types sync can produce; adding a new type requires explicit extension
- `SyncResult<K extends SyncEntityType, T extends object>` — generic discriminated-union variant: `{changeType: K, changes: EntityChanges<T>}`
- `RecipeSyncResult` — `SyncResult<"recipes", Recipe>` — concrete recipe variant
- `PantrySyncResult` — `SyncResult<"pantry", PantryItem>` — concrete pantry variant
- `GroceryListSyncResult` — `SyncResult<"grocery-lists", GroceryList>` — concrete grocery list variant
- `GroceryItemSyncResult` — `SyncResult<"grocery-items", GroceryItem>` — concrete grocery item variant
- `MenuSyncResult` — `SyncResult<"menus", Menu>` — concrete menu variant
- `MenuItemSyncResult` — `SyncResult<"menu-items", MenuItem>` — concrete menu item variant
- `AnySyncResult` — `RecipeSyncResult | PantrySyncResult | GroceryListSyncResult | GroceryItemSyncResult | MenuSyncResult | MenuItemSyncResult` — union used as the `sync:complete` event payload
- `DiffResult` — `{added: string[], changed: string[], removed: string[]}`

### Zod Schemas

**Wire Format Schemas** (accept snake_case input, transform to camelCase):

- `RecipeSchema` — Validates and transforms full recipe objects from API (snake_case input → camelCase Recipe)
- `CategorySchema` — Validates and transforms category objects from API (snake_case input → camelCase Category)
- `PantryItemSchema` — Validates and transforms pantry items from API (snake_case input → camelCase PantryItem)
- `GroceryListSchema` — Validates and transforms grocery lists from API (`order_flag`, `is_default`, `reminders_list` → camelCase `GroceryList`)
- `GroceryItemSchema` — Validates and transforms grocery items from API (`aisle_uid`, `list_uid`, `order_flag` → camelCase `GroceryItem`)
- `GroceryIngredientSchema` — Validates and transforms grocery ingredients from API (`aisle_uid` → camelCase `GroceryIngredient`)
- `MealSchema` — Validates and transforms meals from API (`recipe_uid`, `type_uid`, `order_flag`, `is_ingredient` → camelCase `Meal`)
- `MealTypeSchema` — Validates and transforms meal types from API (`order_flag`, `original_type`, `export_all_day`, `export_time` → camelCase `MealType`)
- `MenuSchema` — Validates and transforms menus from API (`order_flag` → camelCase `Menu`)
- `MenuItemSchema` — Validates and transforms menu items from API (`menu_uid`, `recipe_uid`, `type_uid`, `order_flag` → camelCase `MenuItem`)
- `AuthResponseSchema` — Validates authentication responses

**Stored Format Schemas** (validate camelCase JSON from disk, no transform):

- `RecipeStoredSchema` — Validates camelCase recipe JSON read from disk (no transform)
- `CategoryStoredSchema` — Validates camelCase category JSON read from disk (no transform)
- `PantryItemStoredSchema` — Validates camelCase pantry item JSON read from disk (no transform)
- `AisleStoredSchema` — Validates camelCase aisle JSON read from disk (no transform)
- `GroceryListStoredSchema` — Validates camelCase grocery list JSON read from disk (no transform)
- `GroceryItemStoredSchema` — Validates camelCase grocery item JSON read from disk (no transform)
- `GroceryIngredientStoredSchema` — Validates camelCase grocery ingredient JSON read from disk (no transform)
- `MealStoredSchema` — Validates camelCase meal JSON read from disk (no transform)
- `MealTypeStoredSchema` — Validates camelCase meal type JSON read from disk (no transform)
- `MenuStoredSchema` — Validates camelCase menu JSON read from disk (no transform)
- `MenuItemStoredSchema` — Validates camelCase menu item JSON read from disk (no transform)

**Payload mappers** (camelCase → snake_case wire, exported from `types.ts` following the `mealToApiPayload` convention so write tools can use them without importing `client.ts`):

- `menuToApiPayload(item: Readonly<Menu>): Record<string, unknown>` — inverse of `MenuSchema`'s read transform; emits `order_flag` and the literal fields.
- `menuItemToApiPayload(item: Readonly<MenuItem>): Record<string, unknown>` — inverse of `MenuItemSchema`'s read transform; emits `menu_uid`, `recipe_uid`, `type_uid`, `order_flag`.

**Entry and UID Schemas:**

- Entry schemas: `RecipeEntrySchema`, `CategoryEntrySchema`
- UID schemas: `RecipeUidSchema`, `CategoryUidSchema`

### Error hierarchy (errors.ts)

Paprika-specific classes all extend `PaprikaError` and support ES2024 `ErrorOptions` for cause chaining. The circuit-open surface is the shared `CircuitOpenError` from `src/utils/errors.ts` — same class also used by `EmbeddingClient`; import it from `../utils/errors.js`.

| Class              | Extends        | Carries                                            | When thrown                                              |
| ------------------ | -------------- | -------------------------------------------------- | -------------------------------------------------------- |
| `PaprikaAuthError` | `PaprikaError` | (cause)                                            | Authentication failures                                  |
| `PaprikaAPIError`  | `PaprikaError` | `status`, `endpoint`                               | Real HTTP errors from Paprika                            |
| `CircuitOpenError` | `Error`        | `service`, `endpoint`, `cause: BrokenCircuitError` | Local circuit breaker is open; no network request issued |

`PaprikaClient` throws `new CircuitOpenError("paprika", url, { cause: brokenCircuitError })`. The `service` field disambiguates breaker-open events that reach a shared log aggregator from `EmbeddingClient` (`"embeddings"`) or any future client that mounts cockatiel.

### PaprikaClient (client.ts)

Typed HTTP client wrapping the Paprika Cloud Sync API.

**Exports:**

- `PaprikaClient` — class with `authenticate()`, recipe/category/pantry/grocery read methods, recipe/pantry/grocery write methods, and private `request<T>()`

**Construction:**

- `new PaprikaClient(email: string, password: string, log?: pino.Logger)` — stores credentials and wires resilience policies; no I/O. When `log` is omitted, a silent logger is used (safe for tests that don't capture output).

**Public API:**

- `authenticate(): Promise<void>` — POSTs form-encoded credentials to v1 login endpoint, stores JWT token
- `listRecipes(): Promise<Array<RecipeEntry>>` — fetches lightweight recipe list from `/api/v2/sync/recipes/`
- `getRecipe(uid: string): Promise<Recipe>` — fetches full recipe details from `/api/v2/sync/recipe/{uid}/`
- `getRecipes(uids: ReadonlyArray<string>): Promise<Array<Recipe>>` — fans out to `getRecipe()` with bulkhead(5) concurrency limit
- `listCategories(): Promise<Array<Category>>` — fetches category list, then hydrates each with bulkhead(5) concurrency limit independent of recipe bulkhead
- `listMeals(): Promise<Array<Meal>>` — fetches fully-hydrated meals from `/api/v2/sync/meals/`; parses via `MealSchema`
- `listMealTypes(): Promise<Array<MealType>>` — fetches meal type catalog from `/api/v2/sync/mealtypes/`; parses via `MealTypeSchema`
- `listMenus(): Promise<Array<Menu>>` — fetches menus from `/api/v2/sync/menus/`; parses via `MenuSchema`
- `listMenuItems(): Promise<Array<MenuItem>>` — fetches menu items from `/api/v2/sync/menuitems/`; parses via `MenuItemSchema`
- `listPantry(): Promise<Array<PantryItem>>` — fetches fully-hydrated pantry items from `/api/v2/sync/pantry/` (no entry/detail split; all items are complete objects)
- `listAisles(): Promise<Array<Aisle>>` — fetches aisle catalog from `/api/v2/sync/groceryaisles/`; same pattern as `listCategories()`
- `listGroceryLists(): Promise<Array<GroceryList>>` — fetches fully-hydrated grocery lists from `/api/v2/sync/grocerylists/`; parses via `GroceryListSchema`
- `listGroceryItems(): Promise<Array<GroceryItem>>` — fetches grocery items from `/api/v2/sync/groceries/`; parses via `GroceryItemSchema`
- `listGroceryIngredients(): Promise<Array<GroceryIngredient>>` — fetches grocery ingredients from `/api/v2/sync/groceryingredients/`; parses via `GroceryIngredientSchema`
- `saveAisle(aisle: Readonly<Aisle>): Promise<Aisle>` — POSTs gzip-encoded single-element JSON array to `/api/v2/sync/groceryaisles/` (same multipart shape as `savePantryItems`); server responds `{result: true}`; returns the input aisle on success (caller is responsible for local commit via `commitAisle`)
- `saveRecipe(recipe: Readonly<Recipe>): Promise<Recipe>` — serializes recipe to camelCase-to-snake_case JSON, gzip-compresses, POSTs as `FormData` with `data.gz` attachment
- `savePantryItems(items: ReadonlyArray<Readonly<PantryItem>>): Promise<ReadonlyArray<PantryItem>>` — serializes pantry items to camelCase-to-snake_case JSON array, gzip-compresses, POSTs as `FormData` with field `data` filename `file` to the **collection URL** `/api/v2/sync/pantry/` (NO UID in path — diverges from `saveRecipe`). Batch-capable: callers may pass a single-element or multi-element array. Returns the input items on success (Paprika responds with `{result: true}`, not the saved objects). All operations (add, update, soft-delete) use this same endpoint and body shape; the soft-delete is expressed by toggling `deleted: true` on the item. Paprika upserts by `uid` — POSTing with an unknown UID creates the item.
- `saveGroceryList(list: Readonly<GroceryList>): Promise<GroceryList>` — POSTs gzip-encoded single-element JSON array to `/api/v2/sync/grocerylists/`; returns input list on `{result: true}`
- `saveGroceryItems(items: ReadonlyArray<Readonly<GroceryItem>>): Promise<ReadonlyArray<GroceryItem>>` — POSTs gzip-encoded N-element JSON array to `/api/v2/sync/groceries/`; batch-capable (sends all items in one request); returns input items on `{result: true}`
- `saveGroceryIngredient(ingredient: Readonly<GroceryIngredient>): Promise<GroceryIngredient>` — POSTs gzip-encoded single-element JSON array to `/api/v2/sync/groceryingredients/`; returns input ingredient on `{result: true}`
- `saveMeals(items: ReadonlyArray<Readonly<Meal>>): Promise<ReadonlyArray<Meal>>` — POSTs gzip-encoded N-element JSON array to `/api/v2/sync/meals/`; batch-capable (sends all items in one request); identity-returns `items` on `{result: true}` (Paprika does not echo saved objects). Delegates to `postEntities` with `mealToApiPayload` as the `toPayload` transformer. `mealToApiPayload(item: Readonly<Meal>): Record<string, unknown>` is the inverse of `MealSchema`'s read-side camelCase transform — maps camelCase fields back to snake_case wire names (`recipe_uid`, `type_uid`, `order_flag`, `is_ingredient`).
- `saveMenus(items: ReadonlyArray<Readonly<Menu>>): Promise<ReadonlyArray<Menu>>` — POSTs gzip-encoded N-element JSON array to `/api/v2/sync/menus/` via `postEntities` with `menuToApiPayload`; batch-capable; identity-returns `items` on `{result: true}`.
- `saveMenuItems(items: ReadonlyArray<Readonly<MenuItem>>): Promise<ReadonlyArray<MenuItem>>` — POSTs gzip-encoded N-element JSON array to `/api/v2/sync/menuitems/` via `postEntities` with `menuItemToApiPayload`; batch-capable; identity-returns `items` on `{result: true}`.
- `deleteRecipe(uid: RecipeUid): Promise<void>` — soft-delete: fetches recipe, sets `inTrash: true`, saves, then calls `notifySync()`
- `hardDeleteRecipe(uid: RecipeUid): Promise<void>` — hard-delete (empty trash): fetches recipe, sets BOTH `inTrash: true` and `deleted: true`, saves (echoing the recipe's existing hash and created verbatim — the exact shape Paprika.app emits when emptying the trash), then calls `notifySync()`. Irreversible, unlike `deleteRecipe`. The hash is NOT recomputed: Paprika validates `deleted` against the stored hash, so echoing the synced hash is sufficient (an empty hash on a locally-created recipe also succeeds).
- `notifySync(): Promise<void>` — POSTs to `/api/v2/sync/notify/` to trigger cloud sync propagation

**Private API:**

- `buildEntityFormData(payload: unknown, filename = "file"): FormData` — stringifies `payload` to JSON, gzip-compresses, wraps in a `Blob`, appends to `FormData` as field `"data"` with the given `filename`. Used by `saveRecipe` (with `filename = "data.gz"`) and by `postEntities` (with the default `"file"`)
- `postEntities<T>(url: string, items: ReadonlyArray<Readonly<T>>, toPayload: (item: Readonly<T>) => Record<string, unknown>): Promise<void>` — maps `items` through `toPayload`, passes the resulting array to `buildEntityFormData`, then calls `request("POST", url, z.boolean(), formData)`. Used by all five non-recipe save methods (`saveAisle`, `savePantryItems`, `saveGroceryList`, `saveGroceryItems`, `saveGroceryIngredient`)
- `request<T>(method, url, schema, body?): Promise<T>` — authenticated v2 API calls with:
  - Bearer token header (when token exists)
  - **Resilience:** `wrap(breakerPolicy, retryPolicy)` — breaker outermost, retry innermost. The breaker sees one execution per tool call regardless of how many retries that call exhausted internally. Retry: `maxAttempts: 3` means 3 retries, so each failing tool call makes 4 total network attempts before the retry gives up. Breaker: opens after 5 consecutive failing tool calls (`ConsecutiveBreaker(5)`), half-opens after 30 s.
  - **Retryable conditions:** HTTP 429/500/502/503 and network-level fetch failures (DNS, TCP reset, TLS handshake, abort). `fetch` throws a bare `TypeError` for network failures; `request()` wraps those in a private `NetworkRetryableError` marker so `handleType` can match them.
  - **Circuit open:** throws `CircuitOpenError("paprika", url, { cause: brokenCircuitError })` (imported from `../utils/errors.js`; shared with `EmbeddingClient`) — no fabricated HTTP status. The error carries `service`, `endpoint`, and `cause: BrokenCircuitError` for structured access.
  - **Per-attempt logging:** debug on request start (`{method, url, attempt}`) and on success (`{method, url, attempt, status, attemptDurationMs}`); info on 401 before re-auth; error on non-retryable HTTP failure (`{method, url, attempt, status, attemptDurationMs}`). Retry and give-up telemetry comes from the lifecycle hooks (see below), not inline log calls.
  - 401 re-auth retry (single attempt)
  - Response envelope unwrapping (`{ result: T }` → `T`)
  - Zod schema validation of inner value

**Attempt numbering:** `attempt` in all log records is 1-indexed for the network-touch count. The first `fetch` call logs `attempt: 1`; the first retry logs `attempt: 2`; and so on. Cockatiel's `IRetryContext.attempt` is 0-indexed — both the inline log calls and the `onRetry` hook normalize via `+ 1`.

**Resilience policy lifecycle:**

The constructor installs five hooks after building `this.resilience`. These fire for every `PaprikaClient` instance (the client is process-singleton, so hooks live for the process lifetime).

| Hook                       | Level | Payload                                    | Fires                                                                              |
| -------------------------- | ----- | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `retryPolicy.onRetry`      | warn  | `{attempt: 1-indexed, nextBackoffMs, err}` | Once per failed attempt that will be retried; fires before the backoff delay       |
| `retryPolicy.onGiveUp`     | error | `{err}`                                    | Once when all retries are exhausted                                                |
| `breakerPolicy.onBreak`    | warn  | —                                          | Once per closed→open transition; fans out to MCP clients via `notifyLevel: "warn"` |
| `breakerPolicy.onReset`    | info  | —                                          | When breaker closes after a successful half-open probe                             |
| `breakerPolicy.onHalfOpen` | info  | —                                          | When breaker transitions to half-open                                              |

`onBreak` fires exactly once per closed→open transition. Subsequent calls while the breaker is open do not re-fire it.

**Pantry write wire format** (verified 2026-05-08 against macOS Paprika.app v3.8.4 build:41 via mitmproxy):

- Endpoint: `POST /api/v2/sync/pantry/` (collection URL, NO UID in path — diverges from `saveRecipe` which uses `/sync/recipe/{uid}/`)
- Body: gzipped JSON `Array<PantryItemWire>` (single-element array even for one item; Paprika.app batches when multiple changes happen quickly)
- Multipart: field name `data`, filename `file`, content-type `application/octet-stream`
- Date format: `yyyy-MM-dd HH:mm:ss` (no T, no timezone, no fractional seconds) — see `src/paprika/dates.ts` for helpers
- UID: uppercase UUID v4 (Paprika is case-insensitive but its app emits uppercase)
- All operations use the same shape: add, update, and soft-delete are differentiated only by item content; soft-delete sets `deleted: true`. The `aisleUid` is a 64-char uppercase hex string (Paprika's aisle catalog ID, NOT a UUID).
- Fields sent: `uid`, `ingredient`, `quantity`, `aisle`, `aisle_uid`, `expiration_date`, `has_expiration`, `in_stock`, `purchase_date`, `deleted` (10 fields). The `notes` field present on the `PantryItem` type is **not** sent — the macOS app omits it from POST bodies (confirmed via wire capture).

**Recipe deletion wire format** (verified via `docs/wire-captures/writes.har.json`):

- Endpoint: `POST /api/v2/sync/recipe/{uid}/` (singular URL with UID in path — diverges from pantry/grocery deletes which use the collection URL)
- **Soft-delete (move to trash, reversible):** full recipe object with `in_trash: true`, `deleted: false`; the same multipart `FormData` shape as `saveRecipe`. `deleteRecipe()` fetches the recipe, sets `inTrash: true`, and saves via `saveRecipe()`.
- **Hard-delete (empty trash, irreversible):** byte-identical body with both `in_trash: true` AND `deleted: true` — the hash is echoed verbatim (NOT recomputed; Paprika validates `deleted` against the stored hash). `hardDeleteRecipe()` implements this. Exposed to MCP clients as the `empty_trash` tool, which guards that the recipe is already trashed.

**Photo upload wire format** (verified via `docs/wire-captures/writes.har.json`):

Three-step sequence:

1. `POST /api/v2/sync/recipe/{recipe_uid}/` — recipe object with `photo`/`photo_large` set to filenames and `photo_hash` set
2. `POST /api/v2/sync/photo/{photo_uid}/` — photo metadata (7 fields: `deleted`, `filename`, `hash`, `name`, `order_flag`, `recipe_uid`, `uid`) as multipart, with the binary image data
3. `POST /api/v2/sync/recipe/{recipe_uid}/` — recipe object again to confirm the upload

Deleting a photo POSTs a tombstone (`deleted: true`) to `/api/v2/sync/photo/{photo_uid}/`.

**Grocery ingredient auto-creation** (verified via `docs/wire-captures/writes.har.json`):

When the Paprika app adds grocery items, it also POSTs corresponding `GroceryIngredient` entries to `/api/v2/sync/groceryingredients/` in the same request cycle. Ingredient records are upserted by UID alongside their items — the ingredient catalog is not a pre-populated reference; it grows as items are added.

**Dependencies:**

- **Uses:** `node:zlib` (gzip compression), `zod` (response validation), `cockatiel` (retry + circuit breaker + bulkhead), `./types.js` (schemas), `./errors.js` (error classes)
- **Used by:** `features/`, `tools/`, `resources/`
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`

### `syncReplaceAllEntity` (sync.ts)

A standalone generic helper that implements the replace-all-with-pending-write-filtering sync pattern shared by pantry, grocery list, and grocery item sync. Exported for unit testing.

**Type:**

```typescript
type ReplaceAllEntityOptions<T extends { uid: UID }, UID extends string> = {
  readonly fetch: () => Promise<ReadonlyArray<T>>;
  readonly cache: Pick<DiskCache<T>, "getAll" | "put" | "remove">;
  readonly store: TombstoneEntityStore<T, UID>;
  readonly equals: (a: T, b: T) => boolean;
  readonly label: string;
  readonly log: Logger;
  readonly afterLoad?: () => void;
};
```

**Algorithm:**

1. `fetch()` → `rawIncoming`; `cache.getAll()` → `cached`; build `cachedByUid` map from `cached`.
2. Filter `rawIncoming` to drop pending-delete and pending-upsert UIDs → `incomingFiltered`.
3. Splice pending-upserted cached items back in → `effective = [...incomingFiltered, ...pendingUpserted]`.
4. Compute orphan UIDs (in cached, not in effectiveUids) → `cache.remove` for each.
5. `store.load(effective)`; fire `afterLoad?.()` (used for `setLastSyncedAt()`).
6. `cache.put(item)` for each effective item.
7. **Observation-based clearing:** walk `rawIncoming` (not `effective`) — for each pending-upsert UID whose cached snapshot passes `equals(cachedItem, rawItem)`, call `store.clearPending(uid)`. Walking raw ensures spliced-out UIDs are still checked.
8. Return `{ added, updated, removedUids }` as `EntityChanges<T>`.

Key design choices: `cache: Pick<DiskCache<T>, ...>` narrows to methods actually used; `afterLoad?` decouples `setLastSyncedAt()` from the function signature; observation-based clearing walks `rawIncoming` (not `effective`) to preserve the guarantee that spliced-out UIDs still get checked.

### SyncEngine (sync.ts)

Background polling loop that keeps local cache and in-memory store synchronized with Paprika Cloud Sync API.

**Exports:**

- `SyncEngine` — class with `start()`, `stop()`, `syncOnce()`, and `events` getter
- `syncReplaceAllEntity` — standalone generic helper for the replace-all-with-pending-write-filtering pattern; see above

**Construction:**

- `new SyncEngine(context: AppContext, intervalMs: number)` — creates a new engine with the specified polling interval; does not start automatically. Takes `AppContext` (process-wide) rather than `SessionContext`/`ServerContext` because the sync loop is process-wide and must not be tied to a single MCP session. Stores `this.log = context.log.child({ component: "sync" })` for all sync events. The engine does **not** call `context.notifier` directly — resource-list notification is the responsibility of a `sync:complete` subscriber wired in `buildAppContext`.

**Public API:**

- `start(): void` — begins async polling loop at `intervalMs` interval; no-op if already running
- `stop(): void` — aborts loop via AbortController; no-op if not running
- `syncOnce(): Promise<void>` — runs one full sync cycle across all entities (see Algorithm below); never throws; does **not** call the notifier directly
- `events` getter — returns `Pick<SyncEventEmitter, "on" | "off">` for subscribing to events:
  - `sync:complete` event fires **four times per cycle** — `RecipeSyncResult` (`changeType: "recipes"`), `PantrySyncResult` (`changeType: "pantry"`), `GroceryListSyncResult` (`changeType: "grocery-lists"`), `GroceryItemSyncResult` (`changeType: "grocery-items"`). Subscribers narrow by `result.changeType`.
  - `sync:error` event fires with `Error` on cycle failure

**Algorithm (syncOnce):**

1. **Recipe sync (diff-and-fetch, pending-writes filtered):**
   - Fetches lightweight recipe entries from server via `client.listRecipes()`
   - Diffs against disk cache via `cache.recipes.diff(entries)` → `{ added, changed, removed }`
   - **Filters the diff through `store.isPendingUpsert` / `store.isPendingDelete`** (issue #57):
     - `removed` → drops UIDs marked pending-upsert (server hasn't seen our write yet; deleting would roll it back). Pending-deletes pass through — if the server actually no longer lists the UID, honoring the removal is correct.
     - `added` and `changed` → drops UIDs marked pending-upsert OR pending-delete (incoming snapshot is pre-write, so applying it would clobber or resurrect our local change). Variables are named `filteredAdded` / `filteredChanged` / `filteredRemoved` from this point forward; the emitted `SyncResult` uses the filtered values.
   - Fetches only filtered changes: `client.getRecipes([...filteredAdded, ...filteredChanged])`
   - Writes each fetched recipe to cache: `cache.recipes.put(recipe)` and to store: `store.set(recipe)` (the hash carried on `recipe.hash` is used for diffing internally)
   - Removes deleted recipes (concurrent): `Promise.all(filteredRemoved.map(uid => cache.recipes.remove(uid)))` and `store.delete(uid)`
   - **Observation-based clearing:** walks the raw `entries` from `listRecipes()` and calls `store.clearPending(uid)` for any UID that has a pending-upsert and appears in the canonical list.

2. **Category sync (replace-all):**
   - Fetches all categories: `client.listCategories()` → fully hydrated `Array<Category>`
   - Replaces store categories: `store.setCategories(categories)`
   - Writes each category to cache: `cache.categories.put(category)` (categories use replace-all; no hash maintained)

2.5. **Aisle sync (replace-all with pending-write filtering):**

- Fetches all aisles: `client.listAisles()`; filters `deleted: true` and pending-upsert UIDs; splices cached pending-upserts back in (effectiveAisles)
- Removes orphan aisles, loads effective list into `aisleStore`, writes to cache
- Observation-based clearing for pending-upserts: if a pending-upsert UID appears in the canonical list, clears immediately (aisles use UID presence alone — no content-equality check)

3. **Pantry sync (replace-all with orphan cleanup, pending-writes filtered):**
   - Delegated to `syncReplaceAllEntity({ fetch: client.listPantry, cache: cache.pantry, store: pantryStore, equals: pantryItemsEqual, label: "pantry items", log })`.
   - `pantryItemsEqual()` compares all 11 fields — pantry items have no hash field, so content edits (quantity, in-stock, notes, etc.) are detected by field-wise comparison.
   - Returns `{ added, updated, removedUids }` as `pantryChanges`.

4. **Grocery list sync (replace-all with orphan cleanup, pending-writes filtered):**
   - Delegated to `syncReplaceAllEntity({ ..., fetch: client.listGroceryLists, store: groceryListStore, equals: groceryListsEqual, afterLoad: () => groceryListStore.setLastSyncedAt() })`.
   - `groceryListsEqual()` compares `uid`, `name`, `orderFlag`, `isDefault`, `remindersList`, `deleted`.
   - Returns `groceryListChanges`.

5. **Grocery item sync (replace-all with orphan cleanup, pending-writes filtered):**
   - Delegated to `syncReplaceAllEntity({ ..., fetch: client.listGroceryItems, store: groceryItemStore, equals: groceryItemsEqual })`.
   - `groceryItemsEqual()` compares all 13 fields including `purchased`, `orderFlag`, `instruction`, `recipe`, `separate`.
   - Returns `groceryItemChanges`.

6. **Ingredient catalog sync (replace-all, no pending-writes):**
   - Fetches `client.listGroceryIngredients()`, filters `deleted: true` items **and items with no aisle (`aisleUid === ""`)**, removes orphan cached entries, loads into `groceryIngredientStore`, writes to cache
   - **No-aisle drop:** Paprika returns `aisle_uid: null` for an ingredient never filed into an aisle (`GroceryIngredientSchema` coerces null → `""`). Such a row carries no aisle memory — `add_grocery_items` resolves it to `""` and the item then defaults to Miscellaneous, identical to having no catalog entry — so these are dropped with a single `warn`-level `dropped grocery ingredients with no aisle` log (count only). Historically the un-nullable schema also threw on these rows, aborting the whole sync cycle before meals/menus could sync.
   - No pending-write filtering (GroceryIngredientStore has no pending-writes)
   - No `sync:complete` event emitted for ingredients (reference entity, not a content entity)
   - Logs orphan count when > 0

7. **MealType sync (replace-all, no pending-writes):**
   - Fetches `client.listMealTypes()`, removes orphan cached entries, loads into `mealTypeStore`, writes to cache
   - No pending-write filtering (reference catalog like aisles). No `sync:complete` event.

8. **Meal sync (replace-all with orphan cleanup, pending-writes filtered):**
   - Delegated to `syncReplaceAllEntity({ ..., fetch: client.listMeals, store: mealStore, equals: mealsEqual })`.
   - `mealsEqual()` compares all 10 fields.
   - No `sync:complete` event (meals have no MCP resource surface).

8.5. **Menu + MenuItem sync (replace-all, pending-writes filtered, best-effort):**

- Both delegated to `syncReplaceAllEntity` and wrapped in a single best-effort `try/catch` (like the meal block) so a menu-sync failure cannot abort grocery/recipe sync.
- Menu sync: `fetch: client.listMenus`, `store: menuStore`, `equals: menusEqual` (compares `uid`/`name`/`days`/`orderFlag`/`notes`/`deleted`), `afterLoad: () => menuStore.setLastSyncedAt()`.
- MenuItem sync: `fetch: client.listMenuItems`, `store: menuItemStore`, `equals: menuItemsEqual` (compares all 8 fields), no `afterLoad`.
- **Both emit `sync:complete`** (`MenuSyncResult` and `MenuItemSyncResult`). Menus are the `paprika://menu/{uid}` resource, and menuitems are inlined in that resource — so a menuitem change must trigger a resource-list notification for the parent menu, exactly as grocery-item changes trigger grocery-list resource notifications.

9. **Finalization:**
   - Flushes cache once: `await cache.flush()`
   - **Sweeps expired pending-writes:** `store.sweepPending()`, `pantryStore.sweepPending()`, `aisleStore.sweepPending()`, `groceryListStore.sweepPending()`, `groceryItemStore.sweepPending()`, `mealStore.sweepPending()`, `mealTypeStore.sweepPending()` — TTL fallback for pending-deletes. `groceryIngredientStore` is NOT swept (no pending-writes).
   - Emits **four** `sync:complete` events per cycle: `RecipeSyncResult` (`changeType: "recipes"`), `PantrySyncResult` (`changeType: "pantry"`), `GroceryListSyncResult` (`changeType: "grocery-lists"`), `GroceryItemSyncResult` (`changeType: "grocery-items"`). All four are emitted even for no-change cycles. The engine does **not** call the notifier — a subscriber in `buildAppContext` does.
   - Logs success: `this.log.info({added, updated, removed}, "sync complete")` — record fans out to connected MCP clients only when `notifyLevel` is `"info"` or lower (default `"warn"` suppresses it; see behavior note below)

10. **Error handling (all wrapped in try/catch):**

- Catches any thrown error (API failures, cache errors, store errors)
- Logs error: `this.log.error({err}, "sync failed")` — fans out to connected MCP clients automatically via the multistream (error ≥ default `notifyLevel: "warn"`)
- Emits `sync:error` with the Error
- Never re-throws — returns normally

**Invariants:**

- `syncOnce()` never throws — errors are caught, logged, and emitted as events
- `start()` when already running is a no-op (no duplicate loops via `_ac` check)
- `stop()` when not running is a no-op (no-op if `_ac` is null)
- `syncOnce()` does **not** call `notifier.resourceListChanged()` — a `sync:complete` subscriber in `buildAppContext` drives notifications. Recipe changes are detectable via `RecipeSyncResult.changes` (filtered by pending-writes, hash-based: `filteredAdded`, `filteredChanged`, `filteredRemoved`); pantry changes via `PantrySyncResult.changes`; grocery-list changes via `GroceryListSyncResult.changes`; grocery-item changes via `GroceryItemSyncResult.changes`.
- Cache is flushed exactly once per cycle (single `await cache.flush()` after all mutations)
- Removed recipes are deleted concurrently via `Promise.all()` for efficiency
- Orphaned pantry, grocery list, grocery item, and ingredient entries are deleted concurrently via `Promise.all()` for efficiency
- Loop respects AbortController signal and cleanly exits on `stop()`
- `pantryStore.load(items)` is called unconditionally even when `effectivePantry` is empty, setting `hasSynced = true` after first sync
- Seven stores' `sweepPending()` runs every cycle (store, pantryStore, aisleStore, groceryListStore, groceryItemStore, mealStore, mealTypeStore). `groceryIngredientStore` is NOT swept (no pending-writes). Observation-based clearing handles upserts; TTL sweep is the only clearing mechanism for pending-deletes.
- No `sync:complete` event is emitted for the ingredient catalog, meal types, or meals (reference/non-resource entities)

**Dependencies:**

- **Uses:** `AppContext` (client, cache, store, pantryStore, aisleStore, groceryListStore, groceryItemStore, groceryIngredientStore, mealStore, mealTypeStore — `server` and `notifier` are intentionally absent; notifier is used via subscriber pattern only), `mitt` (event emitter), `node:timers/promises` (scheduler.wait), `./types.js` (Recipe, RecipeUid, Meal, GroceryList, GroceryItem, AnySyncResult, RecipeSyncResult, PantrySyncResult, GroceryListSyncResult, GroceryItemSyncResult, DiffResult)
- **Used by:** `src/server/build.ts` (`buildAppContext` constructs SyncEngine), `src/features/discover-feature.ts` (subscribes to `sync.events` for incremental re-indexing)
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`

### Sync-engine logging

`SyncEngine` uses a pino child logger (`component: "sync"`) for all sync events. Progress messages (recipe diff counts, fetch counts, pantry counts, flush, sweep) emit at `debug` level. The `sync complete` record emits at `info` with `{added, updated, removed}` fields; `sync failed` emits at `error` with `{err}`.

The previous `_log` static method is removed. All sync events emit pino records routed through the multistream fan-out (see `src/utils/CLAUDE.md`) — no direct `notifier.loggingMessage(...)` calls remain in the sync engine.

#### Sync-success notifications: behavior change

Prior to this migration, every successful sync emitted `notifications/message` at level `info` to all connected MCP clients. The structured-logging design routes sync-success to a pino `info` record, which by default does NOT fan out (`notifyLevel: "warn"`). Connected Claude sessions will no longer see periodic "sync complete" notifications. Operators or workflows that depend on these can opt back in by setting `MCP_LOG_NOTIFY_LEVEL=info`. Sync-failure notifications (`error`-level) are unaffected and continue to fan out by default.

## Dependencies

- **Uses:** `zod` (validation), `cockatiel` (resilience), `type-fest` (type utilities)
- **Used by:** `features/`, `tools/`, `resources/`
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`
