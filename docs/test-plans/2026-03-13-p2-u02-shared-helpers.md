# Human Test Plan: p2-u02-shared-helpers

Generated from: `docs/implementation-plans/2026-03-13-p2-u02-shared-helpers/`

## Prerequisites

- Node.js 24 running (managed via `mise`)
- Dependencies installed: `pnpm install`
- All automated tests passing: `pnpm test`
- Typecheck passing: `pnpm typecheck`

## Phase 1: Type-Level Verification

| Step | Action                                                                                                              | Expected                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | Run `pnpm typecheck` from the project root                                                                          | Exit code 0, no errors                                                                                                       |
| 1.2  | Open `src/tools/helpers.ts`, inspect line 6                                                                         | Return type annotation is `{ content: [{ type: "text"; text: string }] }` — the narrow literal shape, not `CallToolResult`   |
| 1.3  | On the same line 7, confirm the expression uses `satisfies CallToolResult` (not `: CallToolResult` type annotation) | `satisfies` keyword present, ensuring compile-time conformance without widening                                              |
| 1.4  | In an IDE, hover over `textResult` function name                                                                    | Tooltip shows the narrow return type `{ content: [{ type: "text"; text: string }] }`, not the widened `CallToolResult` union |

## Phase 2: Import Structure Verification

| Step | Action                                               | Expected                                                                                                                                            |
| ---- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | Open `src/tools/helpers.ts`, inspect lines 1–4       | Line 1: `import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"` — uses `import type`                                             |
| 2.2  | Same file, line 3                                    | `import type { Recipe } from "../paprika/types.js"` — uses `import type`                                                                            |
| 2.3  | Same file, line 4                                    | `import type { ServerContext } from "../types/server-context.js"` — uses `import type`                                                              |
| 2.4  | Same file, line 2                                    | `import { err, ok, type Result } from "neverthrow"` — the only non-type import; `err` and `ok` are runtime constructors required by function bodies |
| 2.5  | Confirm no other import statements exist in the file | Only the four imports above should be present                                                                                                       |

## Phase 3: Export Structure Verification

| Step | Action                                                                   | Expected                                                                    |
| ---- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 3.1  | Open `src/tools/helpers.ts`                                              | Three functions visible: `textResult`, `coldStartGuard`, `recipeToMarkdown` |
| 3.2  | Confirm each function is preceded by `export function` (lines 6, 10, 17) | All three are named exports                                                 |
| 3.3  | Search the file for `export default`                                     | No matches — no default export exists                                       |

## Phase 4: Documentation Verification

| Step | Action                                | Expected                                                                                                                                                              |
| ---- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | Open `src/tools/CLAUDE.md`            | File exists and contains a "Shared Helpers" section                                                                                                                   |
| 4.2  | Locate the `textResult` section       | Contains purpose description ("Wraps a plain string in the MCP wire response envelope"), a code example showing usage, and the function signature                     |
| 4.3  | Locate the `coldStartGuard` section   | Contains purpose description (returns Ok when store has recipes, Err when empty), a code example showing the `.match()` usage pattern                                 |
| 4.4  | Locate the `recipeToMarkdown` section | Contains purpose description (renders Recipe as markdown), notes that `categoryNames` must be pre-resolved, notes that optional fields are omitted when null/falsy    |
| 4.5  | Confirm import paths are documented   | File specifies `'./helpers.js'` for same-directory imports and `'../tools/helpers.js'` for cross-directory imports                                                    |
| 4.6  | Locate the Boundaries section         | Contains a note that `helpers.ts` uses `import type` from `paprika/` for the `Recipe` type and that type-only imports are permitted despite the general boundary rule |

## End-to-End: Cold Start Guard Integration Pattern

**Purpose:** Validate that the `coldStartGuard` return type flows seamlessly into a tool handler response without additional wrapping or transformation.

1. Read the `coldStartGuard` function in `src/tools/helpers.ts` (line 10–15).
2. Confirm the Err branch wraps a `textResult(...)` call — meaning the error payload is already a valid `CallToolResult`.
3. Verify the return type is `Result<void, ReturnType<typeof textResult>>` — the Err type is structurally derived from `textResult`, ensuring type-level consistency.
4. Read the usage example in `src/tools/CLAUDE.md` (the `coldStartGuard` section). The pattern shows `.match(() => textResult("result"), (guard) => guard)` — the Err branch returns the guard directly with no wrapping.
5. Confirm in the test file (`helpers.test.ts` lines 53–61) that `toMatchObject` validates the Err payload has the `{ content: [{ type: "text", text: string }] }` shape — identical to `textResult` output.

