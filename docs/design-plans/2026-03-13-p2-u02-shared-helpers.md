# Shared Response Helpers Design

## Summary

This unit introduces `src/tools/helpers.ts`, a shared utilities module that every MCP tool handler in Phase 2 and beyond will import. The file exports three pure functions covering the three most repetitive tasks in a tool handler: wrapping a plain string into the response envelope the MCP wire protocol expects (`textResult`), rejecting a call early when the in-memory recipe store is still empty after a cold start (`coldStartGuard`), and rendering a full `Recipe` object into human-readable markdown for display to the AI client (`recipeToMarkdown`).

The module is intentionally a Functional Core unit: no I/O, no side effects, and no runtime imports from the rest of the codebase. All cross-module dependencies (`CallToolResult`, `ServerContext`, `Recipe`) enter only as TypeScript types via `import type`, which means the module contributes nothing to the bundle beyond its three function bodies. By extracting these helpers once and testing them in isolation, all future tool handlers inherit correct wire-format shaping, safe cold-start behaviour, and consistent recipe rendering without repeating that logic.

## Definition of Done

- `src/tools/helpers.ts` created with three named exports: `textResult` (explicitly typed as `CallToolResult`), `coldStartGuard` (neverthrow `Result`), and `recipeToMarkdown`
- Unit tests covering all three functions, including edge cases for optional field omission in `recipeToMarkdown`
- `src/tools/CLAUDE.md` updated from placeholder to document the helpers module
- TypeScript compilation, lint, and tests all pass

## Acceptance Criteria

### p2-u02-shared-helpers.AC1: `textResult` wraps a string in the MCP wire envelope

- **p2-u02-shared-helpers.AC1.1 Success:** `textResult("hello")` returns `{ content: [{ type: "text", text: "hello" }] }`
- **p2-u02-shared-helpers.AC1.2 Success:** `textResult("")` returns `{ content: [{ type: "text", text: "" }] }` (empty string is valid)
- **p2-u02-shared-helpers.AC1.3 TypeScript:** the return value satisfies `CallToolResult` from `@modelcontextprotocol/sdk/types.js`
- **p2-u02-shared-helpers.AC1.4 TypeScript:** the narrow literal type is preserved — callers see `{ content: [{ type: "text"; text: string }] }`, not the widened `CallToolResult`

### p2-u02-shared-helpers.AC2: `coldStartGuard` gatekeeps tool invocations against an empty store

- **p2-u02-shared-helpers.AC2.1 Success:** returns `Ok<void>` when `store.size > 0`
- **p2-u02-shared-helpers.AC2.2 Failure:** returns `Err` when `store.size === 0`
- **p2-u02-shared-helpers.AC2.3 Failure:** the Err payload is a ready-to-return `CallToolResult` — callers return it directly without further wrapping
- **p2-u02-shared-helpers.AC2.4 Failure:** the Err message instructs the user to retry (e.g., "Try again in a few seconds")
- **p2-u02-shared-helpers.AC2.5 Usage:** callers use `.match(() => doWork(), (guard) => guard)` — both branches produce `CallToolResult`-compatible values

### p2-u02-shared-helpers.AC3: `recipeToMarkdown` renders a recipe as human-readable markdown

- **p2-u02-shared-helpers.AC3.1 Success:** output starts with `# {recipe.name}`
- **p2-u02-shared-helpers.AC3.2 Success:** output always contains an `## Ingredients` section
- **p2-u02-shared-helpers.AC3.3 Success:** output always contains a `## Directions` section
- **p2-u02-shared-helpers.AC3.4 Edge:** optional fields (`description`, `notes`, `source`, `nutritionalInfo`, etc.) are omitted entirely when empty string or falsy — no empty headings
- **p2-u02-shared-helpers.AC3.5 Success:** `categoryNames` items appear in the output when the array is non-empty
- **p2-u02-shared-helpers.AC3.6 Edge:** when `categoryNames` is `[]`, no categories section appears
- **p2-u02-shared-helpers.AC3.7 Property:** for any valid `Recipe` + any `categoryNames`, output always starts with `# {name}`, always contains `## Ingredients`, always contains `## Directions`

### p2-u02-shared-helpers.AC4: Module uses only `import type` for cross-module dependencies

- **p2-u02-shared-helpers.AC4.1:** `helpers.ts` imports `CallToolResult`, `ServerContext`, and `Recipe` only as `import type` — no runtime imports from the MCP SDK, `../types/`, or `../paprika/`
- **p2-u02-shared-helpers.AC4.2:** All three functions are named exports (no default export)

