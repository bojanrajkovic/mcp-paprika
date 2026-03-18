# PaprikaClient Auth & Request Helper — Phase 3: Request Helper with Resilience

**Goal:** Private `request<T>()` method with cockatiel retry + circuit breaker, 401 re-auth retry, and Zod-validated response unwrapping

**Architecture:** `request<T>()` is the single point for all v2 API calls. A module-level cockatiel policy (retry + circuit breaker) handles transient failures (429, 500, 502, 503). A separate 401 re-auth path handles token expiry. Responses are validated with a caller-supplied `ZodType<T>` schema after unwrapping the `{ result: T }` envelope.

**Tech Stack:** TypeScript 5.9, cockatiel (retry + circuit breaker), zod (response validation)

**Scope:** 4 phases from original design (phase 3 of 4)

**Codebase verified:** 2026-03-09

---

## Acceptance Criteria Coverage

This phase implements (structural verification only — behavioral tests deferred to P1-U06):

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

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->

### Task 1: Add cockatiel resilience policy (module-level)

**Verifies:** p1-u05-client-auth.AC4.1, p1-u05-client-auth.AC4.2

**Files:**

- Modify: `src/paprika/client.ts`

**Implementation:**

Add the cockatiel policy composition at module level, above the `PaprikaClient` class. This policy is shared across all `PaprikaClient` instances so circuit breaker state reflects aggregate API health.

```typescript
import { ExponentialBackoff, ConsecutiveBreaker, retry, circuitBreaker, handleType, wrap } from "cockatiel";

class TransientHTTPError extends Error {
  constructor(readonly status: number) {
    super(`Transient HTTP error (${status.toString()})`);
    this.name = "TransientHTTPError";
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

const retryPolicy = retry(handleType(TransientHTTPError), {
  maxAttempts: 3,
  backoff: new ExponentialBackoff({
    initialDelay: 500, // design: 500ms initial (cockatiel default: 128ms)
    maxDelay: 10_000, // design: 10s max (cockatiel default: 30s)
  }),
});

const breakerPolicy = circuitBreaker(handleType(TransientHTTPError), {
  halfOpenAfter: 30_000,
  breaker: new ConsecutiveBreaker(5),
});

const resilience = wrap(retryPolicy, breakerPolicy);
```

Key details for the implementor:

- `TransientHTTPError` is a private (non-exported) sentinel error class. The `request<T>()` method throws it for retryable status codes, and cockatiel catches it via `handleType`.
- `RETRYABLE_STATUSES` is a `Set` for O(1) lookup.
- The default `ExponentialBackoff` uses decorrelated jitter — no extra configuration needed.
- `wrap(retryPolicy, breakerPolicy)` composes: retry wraps the circuit breaker, so retries go through the breaker.
- `resilience` is module-level — shared across all instances.

**Verification:**

```bash
pnpm typecheck
```

Expected: Exits with code 0.

**Commit:**

```bash
git add src/paprika/client.ts
git commit -m "feat(paprika): add cockatiel resilience policy for PaprikaClient"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Add private request<T>() method with resilience and 401 re-auth

**Verifies:** p1-u05-client-auth.AC2.1, p1-u05-client-auth.AC2.2, p1-u05-client-auth.AC2.3, p1-u05-client-auth.AC2.4, p1-u05-client-auth.AC3.1, p1-u05-client-auth.AC3.2, p1-u05-client-auth.AC3.3, p1-u05-client-auth.AC4.3

**Files:**

- Modify: `src/paprika/client.ts`

**Implementation:**

Add the `request<T>()` private method and `API_BASE` constant to `PaprikaClient`. Also add `BrokenCircuitError` to the cockatiel imports and `PaprikaAPIError` to the error imports.

Additional imports needed at top of file:

```typescript
import { BrokenCircuitError } from "cockatiel";
import type { ZodType } from "zod";
import { z } from "zod";
import { PaprikaAPIError, PaprikaAuthError } from "./errors.js";
```

Add constant:

```typescript
const API_BASE = "https://paprikaapp.com/api/v2/sync";
```

Add a private sentinel error class alongside `TransientHTTPError` (non-exported, module-level):

```typescript
class TokenExpiredError extends Error {
  constructor() {
    super("Token expired");
    this.name = "TokenExpiredError";
  }
}
```

Add method inside the `PaprikaClient` class:

```typescript
  private async request<T>(
    method: "GET" | "POST",
    url: string,
    schema: ZodType<T>,
    body?: FormData | URLSearchParams,
  ): Promise<T> {
    const execute = async (): Promise<T> => {
      const headers: Record<string, string> = {};
      if (this.token) {
        headers["Authorization"] = `Bearer ${this.token}`;
      }

      const response = await fetch(url, { method, headers, body });

      if (!response.ok) {
        if (RETRYABLE_STATUSES.has(response.status)) {
          throw new TransientHTTPError(response.status);
        }

        if (response.status === 401) {
          throw new TokenExpiredError();
        }

        throw new PaprikaAPIError(
          "Request failed",
          response.status,
          url,
        );
      }

      const json: unknown = await response.json();
      const envelope = z.object({ result: schema }).parse(json);
      return envelope.result;
    };

    try {
      return await resilience.execute(execute);
    } catch (error) {
      if (error instanceof BrokenCircuitError) {
        throw new PaprikaAPIError("Service unavailable (circuit open)", 503, url);
      }

      // 401 re-auth: runs OUTSIDE cockatiel to prevent multiple re-auth cycles
      if (error instanceof TokenExpiredError) {
        if (!this.token) {
          throw new PaprikaAuthError("Authentication required (HTTP 401)");
        }

        await this.authenticate();

        // Retry once with fresh token — cockatiel handles transient failures within this retry
        try {
          return await resilience.execute(execute);
        } catch (retryError) {
          if (retryError instanceof TokenExpiredError) {
            throw new PaprikaAuthError(
              "Authentication failed after re-auth (HTTP 401)",
            );
          }
          if (retryError instanceof BrokenCircuitError) {
            throw new PaprikaAPIError("Service unavailable (circuit open)", 503, url);
          }
          throw retryError;
        }
      }

      throw error;
    }
  }
