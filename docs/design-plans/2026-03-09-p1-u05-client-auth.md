# Paprika Client Auth & Request Helper Design

## Summary

`PaprikaClient` is a typed HTTP client for the Paprika Cloud Sync API. It encapsulates two responsibilities: authenticating a user against the v1 login endpoint to obtain a JWT token, and executing resilient authenticated requests against the v2 data endpoint. The class is intentionally narrow — it provides no recipe or category read/write methods, which are deferred to subsequent units (P1-U06, P1-U07). Its only public surface is `authenticate()` and a private `request<T>()` helper that the future data-access methods will rely on.

The implementation follows a layered resilience strategy. Transient server-side failures (rate limits, server errors) are handled transparently by a cockatiel retry-plus-circuit-breaker policy that is shared across all client instances, reflecting API health globally. Token expiry is handled separately: a 401 response triggers a single re-authentication attempt before the request is retried. All responses — both auth and data — are validated at the boundary with Zod schemas, so callers receive well-typed values and never need to defensively re-check the shape of API data.

## Definition of Done

1. **New file `src/paprika/client.ts`** — `PaprikaClient` class with public `authenticate()` and private `request<T>()`, throwing `PaprikaAuthError`/`PaprikaAPIError` at system boundary
2. **Auth**: form-encoded POST to Paprika v1 login endpoint, stores JWT token
3. **Request helper**: Bearer token header, single 401 retry via re-auth, unwraps `{ result: T }` envelope
4. **Tests in `src/paprika/client.test.ts`** using **msw** for HTTP interception, covering all 11 acceptance criteria (>=70% coverage)
5. **msw added as dev dependency** (`pnpm add -D msw`)
6. **CLAUDE.md** for paprika module updated with client.ts contract
7. **No read/write methods** — those come in P1-U06/P1-U07

## Acceptance Criteria

### p1-u05-client-auth.AC1: Authentication works correctly

- **p1-u05-client-auth.AC1.1 Success:** `authenticate()` POSTs form-encoded `email` and `password` to `https://paprikaapp.com/api/v1/account/login/`
- **p1-u05-client-auth.AC1.2 Success:** Successful auth stores token from `response.result.token` in private field
- **p1-u05-client-auth.AC1.3 Success:** Response is validated with `AuthResponseSchema.parse()` (Zod runtime validation)
- **p1-u05-client-auth.AC1.4 Failure:** Non-2xx response throws `PaprikaAuthError` with HTTP status in message
- **p1-u05-client-auth.AC1.5 Failure:** Malformed response (missing `result.token`) throws `ZodError`

### p1-u05-client-auth.AC2: Request helper adds auth and unwraps envelope

- **p1-u05-client-auth.AC2.1 Success:** `request<T>()` includes `Authorization: Bearer {token}` header when token exists
- **p1-u05-client-auth.AC2.2 Success:** Response envelope `{ result: T }` is unwrapped and inner value validated against caller's `ZodType<T>` schema
- **p1-u05-client-auth.AC2.3 Success:** `request<T>()` is `private` — not accessible from outside the class
- **p1-u05-client-auth.AC2.4 Failure:** Non-401 error status throws `PaprikaAPIError` with status and endpoint

### p1-u05-client-auth.AC3: 401 re-auth retry

- **p1-u05-client-auth.AC3.1 Success:** On 401 with existing token, `authenticate()` is called to refresh, then request retried
- **p1-u05-client-auth.AC3.2 Failure:** If retry also returns 401, `PaprikaAuthError` is thrown
- **p1-u05-client-auth.AC3.3 Edge:** No retry attempted when `this.token` is null (prevents infinite loop)

### p1-u05-client-auth.AC4: Cockatiel resilience for transient failures

- **p1-u05-client-auth.AC4.1 Success:** Status codes 429, 500, 502, 503 are retried with exponential backoff
- **p1-u05-client-auth.AC4.2 Success:** Circuit breaker opens after 5 consecutive failures, subsequent calls fail immediately with `PaprikaAPIError`
- **p1-u05-client-auth.AC4.3 Edge:** Non-retryable status codes (e.g., 400, 403, 404) are not retried

### p1-u05-client-auth.AC5: Construction and module structure

- **p1-u05-client-auth.AC5.1 Success:** `new PaprikaClient(email, password)` does not throw
- **p1-u05-client-auth.AC5.2 Success:** `PaprikaClient` is exported from `src/paprika/client.ts`
- **p1-u05-client-auth.AC5.3 Success:** Module CLAUDE.md documents client.ts contract

## Glossary

