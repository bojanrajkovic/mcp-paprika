# p2-u02-shared-helpers Implementation Plan

**Goal:** Create `src/tools/helpers.ts`, a Functional Core module with three pure helper functions used by every MCP tool handler.

**Architecture:** Three named exports (`textResult`, `coldStartGuard`, `recipeToMarkdown`) in a single pure module with zero runtime imports — only `import type` for cross-module dependencies. Follows the Functional Core pattern established by `src/utils/duration.ts`.

**Tech Stack:** TypeScript 5.9 (strictest), ESM, neverthrow v8.2.0, vitest v4.0.18, fast-check v4.5.3, @modelcontextprotocol/sdk v1.27.1

**Scope:** 1 phase from original design (phase 1)

**Codebase verified:** 2026-03-13

---

## Acceptance Criteria Coverage

This phase implements and tests:

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

---

<!-- START_SUBCOMPONENT_A (tasks 1-4) -->

<!-- START_TASK_1 -->

### Task 1: Create `src/tools/helpers.ts`

**Verifies:** p2-u02-shared-helpers.AC1.1, p2-u02-shared-helpers.AC1.2, p2-u02-shared-helpers.AC1.3, p2-u02-shared-helpers.AC1.4, p2-u02-shared-helpers.AC2.1, p2-u02-shared-helpers.AC2.2, p2-u02-shared-helpers.AC2.3, p2-u02-shared-helpers.AC2.4, p2-u02-shared-helpers.AC2.5, p2-u02-shared-helpers.AC3.1, p2-u02-shared-helpers.AC3.2, p2-u02-shared-helpers.AC3.3, p2-u02-shared-helpers.AC3.4, p2-u02-shared-helpers.AC3.5, p2-u02-shared-helpers.AC3.6, p2-u02-shared-helpers.AC4.1, p2-u02-shared-helpers.AC4.2

**Files:**

- Create: `src/tools/helpers.ts`

**Implementation:**

Create the file with the exact contents below. Do not deviate — the `satisfies` pattern and `import type` requirements are precise.

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";
import type { Recipe } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";

export function textResult(text: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text }] } satisfies CallToolResult;
}