```

**Architecture — why 401 re-auth is outside cockatiel:**

The design specifies "a single re-authentication attempt before the request is retried." To enforce this contract cleanly:

1. The inner `execute` callback (passed to `resilience.execute()`) throws `TokenExpiredError` on 401. Cockatiel does NOT catch `TokenExpiredError` — it only handles `TransientHTTPError`. So a 401 immediately exits the cockatiel retry loop.

2. The outer `request()` method catches `TokenExpiredError` and handles re-auth:
   - If `this.token` is `null`: throw `PaprikaAuthError` immediately (AC3.3 — no retry when no token exists, prevents infinite loop)
   - If `this.token` exists: call `authenticate()` once to refresh the token, then call `resilience.execute(execute)` again for a single retry (AC3.1)
   - If the retry also gets a 401 (another `TokenExpiredError`): throw `PaprikaAuthError` (AC3.2)

3. This separation ensures cockatiel retries only handle transient failures (429, 500, 502, 503), and re-auth happens exactly once regardless of how many cockatiel retries occur.

Key implementation details for the implementor:

- `request<T>()` is `private` — this is structural verification for AC2.3.
- `TokenExpiredError` is a non-exported sentinel. Cockatiel's `handleType(TransientHTTPError)` does not match it, so 401 errors escape the cockatiel loop cleanly.
- `TransientHTTPError` is thrown for retryable statuses so cockatiel can catch and retry them. Non-retryable statuses (400, 403, 404) throw `PaprikaAPIError` directly — cockatiel does not catch these either (AC4.3).
- `BrokenCircuitError` from cockatiel is caught and mapped to `PaprikaAPIError` with status 503 in both the initial and retry paths.
- Response validation uses `z.object({ result: schema }).parse(json)` to unwrap the envelope and validate the inner type against the caller's schema (AC2.2).

**Verification:**

```bash
pnpm typecheck
```

Expected: Exits with code 0.

```bash
pnpm build
```

Expected: Exits with code 0.

```bash
pnpm lint
```

Expected: No warnings or errors.

**Commit:**

```bash
git add src/paprika/client.ts
git commit -m "feat(paprika): add private request<T>() with resilience and 401 re-auth"
```

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Add describe.todo() placeholder for request<T>() tests

**Verifies:** None (documentation placeholder only)

**Files:**

- Modify: `src/paprika/client.test.ts`

**Implementation:**

Add a `describe.todo()` block at the end of the existing test file, documenting the deferred test plan for `request<T>()`. The `describe.todo()` function marks a test suite as pending — vitest reports it but doesn't run it.

Add the following after the existing authentication describe blocks:

```typescript
describe.todo("p1-u05-client-auth.AC2: Request helper adds auth and unwraps envelope", () => {
  // Tests deferred to P1-U06 when public methods exist that call request<T>().
  // request<T>() is private and cannot be tested directly.
  //
  // AC2.1: request<T>() includes Authorization: Bearer {token} header
  // AC2.2: Response envelope { result: T } is unwrapped and validated
  // AC2.3: request<T>() is private (structural — verified by TypeScript compiler)
  // AC2.4: Non-401 error status throws PaprikaAPIError
});

describe.todo("p1-u05-client-auth.AC3: 401 re-auth retry", () => {
  // Tests deferred to P1-U06 when public methods exist that call request<T>().
  //
  // AC3.1: On 401 with existing token, authenticate() refreshes, then retries
  // AC3.2: If retry also returns 401, PaprikaAuthError is thrown
  // AC3.3: No retry when this.token is null
});

describe.todo("p1-u05-client-auth.AC4: Cockatiel resilience for transient failures", () => {
  // Tests deferred to P1-U06 when public methods exist that call request<T>().
  //
  // AC4.1: Status codes 429, 500, 502, 503 retried with exponential backoff
  // AC4.2: Circuit breaker opens after 5 consecutive failures
  // AC4.3: Non-retryable statuses (400, 403, 404) not retried
});
```

**Verification:**

```bash
pnpm test
```

Expected: All existing tests pass. The todo blocks appear as "todo" in the test output, not as failures.

**Commit:**

```bash
git add src/paprika/client.test.ts
git commit -m "test(paprika): add describe.todo() placeholders for request<T>() tests"
```

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->

### Task 4: Verify all checks pass

**Files:** None (verification only)

**Step 1: Run full verification suite**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm format:check
```

Expected: All four commands exit with code 0.

**Step 2: If format check fails, fix formatting**

```bash
pnpm format
git add -u
git commit -m "style(paprika): format client files"
```

<!-- END_TASK_4 -->