- **Paprika Cloud Sync API**: The remote HTTP API operated by Paprika Recipe Manager that stores and synchronises recipe data. It exposes a v1 endpoint for authentication and a v2 endpoint for recipe and category data.
- **JWT (JSON Web Token)**: A compact, URL-safe token format used here as the bearer credential returned by the Paprika login endpoint and sent with every subsequent API request.
- **Bearer token**: An authorization scheme where the HTTP `Authorization` header is set to `Bearer <token>`. Possession of the token is sufficient proof of identity.
- **URLSearchParams / form-encoded body**: A standard web API that serialises key-value pairs as `application/x-www-form-urlencoded`. Paprika's login endpoint requires this format instead of JSON.
- **Response envelope**: The outer JSON wrapper `{ result: T }` that Paprika wraps all v2 API responses in. The `request<T>()` helper unwraps this and returns the inner value directly to callers.
- **Zod**: A TypeScript-first schema declaration and validation library used to parse and validate API responses at runtime.
- **ZodType\<T\>**: The generic Zod base type representing any schema that validates and produces a value of type `T`. Passed as a parameter to `request<T>()` for runtime validation.
- **cockatiel**: A TypeScript resilience library providing composable policies (retry, circuit breaker, timeout) for wrapping async operations. Zero transitive dependencies.
- **Exponential backoff**: A retry delay strategy where the wait time grows exponentially with each attempt (e.g. 500ms, 1s, 2s) up to a configured ceiling.
- **Decorrelated jitter**: Randomness added to backoff delays, computed independently of the previous delay, preventing multiple clients from synchronising their retries.
- **Circuit breaker**: A resilience pattern that stops sending requests to a failing dependency after a threshold of consecutive errors. After a half-open interval it allows a probe request; if it succeeds the circuit closes again.
- **BrokenCircuitError**: The exception cockatiel throws when a call is attempted while the circuit breaker is open. Mapped to `PaprikaAPIError` at the client boundary.
- **401 re-auth retry**: A separate, non-cockatiel retry path for token expiry. On receiving HTTP 401, the client calls `authenticate()` once then replays the original request.
- **msw (Mock Service Worker)**: A library for intercepting HTTP requests at the network level in tests, without patching `fetch`. Used via its Node.js adapter (`msw/node.js`).
- **Imperative shell**: Architectural term for code that orchestrates I/O (HTTP calls, token storage), as opposed to the functional core (pure logic, schemas, error types).
- **Module-level policy**: A cockatiel policy instantiated once at module load time and shared across all `PaprikaClient` instances, so circuit breaker state reflects aggregate API health.

## Architecture

PaprikaClient is an imperative shell HTTP client wrapping the Paprika Cloud Sync API. It lives at `src/paprika/client.ts` and handles two concerns: authentication against the v1 endpoint and resilient request execution against the v2 endpoint.

Two API base URLs encode the Paprika API's version split:

- `AUTH_URL = 'https://paprikaapp.com/api/v1/account/login/'` (auth only, form-encoded)
- `API_BASE = 'https://paprikaapp.com/api/v2/sync'` (all data, JSON)

### Class Contract

```typescript
export class PaprikaClient {
  constructor(email: string, password: string);
  authenticate(): Promise<void>;
  private request<T>(
    method: "GET" | "POST",
    url: string,
    schema: ZodType<T>,
    body?: FormData | URLSearchParams,
  ): Promise<T>;
}
```

The constructor stores credentials as `private readonly` fields. `token` is `private`, initially `null`, set by `authenticate()`.

### Authentication

`authenticate()` POSTs to `AUTH_URL` with `new URLSearchParams({ email, password })` as the body. `URLSearchParams` automatically sets `Content-Type: application/x-www-form-urlencoded` — manual Content-Type is prohibited. The response is validated with `AuthResponseSchema.parse()` (Zod runtime validation, not type assertion). On success, `data.result.token` is stored in `this.token`. On HTTP failure, `PaprikaAuthError` is thrown. On malformed response, `ZodError` propagates.

### Request Helper

`request<T>()` is the single point for all v2 API calls. It takes a `ZodType<T>` schema parameter and validates every response at runtime.

**Resilience (cockatiel):** A module-level composed policy handles transient failures:

- Retry: max 3 attempts, exponential backoff (initial 500ms, max 10s), decorrelated jitter
- Circuit breaker: consecutive breaker (5 failures), half-open after 30s
- Retries only on status codes 429, 500, 502, 503

**401 re-auth (separate from cockatiel):** If a request returns 401 and a token exists, the client re-authenticates once and retries. If the retry also returns 401, `PaprikaAuthError` is thrown. This is token refresh logic, not transient failure retry.

**Response validation:** Successful responses are validated with `z.object({ result: schema }).parse(json)`, unwrapping the Paprika API's `{ result: T }` envelope and validating the inner type against the caller's schema.

**Error mapping:**

