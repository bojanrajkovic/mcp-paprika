# Duration Helper Implementation Plan

**Goal:** Implement `parseDuration`, `formatDuration`, and `DurationParseError` in `src/utils/duration.ts` with comprehensive tests.

**Architecture:** Chain-of-responsibility parser with three format-specific handlers (numeric, colon, human/ISO), a compact formatter, and a local error class. Uses neverthrow `Result<T, E>` for functional error handling.

**Tech Stack:** TypeScript 5.9, Luxon (Duration), parse-duration (human/ISO parsing), neverthrow (Result type), vitest (testing), fast-check (property-based testing)

**Scope:** 1 phase from original design (phase 1 of 1)

**Codebase verified:** 2026-03-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

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

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Install neverthrow and update documentation

**Verifies:** duration-helper.AC7.1

**Files:**

- Modify: `/home/brajkovic/Projects/mcp-paprika/package.json` (add neverthrow to dependencies)
- Modify: `/home/brajkovic/Projects/mcp-paprika/CLAUDE.md:72` (add neverthrow to runtime deps list)

**Step 1: Install neverthrow**

```bash
pnpm add neverthrow
```

**Step 2: Verify installation**

```bash
pnpm typecheck
```

Expected: Passes with zero errors.

**Step 3: Update root CLAUDE.md**

In `/home/brajkovic/Projects/mcp-paprika/CLAUDE.md`, make two changes:

First, update the "Key dependencies" line (line 13) from:

```
- **Key dependencies:** zod (validation), luxon (dates), dotenv (env config), parse-duration
```

to:

```
- **Key dependencies:** zod (validation), luxon (dates), dotenv (env config), parse-duration, neverthrow (error handling)
```

Second, update the "Current runtime deps" line (line 72) from:

```
- Current runtime deps: `zod`, `luxon`, `dotenv`, `parse-duration`, `env-paths`
```

to:

```
- Current runtime deps: `zod`, `luxon`, `dotenv`, `parse-duration`, `env-paths`, `neverthrow`
```

**Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml CLAUDE.md
git commit -m "build(deps): add neverthrow for Result type error handling"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Verify neverthrow import works

**Verifies:** None (infrastructure verification)

**Files:**

- None (verification only)

**Step 1: Verify ESM import resolves**

```bash
pnpm tsx -e "import { ok, err } from 'neverthrow'; console.log(ok(42));"
```

Expected: Prints the Ok result object without errors. This confirms ESM resolution works with the project's module configuration.

**Step 2: Verify type resolution**

```bash
pnpm typecheck
```

Expected: Passes with zero errors.

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->

### Task 3: Implement DurationParseError class

**Verifies:** duration-helper.AC5.3

**Files:**

- Create: `src/utils/duration.ts`

**Implementation:**

Create `src/utils/duration.ts` with the `DurationParseError` class. This is the error type used by all parser functions. It extends `Error` directly (not `PaprikaError` — leaf module boundary) and uses a static factory method.

```typescript
export class DurationParseError extends Error {
  readonly input: string | number;
  readonly reason: string;

  private constructor(input: string | number, reason: string) {
    super(`Invalid duration ${JSON.stringify(input)}: ${reason}`);
    this.name = "DurationParseError";
    this.input = input;
    this.reason = reason;
  }

  static fromInput(input: string | number, reason: string): DurationParseError {
    return new DurationParseError(input, reason);
  }
}
```

Key design decisions:

- Private constructor forces use of `fromInput()` factory (static factory method pattern)
- `input` preserves the original value for debugging (string or number)
- `reason` is a human-readable explanation like `"empty input"` or `"negative duration"`
- `name` is set to `"DurationParseError"` for `instanceof` checks
- Message format: `Invalid duration "value": reason`

**Step 1: Verify it compiles**

```bash
pnpm typecheck
```

Expected: Passes with zero errors.

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->

### Task 4: Implement parseDuration and formatDuration

**Verifies:** duration-helper.AC1.1, duration-helper.AC1.2, duration-helper.AC1.3, duration-helper.AC1.4, duration-helper.AC2.1, duration-helper.AC2.2, duration-helper.AC3.1, duration-helper.AC3.2, duration-helper.AC3.3, duration-helper.AC4.1, duration-helper.AC4.2, duration-helper.AC4.3, duration-helper.AC4.4, duration-helper.AC4.5, duration-helper.AC5.1, duration-helper.AC5.2, duration-helper.AC6.1, duration-helper.AC6.2, duration-helper.AC6.3, duration-helper.AC6.4, duration-helper.AC6.5

**Files:**

- Modify: `src/utils/duration.ts` (add parser chain and formatter)

**Implementation:**

