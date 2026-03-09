# Config Loader Implementation Plan — Phase 1: ConfigError and Zod Schema

**Goal:** Define the ConfigError class and all zod schemas with correct parseDuration Result integration, providing the foundation for the full config loader.

**Architecture:** ConfigError follows the DurationParseError pattern (private constructor, static factories, readonly fields). Custom zod types durationField and booleanField bridge neverthrow Result types and env-var-string coercion into the zod validation pipeline. The main paprikaConfigSchema composes these custom types into the full config shape.

**Tech Stack:** TypeScript 5.9, zod 3, neverthrow 8, luxon 3, parse-duration 2

**Scope:** 2 phases from original design (phase 1 of 2)

**Codebase verified:** 2026-03-08

---

## Acceptance Criteria Coverage

This phase implements and tests:

### config-loader.AC1: loadConfig returns valid PaprikaConfig

- **config-loader.AC1.3 Success:** Default `sync.enabled` is `true` when neither file nor env var provides it
- **config-loader.AC1.4 Success:** Default `sync.interval` is `900000` (15 minutes in ms) when neither file nor env var provides it
- **config-loader.AC1.5 Success:** `features` is `undefined` when no Phase 3 env vars or config block are present

### config-loader.AC3: Duration field

- **config-loader.AC3.1 Success:** `sync.interval` accepts `"15m"` and resolves to `900000`
- **config-loader.AC3.2 Success:** `sync.interval` accepts `"PT15M"` (ISO 8601) and resolves to `900000`
- **config-loader.AC3.3 Success:** `sync.interval` accepts `15` (number, minutes) and resolves to `900000`
- **config-loader.AC3.4 Failure:** `sync.interval` of `"abc"` produces `ConfigError` with kind `"validation"`

### config-loader.AC4: Boolean field (PAPRIKA_SYNC_ENABLED)

- **config-loader.AC4.1 Success:** `PAPRIKA_SYNC_ENABLED=true` sets `sync.enabled` to `true`
- **config-loader.AC4.2 Success:** `PAPRIKA_SYNC_ENABLED=false` sets `sync.enabled` to `false`
- **config-loader.AC4.3 Success:** `PAPRIKA_SYNC_ENABLED=1` sets `sync.enabled` to `true`
- **config-loader.AC4.4 Success:** `PAPRIKA_SYNC_ENABLED=0` sets `sync.enabled` to `false`
- **config-loader.AC4.5 Failure:** `PAPRIKA_SYNC_ENABLED=yes` produces `ConfigError` with kind `"validation"`

### config-loader.AC6: Validation errors

- **config-loader.AC6.1 Failure:** Missing `email` produces `ConfigError` with kind `"validation"` and message referencing `PAPRIKA_EMAIL`
- **config-loader.AC6.2 Failure:** Missing `password` produces `ConfigError` with kind `"validation"` and message referencing `PAPRIKA_PASSWORD`
- **config-loader.AC6.3 Failure:** Empty string `email` (`""`) fails validation (not treated as present)
- **config-loader.AC6.4 Success:** Validation errors are human-readable, not raw ZodError output

### config-loader.AC7: Type exports

- **config-loader.AC7.1 Success:** `PaprikaConfig` type is exported and has `paprika`, `sync`, and optional `features` fields
- **config-loader.AC7.2 Success:** `EmbeddingConfig` type is exported with required `apiKey`, `baseUrl`, `model` string fields
- **config-loader.AC7.3 Success:** `ConfigError` class is exported with `reason`, `kind` fields and static factory methods

---

<!-- START_TASK_1 -->

### Task 1: ConfigError class

**Verifies:** config-loader.AC7.3, config-loader.AC6.4

**Files:**

- Create: `src/utils/config.ts`
- Test: `src/utils/config.test.ts` (unit)

**Implementation:**

