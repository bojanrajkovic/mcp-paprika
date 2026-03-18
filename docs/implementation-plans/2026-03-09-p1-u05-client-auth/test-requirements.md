# Test Requirements: p1-u05-client-auth

**Design:** `docs/design-plans/2026-03-09-p1-u05-client-auth.md`
**Implementation:** `docs/implementation-plans/2026-03-09-p1-u05-client-auth/phase_01.md` through `phase_04.md`
**Test file:** `src/paprika/client.test.ts`

---

## AC1: Authentication works correctly

### p1-u05-client-auth.AC1.1 Success

> `authenticate()` POSTs form-encoded `email` and `password` to `https://paprikaapp.com/api/v1/account/login/`

- **Verification:** Automated test (unit)
- **Phase:** 2 (Task 2)
- **Test file:** `src/paprika/client.test.ts`
- **Test location:** `describe("p1-u05-client-auth.AC1: Authentication works correctly")`
- **What the test verifies:** An msw handler intercepts the POST request to `https://paprikaapp.com/api/v1/account/login/`. Inside the handler, the test reads the request body via `new URLSearchParams(await request.text())` and asserts that the `email` and `password` fields match the values passed to the `PaprikaClient` constructor. The test also asserts the request method is POST. The handler returns a valid `{ result: { token: "..." } }` JSON response and `authenticate()` resolves without throwing.

### p1-u05-client-auth.AC1.2 Success

> Successful auth stores token from `response.result.token` in private field

- **Verification:** Automated test (unit) -- indirect
- **Phase:** 2 (Task 2)
- **Test file:** `src/paprika/client.test.ts`
- **Test location:** `describe("p1-u05-client-auth.AC1: Authentication works correctly")`
- **What the test verifies:** Since `token` is a private field, direct assertion is not possible. The test verifies indirectly by calling `authenticate()` twice and verifying the msw handler receives both requests (proving the method works repeatably). Full behavioral verification -- that the stored token is subsequently sent as a `Bearer` header -- is deferred to P1-U06, when public methods that call `request<T>()` exist.

### p1-u05-client-auth.AC1.3 Success

> Response is validated with `AuthResponseSchema.parse()` (Zod runtime validation)

- **Verification:** Automated test (unit) -- implicit
- **Phase:** 2 (Task 2)
- **Test file:** `src/paprika/client.test.ts`
- **Test location:** `describe("p1-u05-client-auth.AC1: Authentication works correctly")`
- **What the test verifies:** The successful authentication test (AC1.1) implicitly exercises Zod parsing -- if `AuthResponseSchema.parse()` were removed or broken, the method would fail or return the wrong shape. Additionally, the malformed response test (AC1.5) explicitly verifies that Zod parsing is active: a valid JSON body that does not match `AuthResponseSchema` throws `ZodError`, proving the parse step runs on every response.

### p1-u05-client-auth.AC1.4 Failure

> Non-2xx response throws `PaprikaAuthError` with HTTP status in message

- **Verification:** Automated test (unit)
- **Phase:** 2 (Task 2)
- **Test file:** `src/paprika/client.test.ts`
- **Test location:** `describe("p1-u05-client-auth.AC1: Authentication works correctly")`
- **What the test verifies:** The msw handler returns `HttpResponse.json({}, { status: 403 })`. The test asserts that `authenticate()` rejects with an instance of `PaprikaAuthError` and that the error message contains the HTTP status code (e.g., `"HTTP 403"`).

### p1-u05-client-auth.AC1.5 Failure

> Malformed response (missing `result.token`) throws `ZodError`

- **Verification:** Automated test (unit)
- **Phase:** 2 (Task 2)
- **Test file:** `src/paprika/client.test.ts`
- **Test location:** `describe("p1-u05-client-auth.AC1: Authentication works correctly")`
- **What the test verifies:** The msw handler returns `HttpResponse.json({ wrong: "shape" })` (valid JSON, HTTP 200, but does not match `AuthResponseSchema`). The test asserts that `authenticate()` rejects with an instance of `ZodError` (imported from `"zod"`).

---

## AC2: Request helper adds auth and unwraps envelope

> **Note:** All AC2 behavioral tests are deferred to P1-U06. In this unit (P1-U05), `request<T>()` is `private` and cannot be called from outside the class. Phase 3 (Task 3) adds a `describe.todo()` placeholder in `src/paprika/client.test.ts` documenting the deferred test plan.

### p1-u05-client-auth.AC2.1 Success

> `request<T>()` includes `Authorization: Bearer {token}` header when token exists

- **Verification:** `describe.todo()` placeholder (behavioral test deferred to P1-U06)
- **Phase:** 3 (Task 3 -- placeholder); P1-U06 (full test)
- **Test file:** `src/paprika/client.test.ts`
- **Deferred test plan:** When public methods are added in P1-U06, an msw handler for the v2 API endpoint will inspect the incoming request's `Authorization` header and assert it equals `Bearer {token}`.

### p1-u05-client-auth.AC2.2 Success

