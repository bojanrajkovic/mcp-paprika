# Duration Helper Design

## Summary

This document describes the design for `src/utils/duration.ts`, a self-contained utility module that handles parsing and formatting of recipe durations. Recipe management applications store durations in a variety of formats — human-readable strings like "1 hr 30 min", ISO 8601 strings like "PT1H30M", colon-separated strings like "1:30", and bare numbers treated as minutes. The module provides a single normalisation point that accepts all of these and produces a Luxon `Duration` object, plus a companion formatter that produces a compact, consistent display string.

The parsing strategy uses a chain-of-responsibility approach: an ordered list of format-specific parsers is tried in sequence until one claims the input or all parsers defer. Parsing results are returned as a `Result<Duration, DurationParseError>` using the neverthrow library rather than throwing exceptions, establishing the functional error handling pattern that the project design guidance calls for. This module is the first in the codebase to introduce both neverthrow's `Result` type and the static factory method convention for error classes, creating reference implementations that downstream modules will follow.

## Definition of Done

- `src/utils/duration.ts` is a leaf module exporting `parseDuration`, `formatDuration`, and `DurationParseError`
- `parseDuration(input: string | number)` returns `Result<Duration, DurationParseError>` using neverthrow, accepting human-readable strings ("15 min", "1 hr 30 min"), ISO 8601 ("PT15M"), H:MM colon format ("1:30"), and numeric minutes (15)
- `formatDuration(duration: Duration)` returns a compact human-readable string using hours and minutes only (e.g., "1 hr 30 min"), or empty string for invalid/zero durations
- `DurationParseError` is a local error class within the module (self-contained leaf, no cross-module imports)
- neverthrow is installed as a runtime dependency (first usage in the project)
- Comprehensive test suite with example-based tests covering all acceptance criteria, plus property-based tests (fast-check) for the parse/format roundtrip
- `src/utils/CLAUDE.md` updated with the duration module contract
- Build, typecheck, lint, and format all pass with zero errors

## Acceptance Criteria

### duration-helper.AC1: parseDuration handles human-readable strings

- **duration-helper.AC1.1 Success:** `parseDuration("15 min")` returns Ok with Duration of 15 minutes
- **duration-helper.AC1.2 Success:** `parseDuration("1 hr 30 min")` returns Ok with Duration of 90 minutes
- **duration-helper.AC1.3 Success:** `parseDuration("45 minutes")` returns Ok with Duration of 45 minutes
- **duration-helper.AC1.4 Success:** `parseDuration("1h30m")` returns Ok with Duration of 90 minutes

### duration-helper.AC2: parseDuration handles ISO 8601

- **duration-helper.AC2.1 Success:** `parseDuration("PT15M")` returns Ok with Duration of 15 minutes
- **duration-helper.AC2.2 Success:** `parseDuration("PT1H30M")` returns Ok with Duration of 90 minutes

### duration-helper.AC3: parseDuration handles colon format

- **duration-helper.AC3.1 Success:** `parseDuration("1:30")` returns Ok with Duration of 90 minutes (H:MM)
- **duration-helper.AC3.2 Success:** `parseDuration("0:30")` returns Ok with Duration of 30 minutes
- **duration-helper.AC3.3 Failure:** `parseDuration("1:60")` returns Err (minutes >= 60)

### duration-helper.AC4: parseDuration handles numeric input

- **duration-helper.AC4.1 Success:** `parseDuration(15)` returns Ok with Duration of 15 minutes
- **duration-helper.AC4.2 Success:** `parseDuration("42")` returns Ok with Duration of 42 minutes (bare numeric string)
- **duration-helper.AC4.3 Failure:** `parseDuration(NaN)` returns Err
- **duration-helper.AC4.4 Failure:** `parseDuration(Infinity)` returns Err
- **duration-helper.AC4.5 Failure:** `parseDuration(-5)` returns Err (negative)

### duration-helper.AC5: parseDuration rejects invalid input

- **duration-helper.AC5.1 Failure:** `parseDuration("")` returns Err
- **duration-helper.AC5.2 Failure:** `parseDuration("not a duration")` returns Err
- **duration-helper.AC5.3 Failure:** All Err results contain a DurationParseError with `input` and `reason` fields

### duration-helper.AC6: formatDuration produces compact output