Create `src/utils/config.ts` with the ConfigError class following the DurationParseError pattern from `src/utils/duration.ts:5-18`. Key differences: ConfigError has a `kind` discriminant instead of `input`, and has three static factory methods instead of one.

Include a module-level constant mapping config paths to env var names, used by the `validation()` factory to produce human-readable error messages with env var hints:

```typescript
import { z } from "zod";

const ENV_VAR_HINTS: Readonly<Record<string, string>> = {
  "paprika.email": "PAPRIKA_EMAIL",
  "paprika.password": "PAPRIKA_PASSWORD",
  "sync.interval": "PAPRIKA_SYNC_INTERVAL",
  "sync.enabled": "PAPRIKA_SYNC_ENABLED",
  "features.replicateApiToken": "REPLICATE_API_TOKEN",
  "features.embeddings.apiKey": "OPENAI_API_KEY",
  "features.embeddings.baseUrl": "OPENAI_BASE_URL",
  "features.embeddings.model": "EMBEDDING_MODEL",
};

export class ConfigError extends Error {
  readonly reason: string;
  readonly kind: "invalid_json" | "file_read_error" | "validation";

  private constructor(reason: string, kind: ConfigError["kind"]) {
    super(reason);
    this.name = "ConfigError";
    this.reason = reason;
    this.kind = kind;
  }

  static invalidJson(path: string, cause: unknown): ConfigError {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return new ConfigError(`Invalid JSON in ${path}: ${detail}`, "invalid_json");
  }

  static fileReadError(path: string, cause: unknown): ConfigError {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return new ConfigError(`Cannot read ${path}: ${detail}`, "file_read_error");
  }

  static validation(issues: ReadonlyArray<z.ZodIssue>): ConfigError {
    const lines = issues.map((issue) => {
      const path = issue.path.join(".");
      const hint = ENV_VAR_HINTS[path];
      const suffix = hint ? ` (set via ${hint})` : "";
      return `  - ${path}: ${issue.message}${suffix}`;
    });
    const reason = `Configuration validation failed:\n${lines.join("\n")}`;
    return new ConfigError(reason, "validation");
  }
}
```

**Testing:**

Create `src/utils/config.test.ts` with a top-level `describe("Configuration loading", () => { ... })`. Follow the test naming convention from `src/utils/duration.test.ts`: use AC IDs as test name prefixes.

Tests must verify each AC listed above:

- config-loader.AC7.3: Test that ConfigError is an instance of Error, has readonly `reason` and `kind` fields, and has the three static factory methods. Verify each factory:
  - `ConfigError.invalidJson("/path/config.json", new Error("unexpected token"))` produces an error with `kind === "invalid_json"` and `reason` containing the path and cause message.
  - `ConfigError.fileReadError("/path/config.json", new Error("EACCES"))` produces an error with `kind === "file_read_error"` and `reason` containing the path and cause message.
  - `ConfigError.validation(mockZodIssues)` produces an error with `kind === "validation"` (detailed formatting tested in AC6.4).
- config-loader.AC6.4: Test that `ConfigError.validation()` produces a formatted, human-readable string — not a raw ZodError dump. Create a `z.ZodIssue` array with path `["paprika", "email"]` and message `"Required"`, pass to `validation()`, verify the reason string includes formatted path `"paprika.email"`, message `"Required"`, and env var hint `"(set via PAPRIKA_EMAIL)"`. The output format should be multi-line: `"Configuration validation failed:\n  - paprika.email: Required (set via PAPRIKA_EMAIL)"`.

Import from vitest: `{ describe, it, expect }`. Import from module: `{ ConfigError } from "./config.js"`. Import `{ z } from "zod"` for constructing mock ZodIssue objects.

**Verification:**

Run: `pnpm test src/utils/config.test.ts`
Expected: All ConfigError tests pass.

**Commit:** `feat(config): add ConfigError class with static factory methods`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Zod schemas, custom types, and type exports

