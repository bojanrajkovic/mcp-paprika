# PaprikaClient Write Operations Design

## Summary

This unit adds write operations to `PaprikaClient`, the typed HTTP client that communicates with the Paprika Cloud Sync API. Three public methods are introduced: `saveRecipe` to persist a recipe, `deleteRecipe` to soft-delete one via a trash flag, and `notifySync` to propagate changes to other Paprika clients. A private helper, `buildRecipeFormData`, and a module-level pure function, `recipeToApiPayload`, handle the serialization pipeline that the new write methods depend on.

The central challenge is the encoding contract the API requires: recipe data must be submitted as gzip-compressed JSON in snake_case field naming inside a `multipart/form-data` body, whereas the rest of the codebase works entirely in camelCase. The implementation mirrors the existing `RecipeSchema` transform in reverse — `recipeToApiPayload` enumerates all 28 `Recipe` fields explicitly, converting each to its API equivalent, then `buildRecipeFormData` JSON-stringifies and compresses the result using Node's built-in `gzipSync`. All three public methods route through the existing `request<T>()` helper, so retry, circuit breaker, and re-authentication behaviour are inherited for free.

## Definition of Done

- `saveRecipe(recipe: Recipe): Promise<Recipe>` — gzip-compresses the recipe as snake_case JSON in a FormData body, POSTs to `/api/v2/sync/recipe/{uid}/`, returns the server response as a camelCase `Recipe`
- `deleteRecipe(uid: RecipeUid): Promise<void>` — fetches the current recipe, sets `inTrash: true`, calls `saveRecipe()`, then `notifySync()`
- `notifySync(): Promise<void>` — POSTs to `/api/v2/sync/notify/` to propagate changes to other Paprika clients
- Private `buildRecipeFormData(recipe: Recipe): FormData` — handles the camelCase→snake_case conversion and gzip encoding
- TypeScript compiles clean, all methods tested with MSW

## Acceptance Criteria

### p1-u07-client-writes.AC1: saveRecipe encodes and POSTs correctly

- **p1-u07-client-writes.AC1.1 Success:** POST sent to `/api/v2/sync/recipe/{uid}/` where uid matches the recipe's uid field
- **p1-u07-client-writes.AC1.2 Success:** FormData `data` field decompresses (gunzip) to valid JSON with snake_case keys (e.g., `prep_time`, `on_favorites`, `in_trash`)
- **p1-u07-client-writes.AC1.3 Success:** All 28 Recipe fields are present in the decompressed payload — no fields dropped
- **p1-u07-client-writes.AC1.4 Success:** Server response deserialized and returned as a camelCase `Recipe`
- **p1-u07-client-writes.AC1.5 Failure:** Non-2xx response from POST throws `PaprikaAPIError`

### p1-u07-client-writes.AC2: deleteRecipe soft-deletes via trash flag

- **p1-u07-client-writes.AC2.1 Success:** GETs current recipe, then POSTs back with `in_trash: true` in the payload
- **p1-u07-client-writes.AC2.2 Success:** After saveRecipe, POSTs to `/api/v2/sync/notify/` (notifySync is called)
- **p1-u07-client-writes.AC2.3 Failure:** 404 from `getRecipe` throws `PaprikaAPIError` with no subsequent POST

### p1-u07-client-writes.AC3: notifySync propagates changes

- **p1-u07-client-writes.AC3.1 Success:** POSTs to `/api/v2/sync/notify/`
- **p1-u07-client-writes.AC3.2 Success:** Returns void (Promise resolves with no value)

### p1-u07-client-writes.AC4: TypeScript hygiene

- **p1-u07-client-writes.AC4.1:** `pnpm typecheck` exits 0 with no suppressions added
- **p1-u07-client-writes.AC4.2:** All three public methods have explicit return type annotations

## Glossary

- **camelCase / snake_case**: Two conventions for writing multi-word identifiers. `camelCase` capitalises each word after the first (`prepTime`); `snake_case` separates words with underscores (`prep_time`). The Paprika API uses snake_case on the wire; the TypeScript codebase uses camelCase internally. The write path must convert from the latter to the former before sending.
- **FormData**: A browser/Node.js API for constructing `multipart/form-data` request bodies, typically used for HTML form submissions. The Paprika API expects recipe payloads delivered as a FormData field named `"data"`.
- **gzip / gzipSync**: A compression algorithm. `gzipSync` is Node.js's synchronous variant from the built-in `node:zlib` module. The Paprika API requires the JSON payload to be gzip-compressed before it is placed in the FormData body.
- **soft delete**: A deletion pattern that marks a record as deleted (here via `inTrash: true`) rather than removing it from the server. The record is preserved server-side and filtered out by clients that honour the flag.
- **MSW (Mock Service Worker)**: A library for intercepting HTTP requests in tests by installing a service-worker-style handler. Used here via `msw/node` to intercept `fetch` calls made by `PaprikaClient` without hitting the real API.
- **Zod / `z.unknown()`**: A TypeScript-first schema validation library. `z.unknown()` is a permissive schema that accepts any value; it is used for `notifySync` because the API response (`{ "result": {} }`) carries no meaningful payload and the result is discarded.
- **Cockatiel**: The resilience library used by `request<T>()`. Provides retry, circuit breaker, and bulkhead policies. All three new public methods inherit these policies because they route through the existing `request<T>()` helper.
- **Circuit breaker**: A resilience pattern (implemented here by Cockatiel) that stops sending requests to a failing service after a threshold of consecutive failures and resumes after a cooldown period. Here configured for 5 consecutive failures and a 30-second half-open window.
- **Bulkhead**: A Cockatiel concurrency-limiting policy that caps how many requests run in parallel. Used by existing read methods; the new write methods do not add their own bulkhead.
- **`RecipeUid` (branded type)**: A TypeScript string type augmented with a compile-time brand so that arbitrary strings cannot be passed where a recipe UID is expected without an explicit validation step via `RecipeUidSchema`.
- **Wire format**: The serialised representation of data as it travels over the network, as opposed to the in-memory representation used by application code. The Paprika wire format is snake_case JSON, optionally gzip-compressed.
- **Envelope / `{ result: T }`**: The JSON wrapper the Paprika API places around every response body. `request<T>()` unwraps it automatically; callers receive only the inner value.
- **`notifySync`**: A Paprika-specific endpoint (`/api/v2/sync/notify/`) that signals to Paprika's server infrastructure that a change has occurred, causing other connected clients to pull the update.

