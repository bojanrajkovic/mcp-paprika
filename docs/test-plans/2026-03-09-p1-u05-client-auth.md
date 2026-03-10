# Human Test Plan: PaprikaClient Auth & Request Helper (p1-u05-client-auth)

## Prerequisites

- Node.js 24 installed (via mise)
- Dependencies installed: `pnpm install`
- All automated tests passing: `pnpm test`
- TypeScript compiles cleanly: `pnpm typecheck`
- Branch `brajkovic/p1-u05-client-auth` checked out at commit `5368a60`

## Phase 1: Verify Module Documentation (AC5.3)

| Step | Action                                                                                                                                                                                                                  | Expected                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1    | Open `src/paprika/CLAUDE.md`                                                                                                                                                                                            | File exists and is valid Markdown                                                                                  |
| 2    | Locate the "Files" section near the top                                                                                                                                                                                 | `client.ts` is listed with description: "Typed HTTP client for Paprika Cloud Sync API (auth + resilient requests)" |
| 3    | Locate the "PaprikaClient (client.ts)" subsection under "Contracts"                                                                                                                                                     | Section exists with subsections: Exports, Construction, Public API, Private API, Dependencies                      |
| 4    | In "Exports", verify `PaprikaClient` is listed as a class with `authenticate()` and private `request<T>()`                                                                                                              | Matches actual exports in `src/paprika/client.ts`                                                                  |
| 5    | In "Construction", verify signature is documented as `new PaprikaClient(email: string, password: string)` with note that it stores credentials with no I/O                                                              | Matches constructor at line 64-67 of `client.ts`                                                                   |
| 6    | In "Public API", verify `authenticate(): Promise<void>` is documented with description of POSTing form-encoded credentials to v1 login                                                                                  | Matches implementation at lines 69-82 of `client.ts`                                                               |
| 7    | In "Private API", verify `request<T>()` is documented with: Bearer token header, Cockatiel retry (429, 500, 502, 503), circuit breaker (5 consecutive failures), 401 re-auth retry, envelope unwrapping, Zod validation | All behaviors match implementation at lines 85-150 of `client.ts`                                                  |
| 8    | In "Private API", verify consumer notes reference P1-U06/P1-U07                                                                                                                                                         | Notes present stating public methods will be added in those units                                                  |
| 9    | In module-level "Dependencies" section, verify `cockatiel` is listed                                                                                                                                                    | `cockatiel` appears in the Dependencies section                                                                    |

## Phase 2: Verify Implementation Structure

| Step | Action                                                                                                       | Expected                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1    | Open `src/paprika/client.ts`                                                                                 | File contains `PaprikaClient` class                                 |
| 2    | Verify `AUTH_URL` constant is `"https://paprikaapp.com/api/v1/account/login/"`                               | Matches line 25                                                     |
| 3    | Verify `API_BASE` constant is `"https://paprikaapp.com/api/v2/sync"`                                         | Matches line 28 (with `@ts-expect-error` since unused in this unit) |
| 4    | Verify `RETRYABLE_STATUSES` contains exactly `[429, 500, 502, 503]`                                          | Matches line 44                                                     |
| 5    | Verify retry policy uses `ExponentialBackoff` with `maxAttempts: 3`, `initialDelay: 500`, `maxDelay: 10_000` | Matches lines 46-52                                                 |
| 6    | Verify circuit breaker uses `ConsecutiveBreaker(5)` with `halfOpenAfter: 30_000`                             | Matches lines 54-57                                                 |
| 7    | Verify `resilience` wraps retry and breaker: `wrap(retryPolicy, breakerPolicy)`                              | Matches line 59                                                     |
| 8    | Verify `token` field is `private` and initialized to `null`                                                  | Matches line 62                                                     |
| 9    | Verify `email` and `password` constructor params are `private readonly`                                      | Matches lines 65-66                                                 |

## Phase 3: Verify Error Module Integration

| Step | Action                                                                   | Expected                             |
| ---- | ------------------------------------------------------------------------ | ------------------------------------ |
| 1    | Confirm `PaprikaAuthError` is imported from `./errors.js` in `client.ts` | Import at line 23                    |
| 2    | Confirm `PaprikaAPIError` is imported from `./errors.js` in `client.ts`  | Import at line 23                    |
| 3    | Confirm test file imports `PaprikaAuthError` from `./errors.js`          | Import at line 6 of `client.test.ts` |
| 4    | Confirm test file imports `ZodError` from `"zod"`                        | Import at line 4 of `client.test.ts` |

## End-to-End: Authentication Flow Validation

**Purpose:** Verify end-to-end that the test suite accurately models the `authenticate()` method's behavior across success and failure paths.