**Verifies:** config-loader.AC3.1, config-loader.AC3.2, config-loader.AC3.3, config-loader.AC3.4, config-loader.AC4.1, config-loader.AC4.2, config-loader.AC4.3, config-loader.AC4.4, config-loader.AC4.5, config-loader.AC1.3, config-loader.AC1.4, config-loader.AC1.5, config-loader.AC6.1, config-loader.AC6.2, config-loader.AC6.3, config-loader.AC7.1, config-loader.AC7.2

**Files:**

- Modify: `src/utils/config.ts` (add schemas and types after ConfigError class)
- Test: `src/utils/config.test.ts` (unit — add schema test suites)

**Implementation:**

Add the following to `src/utils/config.ts` after the ConfigError class. Add `import { parseDuration } from "./duration.js";` to the top-level imports.

**durationField** — custom zod type that bridges `parseDuration()`'s neverthrow Result into zod's validation pipeline using `ctx.addIssue()`. Accepts `string | number`, outputs `number` (milliseconds):

```typescript
import { parseDuration } from "./duration.js";

const durationField = z.union([z.string(), z.number()]).transform((val, ctx) => {
  const result = parseDuration(val);
  if (result.isErr()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: result.error.reason,
    });
    return z.NEVER;
  }
  return result.value.as("milliseconds");
});
```

**booleanField** — custom zod type for env-var string-to-boolean coercion. Accepts `boolean | string`, outputs `boolean`. Valid strings: `"true"`, `"false"`, `"1"`, `"0"`:

```typescript
const BOOLEAN_STRINGS: Readonly<Record<string, boolean>> = {
  true: true,
  false: false,
  "1": true,
  "0": false,
};

const booleanField = z.union([z.boolean(), z.string()]).transform((val, ctx) => {
  if (typeof val === "boolean") {
    return val;
  }
  const mapped = BOOLEAN_STRINGS[val];
  if (mapped === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `expected "true", "false", "1", or "0", got ${JSON.stringify(val)}`,
    });
    return z.NEVER;
  }
  return mapped;
});
```

**Schemas and type exports:**

```typescript
const embeddingConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().min(1),
  model: z.string().min(1),
});

export const paprikaConfigSchema = z.object({
  paprika: z
    .object({
      email: z.string().min(1),
      password: z.string().min(1),
    })
    .default({}),
  sync: z
    .object({
      enabled: booleanField.default(true),
      interval: durationField.default("15m"),
    })
    .default({}),
  features: z
    .object({
      replicateApiToken: z.string().min(1).optional(),
      embeddings: embeddingConfigSchema.optional(),
    })
    .optional(),
});

export type PaprikaConfig = z.infer<typeof paprikaConfigSchema>;
export type EmbeddingConfig = z.infer<typeof embeddingConfigSchema>;
```

Key design decisions:

- `paprika` has `.default({})` so validation drills down to individual fields (email, password) even when the paprika object is entirely absent. This produces error messages referencing specific env vars (PAPRIKA_EMAIL) instead of just "paprika: Required".
- `sync` has `.default({})` so defaults apply when the entire sync block is missing.
- `features` is `.optional()` with NO default — it is `undefined` when not provided (AC1.5).
- `durationField.default("15m")` — the default string goes through parseDuration during parsing, producing 900000 ms (AC1.4).
- `booleanField.default(true)` — the default boolean passes through booleanField's transform unchanged (AC1.3).
- `paprikaConfigSchema` is exported so tests can call `.safeParse()` directly. The `loadConfig()` wrapper added in Phase 2 is the primary public API.

**Testing:**

Add test suites to `src/utils/config.test.ts` nested under the existing `describe("Configuration loading", ...)` block. Import `{ paprikaConfigSchema, type PaprikaConfig, type EmbeddingConfig }` from `"./config.js"`.

A "valid base config" for tests means `{ paprika: { email: "user@test.com", password: "secret" } }`. Extend or reduce this base for each specific test.

