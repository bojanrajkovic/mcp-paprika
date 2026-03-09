# Configuration Loader Design

## Summary

This design introduces `src/utils/config.ts`, the single entry point for loading application
configuration at startup. The server needs Paprika API credentials, a sync schedule, and
optional Phase 3 feature flags (embeddings, Replicate token) before it can do anything useful.
Rather than scattering `process.env` reads and file I/O across the codebase, this module
centralizes configuration into one typed, validated result.

The implementation uses a four-layer priority chain: real environment variables win over `.env`
file values, which win over `config.json`, which win over zod schema defaults. The two file
sources load independently — dotenv mutates `process.env` at the first merge point, and a
manual deep-merge combines the resulting env overrides with the parsed JSON file at the second.
The merged raw object is then fed into a zod schema that handles type coercion (duration strings
to milliseconds, env var strings like `"true"` and `"0"` to booleans) and returns either a
fully-typed `PaprikaConfig` or a `ConfigError` with a human-readable reason. The function
signature is `Result<PaprikaConfig, ConfigError>`, following the neverthrow convention already
established by `parseDuration()`.

## Definition of Done

`src/utils/config.ts` exports `loadConfig()` returning `Result<PaprikaConfig, ConfigError>`, plus the `PaprikaConfig` and `EmbeddingConfig` types derived from a private zod schema. The function loads configuration from three sources (env vars > `.env` file > `config.json` > zod defaults), validates via zod, and returns a Result with a descriptive `ConfigError` on failure. All 8 env var mappings work (including the new `PAPRIKA_SYNC_ENABLED`). The `durationField` transform correctly unwraps `parseDuration()`'s Result type. Tests cover all source priority combinations, missing files, invalid input, and default behavior. A `src/utils/CLAUDE.md` update documents the new module contract.

## Acceptance Criteria

### config-loader.AC1: loadConfig returns valid PaprikaConfig

- **config-loader.AC1.1 Success:** `loadConfig()` returns `Result.ok` with `PaprikaConfig` when `PAPRIKA_EMAIL` and `PAPRIKA_PASSWORD` env vars are set (no files needed)
- **config-loader.AC1.2 Success:** `loadConfig()` returns `Result.ok` with `PaprikaConfig` when only `config.json` provides credentials (no env vars)
- **config-loader.AC1.3 Success:** Default `sync.enabled` is `true` when neither file nor env var provides it
- **config-loader.AC1.4 Success:** Default `sync.interval` is `900000` (15 minutes in ms) when neither file nor env var provides it
- **config-loader.AC1.5 Success:** `features` is `undefined` when no Phase 3 env vars or config block are present

### config-loader.AC2: Source priority chain

- **config-loader.AC2.1 Success:** Env var `PAPRIKA_EMAIL` overrides `config.json`'s `paprika.email`
- **config-loader.AC2.2 Success:** Real env vars override `.env` file values for the same variable
- **config-loader.AC2.3 Success:** `.env` file values override `config.json` values
- **config-loader.AC2.4 Success:** Zod defaults apply when no source provides a value

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

### config-loader.AC5: File handling

- **config-loader.AC5.1 Success:** Missing `config.json` (ENOENT) does not cause an error
- **config-loader.AC5.2 Success:** Missing `.env` file does not cause an error
- **config-loader.AC5.3 Failure:** `config.json` with invalid JSON produces `ConfigError` with kind `"invalid_json"`
- **config-loader.AC5.4 Failure:** `config.json` with permission error produces `ConfigError` with kind `"file_read_error"`

### config-loader.AC6: Validation errors

- **config-loader.AC6.1 Failure:** Missing `email` produces `ConfigError` with kind `"validation"` and message referencing `PAPRIKA_EMAIL`
- **config-loader.AC6.2 Failure:** Missing `password` produces `ConfigError` with kind `"validation"` and message referencing `PAPRIKA_PASSWORD`
- **config-loader.AC6.3 Failure:** Empty string `email` (`""`) fails validation (not treated as present)
- **config-loader.AC6.4 Success:** Validation errors are human-readable, not raw ZodError output

### config-loader.AC7: Type exports

- **config-loader.AC7.1 Success:** `PaprikaConfig` type is exported and has `paprika`, `sync`, and optional `features` fields
- **config-loader.AC7.2 Success:** `EmbeddingConfig` type is exported with required `apiKey`, `baseUrl`, `model` string fields
- **config-loader.AC7.3 Success:** `ConfigError` class is exported with `reason`, `kind` fields and static factory methods

## Glossary