Add the parser chain and formatter to `src/utils/duration.ts`, below the `DurationParseError` class.

The parser chain is an ordered array of format-specific parsers. Each parser is a function `(input: string) => Result<Duration, DurationParseError> | null` where:

- `Result<Duration, DurationParseError>` means "I handled this input" (success or failure)
- `null` means "not my format, try next parser"

**Parser chain order (load-bearing):**

1. `numericParser` — handles `typeof number` and bare numeric strings (`/^\d+(\.\d+)?$/`)
2. `colonParser` — handles H:MM format (`/^\d+:\d{1,2}$/`). Must run before `humanAndIsoParser` because `parse-duration` treats colons as thousand separators.
3. `humanAndIsoParser` — handles human strings ("15 min", "1h30m") and ISO 8601 ("PT15M"). Delegates to `parse-duration` library.

**Before the chain runs:** empty/whitespace-only strings are rejected with an early `Err`.

```typescript
import { Duration } from "luxon";
import { ok, err, type Result } from "neverthrow";
import parseDurationLib from "parse-duration";

// Type for individual parsers in the chain
type Parser = (input: string) => Result<Duration, DurationParseError> | null;
```

**numericParser:**

- Matches bare numeric strings via `/^\d+(\.\d+)?$/`
- Also handles `typeof number` input (dispatched by `parseDuration` before the chain)
- Rejects `NaN`, `Infinity`, negatives, and non-finite values
- Treats valid numbers as minutes

```typescript
function numericParser(input: string): Result<Duration, DurationParseError> | null {
  if (!/^\d+(\.\d+)?$/.test(input)) {
    return null;
  }
  const minutes = Number(input);
  return ok(Duration.fromObject({ minutes }));
}
```

**colonParser:**

- Matches H:MM format via `/^\d+:\d{1,2}$/`
- Rejects minutes >= 60
- Converts to Duration with hours and minutes

```typescript
function colonParser(input: string): Result<Duration, DurationParseError> | null {
  const match = /^(\d+):(\d{1,2})$/.exec(input);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes >= 60) {
    return err(DurationParseError.fromInput(input, "minutes must be less than 60"));
  }
  return ok(Duration.fromObject({ hours, minutes }));
}
```

**humanAndIsoParser:**

- Delegates to `parse-duration` library which returns milliseconds or `null`
- Rejects `null` return (not parseable) by returning `null` (not my format / not recognized)
- Rejects negative results

```typescript
function humanAndIsoParser(input: string): Result<Duration, DurationParseError> | null {
  const ms = parseDurationLib(input);
  if (ms === null || ms === undefined) {
    return null;
  }
  if (ms < 0) {
    return err(DurationParseError.fromInput(input, "negative duration"));
  }
  return ok(Duration.fromMillis(ms));
}
```

**parseDuration orchestrator:**

- Handles numeric input (`typeof number`) before entering the string chain
- Trims and validates empty input
- Walks the parser chain

```typescript
export function parseDuration(input: string | number): Result<Duration, DurationParseError> {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return err(DurationParseError.fromInput(input, "input must be a finite number"));
    }
    if (input < 0) {
      return err(DurationParseError.fromInput(input, "negative duration"));
    }
    return ok(Duration.fromObject({ minutes: input }));
  }

  const trimmed = input.trim();
  if (trimmed === "") {
    return err(DurationParseError.fromInput(input, "empty input"));
  }

  const parsers: ReadonlyArray<Parser> = [numericParser, colonParser, humanAndIsoParser];

  for (const parser of parsers) {
    const result = parser(trimmed);
    if (result !== null) {
      return result;
    }
  }

  return err(DurationParseError.fromInput(input, "unrecognized duration format"));
}
```

**formatDuration:**

- Takes a Luxon `Duration` (not a `Result` — caller unwraps first)
- Rounds to nearest minute via `Math.round(duration.as("minutes"))`
- Returns compact string or empty string for invalid/zero/negative

```typescript
export function formatDuration(duration: Duration): string {
  if (!duration.isValid) {
    return "";
  }

  const totalMinutes = Math.round(duration.as("minutes"));

  if (totalMinutes <= 0) {
    return "";
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${String(hours)} hr ${String(minutes)} min`;
  }
  if (hours > 0) {
    return `${String(hours)} hr`;
  }
  return `${String(minutes)} min`;
}
```

**Step 1: Verify it compiles**

```bash
pnpm typecheck
```

Expected: Passes with zero errors.

**Step 2: Verify lint passes**

```bash
pnpm lint
```

Expected: Passes with zero errors (no console usage in the module).

**Step 3: Verify formatting**

```bash
pnpm format:check
```

Expected: Passes with no formatting issues.

**Step 4: Commit**

```bash
git add src/utils/duration.ts
git commit -m "feat(utils): add duration parsing and formatting module