> Response envelope `{ result: T }` is unwrapped and inner value validated against caller's `ZodType<T>` schema

- **Verification:** `describe.todo()` placeholder (behavioral test deferred to P1-U06)
- **Phase:** 3 (Task 3 -- placeholder); P1-U06 (full test)
- **Test file:** `src/paprika/client.test.ts`
- **Deferred test plan:** A public method will call `request<T>()` with a Zod schema. The msw handler will return `{ result: <valid data> }`. The test will assert the public method returns the unwrapped inner value. A second test will return `{ result: <invalid data> }` and assert `ZodError` is thrown.

### p1-u05-client-auth.AC2.3 Success

> `request<T>()` is `private` -- not accessible from outside the class

- **Verification:** Automated -- structural (TypeScript compiler)
- **Phase:** 3 (Task 2)
- **Test file:** N/A (compile-time verification)
- **What is verified:** The `private` modifier on `request<T>()` is enforced by the TypeScript compiler. `pnpm typecheck` passes with `request<T>()` declared as `private`. Any external caller attempting `client.request(...)` would produce a compile error.

### p1-u05-client-auth.AC2.4 Failure

> Non-401 error status throws `PaprikaAPIError` with status and endpoint

- **Verification:** `describe.todo()` placeholder (behavioral test deferred to P1-U06)
- **Phase:** 3 (Task 3 -- placeholder); P1-U06 (full test)
- **Test file:** `src/paprika/client.test.ts`
- **Deferred test plan:** An msw handler for a v2 endpoint will return a non-retryable error status (e.g., 404). The test will assert the public method rejects with `PaprikaAPIError` with matching `status` and `endpoint` properties.

---

## AC3: 401 re-auth retry

> **Note:** All AC3 behavioral tests are deferred to P1-U06. Phase 3 (Task 3) adds a `describe.todo()` placeholder.

### p1-u05-client-auth.AC3.1 Success

> On 401 with existing token, `authenticate()` is called to refresh, then request retried

- **Verification:** `describe.todo()` placeholder (behavioral test deferred to P1-U06)
- **Phase:** 3 (Task 3 -- placeholder); P1-U06 (full test)
- **Test file:** `src/paprika/client.test.ts`
- **Deferred test plan:** The client authenticates, then a v2 msw handler returns 401 on the first call and 200 on the second. A request counter confirms exactly 2 v2 requests and 2 auth requests were made.

### p1-u05-client-auth.AC3.2 Failure

> If retry also returns 401, `PaprikaAuthError` is thrown

- **Verification:** `describe.todo()` placeholder (behavioral test deferred to P1-U06)
- **Phase:** 3 (Task 3 -- placeholder); P1-U06 (full test)
- **Test file:** `src/paprika/client.test.ts`
- **Deferred test plan:** The v2 handler always returns 401. The auth handler responds successfully to re-auth. The test asserts `PaprikaAuthError` after the single re-auth attempt.

### p1-u05-client-auth.AC3.3 Edge

> No retry attempted when `this.token` is null (prevents infinite loop)

- **Verification:** `describe.todo()` placeholder (behavioral test deferred to P1-U06)
- **Phase:** 3 (Task 3 -- placeholder); P1-U06 (full test)
- **Test file:** `src/paprika/client.test.ts`
- **Deferred test plan:** Client constructed but `authenticate()` NOT called. A public method is called, v2 handler returns 401. Test asserts `PaprikaAuthError` immediately and auth handler was NOT called.

---

## AC4: Cockatiel resilience for transient failures

> **Note:** All AC4 behavioral tests are deferred to P1-U06. Phase 3 (Task 3) adds a `describe.todo()` placeholder.

### p1-u05-client-auth.AC4.1 Success

> Status codes 429, 500, 502, 503 are retried with exponential backoff

- **Verification:** `describe.todo()` placeholder (behavioral test deferred to P1-U06)
- **Phase:** 3 (Task 3 -- placeholder); P1-U06 (full test)
- **Test file:** `src/paprika/client.test.ts`
- **Deferred test plan:** For each retryable status, msw returns that status N-1 times then 200. Test verifies the method eventually succeeds. Request counter confirms retry attempts. Note: verify request count, not timing (jitter makes timing assertions fragile).

### p1-u05-client-auth.AC4.2 Success

> Circuit breaker opens after 5 consecutive failures, subsequent calls fail immediately with `PaprikaAPIError`

- **Verification:** `describe.todo()` placeholder (behavioral test deferred to P1-U06)
- **Phase:** 3 (Task 3 -- placeholder); P1-U06 (full test)
- **Test file:** `src/paprika/client.test.ts`
- **Deferred test plan:** Msw returns 500 on every call. After enough requests to trip the breaker (5 consecutive failures), the next call rejects with `PaprikaAPIError` containing "circuit open" and status 503, without making an HTTP request. Note: module-level policy is shared — test must isolate or reset breaker state.

### p1-u05-client-auth.AC4.3 Edge

> Non-retryable status codes (e.g., 400, 403, 404) are not retried

