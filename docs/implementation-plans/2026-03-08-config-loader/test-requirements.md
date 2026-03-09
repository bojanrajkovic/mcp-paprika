# Config Loader — Test Requirements

Generated from: docs/design-plans/2026-03-08-config-loader.md

## Automated Tests

| AC ID               | Criterion                                                                                                                              | Test Type | Test File                  | Phase |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------- | ----- |
| config-loader.AC1.1 | `loadConfig()` returns `Result.ok` with `PaprikaConfig` when `PAPRIKA_EMAIL` and `PAPRIKA_PASSWORD` env vars are set (no files needed) | Unit      | `src/utils/config.test.ts` | 2     |
| config-loader.AC1.2 | `loadConfig()` returns `Result.ok` with `PaprikaConfig` when only `config.json` provides credentials (no env vars)                     | Unit      | `src/utils/config.test.ts` | 2     |
| config-loader.AC1.3 | Default `sync.enabled` is `true` when neither file nor env var provides it                                                             | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC1.4 | Default `sync.interval` is `900000` (15 min in ms) when neither file nor env var provides it                                           | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC1.5 | `features` is `undefined` when no Phase 3 env vars or config block are present                                                         | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC2.1 | Env var `PAPRIKA_EMAIL` overrides `config.json`'s `paprika.email`                                                                      | Unit      | `src/utils/config.test.ts` | 2     |
| config-loader.AC2.2 | Real env vars override `.env` file values for the same variable                                                                        | Unit      | `src/utils/config.test.ts` | 2     |
| config-loader.AC2.3 | `.env` file values override `config.json` values                                                                                       | Unit      | `src/utils/config.test.ts` | 2     |
| config-loader.AC2.4 | Zod defaults apply when no source provides a value                                                                                     | Unit      | `src/utils/config.test.ts` | 2     |
| config-loader.AC3.1 | `sync.interval` accepts `"15m"` and resolves to `900000`                                                                               | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC3.2 | `sync.interval` accepts `"PT15M"` (ISO 8601) and resolves to `900000`                                                                  | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC3.3 | `sync.interval` accepts `15` (number, minutes) and resolves to `900000`                                                                | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC3.4 | `sync.interval` of `"abc"` produces `ConfigError` with kind `"validation"`                                                             | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC4.1 | `PAPRIKA_SYNC_ENABLED=true` sets `sync.enabled` to `true`                                                                              | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC4.2 | `PAPRIKA_SYNC_ENABLED=false` sets `sync.enabled` to `false`                                                                            | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC4.3 | `PAPRIKA_SYNC_ENABLED=1` sets `sync.enabled` to `true`                                                                                 | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC4.4 | `PAPRIKA_SYNC_ENABLED=0` sets `sync.enabled` to `false`                                                                                | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC4.5 | `PAPRIKA_SYNC_ENABLED=yes` produces `ConfigError` with kind `"validation"`                                                             | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC5.1 | Missing `config.json` (ENOENT) does not cause an error                                                                                 | Unit      | `src/utils/config.test.ts` | 2     |
| config-loader.AC5.2 | Missing `.env` file does not cause an error                                                                                            | Unit      | `src/utils/config.test.ts` | 2     |
| config-loader.AC5.3 | `config.json` with invalid JSON produces `ConfigError` with kind `"invalid_json"`                                                      | Unit      | `src/utils/config.test.ts` | 2     |
| config-loader.AC5.4 | `config.json` with permission error produces `ConfigError` with kind `"file_read_error"`                                               | Unit      | `src/utils/config.test.ts` | 2     |
| config-loader.AC6.1 | Missing `email` produces `ConfigError` with kind `"validation"` and message referencing `PAPRIKA_EMAIL`                                | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC6.2 | Missing `password` produces `ConfigError` with kind `"validation"` and message referencing `PAPRIKA_PASSWORD`                          | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC6.3 | Empty string `email` (`""`) fails validation (not treated as present)                                                                  | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC6.4 | Validation errors are human-readable, not raw ZodError output                                                                          | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC7.1 | `PaprikaConfig` type is exported with `paprika`, `sync`, and optional `features` fields                                                | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC7.2 | `EmbeddingConfig` type is exported with required `apiKey`, `baseUrl`, `model` string fields                                            | Unit      | `src/utils/config.test.ts` | 1     |
| config-loader.AC7.3 | `ConfigError` class is exported with `reason`, `kind` fields and static factory methods                                                | Unit      | `src/utils/config.test.ts` | 1     |

## Human Verification

