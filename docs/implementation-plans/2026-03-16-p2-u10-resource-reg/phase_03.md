# MCP Resource Registration — Phase 3: Implement `src/resources/recipes.ts` and Tests

**Goal:** Create the `src/resources/recipes.ts` module that exposes all non-trashed recipes as browseable MCP resources at `paprika://recipe/{uid}`, and write a full test suite covering list, read, and error cases.

**Architecture:** A single registration function `registerRecipeResources(server, ctx)` constructs a `ResourceTemplate` with a list callback (delegates to `ctx.store.getAll()`), then calls `server.registerResource()` with a read callback (delegates to `ctx.store.get()`, `ctx.store.resolveCategories()`, and `recipeToMarkdown()`). Tests use the extended `makeTestServer()` from Phase 1 and `makeCtx()` from `tool-test-utils.ts`.

**Tech Stack:** TypeScript 5.9, `@modelcontextprotocol/sdk` v1.27.1 (`ResourceTemplate` from `server/mcp.js`), Vitest

**Scope:** 3 of 3 phases

**Codebase verified:** 2026-03-16

---

## Acceptance Criteria Coverage

### p2-u10-resource-reg.AC1: Recipe list is accessible as MCP resources

- **p2-u10-resource-reg.AC1.1 Success:** List handler returns all non-trashed recipes with `uri: "paprika://recipe/{uid}"`, `name: recipe.name`, and `mimeType: "text/markdown"` for each
- **p2-u10-resource-reg.AC1.2 Success:** List handler returns `{ resources: [] }` when the store is empty — no error, no cold-start guard fires
- **p2-u10-resource-reg.AC1.3 Success:** Recipes with `inTrash: true` are excluded from the list

### p2-u10-resource-reg.AC2: Individual recipes are readable as MCP resources

- **p2-u10-resource-reg.AC2.1 Success:** Read handler returns content with a UID header line (`**UID:** \`{uid}\``) prepended to the recipe markdown for a valid UID
- **p2-u10-resource-reg.AC2.2 Success:** Category UIDs are resolved to display names in the markdown output
- **p2-u10-resource-reg.AC2.3 Success:** Response includes `mimeType: "text/markdown"` and `uri: uri.href` in the contents entry
- **p2-u10-resource-reg.AC2.4 Failure:** Read handler throws an error when the requested UID does not exist in the store

---

## Key Codebase Facts (verified by investigator)