## Architecture

Three new public methods and one private helper extend `PaprikaClient` in `src/paprika/client.ts`.

**Write path data flow for `saveRecipe`:**

```
Recipe (camelCase)
  → recipeToApiPayload()    module-level pure fn: explicit 28-field mapping
  → JSON.stringify()
  → gzipSync()              node:zlib built-in, synchronous
  → new Blob([compressed])  Node 24 global
  → FormData field "data"   filename "data.gz"
  → request("POST", ...)    existing resilience pipeline
  → RecipeSchema.parse()    server response → camelCase Recipe
```

**Delete path data flow for `deleteRecipe`:**

```
uid
  → getRecipe(uid)          existing read method
  → { ...recipe, inTrash: true }
  → saveRecipe(trashed)     write path above
  → notifySync()            propagation POST
```

**`notifySync`** POSTs to `/api/v2/sync/notify/` using `request("POST", ..., z.unknown())`. The API returns `{ "result": {} }`; the result is discarded and the method returns void.

All three public methods go through the existing `request<T>()` helper, inheriting retry (429, 500–503), circuit breaker (5 consecutive failures), and 401 re-auth retry at no extra cost.

**Contracts:**

```typescript
// Public additions to PaprikaClient
async saveRecipe(recipe: Recipe): Promise<Recipe>
async deleteRecipe(uid: RecipeUid): Promise<void>
async notifySync(): Promise<void>

// Private
private buildRecipeFormData(recipe: Recipe): FormData

// Module-level pure function (not exported)
function recipeToApiPayload(recipe: Recipe): Record<string, unknown>
```

## Existing Patterns

Investigation found that `RecipeSchema` in `src/paprika/types.ts` already implements the camelCase↔snake_case mapping explicitly — all 28 fields are listed by name in a `.transform()` call. The `recipeToApiPayload` function mirrors this pattern in reverse: same 28 fields, same explicit enumeration, no generics or reflection.

`request<T>()` already accepts `body?: FormData | URLSearchParams` — the FormData path is declared but unused by the read methods. `saveRecipe` and `notifySync` use it without modifying the signature.

Tests for `PaprikaClient` live in `src/paprika/client.test.ts` and use MSW (`msw/node`) to intercept `fetch`. The write-path tests follow the same structure: `setupServer(http.post(...))` handler, call method, assert. The encoding-correctness test is novel: it reads the intercepted FormData body, calls `gunzipSync` on the `data` blob, and asserts the resulting JSON has snake_case field names.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Encoding pipeline and `saveRecipe`

**Goal:** A recipe can be serialized to gzip-compressed snake_case FormData and POSTed to the Paprika API, with the server response parsed back as a camelCase `Recipe`.

**Components:**

- `recipeToApiPayload()` module-level function in `src/paprika/client.ts` — maps all 28 `Recipe` fields to their snake_case API equivalents
- `buildRecipeFormData()` private method in `PaprikaClient` — calls `recipeToApiPayload`, JSON-stringifies, `gzipSync`s, wraps in `FormData` with field name `"data"` and filename `"data.gz"`
- `saveRecipe()` public method — calls `buildRecipeFormData`, passes result to `request("POST", ...)` with `RecipeSchema` for response parsing
- Tests in `src/paprika/client.test.ts`:
  - Happy path: POST lands on correct URL, response decoded as camelCase `Recipe`
  - Encoding correctness: intercept FormData, `gunzipSync` the `data` blob, assert resulting JSON has snake_case keys (e.g., `prep_time` not `prepTime`)
  - API error propagation: non-2xx → `PaprikaAPIError`

**Dependencies:** None (extends existing `PaprikaClient` and `request<T>()`)

**Done when:** `saveRecipe` tests pass covering ACs 1.1–1.5; `pnpm typecheck` exits 0

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: `notifySync` and `deleteRecipe`

**Goal:** Sync propagation and soft-delete are implemented and tested.

**Components:**

- `notifySync()` public method in `PaprikaClient` — POSTs to `/api/v2/sync/notify/` with `z.unknown()` schema, returns void
- `deleteRecipe()` public method — calls `getRecipe(uid)`, spreads with `inTrash: true`, calls `saveRecipe`, then `notifySync`
- Tests in `src/paprika/client.test.ts`:
  - `notifySync` happy path: POST to `/notify/` resolves void
  - `deleteRecipe` happy path: GET recipe → POST with `in_trash: true` → POST to `/notify/`
  - `deleteRecipe` with missing recipe: `getRecipe` 404 → `PaprikaAPIError`, no further requests

**Dependencies:** Phase 1 (`saveRecipe`, `getRecipe`)

**Done when:** All Phase 2 tests pass covering ACs 2.1–2.3, 3.1–3.2, and 4.1–4.2

<!-- END_PHASE_2 -->
