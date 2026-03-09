# Config Loader Implementation Plan — Phase 2: Source Loading and Merge Pipeline

**Goal:** Implement the source loading functions, merge pipeline, and public `loadConfig()` function. Update `src/utils/CLAUDE.md` with the config module contract.

**Architecture:** Three independent source functions feed a merge pipeline. `loadDotEnv` populates `process.env` from a `.env` file (dotenv's default behavior preserves existing vars). `readConfigFile` reads `config.json` synchronously, treating ENOENT as empty config. `buildEnvOverrides` maps known env vars to the config object structure. The merged result feeds into `paprikaConfigSchema.safeParse()` from Phase 1, producing a typed `Result<PaprikaConfig, ConfigError>`.

**Tech Stack:** TypeScript 5.9, zod 3, neverthrow 8, dotenv 16, Node.js fs/path built-ins

**Scope:** 2 phases from original design (phase 2 of 2)

**Codebase verified:** 2026-03-08

---

## Acceptance Criteria Coverage

This phase implements and tests:

### config-loader.AC1: loadConfig returns valid PaprikaConfig

- **config-loader.AC1.1 Success:** `loadConfig()` returns `Result.ok` with `PaprikaConfig` when `PAPRIKA_EMAIL` and `PAPRIKA_PASSWORD` env vars are set (no files needed)
- **config-loader.AC1.2 Success:** `loadConfig()` returns `Result.ok` with `PaprikaConfig` when only `config.json` provides credentials (no env vars)

### config-loader.AC2: Source priority chain

- **config-loader.AC2.1 Success:** Env var `PAPRIKA_EMAIL` overrides `config.json`'s `paprika.email`
- **config-loader.AC2.2 Success:** Real env vars override `.env` file values for the same variable
- **config-loader.AC2.3 Success:** `.env` file values override `config.json` values
- **config-loader.AC2.4 Success:** Zod defaults apply when no source provides a value

### config-loader.AC5: File handling

- **config-loader.AC5.1 Success:** Missing `config.json` (ENOENT) does not cause an error
- **config-loader.AC5.2 Success:** Missing `.env` file does not cause an error
- **config-loader.AC5.3 Failure:** `config.json` with invalid JSON produces `ConfigError` with kind `"invalid_json"`
- **config-loader.AC5.4 Failure:** `config.json` with permission error produces `ConfigError` with kind `"file_read_error"`

---

<!-- START_TASK_1 -->

### Task 1: Source loading functions and loadConfig

**Verifies:** config-loader.AC1.1, config-loader.AC1.2, config-loader.AC2.1, config-loader.AC2.2, config-loader.AC2.3, config-loader.AC2.4, config-loader.AC5.1, config-loader.AC5.2, config-loader.AC5.3, config-loader.AC5.4

**Files:**

- Modify: `src/utils/config.ts` (add source functions, loadConfig, and new imports after Phase 1 content)
- Test: `src/utils/config.test.ts` (unit — add loadConfig test suites)

**Implementation:**

Modify `src/utils/config.ts` to add the source loading pipeline. Add these imports at the top of the file (alongside the existing Phase 1 imports of `z` and `parseDuration`):

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import dotenv from "dotenv";
import { ok, err, type Result } from "neverthrow";
import { getConfigDir } from "./xdg.js";
```

Add the following private helper functions and public `loadConfig()` after the existing Phase 1 code (schemas and types).

**isNodeError type guard** — narrows `unknown` to `NodeJS.ErrnoException` for type-safe filesystem error checking (avoids `as` assertions, aligns with `@tsconfig/strictest`):

```typescript
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
```

Use it as: `isNodeError(error) && error.code === "ENOENT"`. After the type guard narrows, `error.code` is type-safe without assertion.

**readConfigFile** — reads `config.json` from the config directory. ENOENT returns `ok({})` (missing file is not an error). Invalid JSON and permission errors return `err`:

```typescript
function readConfigFile(configDir: string): Result<Record<string, unknown>, ConfigError> {
  const filePath = join(configDir, "config.json");
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return ok({});
    }
    return err(ConfigError.fileReadError(filePath, error));
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return err(ConfigError.invalidJson(filePath, new Error("expected a JSON object")));
    }
    return ok(parsed as Record<string, unknown>);
  } catch (error: unknown) {
    return err(ConfigError.invalidJson(filePath, error));
  }
}
```

**loadDotEnv** — loads `.env` file from config directory into `process.env`. dotenv's default behavior does not override existing env vars (enforces "real env vars > .env" rule). Missing `.env` is silently ignored:

```typescript
function loadDotEnv(configDir: string): void {
  dotenv.config({ path: join(configDir, ".env") });
}
```

**buildEnvOverrides** — maps the 8 known env vars to the nested config object structure. Only includes keys that are actually present in the env:

```typescript
function buildEnvOverrides(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const paprika: Record<string, unknown> = {};
  const sync: Record<string, unknown> = {};
  const features: Record<string, unknown> = {};
  const embeddings: Record<string, unknown> = {};

  if (env.PAPRIKA_EMAIL !== undefined) paprika.email = env.PAPRIKA_EMAIL;
  if (env.PAPRIKA_PASSWORD !== undefined) paprika.password = env.PAPRIKA_PASSWORD;

  if (env.PAPRIKA_SYNC_INTERVAL !== undefined) sync.interval = env.PAPRIKA_SYNC_INTERVAL;
  if (env.PAPRIKA_SYNC_ENABLED !== undefined) sync.enabled = env.PAPRIKA_SYNC_ENABLED;

  if (env.REPLICATE_API_TOKEN !== undefined) features.replicateApiToken = env.REPLICATE_API_TOKEN;
  if (env.OPENAI_API_KEY !== undefined) embeddings.apiKey = env.OPENAI_API_KEY;
  if (env.OPENAI_BASE_URL !== undefined) embeddings.baseUrl = env.OPENAI_BASE_URL;
  if (env.EMBEDDING_MODEL !== undefined) embeddings.model = env.EMBEDDING_MODEL;

  if (Object.keys(embeddings).length > 0) features.embeddings = embeddings;
  if (Object.keys(features).length > 0) overrides.features = features;
  if (Object.keys(paprika).length > 0) overrides.paprika = paprika;
  if (Object.keys(sync).length > 0) overrides.sync = sync;

  return overrides;
}
```

**deepMerge** — recursively merges two config objects. Values in `overrides` win for non-object fields. Objects are merged recursively:

```typescript
function deepMerge(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overrides)) {
    const baseVal = base[key];
    const overVal = overrides[key];
    if (
      typeof baseVal === "object" &&
      baseVal !== null &&
      !Array.isArray(baseVal) &&
      typeof overVal === "object" &&
      overVal !== null &&
      !Array.isArray(overVal)
    ) {
      result[key] = deepMerge(baseVal as Record<string, unknown>, overVal as Record<string, unknown>);
    } else {
      result[key] = overVal;
    }
  }
  return result;
}
```

**loadConfig** — public function that orchestrates the full pipeline. Accepts an optional `configDir` parameter for testability (defaults to `getConfigDir()`):

```typescript
export function loadConfig(configDir?: string): Result<PaprikaConfig, ConfigError> {
  const dir = configDir ?? getConfigDir();

  loadDotEnv(dir);

  const fileResult = readConfigFile(dir);
  if (fileResult.isErr()) {
    return err(fileResult.error);
  }

  const envOverrides = buildEnvOverrides(process.env);
  const merged = deepMerge(fileResult.value, envOverrides);

  const parseResult = paprikaConfigSchema.safeParse(merged);
  if (!parseResult.success) {
    return err(ConfigError.validation(parseResult.error.issues));
  }

  return ok(parseResult.data);
}
```

Key design decisions:

- `loadConfig(configDir?)` accepts an optional directory parameter because `getConfigDir()` caches the path at module load time (via `env-paths`), making it impossible to redirect in tests. This is backward-compatible — production callers pass no args.
- The pipeline order is: loadDotEnv → readConfigFile → buildEnvOverrides → deepMerge → safeParse. This ensures dotenv populates `process.env` before `buildEnvOverrides` reads it, giving us the correct priority chain: real env vars > `.env` > `config.json` > zod defaults.
- `readConfigFile` validates that parsed JSON is an object (not an array, string, or number) before returning it. This produces a clear "expected a JSON object" error instead of a confusing zod validation failure downstream.

**Testing:**

Add test suites to `src/utils/config.test.ts` for the loadConfig integration tests. These tests exercise the full pipeline.

**Test infrastructure:** Each test needs:

1. A temp directory created with `mkdtempSync(join(tmpdir(), "config-test-"))` from `node:fs` and `node:os`
2. Explicit save/restore of config-related env vars in `beforeEach`/`afterEach` (see pattern below)
3. Cleanup of the temp directory in `afterEach` using `rmSync(tempDir, { recursive: true, force: true })`

Import `{ loadConfig }` from `"./config.js"`. Import `{ mkdtempSync, writeFileSync, rmSync, chmodSync }` from `"node:fs"`, `{ tmpdir }` from `"node:os"`, `{ join }` from `"node:path"`.

**IMPORTANT: `loadDotEnv` calls `dotenv.config()` which mutates `process.env`** — any variable from the `.env` file that is not already set will persist in `process.env` for subsequent tests. The save/restore pattern must handle vars added by dotenv, not just vars you set manually. Use this concrete pattern:

```typescript
const CONFIG_ENV_VARS = [
  "PAPRIKA_EMAIL",
  "PAPRIKA_PASSWORD",
  "PAPRIKA_SYNC_INTERVAL",
  "PAPRIKA_SYNC_ENABLED",
  "REPLICATE_API_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "EMBEDDING_MODEL",
] as const;