- `src/resources/` is empty — contains only `.gitkeep` and `CLAUDE.md`
- `RecipeStore.getAll(): Array<Recipe>` — already excludes trashed recipes (`if (!recipe.inTrash)`)
- `RecipeStore.get(uid: RecipeUid): Recipe | undefined` — returns `undefined` on miss
- `RecipeStore.resolveCategories(categoryUids: ReadonlyArray<CategoryUid>): Array<string>` — returns display names
- `recipeToMarkdown(recipe: Recipe, categoryNames: Array<string>): string` — exported from `src/tools/helpers.ts`
- `RecipeUid` is a Zod branded string (`z.string().brand("RecipeUid")`) in `src/paprika/types.ts` — use `import type` (no runtime footprint)
- `ResourceTemplate` → import from `@modelcontextprotocol/sdk/server/mcp.js` (per `docs/verified-api.md`)
- `registerResource(name, template, config, readCallback)` — `config` can be `{}` or `{ description: string }`
- `sendResourceListChanged()` — NOT called in this module (called in `commitRecipe` from Phase 2)
- No `McpError` in this project — throw plain `Error` from read handler; SDK converts to protocol error
- `resources/CLAUDE.md` boundary: no runtime imports from `paprika/` or `cache/` — `import type` is fine
- `recipeToMarkdown` lives in `src/tools/helpers.ts` — resources may import it (it's a pure formatter with no tool-specific dependencies)
- Phase 1 extended `makeTestServer()` provides `callResourceList(name)`, `callResource(name, uid)`, and `sendResourceListChanged` spy
- Test reference pattern from `read.ts`: `ctx.store.resolveCategories(recipe.categories)` → `recipeToMarkdown(recipe, categoryNames)`
- AC1.3 is verified by `RecipeStore.getAll()` itself (it already filters trashed) — test should confirm by adding a trashed recipe and verifying it's absent from results
- No `coldStartGuard` in list handler — empty store returns empty list (correct behavior per design)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Create `src/resources/recipes.ts`

**Verifies:** p2-u10-resource-reg.AC1.1, p2-u10-resource-reg.AC1.2, p2-u10-resource-reg.AC1.3, p2-u10-resource-reg.AC2.1, p2-u10-resource-reg.AC2.2, p2-u10-resource-reg.AC2.3, p2-u10-resource-reg.AC2.4

**Files:**

- Create: `src/resources/recipes.ts`

**Implementation:**

```typescript
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RecipeUid } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";
import { recipeToMarkdown } from "../tools/helpers.js";

export function registerRecipeResources(server: McpServer, ctx: ServerContext): void {
  const template = new ResourceTemplate("paprika://recipe/{uid}", {
    list: async () => {
      const recipes = ctx.store.getAll();
      return {
        resources: recipes.map((recipe) => ({
          uri: `paprika://recipe/${recipe.uid}`,
          name: recipe.name,
          mimeType: "text/markdown",
        })),
      };
    },
  });

  server.registerResource(
    "recipes",
    template,
    { description: "Paprika recipes accessible by UID" },
    async (uri, variables) => {
      const uid = variables["uid"] as RecipeUid;
      const recipe = ctx.store.get(uid);
      if (!recipe) {
        throw new Error(`Recipe not found: ${uid}`);
      }
      const categoryNames = ctx.store.resolveCategories(recipe.categories);
      const content = `**UID:** \`${uid}\`\n\n${recipeToMarkdown(recipe, categoryNames)}`;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: content,
          },
        ],
      };
    },
  );
}
```

**Notes for implementor:**

- The `uid` cast: `variables["uid"] as RecipeUid` — this is safe because the URI template guarantees `{uid}` is a string, and we check `ctx.store.get(uid)` for `undefined` immediately after. The `import type` for `RecipeUid` has zero runtime footprint.
- The `list` callback returns `{ resources: [...] }` — when `getAll()` returns an empty array, this correctly returns `{ resources: [] }` (AC1.2). No cold-start guard is needed.
- `recipeToMarkdown` is imported from `../tools/helpers.js` — this is a runtime import, but `recipeToMarkdown` is a pure formatter with no tool-specific dependencies. The `resources/CLAUDE.md` boundary forbids direct `paprika/` or `cache/` runtime imports, not imports from `tools/helpers.js`.
- The content string uses template literal with `\n\n` between the UID header and the recipe markdown body.
- The `variables` parameter is typed as `Record<string, string | string[]>` by the SDK. We access `variables["uid"]` as `string` (the `{uid}` template variable always produces a scalar string). The TypeScript compiler may warn about the `string | string[]` union — use the `as RecipeUid` cast to address both the union narrowing and the branded type in one step.

**Verification:**

Run: `pnpm typecheck`
Expected: Zero type errors

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Create `src/resources/recipes.test.ts`

**Verifies:** p2-u10-resource-reg.AC1.1, p2-u10-resource-reg.AC1.2, p2-u10-resource-reg.AC1.3, p2-u10-resource-reg.AC2.1, p2-u10-resource-reg.AC2.2, p2-u10-resource-reg.AC2.3, p2-u10-resource-reg.AC2.4

**Files:**

- Create: `src/resources/recipes.test.ts`

**Testing:**

Use the extended `makeTestServer()` from Phase 1 (provides `callResourceList`, `callResource`, `sendResourceListChanged`), `makeCtx()`, and a real `RecipeStore` populated per test. Fixtures: use existing `makeRecipe()` helper from the test fixture utilities (check how `helpers.test.ts` and `create.test.ts` create recipe fixtures — they use a factory from `src/cache/__fixtures__/recipes.ts`).

Tests must verify each AC:

- **p2-u10-resource-reg.AC1.1**: Create a store with two non-trashed recipes. Call `callResourceList("recipes")`. Verify result has `resources` array with entries containing `uri: "paprika://recipe/{uid}"`, `name: recipe.name`, and `mimeType: "text/markdown"` for each recipe.

- **p2-u10-resource-reg.AC1.2**: Create an empty store. Call `callResourceList("recipes")`. Verify result is `{ resources: [] }` and no error is thrown.

- **p2-u10-resource-reg.AC1.3**: Create a store with one non-trashed recipe and one trashed recipe. Call `callResourceList("recipes")`. Verify only the non-trashed recipe appears in the results.

- **p2-u10-resource-reg.AC2.1**: Create a recipe with a known UID. Call `callResource("recipes", uid)`. Verify the returned `contents[0].text` starts with `` **UID:** `{uid}` ``.

- **p2-u10-resource-reg.AC2.2**: Create a recipe with categories. Call `callResource("recipes", uid)`. Verify the returned markdown contains the resolved category display names (not raw UIDs).

- **p2-u10-resource-reg.AC2.3**: Call `callResource("recipes", uid)`. Verify the returned `contents[0].mimeType === "text/markdown"` and `contents[0].uri === "paprika://recipe/{uid}"` (matches `uri.href`).

- **p2-u10-resource-reg.AC2.4**: Call `callResource("recipes", "nonexistent-uid")`. Verify the promise rejects (the read callback throws a plain `Error`).

**Test infrastructure notes:**

- `callResourceList(name)` returns `Promise<unknown>` — cast as `{ resources: Array<{ uri: string; name: string; mimeType: string }> }` for assertions
- `callResource(name, uid)` returns `Promise<unknown>` — cast as `{ contents: Array<{ uri: string; mimeType: string; text: string }> }` for assertions
- Check `src/cache/__fixtures__/recipes.ts` for the `makeRecipe()` factory before writing — it likely accepts partial overrides (similar pattern to helpers tests). Also check if there's a `makeRecipeStore()` or similar utility.
- For trashed recipes (AC1.3): set `inTrash: true` on the recipe fixture using the override pattern
- For categories (AC2.2): create a recipe with `categories: [someUid]` and pre-populate the store's categories map so `resolveCategories` returns a known display name. Check how `RecipeStore` is constructed and how categories are set — look at existing `recipe-store.test.ts` for the pattern.
- AC2.4 assertion: use `await expect(callResource("recipes", "bad-uid")).rejects.toThrow()` (Vitest pattern)

**Verification:**

Run: `pnpm test src/resources/recipes.test.ts`
Expected: All AC tests pass

Run: `pnpm test`
Expected: All tests pass (no regressions)

**Commit:** `feat(resources): add recipe resources — list and read via paprika://recipe/{uid}`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

---

## Post-implementation: Update `src/resources/CLAUDE.md`

After the tests pass, update `src/resources/CLAUDE.md` to reflect the actual contracts and dependencies:

- Update "Last verified" date to today
- Update "Contracts" section to document `registerRecipeResources(server: McpServer, ctx: ServerContext): void`
- Update "Dependencies" to add `tools/helpers.ts` (runtime import of `recipeToMarkdown`)
- Update "Boundary" to note that `import type` from `paprika/` is allowed (same rule as tools)

This update does not need a separate commit — include it in the `feat(resources)` commit from Task 2.

---

## Out of Scope: `src/index.ts` Wiring

`registerRecipeResources` is created and fully tested by this unit, but **wiring it into `src/index.ts` is explicitly out of scope**. The design's "Definition of Done" does not include entry-point registration. The resources module will be activated in a later unit (entry-point assembly) that wires all registration functions into the running server.
