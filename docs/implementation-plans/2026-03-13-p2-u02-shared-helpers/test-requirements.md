# Test Requirements: p2-u02-shared-helpers (Phase 1)

## Automated Tests

### `src/tools/helpers.test.ts` (unit tests)

| Criterion                   | Test Type | Description                                                                                                                                                                  |
| --------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p2-u02-shared-helpers.AC1.1 | unit      | `textResult("hello")` deep-equals `{ content: [{ type: "text", text: "hello" }] }`                                                                                           |
| p2-u02-shared-helpers.AC1.2 | unit      | `textResult("")` deep-equals `{ content: [{ type: "text", text: "" }] }` (empty string preserved)                                                                            |
| p2-u02-shared-helpers.AC2.1 | unit      | `coldStartGuard` returns `Ok<void>` when `store.size > 0` (verified via `.match()` producing a success sentinel)                                                             |
| p2-u02-shared-helpers.AC2.2 | unit      | `coldStartGuard` returns `Err` when `store.size === 0` (verified via `.match()` producing a failure sentinel)                                                                |
| p2-u02-shared-helpers.AC2.3 | unit      | The `Err` payload has the shape `{ content: [{ type: "text", text: string }] }` — a ready-to-return `CallToolResult` requiring no further wrapping                           |
| p2-u02-shared-helpers.AC2.4 | unit      | The `Err` payload's text contains a retry instruction (case-insensitive substring match for "Try again")                                                                     |
| p2-u02-shared-helpers.AC2.5 | unit      | `.match(() => "ok", (guard) => guard.content[0].text)` returns `"ok"` for a populated store and the retry message for an empty store, demonstrating the caller usage pattern |
| p2-u02-shared-helpers.AC3.1 | unit      | Output of `recipeToMarkdown` for a full recipe starts with `# {recipe.name}`                                                                                                 |
| p2-u02-shared-helpers.AC3.2 | unit      | Output of `recipeToMarkdown` always contains `## Ingredients`                                                                                                                |
| p2-u02-shared-helpers.AC3.3 | unit      | Output of `recipeToMarkdown` always contains `## Directions`                                                                                                                 |
| p2-u02-shared-helpers.AC3.4 | unit      | Optional fields (`description`, `notes`, `nutritionalInfo`, `source`) are omitted from output when `null` or empty string — no empty section headings appear                 |
| p2-u02-shared-helpers.AC3.5 | unit      | When `categoryNames` is non-empty, the category names appear in the output (e.g., `**Categories:** Dessert, Baking`)                                                         |
| p2-u02-shared-helpers.AC3.6 | unit      | When `categoryNames` is `[]`, the output does not contain `**Categories:**`                                                                                                  |

### `src/tools/helpers.property.test.ts` (property-based tests)

| Criterion                   | Test Type | Description                                                                                                                                                                                                                                                                                                           |
| --------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p2-u02-shared-helpers.AC3.7 | property  | Three fast-check properties over arbitrary `Recipe` + arbitrary `categoryNames`: (1) output always starts with `# {recipe.name}`, (2) output always contains `## Ingredients`, (3) output always contains `## Directions`. fast-check generates random inputs to verify these structural invariants hold universally. |

## Human / Typecheck Verification

### p2-u02-shared-helpers.AC1.3: Return value satisfies `CallToolResult`

**Why not automated:** This is a compile-time type constraint enforced by the `satisfies CallToolResult` operator in the implementation. At runtime, there is no `CallToolResult` type to check against — TypeScript types are erased. The constraint either compiles or it does not.

**Verification approach:** Run `pnpm typecheck`. If `textResult` returns a value that does not conform to `CallToolResult`, the `satisfies` expression will produce a TypeScript compiler error and `tsc --noEmit` will exit non-zero.

---

### p2-u02-shared-helpers.AC1.4: Narrow literal type is preserved (not widened to `CallToolResult`)

**Why not automated:** This is a type-level property of the function signature. At runtime, the narrow type and the widened type produce identical JavaScript values — the distinction only exists in the TypeScript type system. No runtime assertion can distinguish `{ content: [{ type: "text"; text: string }] }` from `CallToolResult`.

**Verification approach:** Inspect the explicit return type annotation on `textResult` in `src/tools/helpers.ts`. The signature must read `): { content: [{ type: "text"; text: string }] }` (the narrow literal shape), and the body must use `satisfies CallToolResult` (not `: CallToolResult`). Run `pnpm typecheck` to confirm the annotation and implementation agree. Optionally, hover over `textResult` in an IDE to confirm the inferred return type matches the narrow shape.

---

### p2-u02-shared-helpers.AC4.1: Module uses only `import type` for cross-module dependencies

**Why not automated:** This is a source-level structural constraint about import syntax. At runtime, `import type` statements are erased entirely — there is no observable difference between a module that used `import type` and one that used a regular `import` (assuming no side effects). Verifying this requires inspecting the source text.

**Verification approach:** Open `src/tools/helpers.ts` and confirm:

- `CallToolResult` is imported via `import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"`
- `Recipe` is imported via `import type { Recipe } from "../paprika/types.js"`
- `ServerContext` is imported via `import type { ServerContext } from "../types/server-context.js"`
- The only non-type import is `{ err, ok }` from `"neverthrow"` (runtime constructors required by the function bodies)
- Run `pnpm typecheck` to confirm the module compiles under strict mode with these imports.

---

### p2-u02-shared-helpers.AC4.2: All three functions are named exports (no default export)

**Why not automated:** This is a source-level structural constraint. The constraint is better verified by source inspection.

**Verification approach:** Open `src/tools/helpers.ts` and confirm:

- `textResult`, `coldStartGuard`, and `recipeToMarkdown` are each preceded by `export function`
- No `export default` statement exists in the file
- Run `pnpm typecheck` to confirm the named exports resolve correctly from the test files that import them.

---

### p2-u02-shared-helpers.AC5.1: `src/tools/CLAUDE.md` documents purpose and signature of all three helpers

**Why not automated:** Documentation completeness is a qualitative judgment that requires reading prose. Automated checks would be brittle and not meaningfully validate that the documentation is accurate or useful.

**Verification approach:** Open `src/tools/CLAUDE.md` and confirm it contains sections for `textResult`, `coldStartGuard`, and `recipeToMarkdown`, each with a description of purpose and a code example showing the function signature and usage.

---

### p2-u02-shared-helpers.AC5.2: Specifies correct import paths

**Why not automated:** Verifies documentation prose contains the correct import path strings — a qualitative check.

**Verification approach:** Open `src/tools/CLAUDE.md` and confirm it specifies:

- `'./helpers.js'` for same-directory imports (from within `src/tools/`)
- `'../tools/helpers.js'` for cross-directory imports (from outside `src/tools/`)

---

### p2-u02-shared-helpers.AC5.3: Notes that `import type` from `paprika/` is permitted in `helpers.ts`

**Why not automated:** Verifies documentation content, not runtime behavior.

**Verification approach:** Open `src/tools/CLAUDE.md` and confirm it contains a note (in the Boundaries section or equivalent) stating that `helpers.ts` uses `import type` from `paprika/` for the `Recipe` type and that type-only imports are permitted despite the general boundary rule against importing from `paprika/` in tool code.
