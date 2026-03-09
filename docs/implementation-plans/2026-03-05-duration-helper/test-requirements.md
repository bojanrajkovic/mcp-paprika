# Duration Helper Test Requirements

Maps each acceptance criterion from the duration helper design to specific automated tests.

**Design document:** `docs/design-plans/2026-03-05-duration-helper.md`
**Implementation plan:** `docs/implementation-plans/2026-03-05-duration-helper/phase_01.md`

---

## Automated Tests

### AC1: parseDuration handles human-readable strings

| Criterion             | Description                                                           | Test Type | Test File                    | What the Test Verifies                                                                                           |
| --------------------- | --------------------------------------------------------------------- | --------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| duration-helper.AC1.1 | `parseDuration("15 min")` returns Ok with Duration of 15 minutes      | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration("15 min")`, asserts `result.isOk()` is true and `result.value.as("minutes")` equals 15      |
| duration-helper.AC1.2 | `parseDuration("1 hr 30 min")` returns Ok with Duration of 90 minutes | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration("1 hr 30 min")`, asserts `result.isOk()` is true and `result.value.as("minutes")` equals 90 |
| duration-helper.AC1.3 | `parseDuration("45 minutes")` returns Ok with Duration of 45 minutes  | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration("45 minutes")`, asserts `result.isOk()` is true and `result.value.as("minutes")` equals 45  |
| duration-helper.AC1.4 | `parseDuration("1h30m")` returns Ok with Duration of 90 minutes       | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration("1h30m")`, asserts `result.isOk()` is true and `result.value.as("minutes")` equals 90       |

### AC2: parseDuration handles ISO 8601

| Criterion             | Description                                                       | Test Type | Test File                    | What the Test Verifies                                                                                       |
| --------------------- | ----------------------------------------------------------------- | --------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| duration-helper.AC2.1 | `parseDuration("PT15M")` returns Ok with Duration of 15 minutes   | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration("PT15M")`, asserts `result.isOk()` is true and `result.value.as("minutes")` equals 15   |
| duration-helper.AC2.2 | `parseDuration("PT1H30M")` returns Ok with Duration of 90 minutes | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration("PT1H30M")`, asserts `result.isOk()` is true and `result.value.as("minutes")` equals 90 |

### AC3: parseDuration handles colon format

| Criterion             | Description                                                           | Test Type | Test File                    | What the Test Verifies                                                                                    |
| --------------------- | --------------------------------------------------------------------- | --------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| duration-helper.AC3.1 | `parseDuration("1:30")` returns Ok with Duration of 90 minutes (H:MM) | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration("1:30")`, asserts `result.isOk()` is true and `result.value.as("minutes")` equals 90 |
| duration-helper.AC3.2 | `parseDuration("0:30")` returns Ok with Duration of 30 minutes        | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration("0:30")`, asserts `result.isOk()` is true and `result.value.as("minutes")` equals 30 |
| duration-helper.AC3.3 | `parseDuration("1:60")` returns Err (minutes >= 60)                   | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration("1:60")`, asserts `result.isErr()` is true                                           |

### AC4: parseDuration handles numeric input

| Criterion             | Description                                                                        | Test Type | Test File                    | What the Test Verifies                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------- | --------- | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| duration-helper.AC4.1 | `parseDuration(15)` returns Ok with Duration of 15 minutes                         | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration(15)`, asserts `result.isOk()` is true and `result.value.as("minutes")` equals 15   |
| duration-helper.AC4.2 | `parseDuration("42")` returns Ok with Duration of 42 minutes (bare numeric string) | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration("42")`, asserts `result.isOk()` is true and `result.value.as("minutes")` equals 42 |
| duration-helper.AC4.3 | `parseDuration(NaN)` returns Err                                                   | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration(NaN)`, asserts `result.isErr()` is true                                            |
| duration-helper.AC4.4 | `parseDuration(Infinity)` returns Err                                              | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration(Infinity)`, asserts `result.isErr()` is true                                       |
| duration-helper.AC4.5 | `parseDuration(-5)` returns Err (negative)                                         | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration(-5)`, asserts `result.isErr()` is true                                             |

### AC5: parseDuration rejects invalid input