| AC ID                         | Criterion                                                             | Justification                                                                                                                                                                                 | Verification Approach                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| config-loader.AC5.4 (partial) | Permission error produces `ConfigError` with kind `"file_read_error"` | Test uses `chmodSync` to revoke read permissions, but this does not work when tests run as root (root bypasses POSIX file permission checks). CI runners often execute as root in containers. | Automated test includes the check but should be wrapped in a conditional skip (`process.getuid?.() === 0`). Manually verify on a non-root environment by running `pnpm test src/utils/config.test.ts` and confirming the AC5.4 test passes. If CI runs as root, inspect the test output to confirm the test was skipped with a clear reason, not silently passing.                                             |
| (none)                        | CLAUDE.md contract update is accurate and consistent                  | Documentation accuracy cannot be validated by automated tests. The update must correctly describe `loadConfig()` signature, types, and the dependency graph change (config.ts is non-leaf).   | After Phase 2 Task 2, visually inspect `src/utils/CLAUDE.md` and verify: (1) config.ts section documents `loadConfig()` return type as `Result<PaprikaConfig, ConfigError>`, (2) `PaprikaConfig` and `EmbeddingConfig` type descriptions match the zod schema, (3) Dependencies section distinguishes leaf modules (`xdg.ts`, `duration.ts`) from non-leaf (`config.ts`), (4) "Last verified" date is updated. |

## Property-Based Tests

| Property                     | Test File                           | Description                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| deepMerge identity           | `src/utils/config.property.test.ts` | `deepMerge(base, {})` deep-equals `base` for any generated config object. Validates that merging with an empty override object is a no-op. Uses `fc.object()` to generate arbitrary nested objects. Requires either exporting `deepMerge` with `@internal` annotation or testing indirectly through `loadConfig()` by providing identical values in `config.json` and confirming they survive the merge unchanged. |
| deepMerge override dominance | `src/utils/config.property.test.ts` | For any two objects `base` and `overrides`, every top-level key present in `overrides` appears in the merged result. Validates that override values are never dropped. Uses `fc.object()` for both operands. Same export consideration as above.                                                                                                                                                                   |
| booleanField idempotence     | `src/utils/config.property.test.ts` | Parsing an already-valid boolean through `booleanField` returns the same boolean. Uses `fc.constantFrom(true, false)` to generate inputs, passes them through `paprikaConfigSchema.safeParse()` via the `sync.enabled` field, and verifies the output matches the input. Tests through the public schema API -- no export needed.                                                                                  |

## Rationale and Implementation Notes

### Phase assignment logic

Acceptance criteria are split across phases based on what each phase delivers:

- **Phase 1** (ConfigError + Zod schemas) covers all criteria testable via direct `paprikaConfigSchema.safeParse()` calls -- schema defaults (AC1.3-1.5), duration field coercion (AC3), boolean field coercion (AC4), validation error formatting (AC6), type exports (AC7), and the ConfigError class (AC7.3).
- **Phase 2** (source loading + merge pipeline) covers criteria requiring the full `loadConfig()` pipeline -- env-only success (AC1.1), file-only success (AC1.2), priority chain (AC2), and file handling edge cases (AC5).

This split means Phase 1 tests validate schemas in isolation using `safeParse()`, while Phase 2 tests exercise the end-to-end pipeline using temp directories and `process.env` manipulation. No criterion is deferred or left untested.

### Test infrastructure decisions

- **Temp directories over mocks:** Phase 2 tests use real temp directories (`mkdtempSync`) and real file I/O rather than mocking `fs`. This matches the project's preference for testing real behavior and avoids brittle mock setups for `readFileSync`/`dotenv.config`.
- **Env var save/restore:** Tests explicitly save and restore all 8 config-related env vars in `beforeEach`/`afterEach`. This is necessary because `dotenv.config()` mutates `process.env` as a side effect, and leftover vars would contaminate subsequent tests.
- **AC5.4 root guard:** The permission error test (`chmodSync` to 0o000) is inherently platform-dependent. The implementation plan notes it should be skipped when running as root. This is the only criterion with a partial human-verification requirement.

### All criteria accounted for

Every acceptance criterion from the design plan (AC1.1 through AC7.3, 28 total) maps to an automated test in `src/utils/config.test.ts`. Two items require supplementary human verification: AC5.4 (conditional on execution context) and the CLAUDE.md documentation update (not tied to a specific AC but required by Phase 2 Task 2's definition of done). Property-based tests supplement the unit tests for merge and coercion correctness but do not cover new acceptance criteria -- they strengthen confidence in the implementation's invariants.