Tests must verify each AC listed above:

**config-loader.AC3: Duration field** — group in `describe("config-loader.AC3: Duration field", ...)`

- config-loader.AC3.1: safeParse valid base config with `sync: { interval: "15m" }` → `result.success` is true, `result.data.sync.interval` is `900000`
- config-loader.AC3.2: safeParse valid base with `sync: { interval: "PT15M" }` → `result.success` is true, `result.data.sync.interval` is `900000`
- config-loader.AC3.3: safeParse valid base with `sync: { interval: 15 }` → `result.success` is true, `result.data.sync.interval` is `900000`. Note: `parseDuration()` in `src/utils/duration.ts:56-63` treats bare numbers as minutes, so `15` means "15 minutes" = 900000 ms.
- config-loader.AC3.4: safeParse valid base with `sync: { interval: "abc" }` → `result.success` is false

**config-loader.AC4: Boolean field** — group in `describe("config-loader.AC4: Boolean field (PAPRIKA_SYNC_ENABLED)", ...)`

- config-loader.AC4.1: safeParse valid base with `sync: { enabled: "true" }` → `result.data.sync.enabled` is `true`
- config-loader.AC4.2: safeParse valid base with `sync: { enabled: "false" }` → `result.data.sync.enabled` is `false`
- config-loader.AC4.3: safeParse valid base with `sync: { enabled: "1" }` → `result.data.sync.enabled` is `true`
- config-loader.AC4.4: safeParse valid base with `sync: { enabled: "0" }` → `result.data.sync.enabled` is `false`
- config-loader.AC4.5: safeParse valid base with `sync: { enabled: "yes" }` → `result.success` is `false`

**config-loader.AC1: Defaults** — group in `describe("config-loader.AC1: Defaults", ...)`

- config-loader.AC1.3: safeParse valid base config only (no sync block) → `result.data.sync.enabled` is `true`
- config-loader.AC1.4: safeParse valid base config only (no sync block) → `result.data.sync.interval` is `900000`
- config-loader.AC1.5: safeParse valid base config only (no features block) → `result.data.features` is `undefined`

**config-loader.AC6: Validation errors** — group in `describe("config-loader.AC6: Validation errors", ...)`

For AC6.1-6.3, call `paprikaConfigSchema.safeParse()` with invalid input, then pass the resulting `result.error.issues` to `ConfigError.validation()` to test the full error chain:

- config-loader.AC6.1: safeParse `{ paprika: {} }` (no email, no password) → fails. `ConfigError.validation(result.error.issues).reason` contains `"PAPRIKA_EMAIL"`
- config-loader.AC6.2: safeParse `{ paprika: {} }` → `ConfigError.validation(result.error.issues).reason` contains `"PAPRIKA_PASSWORD"`
- config-loader.AC6.3: safeParse `{ paprika: { email: "", password: "secret" } }` → `result.success` is `false` (empty string doesn't satisfy `min(1)`)

**config-loader.AC7: Type exports** — group in `describe("config-loader.AC7: Type exports", ...)`

- config-loader.AC7.1: safeParse valid base config → `result.data` has fields `paprika` (object with email/password), `sync` (object with enabled/interval), and `features` (undefined). Verify the presence and types of these fields at runtime.
- config-loader.AC7.2: Compile-time verification that `EmbeddingConfig` has required `apiKey`, `baseUrl`, `model` string fields. Create a const of type `EmbeddingConfig` with all three fields and verify it compiles. Optionally verify the schema rejects an object missing one of these fields.

**Verification:**

Run: `pnpm test src/utils/config.test.ts`
Expected: All tests pass.

Run: `pnpm typecheck`
Expected: No type errors.

**Commit:** `feat(config): add zod schemas, custom types, and PaprikaConfig/EmbeddingConfig exports`

<!-- END_TASK_2 -->