- **neverthrow**: A TypeScript library that models success and failure as `Result<T, E>` values instead of thrown exceptions, forcing callers to handle both paths explicitly.
- **`Result<T, E>`**: The neverthrow type that is either `Result.ok(value: T)` or `Result.err(error: E)`. Used here so `loadConfig()` callers cannot accidentally ignore a configuration failure.
- **zod**: A TypeScript-first schema declaration and validation library. Schemas describe the expected shape and constraints of data; calling `.safeParse()` on a schema returns a discriminated union instead of throwing.
- **`safeParse()`**: The non-throwing zod validation method. Returns `{ success: true, data }` or `{ success: false, error: ZodError }`, which this design maps to `Result.ok` / `Result.err`.
- **`ZodIssue`**: A single validation problem from a zod parse failure — includes a path, a message, and a machine-readable error code. `ConfigError.validation()` formats these into a human-readable reason string.
- **`ctx.addIssue()`**: The zod API for reporting a custom validation error from inside a `.transform()` callback. `durationField` uses this to surface `DurationParseError` failures as proper zod issues rather than thrown exceptions.
- **dotenv**: A library that reads key=value pairs from a `.env` file and populates `process.env`. By default it does not overwrite variables that are already set, which enforces the "real env vars win over `.env`" rule.
- **XDG Base Directory**: A Linux/freedesktop convention that defines standard locations for application files: `$XDG_CONFIG_HOME` for config, `$XDG_DATA_HOME` for data, etc. The `env-paths` library implements this with platform equivalents on macOS and Windows.
- **`getConfigDir()`**: Project utility in `src/utils/xdg.ts` that returns the platform-appropriate config directory for `mcp-paprika` (e.g., `~/.config/mcp-paprika` on Linux).
- **`parseDuration()`**: Project utility in `src/utils/duration.ts` that parses duration strings and bare numbers into Luxon Duration values, returning `Result<Duration, DurationParseError>`. The `durationField` zod type unwraps this Result inside the schema.
- **`durationField`**: A custom zod type defined in this design that accepts `string | number`, calls `parseDuration()`, and outputs a `number` of milliseconds. Bridges neverthrow's Result type into zod's validation pipeline.
- **`booleanField`**: A custom zod type defined in this design that accepts `boolean | string` and coerces the strings `"true"`, `"false"`, `"1"`, `"0"` to booleans. Needed because env vars are always strings.
- **`ConfigError`**: The structured error type returned by `loadConfig()`. Has a `kind` discriminant (`"invalid_json"`, `"file_read_error"`, `"validation"`) and a `reason` string. Follows the `DurationParseError` pattern.
- **ENOENT**: POSIX error code for "no such file or directory." The design treats this as a non-error — a missing `config.json` or `.env` file simply means that source contributes no values.
- **Priority chain**: The ordered rule for resolving conflicts when multiple sources supply the same config key. Here: env vars > `.env` file > `config.json` > zod defaults.

## Architecture

Configuration loading uses a layered source pipeline. Each source is an independent function; sources merge in priority order and feed into zod validation which produces the typed result.

```
loadConfig()
  │
  ├─ loadDotEnv(configDir)            → void (populates process.env)
  ├─ readConfigFile(configDir)        → Result<Record<string, unknown>, ConfigError>
  ├─ buildEnvOverrides(process.env)   → Record<string, unknown>
  ├─ merge file config + env overrides
  └─ paprikaConfigSchema.safeParse()  → Result<PaprikaConfig, ConfigError>
```

**Priority chain (highest wins):** env vars > `.env` file > `config.json` > zod defaults.