export function coldStartGuard(ctx: ServerContext): Result<void, ReturnType<typeof textResult>> {
  if (ctx.store.size === 0) {
    return err(textResult("Recipe store is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

export function recipeToMarkdown(recipe: Recipe, categoryNames: Array<string>): string {
  const lines: Array<string> = [];

  lines.push(`# ${recipe.name}`);

  if (categoryNames.length > 0) {
    lines.push("");
    lines.push(`**Categories:** ${categoryNames.join(", ")}`);
  }

  if (recipe.description) {
    lines.push("");
    lines.push(recipe.description);
  }

  const timeParts: Array<string> = [];
  if (recipe.prepTime) timeParts.push(`Prep: ${recipe.prepTime}`);
  if (recipe.cookTime) timeParts.push(`Cook: ${recipe.cookTime}`);
  if (recipe.totalTime) timeParts.push(`Total: ${recipe.totalTime}`);
  if (timeParts.length > 0) {
    lines.push("");
    lines.push(timeParts.join(" · "));
  }

  if (recipe.servings) {
    lines.push("");
    lines.push(`**Servings:** ${recipe.servings}`);
  }

  if (recipe.difficulty) {
    lines.push("");
    lines.push(`**Difficulty:** ${recipe.difficulty}`);
  }

  lines.push("");
  lines.push("## Ingredients");
  lines.push("");
  lines.push(recipe.ingredients);

  lines.push("");
  lines.push("## Directions");
  lines.push("");
  lines.push(recipe.directions);

  if (recipe.notes) {
    lines.push("");
    lines.push("## Notes");
    lines.push("");
    lines.push(recipe.notes);
  }

  if (recipe.nutritionalInfo) {
    lines.push("");
    lines.push("## Nutritional Info");
    lines.push("");
    lines.push(recipe.nutritionalInfo);
  }

  if (recipe.source) {
    lines.push("");
    if (recipe.sourceUrl) {
      lines.push(`**Source:** [${recipe.source}](${recipe.sourceUrl})`);
    } else {
      lines.push(`**Source:** ${recipe.source}`);
    }
  } else if (recipe.sourceUrl) {
    lines.push("");
    lines.push(`**Source:** ${recipe.sourceUrl}`);
  }

  return lines.join("\n");
}
```

**Notes on implementation choices:**

- `neverthrow` is a _runtime_ import (`err`, `ok`) — the `Result` _type_ is `import type`. This is correct: `err`/`ok` are runtime functions used to construct the Result.
- `CallToolResult`, `Recipe`, `ServerContext` are all `import type` — no runtime footprint.
- `satisfies CallToolResult` validates conformance without widening the return type. TypeScript infers the narrow `{ content: [{ type: "text"; text: string }] }` shape, which is more useful to callers than the broad `CallToolResult` union.
- `recipeToMarkdown` only includes sections for truthy fields. All nullable fields in `Recipe` are typed as `string | null` (confirmed in codebase) — the truthiness check handles both `null` and empty string.
- `Array<string>` (not `string[]`) per project TypeScript conventions.

**Verification:**

Run: `pnpm typecheck`
Expected: Exits 0, no errors.

Run: `pnpm lint`
Expected: Exits 0, no warnings.

**Commit:** `feat(tools): add shared helper functions (textResult, coldStartGuard, recipeToMarkdown)`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Create `src/tools/helpers.test.ts` (unit tests)

**Verifies:** p2-u02-shared-helpers.AC1.1, p2-u02-shared-helpers.AC1.2, p2-u02-shared-helpers.AC2.1, p2-u02-shared-helpers.AC2.2, p2-u02-shared-helpers.AC2.3, p2-u02-shared-helpers.AC2.4, p2-u02-shared-helpers.AC2.5, p2-u02-shared-helpers.AC3.1, p2-u02-shared-helpers.AC3.2, p2-u02-shared-helpers.AC3.3, p2-u02-shared-helpers.AC3.4, p2-u02-shared-helpers.AC3.5, p2-u02-shared-helpers.AC3.6

**Files:**

- Create: `src/tools/helpers.test.ts`
- Reference (read only): `src/cache/__fixtures__/recipes.ts` — use `makeRecipe()` and `makeCategory()` for test data

**Implementation:**

The test file structure follows `src/utils/duration.test.ts` exactly: `describe`/`it` blocks named after the AC identifiers, neverthrow results consumed with `.match()` (never `.isOk()`/`.isErr()`), plain object literals for ServerContext stubs (no mock framework).

For `coldStartGuard`, construct a minimal ServerContext stub as a plain object literal that satisfies the interface structurally:

```typescript
// Minimal ServerContext stub — only `store.size` matters for coldStartGuard
const makeCtx = (size: number) =>
  ({
    store: { size } as unknown as ServerContext["store"],
    client: {} as unknown as ServerContext["client"],
    cache: {} as unknown as ServerContext["cache"],
    server: {} as unknown as ServerContext["server"],
  }) satisfies ServerContext;
```

Tests must cover, organized by AC group:

**AC1 — textResult:**

- `textResult("hello")` deep-equals `{ content: [{ type: "text", text: "hello" }] }`
- `textResult("")` deep-equals `{ content: [{ type: "text", text: "" }] }`

**AC2 — coldStartGuard:**

- `makeCtx(1)` → result is Ok (use `.match(ok => true, () => false)` pattern and assert `true`)
- `makeCtx(5)` → result is Ok
- `makeCtx(0)` → result is Err (use `.match(() => false, () => true)` pattern and assert `true`)
- `makeCtx(0)` Err payload `.content[0].text` contains "Try again" (case-insensitive substring check acceptable)
- Usage pattern: `coldStartGuard(makeCtx(1)).match(() => "ok", (guard) => guard.content[0].text)` returns `"ok"`
- Usage pattern: `coldStartGuard(makeCtx(0)).match(() => "ok", (guard) => guard.content[0].text)` returns the retry message

**AC3 — recipeToMarkdown:**
Use `makeRecipe()` from `src/cache/__fixtures__/recipes.ts`:

- Full recipe (all optional fields populated): output starts with `# ` + recipe name
- Full recipe: output contains `## Ingredients`
- Full recipe: output contains `## Directions`
- Recipe with `description: "Tasty"`: output contains `"Tasty"`
- Recipe with `description: null`: output does NOT contain `## Description` heading
- Recipe with `notes: "My note"`: output contains `## Notes`
- Recipe with `notes: null`: output does NOT contain `## Notes`
- Recipe with `nutritionalInfo: "200 cal"`: output contains `## Nutritional Info`
- Recipe with `nutritionalInfo: null`: output does NOT contain `## Nutritional Info`
- Non-empty `categoryNames`: output contains the category name
- Empty `categoryNames: []`: output does NOT contain `**Categories:**`

**Verification:**

Run: `pnpm test`
Expected: All tests pass, exits 0.

**Commit:** `test(tools): add unit tests for shared helper functions`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Create `src/tools/helpers.property.test.ts` (property-based tests)

**Verifies:** p2-u02-shared-helpers.AC3.7

**Files:**

- Create: `src/tools/helpers.property.test.ts`
- Reference (read only): `src/utils/duration.property.test.ts` — pattern to follow
- Reference (read only): `src/cache/recipe-store.property.test.ts` — shows how to build arbitrary Recipe objects with fast-check

**Implementation:**

Follow the `src/utils/duration.property.test.ts` pattern: `import fc from "fast-check"`, wrap assertions in `fc.assert(fc.property(...))`.

AC3.7 requires three structural invariants that hold for any valid `Recipe` + any `categoryNames`:

1. Output starts with `# {name}`
2. Output contains `## Ingredients`
3. Output contains `## Directions`

Build a fast-check arbitrary for Recipe. The simplest approach: use `fc.record()` with all fields. Required fields are non-nullable; optional fields can use `fc.option(fc.string(), { nil: null })` to generate both `null` and string values.

Minimal arbitrary (matches codebase's `RecipeStoredSchema`):

```typescript
const arbitraryRecipe = fc.record({
  uid: fc.string().map((s) => s as RecipeUid),
  hash: fc.string(),
  name: fc.string({ minLength: 1 }), // name must be non-empty for meaningful test
  categories: fc.array(fc.string().map((s) => s as CategoryUid)),
  ingredients: fc.string(),
  directions: fc.string(),
  description: fc.option(fc.string(), { nil: null }),
  notes: fc.option(fc.string(), { nil: null }),
  prepTime: fc.option(fc.string(), { nil: null }),
  cookTime: fc.option(fc.string(), { nil: null }),
  totalTime: fc.option(fc.string(), { nil: null }),
  servings: fc.option(fc.string(), { nil: null }),
  difficulty: fc.option(fc.string(), { nil: null }),
  rating: fc.integer({ min: 0, max: 5 }),
  created: fc.string(),
  imageUrl: fc.string(),
  photo: fc.option(fc.string(), { nil: null }),
  photoHash: fc.option(fc.string(), { nil: null }),
  photoLarge: fc.option(fc.string(), { nil: null }),
  photoUrl: fc.option(fc.string(), { nil: null }),
  source: fc.option(fc.string(), { nil: null }),
  sourceUrl: fc.option(fc.string(), { nil: null }),
  onFavorites: fc.boolean(),
  inTrash: fc.boolean(),
  isPinned: fc.boolean(),
  onGroceryList: fc.boolean(),
  scale: fc.option(fc.string(), { nil: null }),
  nutritionalInfo: fc.option(fc.string(), { nil: null }),
});

const arbitraryCategoryNames = fc.array(fc.string());
```

Import `RecipeUid` and `CategoryUid` as types for the cast expressions:

```typescript
import type { Recipe, RecipeUid, CategoryUid } from "../paprika/types.js";
```

Write three properties inside a `describe("p2-u02-shared-helpers.AC3.7: recipeToMarkdown structural invariants", ...)` block:

```typescript
it("Property 1: output always starts with # {recipe.name}", () => {
  fc.assert(
    fc.property(arbitraryRecipe, arbitraryCategoryNames, (recipe, categoryNames) => {
      const output = recipeToMarkdown(recipe, categoryNames);
      expect(output.startsWith(`# ${recipe.name}`)).toBe(true);
    }),
  );
});