Implements parseDuration with chain-of-responsibility pattern
(numeric, colon, human/ISO parsers) and formatDuration for compact
display. Uses neverthrow Result<T, E> for functional error handling."
```

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->

### Task 5: Write example-based tests for parseDuration and formatDuration

**Verifies:** duration-helper.AC1.1, duration-helper.AC1.2, duration-helper.AC1.3, duration-helper.AC1.4, duration-helper.AC2.1, duration-helper.AC2.2, duration-helper.AC3.1, duration-helper.AC3.2, duration-helper.AC3.3, duration-helper.AC4.1, duration-helper.AC4.2, duration-helper.AC4.3, duration-helper.AC4.4, duration-helper.AC4.5, duration-helper.AC5.1, duration-helper.AC5.2, duration-helper.AC5.3, duration-helper.AC6.1, duration-helper.AC6.2, duration-helper.AC6.3, duration-helper.AC6.4, duration-helper.AC6.5, duration-helper.AC7.1, duration-helper.AC7.2

**Files:**

- Create: `src/utils/duration.test.ts`

**Testing:**

Follow the existing test patterns in `src/utils/xdg.test.ts`:

- Import from `vitest`: `describe`, `it`, `expect`
- Import from `./duration.js` (ESM `.js` extension)
- Use nested `describe` blocks organized by AC groups
- Test names reference acceptance criteria (e.g., `duration-helper.AC1.1: ...`)

Tests must verify each AC listed above:

**AC1 (human-readable strings):**

- duration-helper.AC1.1: `parseDuration("15 min")` returns Ok, unwrap and verify `as("minutes")` equals 15
- duration-helper.AC1.2: `parseDuration("1 hr 30 min")` returns Ok with 90 minutes
- duration-helper.AC1.3: `parseDuration("45 minutes")` returns Ok with 45 minutes
- duration-helper.AC1.4: `parseDuration("1h30m")` returns Ok with 90 minutes

**AC2 (ISO 8601):**

- duration-helper.AC2.1: `parseDuration("PT15M")` returns Ok with 15 minutes
- duration-helper.AC2.2: `parseDuration("PT1H30M")` returns Ok with 90 minutes

**AC3 (colon format):**

- duration-helper.AC3.1: `parseDuration("1:30")` returns Ok with 90 minutes
- duration-helper.AC3.2: `parseDuration("0:30")` returns Ok with 30 minutes
- duration-helper.AC3.3: `parseDuration("1:60")` returns Err, verify `.isErr()` is true

**AC4 (numeric input):**

- duration-helper.AC4.1: `parseDuration(15)` returns Ok with 15 minutes
- duration-helper.AC4.2: `parseDuration("42")` returns Ok with 42 minutes
- duration-helper.AC4.3: `parseDuration(NaN)` returns Err
- duration-helper.AC4.4: `parseDuration(Infinity)` returns Err
- duration-helper.AC4.5: `parseDuration(-5)` returns Err

**AC5 (invalid input):**

- duration-helper.AC5.1: `parseDuration("")` returns Err
- duration-helper.AC5.2: `parseDuration("not a duration")` returns Err
- duration-helper.AC5.3: For each Err case above, verify the error is `instanceof DurationParseError` and has `input` and `reason` properties

**AC6 (formatDuration):**

- duration-helper.AC6.1: `formatDuration(Duration.fromObject({ hours: 1, minutes: 30 }))` equals `"1 hr 30 min"`
- duration-helper.AC6.2: `formatDuration(Duration.fromObject({ minutes: 45 }))` equals `"45 min"`
- duration-helper.AC6.3: `formatDuration(Duration.fromObject({ hours: 2 }))` equals `"2 hr"`
- duration-helper.AC6.4: `formatDuration(Duration.invalid("test"))` equals `""`
- duration-helper.AC6.5: `formatDuration(Duration.fromObject({ minutes: 0 }))` equals `""`

**AC7 (module characteristics):**

- duration-helper.AC7.1: Read `package.json` and verify `dependencies.neverthrow` is defined (follow `xdg.test.ts` pattern using `readFileSync`)
- duration-helper.AC7.2: Read `src/utils/duration.ts` source and verify no relative imports exist (follow `xdg.test.ts` AC3.1 pattern: assert source does not match `/from\s+["']\.\//` or `/from\s+["']\.\.\//`)

For asserting on `Result` values:

- Use `result.isOk()` to check success, then access `result.value`
- Use `result.isErr()` to check failure, then access `result.error`
- Convert duration to minutes via `result.value.as("minutes")`

**Verification:**

```bash
pnpm test
```

Expected: All tests pass.

**Commit:**

```bash
git add src/utils/duration.test.ts
git commit -m "test(utils): add example-based tests for duration module

Covers all acceptance criteria: human-readable, ISO 8601, colon format,
numeric input, invalid input rejection, format output, and module
characteristics (leaf boundary, neverthrow dependency)."
```

<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-7) -->

