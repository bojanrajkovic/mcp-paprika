# Human Test Plan: Duration Helper

## Prerequisites

- Node.js 24 installed (managed via mise)
- Dependencies installed: `pnpm install`
- All automated tests passing: `pnpm test`

## Phase 1: Build and Typecheck Verification (AC7.3)

This is the sole criterion requiring human verification.

| Step | Action                                      | Expected                                                                                                                     |
| ---- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1    | Run `pnpm build` in the project root        | Exits with code 0. No errors in output. The `dist/` directory contains compiled JS files including `dist/utils/duration.js`. |
| 2    | Run `pnpm typecheck` in the project root    | Exits with code 0. No type errors reported.                                                                                  |
| 3    | Run `pnpm lint` in the project root         | Exits with code 0. No linting violations reported. Confirms no `console.log` usage (banned by `no-console` rule).            |
| 4    | Run `pnpm format:check` in the project root | Exits with code 0. All files formatted correctly by oxfmt.                                                                   |
| 5    | Run `pnpm test` in the project root         | Exits with code 0. All 27 duration-related tests (24 unit + 3 property-based) pass. No failures or skipped tests.            |

## Phase 2: Import and Export Verification

| Step | Action                                                                                   | Expected                                                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Open `src/utils/duration.ts` and inspect the import statements at lines 1-3              | Only three imports exist: `Duration` from `"luxon"`, `ok`/`err`/`Result` from `"neverthrow"`, and `parseDurationLib` from `"parse-duration"`. No relative imports (no `./` or `../` paths). |
| 2    | Verify the module exports `parseDuration`, `formatDuration`, and `DurationParseError`    | All three are exported with the `export` keyword.                                                                                                                                           |
| 3    | Open `package.json` and verify `neverthrow` is in `dependencies` (not `devDependencies`) | The `dependencies` object contains a `"neverthrow"` entry with a valid semver version string.                                                                                               |

## Phase 3: Error Structure Verification

| Step | Action                                                             | Expected                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Inspect `DurationParseError` class in `src/utils/duration.ts`      | Class extends `Error`. Has `readonly input: string \| number` and `readonly reason: string` fields. Constructor is private. Static factory method `fromInput(input, reason)` creates instances. |
| 2    | Confirm the error `name` property is set to `"DurationParseError"` | `this.name = "DurationParseError"` is present in the constructor.                                                                                                                               |
| 3    | Confirm the error `message` includes both input and reason         | Message format is `Invalid duration ${JSON.stringify(input)}: ${reason}`.                                                                                                                       |

## End-to-End: Parse-Format Roundtrip

Validate that the parse and format functions work together as a coherent pipeline for all supported input formats.

| Step | Action                                                            | Expected                                                          |
| ---- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1    | Import `parseDuration` and `formatDuration` from the built module | Imports succeed without errors.                                   |
| 2    | Parse `"1 hr 30 min"`, then format the result                     | Returns `"1 hr 30 min"` — identical to original input.            |
| 3    | Parse `"PT1H30M"` (ISO 8601), then format                         | Returns `"1 hr 30 min"` — ISO input normalized to human-readable. |
| 4    | Parse `"1:30"` (colon format), then format                        | Returns `"1 hr 30 min"` — colon input normalized.                 |
| 5    | Parse `90` (number), then format                                  | Returns `"1 hr 30 min"` — numeric minutes normalized.             |
| 6    | Parse `"90"` (bare numeric string), then format                   | Returns `"1 hr 30 min"` — bare numeric string normalized.         |

## End-to-End: Error Path Consistency

Validate that all invalid inputs produce structurally consistent errors with meaningful messages.

| Step | Action                                 | Expected                                                                                                       |
| ---- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1    | Call `parseDuration("")`               | `isErr()` true. `DurationParseError` with `input: ""`, `reason: "empty input"`.                                |
| 2    | Call `parseDuration("not a duration")` | `isErr()` true. `DurationParseError` with `input: "not a duration"`, `reason: "unrecognized duration format"`. |
| 3    | Call `parseDuration(NaN)`              | `isErr()` true. `DurationParseError` with `input: NaN`, `reason: "input must be a finite number"`.             |
| 4    | Call `parseDuration(-5)`               | `isErr()` true. `DurationParseError` with `input: -5`, `reason: "negative duration"`.                          |
| 5    | Call `parseDuration("1:60")`           | `isErr()` true. `DurationParseError` with `input: "1:60"`, `reason: "minutes must be less than 60"`.           |

## Traceability

| Acceptance Criterion       | Automated Test                      | Manual Step        |
| -------------------------- | ----------------------------------- | ------------------ |
| duration-helper.AC1.1      | `duration.test.ts` line 10          | —                  |
| duration-helper.AC1.2      | `duration.test.ts` line 19          | —                  |
| duration-helper.AC1.3      | `duration.test.ts` line 28          | —                  |
| duration-helper.AC1.4      | `duration.test.ts` line 37          | —                  |
| duration-helper.AC2.1      | `duration.test.ts` line 48          | —                  |
| duration-helper.AC2.2      | `duration.test.ts` line 57          | —                  |
| duration-helper.AC3.1      | `duration.test.ts` line 68          | —                  |
| duration-helper.AC3.2      | `duration.test.ts` line 77          | —                  |
| duration-helper.AC3.3      | `duration.test.ts` line 86          | —                  |
| duration-helper.AC4.1      | `duration.test.ts` line 94          | —                  |
| duration-helper.AC4.2      | `duration.test.ts` line 103         | —                  |
| duration-helper.AC4.3      | `duration.test.ts` line 112         | —                  |
| duration-helper.AC4.4      | `duration.test.ts` line 118         | —                  |
| duration-helper.AC4.5      | `duration.test.ts` line 124         | —                  |
| duration-helper.AC5.1      | `duration.test.ts` line 132         | —                  |
| duration-helper.AC5.2      | `duration.test.ts` line 138         | —                  |
| duration-helper.AC5.3      | `duration.test.ts` line 144         | —                  |
| duration-helper.AC6.1      | `duration.test.ts` line 162         | —                  |
| duration-helper.AC6.2      | `duration.test.ts` line 169         | —                  |
| duration-helper.AC6.3      | `duration.test.ts` line 176         | —                  |
| duration-helper.AC6.4      | `duration.test.ts` line 183         | —                  |
| duration-helper.AC6.5      | `duration.test.ts` line 189         | —                  |
| duration-helper.AC7.1      | `duration.test.ts` line 199         | Phase 2, Step 3    |
| duration-helper.AC7.2      | `duration.test.ts` line 212         | Phase 2, Step 1    |
| duration-helper.AC7.3      | N/A (human verification)            | Phase 1, Steps 1-5 |
| duration-helper.AC7.4 (P1) | `duration.property.test.ts` line 7  | —                  |
| duration-helper.AC7.4 (P2) | `duration.property.test.ts` line 21 | —                  |
| duration-helper.AC7.4 (P3) | `duration.property.test.ts` line 41 | —                  |