it("Property 2: output always contains ## Ingredients", () => {
  fc.assert(
    fc.property(arbitraryRecipe, arbitraryCategoryNames, (recipe, categoryNames) => {
      const output = recipeToMarkdown(recipe, categoryNames);
      expect(output).toContain("## Ingredients");
    }),
  );
});

it("Property 3: output always contains ## Directions", () => {
  fc.assert(
    fc.property(arbitraryRecipe, arbitraryCategoryNames, (recipe, categoryNames) => {
      const output = recipeToMarkdown(recipe, categoryNames);
      expect(output).toContain("## Directions");
    }),
  );
});
```

**Verification:**

Run: `pnpm test`
Expected: All tests pass (including property tests), exits 0.

**Commit:** `test(tools): add property-based tests for recipeToMarkdown invariants`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->

### Task 4: Update `src/tools/CLAUDE.md`

**Verifies:** p2-u02-shared-helpers.AC5.1, p2-u02-shared-helpers.AC5.2, p2-u02-shared-helpers.AC5.3

**Files:**

- Modify: `src/tools/CLAUDE.md` (currently a placeholder — replace entirely)

**Implementation:**

Replace the current placeholder contents of `src/tools/CLAUDE.md` with:

````markdown
# MCP Tool Definitions

Last verified: 2026-03-13

Purpose: Defines MCP tools that AI assistants can invoke.

## Shared Helpers (`helpers.ts`)

All tool handlers import shared utilities from `./helpers.js` (same-directory) or `../tools/helpers.js` (cross-directory from outside `src/tools/`).

### `textResult(text: string)`

Wraps a plain string in the MCP wire response envelope.

```typescript
import { textResult } from "./helpers.js";

