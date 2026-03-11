# PaprikaClient Read Operations Design

## Summary

`PaprikaClient` currently handles authentication and the low-level `request<T>()` helper but exposes no data-access methods. This unit adds four public read methods — `listRecipes()`, `getRecipe()`, `getRecipes()`, and `listCategories()` — all of which delegate to the existing helper, letting it continue to own auth, retry, circuit breaking, envelope unwrapping, and Zod validation. It also removes the `@ts-expect-error` and `eslint-disable` stubs that were left as placeholders in P1-U05 because `API_BASE` and `request` had no callers yet.

The more complex additions are the two batch methods. `getRecipes()` fans out to `getRecipe()` in parallel; `listCategories()` first fetches a lightweight entry list, then fans out to per-category hydration requests. Each batch method is independently gated by a Cockatiel `bulkhead(5)` semaphore, so at most five requests run at a time per method. The two bulkheads are separate instances so a large recipe fetch cannot block category hydration when both run concurrently during a future sync pass. Both methods use `Promise.all`, meaning a single failure rejects the entire batch — error isolation is a concern for the sync engine, not the client.

## Definition of Done

`PaprikaClient` gains four public read methods — `listRecipes()`, `getRecipe(uid)`, `getRecipes(uids)`, and `listCategories()` — each delegating to the existing private `request<T>()` helper with appropriate Zod schemas for response validation. Concurrency is managed via Cockatiel `bulkhead(5)` as a true semaphore: `getRecipes()` and `listCategories()` each hold their own independent bulkhead instance so they cannot starve each other when the sync engine runs both concurrently. The P1-U05 `@ts-expect-error` stubs for `API_BASE` and `request` are removed. Tests cover all four methods using msw HTTP mocking. Write operations (P1-U07) and sync orchestration (P2-U11) are out of scope.

## Acceptance Criteria

### p1-u06-client-reads.AC1: listRecipes() returns a recipe entry list

- **p1-u06-client-reads.AC1.1 Success:** Returns `RecipeEntry[]` where each entry has `uid: RecipeUid` and `hash: string`, fetched from `/api/v2/sync/recipes/`
- **p1-u06-client-reads.AC1.2 Edge:** Returns `[]` when the API returns an empty result array

### p1-u06-client-reads.AC2: getRecipe() returns a full recipe by UID

- **p1-u06-client-reads.AC2.1 Success:** Returns a `Recipe` object with all fields in camelCase, fetched from `/api/v2/sync/recipe/{uid}/`
- **p1-u06-client-reads.AC2.2 Failure:** A non-2xx response propagates as `PaprikaAPIError`

### p1-u06-client-reads.AC3: getRecipes() fetches multiple recipes with concurrency limiting

- **p1-u06-client-reads.AC3.1 Success:** Returns `Recipe[]` with one entry per provided UID, in the same order
- **p1-u06-client-reads.AC3.2 Edge:** `getRecipes([])` returns `[]` with zero HTTP requests made
- **p1-u06-client-reads.AC3.3 Concurrency:** At most 5 `getRecipe()` calls execute simultaneously (bulkhead cap)
- **p1-u06-client-reads.AC3.4 Failure:** A single recipe fetch error causes the entire `getRecipes()` call to reject

### p1-u06-client-reads.AC4: listCategories() returns hydrated Category objects

- **p1-u06-client-reads.AC4.1 Success:** Returns `Category[]` with all fields in camelCase (not raw `CategoryEntry[]`)
- **p1-u06-client-reads.AC4.2 Step:** Makes exactly one request to `/api/v2/sync/categories/` then N requests to `/api/v2/sync/category/{uid}/`
- **p1-u06-client-reads.AC4.3 Edge:** Returns `[]` when `/categories/` returns an empty list, with no hydration requests made
- **p1-u06-client-reads.AC4.4 Concurrency:** At most 5 hydration requests execute simultaneously, independently of the recipe bulkhead

### p1-u06-client-reads.AC5: P1-U05 suppression stubs are removed

- **p1-u06-client-reads.AC5.1:** The `@ts-expect-error` and `eslint-disable` comments on `API_BASE` are removed
- **p1-u06-client-reads.AC5.2:** The `@ts-expect-error` comment on `request()` is removed
- **p1-u06-client-reads.AC5.3:** TypeScript compiles with no errors after the changes

## Glossary