- `BrokenCircuitError` from cockatiel → `PaprikaAPIError`
- 401 after re-auth → `PaprikaAuthError`
- Other non-2xx → `PaprikaAPIError`
- Zod parse failure → `ZodError` propagates (API contract violation)

### Testing

Tests use msw (`setupServer` from `msw/node.js`) to intercept HTTP at the network level. The server is created per-file, not globally. `authenticate()` is tested thoroughly. `request<T>()` testing is deferred to P1-U06 when public methods exist, with a `describe.todo()` placeholder.

## Existing Patterns

Investigation confirmed the following established patterns this design follows:

**Zod for external data validation.** The codebase never uses `as` type assertions for external/untrusted data — only in test fixtures. `loadConfig()` in `src/utils/config.ts` validates with `safeParse()`. This design uses `AuthResponseSchema.parse()` for auth responses and `z.object({ result: schema }).parse()` for API responses.

**Error hierarchy from `src/paprika/errors.ts`.** `PaprikaAuthError` and `PaprikaAPIError` are already defined with correct signatures. `PaprikaAPIError` auto-formats messages as `"message (HTTP status from endpoint)"`.

**ESM imports with `.js` extensions.** All existing code follows this convention.

**Colocated tests as `*.test.ts`.** Acceptance criteria ID format `{slug}.AC{N}.{M}` established in `src/paprika/types.test.ts` and `src/paprika/errors.test.ts`.

**New pattern introduced: cockatiel resilience.** No existing resilience pattern in the codebase. Cockatiel is adopted for retry + circuit breaker composition. This is a new runtime dependency justified by: zero transitive dependencies, TypeScript-native, composable policies that will be reused by P1-U06/U07 callers.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Dependencies & Scaffolding

**Goal:** Add cockatiel and msw, create empty client file that compiles

**Components:**

- `package.json` — add `cockatiel` to dependencies, `msw` to devDependencies
- `src/paprika/client.ts` — empty `PaprikaClient` class with constructor, no methods yet

**Dependencies:** None (P1-U02 types and errors already exist)

**Done when:** `pnpm install` succeeds, `pnpm typecheck` passes, `pnpm build` succeeds

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: Authentication

**Goal:** Working `authenticate()` method with Zod-validated response

**Components:**

- `src/paprika/client.ts` — `authenticate()` method, `AUTH_URL` constant
- `src/paprika/client.test.ts` — msw-based tests for auth happy path, bad credentials, malformed response

**Dependencies:** Phase 1

**Done when:** Tests verify: successful auth stores token, bad credentials throw `PaprikaAuthError`, malformed response throws `ZodError`. Covers `p1-u05-client-auth.AC1.*`.

<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->

### Phase 3: Request Helper with Resilience

**Goal:** Private `request<T>()` with cockatiel resilience, 401 re-auth, and schema-validated responses

**Components:**

- `src/paprika/client.ts` — `request<T>()` method, `API_BASE` constant, cockatiel policy composition
- `src/paprika/client.test.ts` — `describe.todo('request<T>()')` placeholder noting tests deferred to P1-U06

**Dependencies:** Phase 2

**Done when:** `pnpm typecheck` passes, `pnpm build` succeeds. `request<T>()` is `private` and cannot be called from outside the class. `describe.todo()` block documents deferred test plan. Covers `p1-u05-client-auth.AC2.*` (structural verification only — behavioral tests deferred).

<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->

### Phase 4: Documentation & Cleanup

**Goal:** Update module CLAUDE.md with client.ts contract, verify all checks pass

**Components:**

- `src/paprika/CLAUDE.md` — add `client.ts` entry with exports, dependencies (`cockatiel`, `zod`), and consumer notes for P1-U06/U07

**Dependencies:** Phase 3

**Done when:** `pnpm lint` passes, `pnpm format:check` passes, `pnpm test` passes, `pnpm typecheck` passes. CLAUDE.md documents the PaprikaClient contract.

<!-- END_PHASE_4 -->

## Additional Considerations

**Trailing slash on AUTH_URL.** Community implementations note that `https://paprikaapp.com/api/v1/account/login/` (with trailing slash) is required. The slash must be preserved.

**URLSearchParams Content-Type.** Passing `URLSearchParams` as the fetch body automatically sets `Content-Type: application/x-www-form-urlencoded`. Manually setting Content-Type can cause header duplication. The implementation must not set Content-Type for auth requests.

**Token nullability.** `this.token` is `null` before `authenticate()` is called. If `request()` is called without prior authentication, no Bearer header is sent. The API returns 401, but the 401-retry logic only fires if `this.token` is truthy — preventing infinite retry loops when no token exists.

**Cockatiel policy scope.** The composed retry + circuit breaker policy is module-level (shared across all PaprikaClient instances). This is intentional — circuit state should reflect the health of the Paprika API globally, not per-client.
