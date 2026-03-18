# PaprikaClient Auth & Request Helper — Phase 2: Authentication

**Goal:** Working `authenticate()` method with Zod-validated response, tested with msw

**Architecture:** `authenticate()` POSTs form-encoded credentials to the Paprika v1 login endpoint, validates the response with `AuthResponseSchema.parse()`, and stores the JWT token. Errors are mapped to `PaprikaAuthError` (HTTP failures) or `ZodError` (malformed responses). Tests use msw's `setupServer` to intercept HTTP at the network level.

**Tech Stack:** TypeScript 5.9, zod (validation), msw (test HTTP interception), vitest

**Scope:** 4 phases from original design (phase 2 of 4)

**Codebase verified:** 2026-03-09

---

## Acceptance Criteria Coverage

This phase implements and tests:

### p1-u05-client-auth.AC1: Authentication works correctly

- **p1-u05-client-auth.AC1.1 Success:** `authenticate()` POSTs form-encoded `email` and `password` to `https://paprikaapp.com/api/v1/account/login/`
- **p1-u05-client-auth.AC1.2 Success:** Successful auth stores token from `response.result.token` in private field
- **p1-u05-client-auth.AC1.3 Success:** Response is validated with `AuthResponseSchema.parse()` (Zod runtime validation)
- **p1-u05-client-auth.AC1.4 Failure:** Non-2xx response throws `PaprikaAuthError` with HTTP status in message
- **p1-u05-client-auth.AC1.5 Failure:** Malformed response (missing `result.token`) throws `ZodError`

### p1-u05-client-auth.AC5: Construction and module structure

- **p1-u05-client-auth.AC5.1 Success:** `new PaprikaClient(email, password)` does not throw
- **p1-u05-client-auth.AC5.2 Success:** `PaprikaClient` is exported from `src/paprika/client.ts`

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->

### Task 1: Add AUTH_URL constant and authenticate() method to PaprikaClient

**Verifies:** p1-u05-client-auth.AC1.1, p1-u05-client-auth.AC1.2, p1-u05-client-auth.AC1.3, p1-u05-client-auth.AC1.4, p1-u05-client-auth.AC5.1, p1-u05-client-auth.AC5.2

**Files:**

- Modify: `src/paprika/client.ts` (created in Phase 1)

**Implementation:**

Add a module-level constant `AUTH_URL` and the `authenticate()` method to the `PaprikaClient` class:

```typescript
import { AuthResponseSchema } from "./types.js";
import { PaprikaAuthError } from "./errors.js";

const AUTH_URL = "https://paprikaapp.com/api/v1/account/login/";

export class PaprikaClient {
  private token: string | null = null;

  constructor(
    private readonly email: string,
    private readonly password: string,
  ) {}

  async authenticate(): Promise<void> {
    const response = await fetch(AUTH_URL, {
      method: "POST",
      body: new URLSearchParams({ email: this.email, password: this.password }),
    });

    if (!response.ok) {
      throw new PaprikaAuthError(`Authentication failed (HTTP ${response.status.toString()})`);
    }

    const json: unknown = await response.json();
    const data = AuthResponseSchema.parse(json);
    this.token = data.result.token;
  }
}
```

Key implementation details for the implementor:

- `AUTH_URL` has a **trailing slash** — required by the Paprika API. Do not remove it.
- `new URLSearchParams(...)` as `body` automatically sets `Content-Type: application/x-www-form-urlencoded`. Do NOT manually set Content-Type — it causes header duplication.
- Response validation uses `AuthResponseSchema.parse()` (throws `ZodError` on mismatch), NOT `safeParse()`. This is intentional — malformed responses should throw, not return Result types.
- The `json` variable is typed as `unknown` to satisfy the TypeScript house style (never use `any`).
- Imports use `.js` extensions per ESM convention.

**Verification:**

```bash
pnpm typecheck
```

Expected: Exits with code 0.

```bash
pnpm build
```

Expected: Exits with code 0.

**Commit:**

```bash
git add src/paprika/client.ts
git commit -m "feat(paprika): add authenticate() method to PaprikaClient"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Write authentication tests with msw

**Verifies:** p1-u05-client-auth.AC1.1, p1-u05-client-auth.AC1.2, p1-u05-client-auth.AC1.3, p1-u05-client-auth.AC1.4, p1-u05-client-auth.AC1.5, p1-u05-client-auth.AC5.1, p1-u05-client-auth.AC5.2

**Files:**

- Create: `src/paprika/client.test.ts`

**Testing:**

The test file must cover every AC listed in this phase. Use msw `setupServer` to intercept HTTP requests. The server is created per-file, not globally (no vitest setup file exists or should be created).

Tests must verify each AC:

- **p1-u05-client-auth.AC5.1:** `new PaprikaClient(email, password)` does not throw
- **p1-u05-client-auth.AC5.2:** `PaprikaClient` is exported (implicit — if import works, it's exported)
- **p1-u05-client-auth.AC1.1:** `authenticate()` POSTs form-encoded email and password to `https://paprikaapp.com/api/v1/account/login/` — verify by inspecting the intercepted request's body and method in the msw handler
- **p1-u05-client-auth.AC1.2:** After successful auth, the token is stored. Since `token` is private, verify indirectly: call `authenticate()` twice and verify the msw handler receives both requests (proving the method works repeatably and resolves without error). Full behavioral verification (token sent as Bearer header) is tested in P1-U06 when public methods that use the token exist.
- **p1-u05-client-auth.AC1.3:** Response is validated with Zod — the successful path implicitly tests this
- **p1-u05-client-auth.AC1.4:** Non-2xx response (e.g., 403) throws `PaprikaAuthError` with status in message
- **p1-u05-client-auth.AC1.5:** Malformed response (valid JSON but missing `result.token`) throws `ZodError`

Test structure should follow the established AC naming convention:

```
describe("PaprikaClient", () => {
  describe("p1-u05-client-auth.AC5: Construction and module structure", () => { ... })
  describe("p1-u05-client-auth.AC1: Authentication works correctly", () => { ... })
})
```

MSW server lifecycle:

```typescript
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { beforeAll, afterAll, afterEach } from "vitest";

const server = setupServer();

beforeAll(() => {
  server.listen();
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
```

For each test, use `server.use(http.post(...))` to set up per-test handlers. In the handler, inspect the request:

- Read form-encoded body with `new URLSearchParams(await request.text())`
- Return responses with `HttpResponse.json({ result: { token: "test-jwt-token" } })`
- Return errors with `HttpResponse.json({}, { status: 403 })`
- Return malformed responses with `HttpResponse.json({ wrong: "shape" })`

Import `ZodError` from `"zod"` to assert malformed response throws the correct error type.

**Verification:**

```bash
pnpm test
```

Expected: All tests pass.

```bash
pnpm lint
```

Expected: No warnings or errors.

**Commit:**

```bash
git add src/paprika/client.test.ts
git commit -m "test(paprika): add authentication tests for PaprikaClient"
```

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Verify all checks pass

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

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
