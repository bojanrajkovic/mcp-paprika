# Cross-Cutting Utilities

Last verified: 2026-03-09

## Purpose

Shared utility functions and helpers used across multiple modules. Includes error base classes, logging helpers, and common transformations.

## Contracts

### xdg.ts — Platform-native application directory paths

Wraps `env-paths` v4 with app name `mcp-paprika` (no suffix). Exports 5 synchronous functions
that return absolute path strings. No I/O. No internal dependencies (leaf module).

| Function         | Returns                          |
| ---------------- | -------------------------------- |
| `getConfigDir()` | Platform-native config directory |
| `getCacheDir()`  | Platform-native cache directory  |
| `getDataDir()`   | Platform-native data directory   |
| `getLogDir()`    | Platform-native log directory    |
| `getTempDir()`   | Platform-native temp directory   |

### duration.ts — Recipe duration parsing and formatting

Parses duration strings in multiple formats (human-readable, ISO 8601, H:MM colon, bare
numbers) into Luxon `Duration` objects. Returns `Result<Duration, DurationParseError>` using
neverthrow. Formats durations as compact human-readable strings. No I/O. No internal
dependencies (leaf module).

| Function                   | Returns                                    |
| -------------------------- | ------------------------------------------ |
| `parseDuration(input)`     | `Result<Duration, DurationParseError>`     |
| `formatDuration(duration)` | Compact string (e.g., "1 hr 30 min") or "" |

| Class                | Extends | Fields                                      |
| -------------------- | ------- | ------------------------------------------- |
| `DurationParseError` | `Error` | `input: string \| number`, `reason: string` |

### config.ts — Configuration loading, validation, and type definitions

Provides config schema validation (zod), error handling, and type exports for Paprika MCP
configuration. Bridges neverthrow `Result` types and env-var string coercion into zod validation
pipeline via custom types `durationField` and `booleanField`. No I/O. Uses `duration.ts` for
duration parsing.

| Export                | Type      | Description                                                      |
| --------------------- | --------- | ---------------------------------------------------------------- |
| `paprikaConfigSchema` | ZodSchema | Zod schema for full config validation                            |
| `PaprikaConfig`       | Type      | Inferred config shape: `paprika`, `sync`, optional features      |
| `EmbeddingConfig`     | Type      | Inferred embedding config: required `apiKey`, `baseUrl`, `model` |
| `ConfigError`         | Class     | Error with `kind` discriminant and 3 static factories            |

| Method                        | Returns     | Purpose                                 |
| ----------------------------- | ----------- | --------------------------------------- |
| `ConfigError.invalidJson()`   | ConfigError | File parse error with JSON detail       |
| `ConfigError.fileReadError()` | ConfigError | File I/O error with system detail       |
| `ConfigError.validation()`    | ConfigError | Zod validation error with env var hints |

| Const (internal) | Type    | Purpose                                                       |
| ---------------- | ------- | ------------------------------------------------------------- |
| `durationField`  | ZodType | Custom zod type: accepts `string \| number`, outputs ms       |
| `booleanField`   | ZodType | Custom zod type: accepts `boolean \| string`, outputs boolean |
| `ENV_VAR_HINTS`  | Record  | Maps config paths to env var names for error messages         |

## Dependencies

- **Uses:** duration.ts (for `parseDuration`), zod (for schemas)
- **External packages:**
  - xdg.ts uses `env-paths`
  - duration.ts uses `luxon`, `parse-duration`, `neverthrow`
  - config.ts uses `zod`, `neverthrow`
- **Used by:** All other `src/` modules
- **Boundary:** Must not import from any other `src/` module except duration.ts (leaf dependency)