- **duration-helper.AC6.1 Success:** formats 1h30m as "1 hr 30 min"
- **duration-helper.AC6.2 Success:** formats 45m as "45 min"
- **duration-helper.AC6.3 Success:** formats 2h as "2 hr"
- **duration-helper.AC6.4 Edge:** returns "" for invalid Duration
- **duration-helper.AC6.5 Edge:** returns "" for zero Duration

### duration-helper.AC7: Module characteristics

- **duration-helper.AC7.1 Success:** neverthrow is listed as a runtime dependency in package.json
- **duration-helper.AC7.2 Success:** `src/utils/duration.ts` imports only from npm packages (leaf boundary)
- **duration-helper.AC7.3 Success:** `pnpm build` and `pnpm typecheck` pass with zero errors
- **duration-helper.AC7.4 Success:** Property-based tests demonstrate parse/format roundtrip stability

## Glossary

- **Result\<T, E\>**: A type from the neverthrow library representing either a success value (`Ok<T>`) or a failure value (`Err<E>`). Used instead of throwing exceptions so that error paths are visible in function signatures and must be explicitly handled by the caller.
- **neverthrow**: An npm library that provides the `Result<T, E>` type for functional error handling in TypeScript. Being installed here as the first runtime usage in this project.
- **luxon**: A JavaScript date/time library. Used here for its `Duration` type, which represents a span of time (hours, minutes, seconds, etc.) as a structured object.
- **parse-duration**: An npm library that converts human-readable duration strings ("15 min", "1h30m") and ISO 8601 duration strings ("PT15M") into milliseconds. Used as a delegate in the `humanAndIsoParser` step of the chain.
- **ISO 8601 duration**: A standardised text format for durations defined by the ISO 8601 standard. Examples: `PT15M` (15 minutes), `PT1H30M` (1 hour 30 minutes). The "P" prefix stands for "period" and "T" separates date from time components.
- **H:MM colon format**: A human shorthand for durations written as hours and two-digit minutes separated by a colon (e.g., "1:30" for 1 hour 30 minutes). Distinct from clock time — interpreted here as elapsed duration, not a time of day.
- **Chain of responsibility**: A design pattern where a request is passed along a sequence of handlers; each handler either processes the request and stops the chain, or defers to the next handler. Used here so each parser only handles the format it recognises.
- **Leaf module**: A module that has no imports from other modules within the same project — it only imports from npm packages or Node.js built-ins. This boundary keeps the module self-contained and prevents circular dependencies.
- **Static factory method**: A static method on a class (e.g., `DurationParseError.fromInput(...)`) that constructs and returns an instance, as an alternative to calling `new` directly. Allows the constructor to enforce invariants and produce a meaningful error message before the object is created.
- **fast-check**: A property-based testing library for TypeScript/JavaScript. Instead of individual example inputs, the developer describes properties that should hold for all inputs, and fast-check generates many random cases to search for counter-examples.
- **Property-based test**: A test that asserts a general property (e.g., "parsing and then formatting a valid duration always produces a non-empty string") rather than testing a single hard-coded example. Run using fast-check.
- **Roundtrip**: In the context of this module, parsing a valid input to a `Duration` and then formatting that `Duration` back to a string. A stable roundtrip means the result is always a well-formed non-empty string, even if not identical to the original input.

## Architecture

Duration parsing uses a chain-of-responsibility pattern. An ordered array of format-specific parsers is walked sequentially — the first parser to return `Ok` or `Err` wins; parsers that return `null` defer to the next in the chain. If all parsers defer, the orchestrator returns `Err(DurationParseError)`.

### Public API

```typescript
import { type Duration } from "luxon";
import { type Result } from "neverthrow";

export function parseDuration(input: string | number): Result<Duration, DurationParseError>;
export function formatDuration(duration: Duration): string;
export class DurationParseError extends Error {
  readonly input: string | number;
  readonly reason: string;
  static fromInput(input: string | number, reason: string): DurationParseError;
}
```

### Parser Chain

Each parser is a function `(input: string) => Result<Duration, DurationParseError> | null` where `null` means "not my format" and `Err` means "my format, but invalid."

