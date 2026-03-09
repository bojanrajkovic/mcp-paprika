# Paprika Type Definitions — Phase 3: Error Class Hierarchy

**Goal:** Create error classes in `src/paprika/errors.ts` with proper inheritance and ES2022+ cause chaining.

**Architecture:** Three-class hierarchy: `PaprikaError` (base) → `PaprikaAuthError` (auth failures) → standalone `PaprikaAPIError` (HTTP errors). All classes accept `ErrorOptions` for cause chaining. This is a leaf dependency — `errors.ts` imports nothing from `types.ts` or other `src/` modules.

**Tech Stack:** TypeScript 5.9, ES2024 target (ErrorOptions fully supported)

**Scope:** 3 phases from original design (phase 3 of 3)

**Codebase verified:** 2026-03-03

---

## Acceptance Criteria Coverage

This phase implements and tests:

### paprika-types.AC4: Error classes have correct hierarchy and fields

- **paprika-types.AC4.1 Success:** PaprikaAuthError instanceof PaprikaError instanceof Error
- **paprika-types.AC4.2 Success:** PaprikaAPIError exposes readonly status: number and endpoint: string
- **paprika-types.AC4.3 Success:** PaprikaAPIError formats message as "message (HTTP status from endpoint)"
- **paprika-types.AC4.4 Success:** All error classes accept ErrorOptions for cause chaining
- **paprika-types.AC4.5 Success:** Each error class sets this.name to match its class name

### paprika-types.AC5: Build and exports

- **paprika-types.AC5.1 Success:** pnpm build compiles with zero errors
- **paprika-types.AC5.2 Success:** pnpm typecheck passes
- **paprika-types.AC5.4 Success:** All error classes are named exports from src/paprika/errors.ts

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Create error class hierarchy

**Verifies:** paprika-types.AC4.1, paprika-types.AC4.2, paprika-types.AC4.3, paprika-types.AC4.4, paprika-types.AC4.5, paprika-types.AC5.4

**Files:**

- Create: `src/paprika/errors.ts`

**Context files to read first:**

- `/home/brajkovic/Projects/mcp-paprika/CLAUDE.md` — error handling conventions (static factory methods, neverthrow integration)
- `/home/brajkovic/Projects/mcp-paprika/src/paprika/CLAUDE.md` — module boundary contracts

**Implementation:**

Create `src/paprika/errors.ts` with three error classes. This file is a leaf dependency — it imports nothing from other `src/` modules.

**PaprikaError** — base class for all Paprika-related errors:

```typescript
export class PaprikaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PaprikaError";
  }
}
```

**PaprikaAuthError** — authentication failure, unrecoverable:

```typescript
export class PaprikaAuthError extends PaprikaError {
  constructor(message = "Authentication failed", options?: ErrorOptions) {
    super(message, options);
    this.name = "PaprikaAuthError";
  }
}
```

Note the default message parameter — `new PaprikaAuthError()` produces "Authentication failed".

**PaprikaAPIError** — HTTP error with status code and endpoint:

```typescript
export class PaprikaAPIError extends PaprikaError {
  readonly status: number;
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string, options?: ErrorOptions) {
    super(`${message} (HTTP ${status} from ${endpoint})`, options);
    this.name = "PaprikaAPIError";
    this.status = status;
    this.endpoint = endpoint;
  }
}
```

AC4.3 specifies the format: `"message (HTTP status from endpoint)"`. The formatted string becomes the Error's `message` property. The original `message`, `status`, and `endpoint` are preserved as separate fields for programmatic access.

All three classes:

- Set `this.name` to match the class name (AC4.5)
- Accept `ErrorOptions` as the last parameter for cause chaining (AC4.4)
- Are named exports (AC5.4)

**Verification:**

Run: `pnpm build`
Expected: Compiles with zero errors

Run: `pnpm typecheck`
Expected: Passes with zero errors

Run: `pnpm lint`
Expected: No warnings or errors

Run: `pnpm format:check`
Expected: All files formatted correctly (run `pnpm format` to fix if needed)

**Commit:** `feat(paprika): add PaprikaError, PaprikaAuthError, and PaprikaAPIError`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Tests for error class hierarchy

**Verifies:** paprika-types.AC4.1, paprika-types.AC4.2, paprika-types.AC4.3, paprika-types.AC4.4, paprika-types.AC4.5

**Files:**

- Create: `src/paprika/errors.test.ts`

**Context files to read first:**

- `/home/brajkovic/Projects/mcp-paprika/CLAUDE.md` — testing conventions (vitest, colocated tests)
- `/home/brajkovic/Projects/mcp-paprika/src/paprika/errors.ts` — the implementation from Task 1

**Testing:**

Tests must verify each AC listed above:

- **paprika-types.AC4.1:** Create a `PaprikaAuthError` instance. Assert `instanceof PaprikaAuthError`, `instanceof PaprikaError`, and `instanceof Error` are all `true`. Do the same for `PaprikaAPIError` (extends `PaprikaError` extends `Error`).

- **paprika-types.AC4.2:** Create a `PaprikaAPIError` with status `404` and endpoint `"/api/v2/sync/recipe/abc/"`. Assert `error.status === 404` and `error.endpoint === "/api/v2/sync/recipe/abc/"`. Assert both are readonly (use `// @ts-expect-error` to verify that assignment to `error.status` and `error.endpoint` produces compile errors).

- **paprika-types.AC4.3:** Create `new PaprikaAPIError("Not found", 404, "/api/v2/sync/recipe/abc/")`. Assert `error.message` equals `"Not found (HTTP 404 from /api/v2/sync/recipe/abc/)"`.

- **paprika-types.AC4.4:** Create each error class with `{ cause: new Error("original") }` as the options argument. Assert `error.cause instanceof Error` and `error.cause.message === "original"` for each class. Also test `PaprikaAuthError` with default message + cause: `new PaprikaAuthError(undefined, { cause: original })`.

- **paprika-types.AC4.5:** Assert `new PaprikaError("x").name === "PaprikaError"`, `new PaprikaAuthError().name === "PaprikaAuthError"`, `new PaprikaAPIError("x", 500, "/").name === "PaprikaAPIError"`.

Follow project testing patterns: vitest, colocated as `src/paprika/errors.test.ts`.

**Verification:**

Run: `pnpm typecheck`
Expected: Passes (verifies `@ts-expect-error` annotations for readonly fields)

Run: `pnpm test`
Expected: All tests pass

Run: `pnpm lint`
Expected: No warnings or errors

Run: `pnpm format:check`
Expected: All files formatted correctly (run `pnpm format` to fix if needed)

Run: `pnpm test --coverage`
Expected: Coverage for new code in `src/paprika/types.ts` and `src/paprika/errors.ts` meets >= 70% target

**Commit:** `test(paprika): add error class hierarchy tests`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