let tempDir: string;
let savedEnv: Map<string, string | undefined>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "config-test-"));
  savedEnv = new Map();
  for (const key of CONFIG_ENV_VARS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  rmSync(tempDir, { recursive: true, force: true });
});
```

The `beforeEach` saves the original value of each config env var (including `undefined` if not set), then deletes them all to ensure a clean slate. The `afterEach` restores each var to its original state — either the saved value or `delete` if it was originally unset. This catches vars added by `dotenv.config()` during the test.

Use a helper function to write `config.json` to the temp dir:

```typescript
function writeConfig(dir: string, config: Record<string, unknown>): void {
  writeFileSync(join(dir, "config.json"), JSON.stringify(config));
}
```

And a helper to write `.env` files:

```typescript
function writeDotEnv(dir: string, vars: Record<string, string>): void {
  const content = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  writeFileSync(join(dir, ".env"), content);
}
```

Tests must verify each AC listed above:

**config-loader.AC1: loadConfig success paths** — group in `describe("config-loader.AC1: loadConfig returns valid PaprikaConfig", ...)`

- config-loader.AC1.1: Set `process.env.PAPRIKA_EMAIL = "user@test.com"` and `process.env.PAPRIKA_PASSWORD = "secret"`. Do NOT create any files in temp dir. Call `loadConfig(tempDir)`. Verify `result.isOk()` is true and `result.value.paprika.email === "user@test.com"`.
- config-loader.AC1.2: Write `config.json` to temp dir with `{ "paprika": { "email": "user@test.com", "password": "secret" } }`. Do NOT set any env vars. Call `loadConfig(tempDir)`. Verify `result.isOk()` is true and `result.value.paprika.email === "user@test.com"`.

**config-loader.AC2: Source priority chain** — group in `describe("config-loader.AC2: Source priority chain", ...)`

- config-loader.AC2.1: Write `config.json` with `{ "paprika": { "email": "file@test.com", "password": "filepw" } }`. Set `process.env.PAPRIKA_EMAIL = "env@test.com"`. Call `loadConfig(tempDir)`. Verify `result.value.paprika.email === "env@test.com"` (env var wins) and `result.value.paprika.password === "filepw"` (file value preserved for non-conflicting key).
- config-loader.AC2.2: Write `.env` file with `PAPRIKA_EMAIL=dotenv@test.com` and `PAPRIKA_PASSWORD=dotenvpw`. Set `process.env.PAPRIKA_EMAIL = "real@test.com"` BEFORE calling loadConfig. Call `loadConfig(tempDir)`. Verify `result.value.paprika.email === "real@test.com"` (real env var wins over .env) and `result.value.paprika.password === "dotenvpw"` (.env provides password since no real env var for it).
- config-loader.AC2.3: Write `config.json` with `{ "paprika": { "email": "file@test.com", "password": "filepw" } }`. Write `.env` file with `PAPRIKA_EMAIL=dotenv@test.com`. Do NOT set any real env vars. Call `loadConfig(tempDir)`. Verify `result.value.paprika.email === "dotenv@test.com"` (.env wins over config.json).
- config-loader.AC2.4: Set `process.env.PAPRIKA_EMAIL = "user@test.com"` and `process.env.PAPRIKA_PASSWORD = "secret"`. Do NOT create any files. Call `loadConfig(tempDir)`. Verify `result.value.sync.enabled === true` and `result.value.sync.interval === 900000` (zod defaults apply).

**config-loader.AC5: File handling** — group in `describe("config-loader.AC5: File handling", ...)`

- config-loader.AC5.1: Set credentials in env vars. Do NOT create `config.json` in temp dir. Call `loadConfig(tempDir)`. Verify `result.isOk()` is true (missing config.json is not an error).
- config-loader.AC5.2: Write `config.json` with valid credentials. Do NOT create `.env` file. Call `loadConfig(tempDir)`. Verify `result.isOk()` is true (missing .env is not an error).
- config-loader.AC5.3: Write invalid JSON content (e.g., `"not valid json {"`) to `config.json` in temp dir. Call `loadConfig(tempDir)`. Verify `result.isErr()` is true and `result.error.kind === "invalid_json"`.
- config-loader.AC5.4: Write valid `config.json` to temp dir, then `chmodSync(join(tempDir, "config.json"), 0o000)` to remove all permissions. Call `loadConfig(tempDir)`. Verify `result.isErr()` is true and `result.error.kind === "file_read_error"`. Restore permissions in `afterEach` to allow cleanup: `chmodSync(join(tempDir, "config.json"), 0o644)`. Note: this test may need to be skipped when running as root (root can read files regardless of permissions).

**Property-based tests** — add to `src/utils/config.property.test.ts` using `fast-check` (already a dev dependency). Follow the pattern from `src/utils/duration.property.test.ts`:

- **deepMerge identity:** `deepMerge(base, {})` deep-equals `base` for any generated config object. Use `fc.object()` to generate arbitrary nested objects. This validates that merging with an empty override produces no changes.
- **deepMerge override dominance:** For any two objects `base` and `overrides`, every key present in `overrides` at the top level appears in the result. This validates that override values are never lost.
- **booleanField idempotence:** Parsing an already-parsed boolean through `booleanField` returns the same value. Use `fc.constantFrom(true, false)` to generate booleans, parse them, and verify the result equals the input.

Since `deepMerge` and `booleanField` are private to `config.ts`, test these properties through the public API:

- For deepMerge: test through `loadConfig()` by providing the same credential value in both `config.json` and env var, verifying the result matches the env var (override dominance). Or export `deepMerge` for direct property testing — since it's a pure function with no side effects, direct testing is cleaner.
- For booleanField: test through `paprikaConfigSchema.safeParse()` with boolean values for `sync.enabled`.

If exporting `deepMerge` for testing, add an `@internal` JSDoc annotation to signal it's not part of the public API.

**Verification:**

Run: `pnpm test src/utils/config.test.ts src/utils/config.property.test.ts`
Expected: All tests pass (Phase 1 + Phase 2 tests + property tests).

Run: `pnpm typecheck`
Expected: No type errors.

**Commit:** `feat(config): add loadConfig with source loading and merge pipeline`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Update src/utils/CLAUDE.md with config.ts contract

**Verifies:** None (infrastructure — documentation update)

**Files:**

- Modify: `src/utils/CLAUDE.md` (add config.ts contract section)

**Implementation:**

Add a new section to `src/utils/CLAUDE.md` documenting the config.ts module contract, following the existing pattern for xdg.ts and duration.ts sections. Place the new section after the duration.ts contract section and before the Dependencies section.

Add the following section:

```markdown
### config.ts — Application configuration loading