| Priority | Parser            | Handles                                                      | Notes                                                                             |
| -------- | ----------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 1        | numericParser     | `typeof number` and bare numeric strings (`/^\d+(\.\d+)?$/`) | Treats value as minutes. Rejects `NaN`, `Infinity`, negatives.                    |
| 2        | colonParser       | H:MM colon format (`/^\d+:\d{1,2}$/`)                        | Rejects minutes >= 60. Must run before parse-duration which misinterprets colons. |
| 3        | humanAndIsoParser | Human strings ("15 min", "1h30m") and ISO 8601 ("PT15M")     | Delegates to `parse-duration` library. Rejects negative results.                  |

Before the chain runs, empty/whitespace-only strings are rejected with an early `Err`.

### Formatter

`formatDuration` takes a Luxon `Duration` (not a `Result` — caller unwraps first) and returns a compact string. It rounds to the nearest minute via `Math.round(duration.as("minutes"))` and produces one of:

- `"1 hr 30 min"` — hours and minutes
- `"2 hr"` — hours only
- `"45 min"` — minutes only
- `""` — invalid, zero, or negative durations

### Error Class

`DurationParseError` is a local class within `duration.ts` that extends `Error` directly (not `PaprikaError` — leaf module cannot import from `src/paprika/`). It carries structured context:

- `readonly input` — the original input value
- `readonly reason` — a human-readable explanation (e.g., "invalid minutes", "negative duration")
- `static fromInput(input, reason)` — factory method that formats a descriptive message

This establishes the static factory method pattern recommended by the project's design guidance.

### Dependencies

- **luxon** (existing) — `Duration` type for output
- **parse-duration** (existing) — human-readable and ISO 8601 parsing
- **neverthrow** (new install) — `Result<T, E>` type. First usage in the project, establishing the functional error handling pattern for the codebase.

## Existing Patterns

Investigation found one existing module in `src/utils/`: `xdg.ts`. This design follows the same conventions:

- **Leaf module boundary:** No imports from other `src/` modules. Only npm package imports (`luxon`, `parse-duration`, `neverthrow`).
- **Named exports only:** No default exports, consistent with project conventions.
- **Synchronous, no I/O:** All functions are pure and return immediately.
- **Contract in CLAUDE.md:** Module contract documented in `src/utils/CLAUDE.md`.
- **Leaf boundary test:** Static analysis test that reads the source file and verifies no relative imports exist.

**New pattern introduced:** `Result<T, E>` return type using neverthrow. The existing codebase uses `Duration.invalid()` / exception-based error handling. This module is the first to adopt the functional `Result` pattern specified in the project's design guidance. Future modules (P1-U04 config loader, P2-U02 helpers) will follow this pattern.

**New pattern introduced:** Static factory methods on error classes. The existing `PaprikaError` hierarchy uses direct `new` construction. `DurationParseError.fromInput()` establishes the factory pattern recommended by the design guidance.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Duration Helper Module

**Goal:** Install neverthrow, implement `parseDuration`, `formatDuration`, and `DurationParseError`, write tests, and update documentation.

**Components:**

- `neverthrow` added to `package.json` runtime dependencies
- `src/utils/duration.ts` — parser chain, formatter, and error class
- `src/utils/duration.test.ts` — example-based tests covering all acceptance criteria
- `src/utils/duration.property.test.ts` — property-based tests for parse/format roundtrip
- `src/utils/CLAUDE.md` — updated with duration module contract
- Root `CLAUDE.md` — updated with `neverthrow` in runtime deps list

**Dependencies:** P1-U01 (project scaffolding, luxon + parse-duration installed), P1-U02 (type definitions)

**Done when:** All acceptance criteria pass as automated tests, property-based tests demonstrate roundtrip stability, leaf boundary test confirms no relative imports, `pnpm build && pnpm typecheck && pnpm lint && pnpm test` all pass with zero errors.

<!-- END_PHASE_1 -->

## Additional Considerations

**Numeric string convention:** Both `42` (number) and `"42"` (string) are interpreted as 42 minutes. This is a project-specific convention for backward compatibility with config files. The numericParser intercepts bare numeric strings before `parse-duration` can misinterpret them as milliseconds.

**parse-duration colon behavior:** The `parse-duration` library treats colons as thousand separators (`"1:30"` → 1.03ms), which is why the colonParser must run before humanAndIsoParser in the chain. This ordering is load-bearing.