The `.env` merge happens at the `process.env` level (dotenv's default behavior — does not override existing vars). The file-vs-env merge happens at the config object level (env overrides spread on top of file values). These are two separate merge points, but the priority chain holds.

### Module: `src/utils/config.ts`

**Public exports:**

```typescript
function loadConfig(): Result<PaprikaConfig, ConfigError>;
type PaprikaConfig = z.infer<typeof paprikaConfigSchema>;
type EmbeddingConfig = z.infer<typeof embeddingConfigSchema>;
```

```typescript
class ConfigError extends Error {
  readonly reason: string;
  readonly kind: "invalid_json" | "file_read_error" | "validation";

  static invalidJson(path: string, cause: unknown): ConfigError;
  static fileReadError(path: string, cause: unknown): ConfigError;
  static validation(issues: z.ZodIssue[]): ConfigError;
}
```

**Private (not exported):** zod schemas, `loadDotEnv`, `readConfigFile`, `buildEnvOverrides`.

### PaprikaConfig Shape

```typescript
interface PaprikaConfig {
  paprika: {
    email: string; // required, min 1 char
    password: string; // required, min 1 char
  };
  sync: {
    enabled: boolean; // default: true
    interval: number; // milliseconds, default: 900000 (15 min)
  };
  features?: {
    replicateApiToken?: string;
    embeddings?: EmbeddingConfig;
  };
}

interface EmbeddingConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}
```

### ConfigError

Follows the `DurationParseError` pattern: private constructor, static factory methods, readonly fields.

- **`invalidJson(path, cause)`** — `config.json` exists but isn't valid JSON
- **`fileReadError(path, cause)`** — non-ENOENT filesystem error reading `config.json`
- **`validation(issues)`** — zod validation failed; formats issues into human-readable `reason`

ENOENT is not an error — `readConfigFile` returns `ok({})` for missing files.

### Custom Zod Types

**`durationField`** — bridges `parseDuration()`'s neverthrow Result into zod's validation pipeline using `ctx.addIssue()` on error. Accepts `string | number`, outputs `number` (milliseconds).

**`booleanField`** — handles string-to-boolean coercion for env vars. Accepts `boolean | string`, outputs `boolean`. Valid strings: `"true"`, `"false"`, `"1"`, `"0"`.

### Environment Variable Mapping

| Env Var                 | Config Field                  | Added by this design |
| ----------------------- | ----------------------------- | -------------------- |
| `PAPRIKA_EMAIL`         | `paprika.email`               |                      |
| `PAPRIKA_PASSWORD`      | `paprika.password`            |                      |
| `PAPRIKA_SYNC_INTERVAL` | `sync.interval`               |                      |
| `PAPRIKA_SYNC_ENABLED`  | `sync.enabled`                | Yes                  |
| `REPLICATE_API_TOKEN`   | `features.replicateApiToken`  |                      |
| `OPENAI_API_KEY`        | `features.embeddings.apiKey`  |                      |
| `OPENAI_BASE_URL`       | `features.embeddings.baseUrl` |                      |
| `EMBEDDING_MODEL`       | `features.embeddings.model`   |                      |

### Config File Formats

**`config.json`** lives at `$XDG_CONFIG_HOME/mcp-paprika/config.json` (path from `getConfigDir()`). Structure mirrors the `PaprikaConfig` type directly. Read synchronously with `readFileSync` — config loading is a one-time startup cost.

**`.env`** lives at `$XDG_CONFIG_HOME/mcp-paprika/.env`. Loaded by `dotenv.config({ path })` with explicit path (not CWD-based — MCP servers are launched with unpredictable working directories).

## Existing Patterns

Investigation found established patterns in `src/utils/`:

- **Error classes:** `DurationParseError` in `src/utils/duration.ts` uses private constructor + `static fromInput()` factory + readonly `input`/`reason` fields. `ConfigError` follows this pattern with factory methods per error kind.
- **Result types:** `parseDuration()` returns `Result<Duration, DurationParseError>` via neverthrow. `loadConfig()` follows this convention.
- **XDG paths:** `getConfigDir()` in `src/utils/xdg.ts` returns a plain string path. No directory creation — just path computation.
- **Module organization:** Utilities are leaf modules in `src/utils/` with colocated tests.
- **CLAUDE.md contracts:** `src/utils/CLAUDE.md` documents module signatures, dependencies, and boundaries.

No divergence from existing patterns.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: ConfigError and Zod Schema

**Goal:** Define the `ConfigError` class and all zod schemas (`paprikaConfigSchema`, `embeddingConfigSchema`, `durationField`, `booleanField`) with correct `parseDuration` Result integration. Export `PaprikaConfig`, `EmbeddingConfig`, and `ConfigError` types.

**Components:**

- `ConfigError` class in `src/utils/config.ts` — error type with `kind` discriminant and static factories
- Zod schemas in `src/utils/config.ts` — `paprikaConfigSchema`, `embeddingConfigSchema`, custom `durationField` and `booleanField` types
- Tests in `src/utils/config.test.ts` — schema validation, duration field unwrapping, boolean coercion, defaults

**Dependencies:** P1-U09 (`parseDuration` from `src/utils/duration.ts`)

**Done when:** Schemas parse valid input correctly, reject invalid input with appropriate ConfigErrors, defaults populate, `durationField` correctly unwraps `parseDuration`'s Result, and all tests pass.

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: Source Loading and Merge Pipeline

**Goal:** Implement `readConfigFile`, `buildEnvOverrides`, `loadDotEnv`, merge logic, and the public `loadConfig()` function. Update `src/utils/CLAUDE.md`.

**Components:**

- Source functions in `src/utils/config.ts` — `readConfigFile`, `buildEnvOverrides`, `loadDotEnv`
- Public `loadConfig()` in `src/utils/config.ts` — orchestrates the pipeline
- Tests in `src/utils/config.test.ts` — env-only, file-only, priority/merge, missing files, invalid JSON, permissions errors, `.env` loading, `PAPRIKA_SYNC_ENABLED`, features undefined when no Phase 3 vars set
- Contract update in `src/utils/CLAUDE.md` — document `config.ts` signature, exports, and boundaries

**Dependencies:** Phase 1 (schemas and ConfigError), P1-U03 (`getConfigDir` from `src/utils/xdg.ts`)

**Done when:** `loadConfig()` correctly loads from all three sources with proper priority, returns `Result.ok` for valid config, returns `Result.err` with descriptive `ConfigError` for all failure modes, and all tests pass. CLAUDE.md updated.

<!-- END_PHASE_2 -->

## Additional Considerations

**`sync.interval` after parsing is milliseconds.** Callers use it directly in `setInterval()` — no conversion needed. The field name is `interval` in both JSON and TypeScript.

**Features block is fully optional.** When no Phase 3 env vars are set and no `features` block exists in `config.json`, `features` must be `undefined` — not an empty object. This prevents Phase 1 code from needing to handle Phase 3 types.

**Empty strings vs undefined.** An env var set to `""` does not satisfy `z.string().min(1)` for email/password. This is correct — empty credentials should fail validation.
