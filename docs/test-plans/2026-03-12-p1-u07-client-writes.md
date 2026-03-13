# Human Test Plan: PaprikaClient Write Operations (P1-U07)

**Implementation plan:** `docs/implementation-plans/2026-03-12-p1-u07-client-writes/`
**Coverage result:** PASS — 10/10 automated ACs covered, 253/253 tests passing

---

## Prerequisites

- Node.js 24 installed (via mise)
- Dependencies installed: `pnpm install`
- All automated tests passing: `pnpm test` (253 tests, 0 failures)
- TypeScript compiles: `pnpm typecheck` exits 0

---

## Phase 1: Type Safety Verification (AC4.1)

| Step | Action                                                                                                             | Expected                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 1    | Run `pnpm typecheck` from the project root                                                                         | Exit code 0, no compiler errors printed to stdout/stderr       |
| 2    | Run `git diff ffd7add..HEAD -- src/paprika/client.ts` and search for `@ts-ignore`, `@ts-expect-error`, or `as any` | Zero matches. No type suppressions were introduced in the diff |
| 3    | Run `git diff ffd7add..HEAD -- src/paprika/client.test.ts` and search for the same patterns                        | Zero matches in test code as well                              |

---

## Phase 2: Explicit Return Type Annotations (AC4.2)

| Step | Action                                                                               | Expected                                                                       |
| ---- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 1    | Open `src/paprika/client.ts` and locate the `saveRecipe` method signature (line 143) | Signature reads: `async saveRecipe(recipe: Readonly<Recipe>): Promise<Recipe>` |
| 2    | Locate the `deleteRecipe` method signature (line 152)                                | Signature reads: `async deleteRecipe(uid: RecipeUid): Promise<void>`           |
| 3    | Locate the `notifySync` method signature (line 148)                                  | Signature reads: `async notifySync(): Promise<void>`                           |
| 4    | Confirm all three annotations are explicit (not relying on TypeScript inference)     | Each method has `: Promise<...>` written in the source, not inferred           |

---

## Phase 3: Encoding Pipeline Spot-Check

| Step | Action                                                                              | Expected                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Open `src/paprika/client.ts` and locate the `recipeToApiPayload` function (line 62) | Function maps all 28 Recipe fields from camelCase to snake_case keys                                                                                                                                                                                                                                                                                                              |
| 2    | Count the keys in the returned object literal                                       | Exactly 28 keys: `uid`, `hash`, `name`, `categories`, `ingredients`, `directions`, `description`, `notes`, `prep_time`, `cook_time`, `total_time`, `servings`, `difficulty`, `rating`, `created`, `image_url`, `photo`, `photo_hash`, `photo_large`, `photo_url`, `source`, `source_url`, `on_favorites`, `in_trash`, `is_pinned`, `on_grocery_list`, `scale`, `nutritional_info` |
| 3    | Locate `buildRecipeFormData` (line 158)                                             | Calls `recipeToApiPayload`, JSON-stringifies the result, gzip-compresses with `gzipSync`, wraps in `Blob`, appends to `FormData` with key `"data"` and filename `"data.gz"`                                                                                                                                                                                                       |

---

## Phase 4: Delete Flow Correctness Review

| Step | Action                                                                                                            | Expected                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1    | Open `src/paprika/client.ts` and locate `deleteRecipe` (line 152-156)                                             | Method body: (1) calls `getRecipe(uid)`, (2) calls `saveRecipe({ ...recipe, inTrash: true })`, (3) calls `notifySync()` |
| 2    | Verify the spread operator preserves all original recipe fields                                                   | `{ ...recipe, inTrash: true }` overrides only `inTrash`, all other 27 fields come from the GET response                 |
| 3    | Verify error propagation: if `getRecipe` throws (e.g., 404), confirm no `saveRecipe` or `notifySync` call follows | The three calls are sequential `await` statements; an exception at step 1 exits the method before steps 2 or 3          |

---

## End-to-End: Save-Delete Round Trip

**Purpose:** Validates that the complete write pipeline (serialize → compress → POST → deserialize) and the delete pipeline (GET → mutate → save → notify) work together correctly and exercise all acceptance criteria in a realistic sequence.

| Step | Action                                                   | Expected                                                                                                                                                                                                                          |
| ---- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Run `pnpm test -- --run src/paprika/client.test.ts`      | All 30 tests pass (including the 10 new p1-u07 tests)                                                                                                                                                                             |
| 2    | Verify test output contains all expected describe blocks | `p1-u07-client-writes.AC1: saveRecipe encodes and POSTs correctly` (4 tests), `p1-u07-client-writes.AC3: notifySync propagates changes` (2 tests), `p1-u07-client-writes.AC2: deleteRecipe soft-deletes via trash flag` (2 tests) |
| 3    | Run `pnpm lint`                                          | Zero warnings/errors in `src/paprika/client.ts`                                                                                                                                                                                   |
| 4    | Run `pnpm format:check`                                  | No formatting issues                                                                                                                                                                                                              |

---

## Human Verification Required

| Criterion                                                           | Why Manual                                                                                                                    | Steps                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC4.1: `pnpm typecheck` passes with no type suppressions            | Build-time command, not a runtime assertion. CI enforces automatically, but type suppressions require visual diff inspection. | Run `pnpm typecheck` (expect exit 0). Search the diff for `@ts-ignore`, `@ts-expect-error`, `as any` (expect zero matches).                                                              |
| AC4.2: Explicit return type annotations on all three public methods | TypeScript does not emit metadata distinguishing explicit vs. inferred annotations. This is a code-style property.            | Open `src/paprika/client.ts`. Verify `saveRecipe` at line 143 has `: Promise<Recipe>`, `notifySync` at line 148 has `: Promise<void>`, `deleteRecipe` at line 152 has `: Promise<void>`. |

---

## Traceability

| Acceptance Criterion                             | Automated Test                                    | Manual Step                    |
| ------------------------------------------------ | ------------------------------------------------- | ------------------------------ |
| AC1.1: POST to correct URL                       | `p1-u07-client-writes.AC1.1` (line 506)           | —                              |
| AC1.2: FormData snake_case encoding              | `p1-u07-client-writes.AC1.2 and AC1.3` (line 523) | Phase 3, Step 1-2 (spot-check) |
| AC1.3: All 28 fields preserved                   | `p1-u07-client-writes.AC1.2 and AC1.3` (line 523) | Phase 3, Step 2 (count keys)   |
| AC1.4: Response deserialized as camelCase        | `p1-u07-client-writes.AC1.4` (line 562)           | —                              |
| AC1.5: Non-2xx throws PaprikaAPIError            | `p1-u07-client-writes.AC1.5` (line 585)           | —                              |
| AC2.1: deleteRecipe sets in_trash: true          | `p1-u07-client-writes.AC2.1 and AC2.2` (line 637) | Phase 4, Step 1-2              |
| AC2.2: deleteRecipe calls notifySync             | `p1-u07-client-writes.AC2.1 and AC2.2` (line 637) | —                              |
| AC2.3: 404 from getRecipe throws, no save/notify | `p1-u07-client-writes.AC2.3` (line 671)           | Phase 4, Step 3                |
| AC3.1: notifySync POSTs to /notify/              | `p1-u07-client-writes.AC3.1` (line 606)           | —                              |
| AC3.2: notifySync returns void                   | `p1-u07-client-writes.AC3.2` (line 622)           | —                              |
| AC4.1: pnpm typecheck passes, no suppressions    | —                                                 | Phase 1 (all 3 steps)          |
| AC4.2: Explicit return type annotations          | —                                                 | Phase 2 (all 4 steps)          |