<!-- START_TASK_6 -->

### Task 6: Write property-based tests for parse/format roundtrip

**Verifies:** duration-helper.AC7.4

**Files:**

- Create: `src/utils/duration.property.test.ts`

**Testing:**

Property-based tests using `fast-check` (already installed as devDependency).

Import `fc` from `fast-check`, `describe`/`it`/`expect` from `vitest`.

**Property 1: Roundtrip stability** — For any valid duration (positive integer minutes), parsing and formatting should produce a non-empty string.

Strategy: Generate integers in range `[1, 10000]` as minutes. Parse the number, unwrap the Ok result, format it, assert non-empty string.

```
fc.integer({ min: 1, max: 10000 })
```

Pseudocode:

```
for each minutes in 1..10000:
  result = parseDuration(minutes)
  assert result.isOk()
  formatted = formatDuration(result.value)
  assert formatted !== ""
```

**Property 2: Idempotence of formatting** — Parsing a formatted string (back through parseDuration) and re-formatting should yield the same string.

Strategy: Generate integers in range `[1, 10000]` as minutes. Parse, format, parse the formatted string, format again. Both format outputs should be identical.

Pseudocode:

```
for each minutes in 1..10000:
  result1 = parseDuration(minutes)
  formatted1 = formatDuration(result1.value)
  result2 = parseDuration(formatted1)
  assert result2.isOk()
  formatted2 = formatDuration(result2.value)
  assert formatted1 === formatted2
```

**Property 3: Numeric parse preserves value** — For any non-negative finite number, `parseDuration(n)` should return Ok with a Duration whose `as("minutes")` equals the input.

Strategy: Generate non-negative numbers (`fc.double({ min: 0, max: 100000, noNaN: true })`). Filter out `Infinity`. Parse and verify the minutes match.

**Verification:**

```bash
pnpm test
```

Expected: All property-based tests pass.

**Commit:**

```bash
git add src/utils/duration.property.test.ts
git commit -m "test(utils): add property-based tests for duration roundtrip

Verifies roundtrip stability, format idempotence, and numeric
parse value preservation using fast-check."
```

<!-- END_TASK_6 -->

<!-- START_TASK_7 -->

### Task 7: Update src/utils/CLAUDE.md with duration module contract

**Verifies:** None (documentation)

**Files:**

- Modify: `src/utils/CLAUDE.md` (add duration.ts contract section)

**Implementation:**

Add a new contract section to `src/utils/CLAUDE.md` after the existing `xdg.ts` section, following the same documentation pattern.

Add the following section after the `xdg.ts` contract table and before the `## Dependencies` section:

```markdown
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
```

Also update the `## Dependencies` section. The "Uses" field refers to internal project imports (which remains "None" for leaf modules). Add an "External packages" line to document npm dependencies per module:

Change:

```
- **Uses:** None (leaf dependency)
- **Used by:** All other `src/` modules
- **Boundary:** Must not import from any other `src/` module (leaf dependency)
```

to:

```
- **Uses:** None (leaf module — no internal project imports)
- **External packages:** xdg.ts uses `env-paths`; duration.ts uses `luxon`, `parse-duration`, `neverthrow`
- **Used by:** All other `src/` modules
- **Boundary:** Must not import from any other `src/` module (leaf dependency)
```

**Step 1: Verify formatting**

```bash
pnpm format:check
```

Expected: Passes.

**Step 2: Commit**

```bash
git add src/utils/CLAUDE.md
git commit -m "docs(utils): add duration module contract to CLAUDE.md"
```

<!-- END_TASK_7 -->

<!-- END_SUBCOMPONENT_C -->

<!-- START_TASK_8 -->

### Task 8: Final verification

**Verifies:** duration-helper.AC7.3

**Files:**

- None (verification only)

**Step 1: Run full build pipeline**

```bash
pnpm build
```

Expected: Builds with zero errors.

**Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: Passes with zero errors.

**Step 3: Run lint**

```bash
pnpm lint
```

Expected: Passes with zero warnings or errors.

**Step 4: Run all tests**

```bash
pnpm test
```

Expected: All tests pass (duration example-based + property-based + existing xdg/paprika tests).

**Step 5: Check formatting**

```bash
pnpm format:check
```

Expected: All files formatted correctly.

<!-- END_TASK_8 -->