Loads configuration from three sources with priority: env vars > `.env` file > `config.json` > zod
defaults. Returns `Result<PaprikaConfig, ConfigError>` using neverthrow. Config files are read from
`getConfigDir()` (or an explicit path for testing). Synchronous — config loading is a one-time
startup cost.

| Function       | Returns                              |
| -------------- | ------------------------------------ |
| `loadConfig()` | `Result<PaprikaConfig, ConfigError>` |

| Type              | Description                                                      |
| ----------------- | ---------------------------------------------------------------- |
| `PaprikaConfig`   | `{ paprika, sync, features? }` — validated application config    |
| `EmbeddingConfig` | `{ apiKey, baseUrl, model }` — Phase 3 embedding provider config |

| Class         | Extends | Fields                                                                        |
| ------------- | ------- | ----------------------------------------------------------------------------- |
| `ConfigError` | `Error` | `kind: "invalid_json" \| "file_read_error" \| "validation"`, `reason: string` |
```

Also update the "Last verified" date to the current date and **replace the entire Dependencies section** with the following, which distinguishes leaf modules from non-leaf modules:

```markdown
## Dependencies

- **Leaf modules (no internal imports):** `xdg.ts` (uses `env-paths`), `duration.ts` (uses `luxon`, `parse-duration`, `neverthrow`)
- **Non-leaf modules:** `config.ts` imports from `xdg.ts` and `duration.ts`; also uses `dotenv`, `zod`, `neverthrow`
- **Used by:** All other `src/` modules may import from `src/utils/`
```

This replaces the existing text which incorrectly claims all utils are leaf modules. The boundary constraint "must not import from any other `src/` module" applies only to `xdg.ts` and `duration.ts`, not to `config.ts`.

**Verification:**

Visually inspect the updated CLAUDE.md for consistency with existing sections.

**Commit:** `docs(utils): add config.ts contract to CLAUDE.md`

<!-- END_TASK_2 -->