| Step | Action                                                                                                                                              | Expected                                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Run `pnpm test -- src/paprika/client.test.ts`                                                                                                       | All 10 tests pass, 3 `describe.todo()` blocks shown as pending                                                                                                                                                   |
| 2    | In `client.ts`, temporarily change `this.token = data.result.token` (line 81) to `this.token = "hardcoded"`                                         | Save file                                                                                                                                                                                                        |
| 3    | Run `pnpm test -- src/paprika/client.test.ts`                                                                                                       | AC1.1 and AC1.3 tests still pass (they do not inspect the stored token). AC1.2 still passes (it only checks call count, not token value). This confirms the indirect nature documented in the test requirements. |
| 4    | Revert the change to `client.ts`                                                                                                                    | File restored to original                                                                                                                                                                                        |
| 5    | In `client.ts`, temporarily remove `AuthResponseSchema.parse(json)` (line 80) and replace with `const data = json as { result: { token: string } }` | Save file                                                                                                                                                                                                        |
| 6    | Run `pnpm test -- src/paprika/client.test.ts`                                                                                                       | AC1.5 tests (malformed response) should FAIL since Zod parsing is bypassed. AC1.1 and AC1.3 should still pass with valid responses. This confirms AC1.5 is truly testing Zod validation.                         |
| 7    | Revert the change to `client.ts`                                                                                                                    | File restored to original                                                                                                                                                                                        |
| 8    | Run `pnpm typecheck`                                                                                                                                | Passes cleanly, confirming `request<T>()` is valid as private (AC2.3)                                                                                                                                            |

## End-to-End: describe.todo() Placeholder Completeness

**Purpose:** Verify that all deferred criteria have corresponding `describe.todo()` blocks with documented test plans.

| Step | Action                                                                               | Expected                                                                          |
| ---- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 1    | Open `src/paprika/client.test.ts`                                                    | File opens                                                                        |
| 2    | Locate `describe.todo("p1-u05-client-auth.AC2: ...")`                                | Found at line 172. Comments reference AC2.1, AC2.2, AC2.3, AC2.4.                 |
| 3    | Locate `describe.todo("p1-u05-client-auth.AC3: ...")`                                | Found at line 182. Comments reference AC3.1, AC3.2, AC3.3.                        |
| 4    | Locate `describe.todo("p1-u05-client-auth.AC4: ...")`                                | Found at line 190. Comments reference AC4.1, AC4.2, AC4.3.                        |
| 5    | Cross-reference each commented AC ID against the test-requirements.md Summary Matrix | All 9 deferred criteria have a matching comment line in a `describe.todo()` block |

## Traceability

| Acceptance Criterion                          | Automated Test                               | Manual Step                     |
| --------------------------------------------- | -------------------------------------------- | ------------------------------- |
| AC1.1 -- Auth POSTs form-encoded credentials  | `client.test.ts` line 37                     | Auth Flow step 1                |
| AC1.2 -- Token stored on success              | `client.test.ts` line 63 (indirect)          | Auth Flow steps 2-4             |
| AC1.3 -- Zod validation of auth response      | `client.test.ts` line 86 (implicit)          | Auth Flow steps 5-7             |
| AC1.4 -- Non-2xx throws PaprikaAuthError      | `client.test.ts` lines 99, 117               | Auth Flow step 1                |
| AC1.5 -- Malformed response throws ZodError   | `client.test.ts` lines 135, 147, 159         | Auth Flow steps 5-7             |
| AC2.1 -- Bearer token header                  | `describe.todo()` line 172 (deferred P1-U06) | Placeholder step 2              |
| AC2.2 -- Envelope unwrap + schema validation  | `describe.todo()` line 172 (deferred P1-U06) | Placeholder step 2              |
| AC2.3 -- request<T>() is private              | TypeScript compiler (`pnpm typecheck`)       | Auth Flow step 8                |
| AC2.4 -- Non-401 error throws PaprikaAPIError | `describe.todo()` line 172 (deferred P1-U06) | Placeholder step 2              |
| AC3.1 -- 401 re-auth then retry               | `describe.todo()` line 182 (deferred P1-U06) | Placeholder step 3              |
| AC3.2 -- Double 401 throws PaprikaAuthError   | `describe.todo()` line 182 (deferred P1-U06) | Placeholder step 3              |
| AC3.3 -- No retry when token is null          | `describe.todo()` line 182 (deferred P1-U06) | Placeholder step 3              |
| AC4.1 -- Retryable statuses retried           | `describe.todo()` line 190 (deferred P1-U06) | Placeholder step 4              |
| AC4.2 -- Circuit breaker opens after 5        | `describe.todo()` line 190 (deferred P1-U06) | Placeholder step 4              |
| AC4.3 -- Non-retryable not retried            | `describe.todo()` line 190 (deferred P1-U06) | Placeholder step 4              |
| AC5.1 -- Constructor does not throw           | `client.test.ts` line 26                     | Auth Flow step 1                |
| AC5.2 -- PaprikaClient is exported            | `client.test.ts` line 30 (implicit)          | Auth Flow step 1                |
| AC5.3 -- CLAUDE.md documents contract         | N/A (human verification)                     | Documentation Phase 1 steps 1-9 |
