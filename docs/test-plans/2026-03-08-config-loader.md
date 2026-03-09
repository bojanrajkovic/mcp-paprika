# Config Loader — Human Test Plan

## Prerequisites

- Node.js 24 installed (managed via mise)
- Dependencies installed: `pnpm install`
- All automated tests passing: `pnpm test src/utils/config.test.ts src/utils/config.property.test.ts`
- A non-root user account (for AC5.4 verification)

## Phase 1: Permission Error Behavior (AC5.4 partial)

| Step | Action                                             | Expected                                                     |
| ---- | -------------------------------------------------- | ------------------------------------------------------------ |
| 1    | Run `id -u` to confirm you are not running as root | Output is a non-zero number (e.g., `1000`)                   |
| 2    | Run `pnpm test src/utils/config.test.ts`           | All tests pass, including AC5.4                              |
| 3    | Inspect the test output for AC5.4                  | The test should show a green checkmark, not "skipped"        |
| 4    | If running in CI as root, inspect the test output  | The AC5.4 test should show as skipped (not silently passing) |

## Phase 2: CLAUDE.md Documentation Accuracy

| Step | Action                                                                                    | Expected                                             |
| ---- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1    | Open `src/utils/CLAUDE.md`                                                                | File exists and is readable                          |
| 2    | Locate the `config.ts` section                                                            | Section exists under "Contracts" heading             |
| 3    | Verify `loadConfig()` is documented with return type `Result<PaprikaConfig, ConfigError>` | Matches export table                                 |
| 4    | Verify `paprikaConfigSchema` is documented                                                | Included in export table                             |
| 5    | Verify `PaprikaConfig` type lists `paprika`, `sync`, and optional `features`              | Type table matches                                   |
| 6    | Verify `EmbeddingConfig` type lists `apiKey`, `baseUrl`, `model` as required              | Type table matches                                   |
| 7    | Verify `ConfigError` shows `kind` discriminant with all three variants                    | Class table matches                                  |
| 8    | Verify Dependencies section distinguishes leaf from non-leaf modules                      | Leaf: `xdg.ts`, `duration.ts`. Non-leaf: `config.ts` |
| 9    | Verify "Last verified" date is current                                                    | Date reads `2026-03-09` or later                     |

## End-to-End: Full Priority Chain Scenario

Validates the complete configuration precedence chain (env vars > .env > config.json > Zod defaults).

| Step | Action                                                                                                                                                      | Expected                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1    | Create a temporary directory: `TMPDIR=$(mktemp -d)`                                                                                                         | Directory created                           |
| 2    | Write `config.json`: `echo '{"paprika":{"email":"file@example.com","password":"filepass"},"sync":{"interval":"30m","enabled":true}}' > $TMPDIR/config.json` | File written                                |
| 3    | Write `.env`: `echo -e 'PAPRIKA_EMAIL=dotenv@example.com\nPAPRIKA_SYNC_INTERVAL=10m' > $TMPDIR/.env`                                                        | File written                                |
| 4    | In a Node.js REPL or script, unset all config env vars, then set `PAPRIKA_EMAIL=real@example.com`                                                           | Only `PAPRIKA_EMAIL` is set in real env     |
| 5    | Call `loadConfig($TMPDIR)`                                                                                                                                  | Returns `Result.ok`                         |
| 6    | Check `result.value.paprika.email`                                                                                                                          | `"real@example.com"` — real env var wins    |
| 7    | Check `result.value.paprika.password`                                                                                                                       | `"filepass"` — falls through to config.json |
| 8    | Check `result.value.sync.interval`                                                                                                                          | `600000` (10m) — .env wins over config.json |
| 9    | Check `result.value.sync.enabled`                                                                                                                           | `true` — config.json provides it            |
| 10   | Check `result.value.features`                                                                                                                               | `undefined` — Zod default applies           |
| 11   | Clean up: `rm -rf $TMPDIR`                                                                                                                                  | Directory removed                           |

## End-to-End: Error Recovery Scenario

Validates that file errors produce actionable error messages.