| Criterion             | Description                                                                   | Test Type | Test File                    | What the Test Verifies                                                                                                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------- | --------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| duration-helper.AC5.1 | `parseDuration("")` returns Err                                               | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration("")`, asserts `result.isErr()` is true                                                                                                                                             |
| duration-helper.AC5.2 | `parseDuration("not a duration")` returns Err                                 | Unit      | `src/utils/duration.test.ts` | Calls `parseDuration("not a duration")`, asserts `result.isErr()` is true                                                                                                                               |
| duration-helper.AC5.3 | All Err results contain a DurationParseError with `input` and `reason` fields | Unit      | `src/utils/duration.test.ts` | For each Err-producing case (AC3.3, AC4.3, AC4.4, AC4.5, AC5.1, AC5.2), asserts the error is `instanceof DurationParseError`, and that `error.input` and `error.reason` are defined and correctly typed |

### AC6: formatDuration produces compact output

| Criterion             | Description                     | Test Type | Test File                    | What the Test Verifies                                                                                        |
| --------------------- | ------------------------------- | --------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| duration-helper.AC6.1 | Formats 1h30m as "1 hr 30 min"  | Unit      | `src/utils/duration.test.ts` | Calls `formatDuration(Duration.fromObject({ hours: 1, minutes: 30 }))`, asserts result equals `"1 hr 30 min"` |
| duration-helper.AC6.2 | Formats 45m as "45 min"         | Unit      | `src/utils/duration.test.ts` | Calls `formatDuration(Duration.fromObject({ minutes: 45 }))`, asserts result equals `"45 min"`                |
| duration-helper.AC6.3 | Formats 2h as "2 hr"            | Unit      | `src/utils/duration.test.ts` | Calls `formatDuration(Duration.fromObject({ hours: 2 }))`, asserts result equals `"2 hr"`                     |
| duration-helper.AC6.4 | Returns "" for invalid Duration | Unit      | `src/utils/duration.test.ts` | Calls `formatDuration(Duration.invalid("test"))`, asserts result equals `""`                                  |
| duration-helper.AC6.5 | Returns "" for zero Duration    | Unit      | `src/utils/duration.test.ts` | Calls `formatDuration(Duration.fromObject({ minutes: 0 }))`, asserts result equals `""`                       |

### AC7: Module characteristics

| Criterion             | Description                                                            | Test Type       | Test File                             | What the Test Verifies                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------- | --------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| duration-helper.AC7.1 | neverthrow is listed as a runtime dependency in package.json           | Static analysis | `src/utils/duration.test.ts`          | Reads `package.json` via `readFileSync`, parses JSON, and asserts `dependencies.neverthrow` is defined and is a string (follows the xdg.test.ts AC2.2 pattern)                    |
| duration-helper.AC7.2 | `src/utils/duration.ts` imports only from npm packages (leaf boundary) | Static analysis | `src/utils/duration.test.ts`          | Reads the source of `src/utils/duration.ts` via `readFileSync` and asserts it does not match `/from\s+["']\.\//` or `/from\s+["']\.\.\//` (follows the xdg.test.ts AC3.1 pattern) |
| duration-helper.AC7.3 | `pnpm build` and `pnpm typecheck` pass with zero errors                | Static analysis | N/A (CI pipeline)                     | Verified by running `pnpm build` and `pnpm typecheck` as the final step of Task 8. See [Human Verification](#human-verification) section below.                                   |
| duration-helper.AC7.4 | Property-based tests demonstrate parse/format roundtrip stability      | Property-based  | `src/utils/duration.property.test.ts` | Three properties verified via fast-check (see details below)                                                                                                                      |

#### AC7.4 Property-based test details

| Property                      | Generator                                                                      | Assertion                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Roundtrip stability           | `fc.integer({ min: 1, max: 10000 })` as minutes                                | `parseDuration(n)` returns Ok; `formatDuration(result.value)` returns a non-empty string                   |
| Format idempotence            | `fc.integer({ min: 1, max: 10000 })` as minutes                                | Parse number, format to string, parse the string again, format again; both formatted strings are identical |
| Numeric parse preserves value | `fc.double({ min: 0, max: 100000, noNaN: true })` filtered to exclude Infinity | `parseDuration(n)` returns Ok; `result.value.as("minutes")` equals input                                   |

---

## Human Verification

### duration-helper.AC7.3: Build and typecheck pass with zero errors

**Justification:** This criterion validates that the full build pipeline (`pnpm build`) and type checker (`pnpm typecheck`) complete without errors. These are whole-project compilation steps that depend on toolchain configuration, environment, and all project files -- not just the duration module. While a CI pipeline could automate this, the acceptance criterion as written calls for running these commands and observing their exit codes, which is a verification step rather than a unit-testable property.

**Verification approach:** After all implementation tasks are complete (Task 8 in the implementation plan), run the following commands and confirm each exits with code 0 and produces no error output:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

**Note:** This is the only criterion that requires human verification. All other criteria are covered by automated tests in `src/utils/duration.test.ts` and `src/utils/duration.property.test.ts`. In a CI environment, this criterion would be verified by the pipeline itself.

---

## Test File Summary

| Test File                             | Test Type              | Criteria Covered                                                                           |
| ------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| `src/utils/duration.test.ts`          | Unit + Static analysis | AC1.1-AC1.4, AC2.1-AC2.2, AC3.1-AC3.3, AC4.1-AC4.5, AC5.1-AC5.3, AC6.1-AC6.5, AC7.1, AC7.2 |
| `src/utils/duration.property.test.ts` | Property-based         | AC7.4                                                                                      |

**Total acceptance criteria:** 24
**Automated tests:** 23
**Human verification:** 1 (AC7.3 -- build/typecheck pipeline)