- **Verification:** `describe.todo()` placeholder (behavioral test deferred to P1-U06)
- **Phase:** 3 (Task 3 -- placeholder); P1-U06 (full test)
- **Test file:** `src/paprika/client.test.ts`
- **Deferred test plan:** For each non-retryable status (400, 403, 404), msw returns that status. Test asserts `PaprikaAPIError` on first call. Request counter confirms exactly 1 request (no retries).

---

## AC5: Construction and module structure

### p1-u05-client-auth.AC5.1 Success

> `new PaprikaClient(email, password)` does not throw

- **Verification:** Automated test (unit)
- **Phase:** 2 (Task 2)
- **Test file:** `src/paprika/client.test.ts`
- **Test location:** `describe("p1-u05-client-auth.AC5: Construction and module structure")`
- **What the test verifies:** `new PaprikaClient("test@example.com", "password123")` does not throw and returns an instance of `PaprikaClient`.

### p1-u05-client-auth.AC5.2 Success

> `PaprikaClient` is exported from `src/paprika/client.ts`

- **Verification:** Automated test (unit) -- implicit
- **Phase:** 2 (Task 2)
- **Test file:** `src/paprika/client.test.ts`
- **Test location:** `describe("p1-u05-client-auth.AC5: Construction and module structure")`
- **What the test verifies:** The import statement `import { PaprikaClient } from "./client.js"` succeeds. If the export were missing, all tests would fail.

### p1-u05-client-auth.AC5.3 Success

> Module CLAUDE.md documents client.ts contract

- **Verification:** Human verification
- **Phase:** 4 (Task 1)
- **Justification:** CLAUDE.md is a free-form Markdown documentation file. Verifying its semantic content requires human judgment.
- **Verification approach:** After Phase 4 Task 1 is completed, inspect `src/paprika/CLAUDE.md` and confirm:
  1. `client.ts` is listed in the "Files" section
  2. A "PaprikaClient (client.ts)" section exists with exports, construction signature, public/private API, and dependencies
  3. Consumer notes for P1-U06/P1-U07 are present
  4. The module-level "Dependencies" section includes `cockatiel`

---

## Summary Matrix

| AC ID | Criterion                            | Verification Type          | Phase | Status in P1-U05           |
| ----- | ------------------------------------ | -------------------------- | ----- | -------------------------- |
| AC1.1 | Auth POSTs form-encoded credentials  | Automated (unit)           | 2     | Fully tested               |
| AC1.2 | Token stored on success              | Automated (unit, indirect) | 2     | Indirect; full in P1-U06   |
| AC1.3 | Zod validation of auth response      | Automated (unit, implicit) | 2     | Implicit via AC1.1 + AC1.5 |
| AC1.4 | Non-2xx throws PaprikaAuthError      | Automated (unit)           | 2     | Fully tested               |
| AC1.5 | Malformed response throws ZodError   | Automated (unit)           | 2     | Fully tested               |
| AC2.1 | Bearer token header                  | describe.todo()            | 3     | Deferred to P1-U06         |
| AC2.2 | Envelope unwrap + schema validation  | describe.todo()            | 3     | Deferred to P1-U06         |
| AC2.3 | request<T>() is private              | Structural (TypeScript)    | 3     | Verified by compiler       |
| AC2.4 | Non-401 error throws PaprikaAPIError | describe.todo()            | 3     | Deferred to P1-U06         |
| AC3.1 | 401 re-auth then retry               | describe.todo()            | 3     | Deferred to P1-U06         |
| AC3.2 | Double 401 throws PaprikaAuthError   | describe.todo()            | 3     | Deferred to P1-U06         |
| AC3.3 | No retry when token is null          | describe.todo()            | 3     | Deferred to P1-U06         |
| AC4.1 | Retryable statuses retried           | describe.todo()            | 3     | Deferred to P1-U06         |
| AC4.2 | Circuit breaker opens after 5        | describe.todo()            | 3     | Deferred to P1-U06         |
| AC4.3 | Non-retryable not retried            | describe.todo()            | 3     | Deferred to P1-U06         |
| AC5.1 | Constructor does not throw           | Automated (unit)           | 2     | Fully tested               |
| AC5.2 | PaprikaClient is exported            | Automated (unit, implicit) | 2     | Implicit via import        |
| AC5.3 | CLAUDE.md documents contract         | Human verification         | 4     | Manual review              |

## Coverage Notes

- **Fully tested in P1-U05:** 5 criteria (AC1.1, AC1.4, AC1.5, AC5.1, AC5.2)
- **Indirectly/implicitly tested:** 2 criteria (AC1.2, AC1.3)
- **Structurally verified by compiler:** 1 criterion (AC2.3)
- **Deferred to P1-U06 with describe.todo():** 9 criteria (AC2.1, AC2.2, AC2.4, AC3.1-AC3.3, AC4.1-AC4.3)
- **Human verification:** 1 criterion (AC5.3)
- **Total:** 18 acceptance criteria across 5 AC groups, all mapped