| Step | Action                                                           | Expected                                            |
| ---- | ---------------------------------------------------------------- | --------------------------------------------------- |
| 1    | Write malformed JSON: `echo '{"paprika":' > $TMPDIR/config.json` | Truncated JSON written                              |
| 2    | Set `PAPRIKA_EMAIL` and `PAPRIKA_PASSWORD` env vars              | Env vars set                                        |
| 3    | Call `loadConfig($TMPDIR)`                                       | Returns `Result.err`                                |
| 4    | Check `result.error.kind`                                        | `"invalid_json"`                                    |
| 5    | Check `result.error.reason`                                      | Contains file path and JSON parse error description |
| 6    | Fix JSON: write valid `config.json` with credentials             | Valid JSON written                                  |
| 7    | Call `loadConfig($TMPDIR)` again                                 | Returns `Result.ok`                                 |
| 8    | Clean up                                                         | Directory removed                                   |

## End-to-End: Missing Credentials Scenario

Validates human-readable error messages when no credentials are provided.

| Step | Action                                                               | Expected                                                                                                                                                     |
| ---- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Create empty temp dir (no config.json, no .env)                      | Directory created                                                                                                                                            |
| 2    | Ensure all `PAPRIKA_*` env vars are unset                            | Clean environment                                                                                                                                            |
| 3    | Call `loadConfig($TMPDIR)`                                           | Returns `Result.err`                                                                                                                                         |
| 4    | Check `result.error.kind`                                            | `"validation"`                                                                                                                                               |
| 5    | Read `result.error.reason`                                           | Contains `"Configuration validation failed:"`, lists `paprika.email` with `(set via PAPRIKA_EMAIL)` and `paprika.password` with `(set via PAPRIKA_PASSWORD)` |
| 6    | Verify no raw Zod internals like `ZodError` or JSON-formatted issues | Plain text with dashes and readable paths                                                                                                                    |
| 7    | Clean up                                                             | Directory removed                                                                                                                                            |

## Human Verification Required

| Criterion                     | Why Manual                                            | Steps             |
| ----------------------------- | ----------------------------------------------------- | ----------------- |
| config-loader.AC5.4 (partial) | `chmodSync(0o000)` has no effect when running as root | Phase 1 steps 1-4 |
| CLAUDE.md contract accuracy   | Documentation correctness cannot be automated         | Phase 2 steps 1-9 |

## Traceability

| AC    | Automated Test                     | Manual Step                   |
| ----- | ---------------------------------- | ----------------------------- |
| AC1.1 | `config.test.ts:347`               | Priority Chain step 5         |
| AC1.2 | `config.test.ts:360`               | Priority Chain step 7         |
| AC1.3 | `config.test.ts:195`               | Priority Chain step 9         |
| AC1.4 | `config.test.ts:203`               | Priority Chain step 8         |
| AC1.5 | `config.test.ts:211`               | Priority Chain step 10        |
| AC2.1 | `config.test.ts:377`               | Priority Chain step 6         |
| AC2.2 | `config.test.ts:392`               | Priority Chain step 6         |
| AC2.3 | `config.test.ts:408`               | Priority Chain step 8         |
| AC2.4 | `config.test.ts:423`               | Priority Chain step 10        |
| AC3.1 | `config.test.ts:112`               | —                             |
| AC3.2 | `config.test.ts:121`               | —                             |
| AC3.3 | `config.test.ts:130`               | —                             |
| AC3.4 | `config.test.ts:139`               | Error Recovery step 4         |
| AC4.1 | `config.test.ts:149`               | —                             |
| AC4.2 | `config.test.ts:158`               | —                             |
| AC4.3 | `config.test.ts:167`               | —                             |
| AC4.4 | `config.test.ts:176`               | —                             |
| AC4.5 | `config.test.ts:185`               | —                             |
| AC5.1 | `config.test.ts:438`               | —                             |
| AC5.2 | `config.test.ts:447`               | —                             |
| AC5.3 | `config.test.ts:457`               | Error Recovery steps 3-5      |
| AC5.4 | `config.test.ts:471` (conditional) | Phase 1 steps 1-4             |
| AC6.1 | `config.test.ts:221`               | Missing Credentials step 5    |
| AC6.2 | `config.test.ts:240`               | Missing Credentials step 5    |
| AC6.3 | `config.test.ts:249`               | —                             |
| AC6.4 | `config.test.ts:49`                | Missing Credentials steps 5-6 |
| AC7.1 | `config.test.ts:261`               | CLAUDE.md step 5              |
| AC7.2 | `config.test.ts:278`               | CLAUDE.md step 6              |
| AC7.3 | `config.test.ts:9`                 | CLAUDE.md step 7              |