### p2-u02-shared-helpers.AC5: `src/tools/CLAUDE.md` documents the helpers module

- **p2-u02-shared-helpers.AC5.1:** Documents purpose and signature of all three helpers
- **p2-u02-shared-helpers.AC5.2:** Specifies correct import paths (`'./helpers.js'` same-directory, `'../tools/helpers.js'` cross-directory)
- **p2-u02-shared-helpers.AC5.3:** Notes that `import type` from `paprika/` is permitted in `helpers.ts`

## Glossary

- **MCP (Model Context Protocol)**: The protocol used by this server to communicate with AI clients. Tool handlers receive requests and must return responses in a specific wire format envelope.
- **`CallToolResult`**: The TypeScript type from `@modelcontextprotocol/sdk` that defines the exact shape of a valid tool response over the MCP wire format. Consists of a `content` array of typed content blocks.
- **Wire envelope / wire format**: The JSON structure that MCP requires for tool responses — specifically `{ content: [{ type: "text", text: "..." }] }`. Raw strings are not valid; they must be wrapped in this shape before returning.
- **`ServerContext`**: A plain immutable record defined in `src/types/server-context.ts` that bundles the four shared runtime objects (`client`, `cache`, `store`, `server`) and is passed by reference into every tool and resource handler.
- **`RecipeStore`**: The in-memory cache for recipes and categories (`src/cache/recipe-store.ts`). Its `size` getter returns the count of non-trashed recipes and is what `coldStartGuard` checks to detect an unsynced state.
- **`Recipe`**: The core domain type (`src/paprika/types.ts`). Represents a full Paprika recipe with numerous fields, many of which are optional and may be `null` or empty string.
- **cold start**: The window between server startup and the completion of the first background sync from the Paprika API, during which `RecipeStore` is empty. A `store.size === 0` check is the proxy for detecting this state.
- **neverthrow `Result<T, E>`**: A library type representing a value that is either `Ok<T>` (success) or `Err<E>` (failure), used instead of exceptions for recoverable errors. Callers chain with `.match()` or `.andThen()` rather than using imperative `if` checks.
- **`Ok` / `Err`**: The two constructors for a neverthrow `Result`. `Ok(value)` represents success; `Err(value)` represents a known failure with a typed payload.
- **`.match(okFn, errFn)`**: The neverthrow method that exhaustively handles both branches of a `Result`, producing a single output value. The project convention for consuming `Result` values.
- **Functional Core, Imperative Shell (FCIS)**: An architectural pattern where pure functions (no I/O, no side effects) live in the "core" and are composed by an outer "shell" that handles I/O. `helpers.ts` is a core module.
- **`import type`**: A TypeScript syntax that imports only a type, not the runtime value. The import is erased entirely at compile time, preventing accidental circular dependencies and keeping the compiled output clean.
- **`satisfies`**: A TypeScript operator (introduced in 4.9) that validates a value conforms to a type without widening the inferred type to that type. Used in `textResult` to assert conformance to `CallToolResult` while preserving the narrow literal shape for callers.
- **narrow / widened type**: When TypeScript infers a more specific type (narrow, e.g. `{ type: "text" }`) vs a broader type (widened, e.g. `string`). Preserving the narrow type gives callers more precise type information.
- **fast-check**: A property-based testing library for TypeScript. Rather than writing individual example inputs, you describe invariants that must hold for all inputs and fast-check generates test cases automatically.
- **property-based test**: A test that asserts an invariant holds for any valid input rather than specific examples. Used here to verify `recipeToMarkdown` structural guarantees.
- **vitest**: The test runner used in this project, compatible with the ESM toolchain.
- **`resolveCategories`**: A method on `RecipeStore` that converts an array of opaque `CategoryUid` brand strings into human-readable category name strings.
- **branded type**: A TypeScript technique for making structurally identical primitive types (`string`) non-interchangeable by attaching a phantom type tag (e.g., `RecipeUid`, `CategoryUid`). Prevents passing a category UID where a recipe UID is expected.

---

## Architecture

Three pure functions in a single Functional Core module at `src/tools/helpers.ts`. No I/O, no side effects, no runtime imports — every dependency is `import type`. All Phase 2 and Phase 3 tool handlers import from this file.

### Contracts