- **PaprikaClient**: The TypeScript class in `src/paprika/client.ts` that wraps all HTTP communication with the Paprika Cloud Sync API. Handles authentication, resilience policies, and response parsing.
- **Paprika Cloud Sync API**: The remote HTTP API exposed by Paprika Recipe Manager (at `paprikaapp.com/api/v2/sync`) for syncing recipes and categories across devices.
- **`request<T>()`**: Private method on `PaprikaClient` that executes an authenticated HTTP request, applies retry and circuit-breaker policies, unwraps the `{ result: T }` response envelope, and validates the inner value against a Zod schema.
- **RecipeEntry / CategoryEntry**: Lightweight summary objects returned by the Paprika list endpoints (`/recipes/`, `/categories/`). Each contains only a `uid` and a `hash`; the full object must be fetched separately.
- **Recipe / Category**: Fully hydrated domain objects (28 fields for `Recipe`, 4 for `Category`) returned by the per-item endpoints. Fields are camelCase after Zod transform.
- **hydration**: The two-step pattern where a list endpoint first returns entry summaries, then each entry is individually fetched to obtain the full object. Used by `listCategories()`.
- **Zod schema**: A runtime validator defined with the [Zod](https://zod.dev) library. Schemas in this codebase also carry a `.transform()` step that converts the API's snake_case field names to camelCase TypeScript properties.
- **snake_case / camelCase**: Naming conventions. The Paprika API returns JSON with underscore-separated names (e.g., `prep_time`); TypeScript convention uses camelCase (e.g., `prepTime`). Zod transforms bridge the two at the boundary.
- **Cockatiel**: A resilience library for Node.js providing composable policies including `retry`, `circuitBreaker`, `wrap`, and `bulkhead`.
- **bulkhead**: A Cockatiel policy that limits how many concurrent executions of a wrapped function are allowed at once, acting as a semaphore. Excess calls queue rather than fail (when the queue limit is `Number.MAX_SAFE_INTEGER`).
- **semaphore**: A concurrency primitive that limits the number of operations executing simultaneously. Here, `bulkhead(5)` acts as a semaphore with a capacity of 5.
- **circuit breaker**: A Cockatiel policy that stops making requests to a failing service after a threshold of consecutive failures, then probes again after a cooldown. Prevents cascading failures.
- **`Promise.all`**: A JavaScript built-in that runs multiple promises concurrently and resolves when all succeed, or rejects immediately when any one fails. Used here to fan out batch requests.
- **MSW (Mock Service Worker)**: A test-layer HTTP mocking library that intercepts `fetch` calls at the network level. Used in tests via `setupServer()`, `server.use(http.get(...))`, and `HttpResponse.json(...)`.
- **`@ts-expect-error`**: A TypeScript comment directive that suppresses a type error on the next line. Used in P1-U05 to silence "unused variable" errors on `API_BASE` and `request` until this unit adds callers.
- **branded type**: A TypeScript pattern where a primitive (e.g., `string`) is tagged with a compile-time marker to prevent accidental mixing of values that have the same runtime type but different semantic meanings. `RecipeUid` and `CategoryUid` are branded strings.
- **`P1-U05` / `P1-U06` / `P1-U07` / `P2-U11`**: Work-unit identifiers used in this project to track implementation phases. P1 = Phase 1, P2 = Phase 2; U05/U06 etc. are sequential unit numbers within each phase.
- **sync engine**: The future orchestration component (P2-U11) that will call the client's read methods concurrently to reconcile local cache state with the remote API. Out of scope for this unit.
- **response envelope**: The Paprika API wraps every response body as `{ "result": <payload> }`. `request<T>()` unwraps this before returning, so callers receive the inner value directly.

## Architecture

Four public read methods are added to the existing `PaprikaClient` class in `src/paprika/client.ts`. Each method delegates to the existing private `request<T>(method, url, schema)` helper, which handles auth headers, retry, circuit breaking, response envelope unwrapping (`{ result: T }`), and Zod validation.

Two independent Cockatiel `bulkhead` policies are added as private instance fields:

```typescript
private readonly _recipesBulkhead = bulkhead(5, Number.MAX_SAFE_INTEGER);
private readonly _categoriesBulkhead = bulkhead(5, Number.MAX_SAFE_INTEGER);
```

The `Number.MAX_SAFE_INTEGER` queue means the bulkhead never rejects — all calls queue and drain as slots free. The two pools are independent so a large recipe batch cannot starve category hydration when both run concurrently in the sync engine.

**Public API additions:**

```typescript
async listRecipes(): Promise<RecipeEntry[]>
async getRecipe(uid: string): Promise<Recipe>
async getRecipes(uids: string[]): Promise<Recipe[]>
async listCategories(): Promise<Category[]>
```

**URL table** (all trailing slashes required):

| Method                          | URL                            |
| ------------------------------- | ------------------------------ |
| `listRecipes()`                 | `${API_BASE}/recipes/`         |
| `getRecipe(uid)`                | `${API_BASE}/recipe/${uid}/`   |
| `listCategories()` — entry list | `${API_BASE}/categories/`      |
| `listCategories()` — hydration  | `${API_BASE}/category/${uid}/` |

**Schema-to-method mapping:**

| Method                          | Schema passed to `request<T>()` |
| ------------------------------- | ------------------------------- |
| `listRecipes()`                 | `z.array(RecipeEntrySchema)`    |
| `getRecipe(uid)`                | `RecipeSchema`                  |
| `getRecipes(uids)`              | delegates to `getRecipe()`      |
| `listCategories()` — entry list | `z.array(CategoryEntrySchema)`  |
| `listCategories()` — hydration  | `CategorySchema`                |

`getRecipes()` wraps each `getRecipe()` call with `_recipesBulkhead.execute()`. `listCategories()` wraps each hydration `request()` call with `_categoriesBulkhead.execute()`.

Batch failure semantics: `Promise.all` is used throughout, so a single failing request rejects the entire batch. Error isolation belongs in the sync engine (P2-U11), not the client.

## Existing Patterns

`src/paprika/client.ts` (P1-U05) established the patterns this unit extends:

- **Cockatiel policies** for resilience: `retry`, `circuitBreaker`, and `wrap()` already imported and used. `bulkhead` is added from the same package.
- **Zod schemas** from `./types.js` for response validation inside `request<T>()`. This unit imports `RecipeEntrySchema`, `RecipeSchema`, `CategoryEntrySchema`, `CategorySchema`.
- **`@ts-expect-error` / `eslint-disable` stubs** were placed on `API_BASE` and `request` in P1-U05 because they had no callers yet. This unit removes both stubs.

Test patterns follow `src/paprika/client.test.ts` (P1-U05):

- MSW v2: `setupServer()` module-scoped, `server.listen()` in `beforeAll`, `server.resetHandlers()` in `afterEach`, `server.close()` in `afterAll`
- Handlers registered per-test via `server.use(http.get(...))` / `server.use(http.post(...))`
- Responses built with `HttpResponse.json({ result: ... })`

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Simple read methods and stub cleanup

**Goal:** Add `listRecipes()` and `getRecipe()`, remove the P1-U05 suppression stubs, and establish the test infrastructure for read methods.

**Components:**

- `src/paprika/client.ts` — remove `@ts-expect-error` and `eslint-disable` comments on `API_BASE` and `request`; import `RecipeEntrySchema` and `RecipeSchema` from `./types.js`; add `listRecipes()` and `getRecipe()` methods
- `src/paprika/client.test.ts` — extend existing test file with tests for `listRecipes()` (happy path, empty result) and `getRecipe()` (happy path, non-2xx error propagation)

**Dependencies:** P1-U05 (existing `PaprikaClient` with `request<T>()` and `authenticate()`)

**Done when:** `listRecipes()` and `getRecipe()` pass their tests; TypeScript compiles with no errors; no suppression comments remain on `API_BASE` or `request`

**Acceptance criteria covered:** p1-u06-client-reads.AC1, p1-u06-client-reads.AC2, p1-u06-client-reads.AC5

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: Concurrent batch methods with bulkhead limiting

**Goal:** Add `getRecipes()` and `listCategories()` with independent Cockatiel bulkhead semaphores and verify concurrency behavior.

**Components:**

- `src/paprika/client.ts` — import `bulkhead` from `cockatiel`; import `CategoryEntrySchema` and `CategorySchema` from `./types.js`; add `_recipesBulkhead` and `_categoriesBulkhead` private instance fields; add `getRecipes()` and `listCategories()` methods
- `src/paprika/client.test.ts` — extend with tests for `getRecipes()` (empty input, batch return, concurrency cap, single failure propagation) and `listCategories()` (empty input, two-step fetch, camelCase output, concurrency cap)

**Dependencies:** Phase 1 (provides `getRecipe()` which `getRecipes()` delegates to)

**Done when:** All `getRecipes()` and `listCategories()` tests pass; concurrency test confirms ≤5 simultaneous in-flight requests per method; `listCategories()` test confirms its bulkhead is independent from the recipes bulkhead

**Acceptance criteria covered:** p1-u06-client-reads.AC3, p1-u06-client-reads.AC4

<!-- END_PHASE_2 -->

## Additional Considerations

**Trailing slashes:** All Paprika API URLs require trailing slashes. The Paprika API redirects or errors without them. This is enforced by the URL constants in the implementation; there is no runtime check.

**`BulkheadRejectedError`:** With `Number.MAX_SAFE_INTEGER` as the queue limit, this error cannot occur in practice. No catch is needed in the read methods. If it somehow fires, it propagates as an unexpected error to the caller — correct behavior.

**`getRecipe()` called directly:** `getRecipe(uid)` is a public method. When called directly (not via `getRecipes()`), it bypasses the bulkhead. This is intentional — the concurrency limit applies to batch operations, not individual calls.