// Returns: { content: [{ type: "text", text }] }
// Satisfies CallToolResult while preserving the narrow literal type.
return textResult("Hello, world!");
```
````

### `coldStartGuard(ctx: ServerContext)`

Returns `Ok<void>` when the recipe store has recipes (sync complete), or `Err<CallToolResult>` when the store is empty (cold start). Use `.match()` to handle both branches:

```typescript
import { coldStartGuard, textResult } from "./helpers.js";

return coldStartGuard(ctx).match(
  () => {
    // store is ready — execute tool logic
    return textResult("result");
  },
  (guard) => guard, // return the ready-to-send error directly
);
```

### `recipeToMarkdown(recipe: Recipe, categoryNames: string[])`

Renders a full Recipe as human-readable markdown. `categoryNames` must be pre-resolved via `ctx.store.resolveCategories(recipe.categories)` before calling.

Optional recipe fields (`description`, `notes`, `nutritionalInfo`, `source`, etc.) are omitted entirely when `null` or falsy — no empty headings appear.

```typescript
import { recipeToMarkdown, textResult } from "./helpers.js";

const categoryNames = ctx.store.resolveCategories(recipe.categories);
return textResult(recipeToMarkdown(recipe, categoryNames));
```

## Boundaries

- Tool handlers **must not** import from `paprika/` or `cache/` at runtime — use `ServerContext` (via `features/` or the context object) as the intermediary.
- `helpers.ts` is an exception: it uses `import type` from `paprika/` for the `Recipe` type. Type-only imports have no runtime footprint and do not violate the boundary.

## Dependencies

- Used by: `index.ts` (MCP server registration)
- Uses: `types/` (ServerContext), `paprika/types.ts` (Recipe, via `import type` only)

````

**Verification:**

Run: `pnpm lint`
Expected: Exits 0. (oxlint lints `.ts` files only; CLAUDE.md is markdown and not linted)

**Commit:** `docs(tools): document helpers module in src/tools/CLAUDE.md`
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_A -->

---

## Verification Summary

After all four tasks complete, run the full verification suite:

```bash
pnpm typecheck  # must exit 0
pnpm lint       # must exit 0
pnpm test       # must exit 0
````

All three must pass before the phase is considered done.