**Expected:** The cold start guard error payload is indistinguishable from a normal tool response. A tool handler can return it directly from the Err branch of `.match()` without any transformation.

## Human Verification Required

| Criterion                                                             | Why Manual                                                                       | Steps                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1.3: Return value satisfies `CallToolResult`                        | Compile-time type constraint enforced by `satisfies` operator; erased at runtime | Run `pnpm typecheck` (exit 0). Inspect line 7 of `helpers.ts` for `satisfies CallToolResult`.                                                                         |
| AC1.4: Narrow literal type preserved (not widened)                    | Type-level property only distinguishable in the type system, not at runtime      | Inspect line 6 of `helpers.ts` for narrow return type annotation. Hover in IDE to confirm inferred type matches. Run `pnpm typecheck`.                                |
| AC4.1: Module uses only `import type` for cross-module deps           | Source-level structural constraint about import syntax; erased at runtime        | Inspect lines 1–4 of `helpers.ts`. Confirm `CallToolResult`, `Recipe`, `ServerContext` all use `import type`. Only `{ err, ok }` from neverthrow is a runtime import. |
| AC4.2: All three functions are named exports (no default)             | Source structure constraint best verified by inspection                          | Confirm `export function` on lines 6, 10, 17. Search for `export default` — none found.                                                                               |
| AC5.1: CLAUDE.md documents purpose and signature of all three helpers | Documentation quality is a qualitative judgment                                  | Read `src/tools/CLAUDE.md`. Confirm sections for `textResult`, `coldStartGuard`, `recipeToMarkdown` each with description and code example.                           |
| AC5.2: Specifies correct import paths                                 | Documentation prose content                                                      | Read `src/tools/CLAUDE.md`. Confirm it specifies `'./helpers.js'` and `'../tools/helpers.js'`.                                                                        |
| AC5.3: Notes that `import type` from `paprika/` is permitted          | Documentation prose content                                                      | Read Boundaries section of `src/tools/CLAUDE.md`. Confirm it notes `helpers.ts` uses `import type` from `paprika/` and that this is permitted.                        |

## Traceability

| Acceptance Criterion                     | Automated Test                                          | Manual Step            |
| ---------------------------------------- | ------------------------------------------------------- | ---------------------- |
| AC1.1: textResult wraps string           | `helpers.test.ts` AC1.1                                 | —                      |
| AC1.2: textResult preserves empty string | `helpers.test.ts` AC1.2                                 | —                      |
| AC1.3: Return satisfies CallToolResult   | —                                                       | Phase 1, Steps 1.1–1.3 |
| AC1.4: Narrow type preserved             | —                                                       | Phase 1, Steps 1.2–1.4 |
| AC2.1: Ok when store populated           | `helpers.test.ts` AC2.1                                 | —                      |
| AC2.2: Err when store empty              | `helpers.test.ts` AC2.2                                 | —                      |
| AC2.3: Err payload shape                 | `helpers.test.ts` AC2.3                                 | —                      |
| AC2.4: Retry instruction in message      | `helpers.test.ts` AC2.4                                 | —                      |
| AC2.5: Caller usage pattern              | `helpers.test.ts` AC2.5                                 | —                      |
| AC3.1: Starts with recipe name           | `helpers.test.ts` AC3.1 + `helpers.property.test.ts` P1 | —                      |
| AC3.2: Contains Ingredients section      | `helpers.test.ts` AC3.2 + `helpers.property.test.ts` P2 | —                      |
| AC3.3: Contains Directions section       | `helpers.test.ts` AC3.3 + `helpers.property.test.ts` P3 | —                      |
| AC3.4: Optional fields omitted when null | `helpers.test.ts` AC3.4a–j                              | —                      |
| AC3.5: Category names appear             | `helpers.test.ts` AC3.5a                                | —                      |
| AC3.6: No categories when empty          | `helpers.test.ts` AC3.6                                 | —                      |
| AC3.7: Structural invariants (property)  | `helpers.property.test.ts` (3 properties)               | —                      |
| AC4.1: import type only                  | —                                                       | Phase 2, Steps 2.1–2.5 |
| AC4.2: Named exports only                | —                                                       | Phase 3, Steps 3.1–3.3 |
| AC5.1: Docs cover all helpers            | —                                                       | Phase 4, Steps 4.1–4.4 |
| AC5.2: Correct import paths              | —                                                       | Phase 4, Step 4.5      |
| AC5.3: import type exception noted       | —                                                       | Phase 4, Step 4.6      |