```typescript
// Wraps a string in the MCP wire response envelope.
// Uses `satisfies CallToolResult` to validate conformance without widening the
// inferred type — callers see the narrow literal shape.
export function textResult(text: string): { content: [{ type: "text"; text: string }] };

// Returns Ok<void> when the store has recipes, Err when sync hasn't completed.
// The Err payload is a ready-to-return CallToolResult, so callers can do:
//   return coldStartGuard(ctx).match(() => doWork(), (guard) => guard);
export function coldStartGuard(ctx: ServerContext): Result<void, ReturnType<typeof textResult>>;

// Renders a full Recipe as human-readable markdown.
// categoryNames must already be resolved (via store.resolveCategories(recipe.categories)).
// Optional fields are omitted when empty string / falsy.
// ## Ingredients and ## Directions sections always appear.
export function recipeToMarkdown(recipe: Recipe, categoryNames: string[]): string;
```

**Result usage convention:** Callers always use `.match()` or `.andThen()` — never `.isOk()` / `.isErr()` imperative checks. This is a codebase-wide convention enforced by CLAUDE.md.

### Data flow

Tool handler receives `ServerContext` → calls `coldStartGuard(ctx)` → on Ok, executes tool logic → wraps response with `textResult(...)`. For tools displaying recipes, calls `store.resolveCategories(recipe.categories)` then `recipeToMarkdown(recipe, categoryNames)` → wraps with `textResult(...)`.

---

## Existing Patterns

`helpers.ts` follows the Functional Core, Imperative Shell (FCIS) pattern established across the codebase. All existing pure-function modules (e.g., `src/utils/duration.ts`, `src/types/server-context.ts`) use only `import type` for cross-module dependencies.

The `neverthrow` Result chaining pattern with `.match()` and `.andThen()` is the established project convention (see `src/utils/config.ts` and `src/cache/recipe-store.ts`).

Test structure follows the existing `describe / it` pattern with vitest, property-based tests in a separate `*.property.test.ts` file using fast-check — matching `src/utils/duration.property.test.ts` and `src/cache/recipe-store.property.test.ts`.

---

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Shared helpers module

**Goal:** Create `src/tools/helpers.ts` with all three exported functions, cover them with unit and property-based tests, and update `src/tools/CLAUDE.md`.

**Components:**

- `src/tools/helpers.ts` (create) — three pure helper functions with `import type` for `CallToolResult`, `ServerContext`, and `Recipe`
- `src/tools/helpers.test.ts` (create) — unit tests organized by acceptance criterion; `ServerContext` stubbed with a plain object literal (no mock framework needed since `ServerContext` is a plain interface)
- `src/tools/helpers.property.test.ts` (create) — fast-check property tests for `recipeToMarkdown` invariants: output always starts with `# {name}`, always contains `## Ingredients` and `## Directions`
- `src/tools/CLAUDE.md` (modify) — replace placeholder with module documentation: function signatures and purpose, correct import paths for same-directory and cross-directory consumers, boundary clarification that `import type` from `paprika/` is permitted

**Dependencies:** P2-U01 (ServerContext interface), Phase 1 types (Recipe from `src/paprika/types.ts`), neverthrow installed

**Done when:** `pnpm typecheck`, `pnpm lint`, and `pnpm test` all exit 0; all acceptance criteria covered by passing tests

**Covers:** p2-u02-shared-helpers.AC1, p2-u02-shared-helpers.AC2, p2-u02-shared-helpers.AC3, p2-u02-shared-helpers.AC4, p2-u02-shared-helpers.AC5

<!-- END_PHASE_1 -->

---

## Additional Considerations

**`satisfies` vs explicit return type:** `textResult` uses `satisfies CallToolResult` rather than `: CallToolResult`. This validates conformance to the SDK type while preserving the narrow inferred literal type `{ content: [{ type: "text"; text: string }] }`. The narrow type is preferable because it provides more precise type information to callers without any runtime cost.

**`coldStartGuard` and zero-recipe edge case:** The guard treats `store.size === 0` as "sync not yet complete." A user with genuinely zero recipes would also trigger this guard. This is acceptable: an empty recipe store is indistinguishable from a cold-start state, and the error message ("Try again in a few seconds") is harmless for empty libraries. Future phases may refine this with an explicit sync-complete signal.

**Phase 3 compatibility:** Phase 3 tool handlers import `textResult` from `'../tools/helpers.js'`. The module must not acquire any Phase 2-specific logic that would break this import path or introduce unexpected behaviour for Phase 3 consumers.
