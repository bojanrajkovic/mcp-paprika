# Human Test Plan: Discovery Tools (p2-discovery-tools)

## Prerequisites

- Node.js 24 running (managed via mise)
- Dependencies installed: `pnpm install`
- All automated tests passing: `pnpm test` (307 tests, 0 failures)
- Project builds cleanly: `pnpm build`
- Lint and typecheck pass: `pnpm typecheck && pnpm lint`

---

## Phase 1: AC5.1 — Tool Registration via `registerTool()` with raw `ZodRawShape`

Purpose: Verify all four tools pass `inputSchema` as a plain object with Zod fields, not wrapped in `z.object()`.

| Step | Action                                                           | Expected                                                                                                                                                         |
| ---- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Open `src/tools/search.ts`, lines 9–25                           | `inputSchema` is `{ query: z.string()..., limit: z.number()... }` — a plain object literal, no `z.object()` wrapper                                              |
| 2    | Open `src/tools/filter.ts`, lines 12–31 (`filter_by_ingredient`) | `inputSchema` is `{ ingredients: z.array(z.string())..., mode: z.enum(...)..., limit: z.number()... }` — plain object, no `z.object()`                           |
| 3    | Open `src/tools/filter.ts`, lines 48–65 (`filter_by_time`)       | `inputSchema` is `{ maxPrepTime: z.string()..., maxCookTime: z.string()..., maxTotalTime: z.string()..., limit: z.number()... }` — plain object, no `z.object()` |
| 4    | Open `src/tools/categories.ts`, lines 8–14 (`list_categories`)   | `inputSchema` is `{}` — empty plain object, no `z.object()`                                                                                                      |
| 5    | Search all tool files for `z.object(`                            | Zero matches in `search.ts`, `filter.ts`, `categories.ts`                                                                                                        |

---

## Phase 2: AC5.2 — Cold-Start Guard Uses Idiomatic `.match()` Pattern

Purpose: Verify all four tool handlers use `coldStartGuard(ctx).match(okFn, errFn)` rather than imperative `.isOk()` / `.isErr()` checks.

| Step | Action                                                               | Expected                                                                              |
| ---- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1    | Open `src/tools/search.ts`, line 27                                  | Handler body contains `coldStartGuard(ctx).match(`                                    |
| 2    | Verify the Err branch at line 39                                     | `(guard) => guard` — returns the cold-start error result directly                     |
| 3    | Open `src/tools/filter.ts`, line 34 (`filter_by_ingredient` handler) | Handler body contains `coldStartGuard(ctx).match(` with `(guard) => guard` Err branch |
| 4    | Open `src/tools/filter.ts`, line 68 (`filter_by_time` handler)       | Handler body contains `coldStartGuard(ctx).match(` with `(guard) => guard` Err branch |
| 5    | Open `src/tools/categories.ts`, line 16                              | Handler body contains `coldStartGuard(ctx).match(` with `(guard) => guard` Err branch |
| 6    | Search all three tool files for `.isOk(` and `.isErr(`               | Zero matches                                                                          |

---

## Phase 3: AC5.3 — No Direct `PaprikaClient` Usage

Purpose: Verify tool handlers access data exclusively through `ctx.store`, never importing or calling `PaprikaClient` directly.

| Step | Action                                                         | Expected                                                                                                                                                                                                |
| ---- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Open `src/tools/search.ts`, review all imports (lines 1–6)     | No imports from `../paprika/` (only `import type` from SDK types). All runtime imports are from `./helpers.js` and type imports from `../types/` and `../cache/`                                        |
| 2    | Open `src/tools/filter.ts`, review all imports (lines 1–9)     | `import type { Recipe } from "../paprika/types.js"` is type-only (allowed). No runtime import from `../paprika/`. Runtime imports are from `neverthrow`, `zod`, `./helpers.js`, `../utils/duration.js`  |
| 3    | Open `src/tools/categories.ts`, review all imports (lines 1–5) | `import type { Category } from "../paprika/types.js"` is type-only (allowed). No runtime import from `../paprika/`                                                                                      |
| 4    | Search all three tool files for `PaprikaClient`                | Zero matches                                                                                                                                                                                            |
| 5    | Search all three tool files for `ctx.client`                   | Zero matches — handlers only reference `ctx.store`                                                                                                                                                      |
| 6    | Verify handler bodies use only store methods                   | All data access goes through `ctx.store.search()`, `ctx.store.filterByIngredients()`, `ctx.store.filterByTime()`, `ctx.store.getAllCategories()`, `ctx.store.getAll()`, `ctx.store.resolveCategories()` |

---

## End-to-End: Full Discovery Workflow

Purpose: Validate that all four tools work together as a coherent discovery system.

| Step | Action                                                                                            | Expected                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1    | Run `pnpm test -- src/tools/search.test.ts src/tools/filter.test.ts src/tools/categories.test.ts` | All 27 tests pass                                                                           |
| 2    | Run `pnpm build`                                                                                  | Project compiles without errors — validates type-only imports and runtime import resolution |
| 3    | Run `pnpm typecheck`                                                                              | No type errors — confirms `ServerContext` satisfied by all tool registrations               |
| 4    | Run `pnpm lint`                                                                                   | 0 warnings, 0 errors — confirms no `console.log` in tool files (stdio transport constraint) |

---

## End-to-End: Error Path Consistency

Purpose: Validate that all four tools handle edge cases consistently.

| Step | Action                                                                | Expected                                                                         |
| ---- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1    | Review test results for AC1.5, AC2.5, AC3.7, AC4.4 (cold-start tests) | All return text containing "try again" (case-insensitive)                        |
| 2    | Review test results for AC1.6, AC2.6, AC3.8, AC4.5 (no-match tests)   | All return `isError: falsy` with text containing "no recipes" or "no categories" |
| 3    | Review the "invalid duration" test in `filter.test.ts`                | Returns `isError: falsy` with text containing "invalid"                          |
| 4    | Check `src/tools/helpers.ts` for the cold-start message               | Contains: "Recipe store is not yet synced. Try again in a few seconds."          |

---

## Traceability

| Acceptance Criterion | Automated Test                                                                    | Manual Step                                        |
| -------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------- |
| AC1.1                | search.test.ts: "non-empty store + matching query returns formatted results"      | —                                                  |
| AC1.2                | search.test.ts: "limit defaults to 20 when store has many matches"                | —                                                  |
| AC1.3                | search.test.ts: "limit caps result count"                                         | —                                                  |
| AC1.4                | search.test.ts: "category names appear in formatted results"                      | —                                                  |
| AC1.5                | search.test.ts: "empty store returns cold-start Err payload"                      | —                                                  |
| AC1.6                | search.test.ts: "no matching recipes returns empty-result message"                | —                                                  |
| AC2.1                | filter.test.ts: "mode=all returns only recipes with all ingredients"              | —                                                  |
| AC2.2                | filter.test.ts: "mode=any returns recipes with any ingredient"                    | —                                                  |
| AC2.3                | filter.test.ts: "mode defaults to all"                                            | —                                                  |
| AC2.4                | filter.test.ts: "limit caps results"                                              | —                                                  |
| AC2.5                | filter.test.ts: "empty store returns cold-start Err payload"                      | —                                                  |
| AC2.6                | filter.test.ts: "no matching recipes returns empty-result message"                | —                                                  |
| AC3.1                | filter.test.ts: "maxTotalTime returns only recipes with totalTime <= constraint"  | —                                                  |
| AC3.2                | filter.test.ts: "maxPrepTime returns only recipes with prepTime <= constraint"    | —                                                  |
| AC3.3                | filter.test.ts: "maxCookTime returns only recipes with cookTime <= constraint"    | —                                                  |
| AC3.4                | filter.test.ts: "results ordered by total time ascending"                         | —                                                  |
| AC3.5                | filter.test.ts: "limit applied post-store"                                        | —                                                  |
| AC3.6                | filter.test.ts: "all constraints optional"                                        | —                                                  |
| AC3.7                | filter.test.ts: "empty store returns cold-start Err payload"                      | —                                                  |
| AC3.8                | filter.test.ts: "no recipes match constraints returns empty-result message"       | —                                                  |
| AC4.1                | categories.test.ts: "returns all categories with non-trashed recipe counts"       | —                                                  |
| AC4.2                | categories.test.ts: "categories sorted alphabetically by name"                    | —                                                  |
| AC4.3                | categories.test.ts: "category with zero non-trashed recipes appears with count 0" | —                                                  |
| AC4.4                | categories.test.ts: "empty store returns cold-start Err payload"                  | —                                                  |
| AC4.5                | categories.test.ts: "store with recipes but no categories returns empty message"  | —                                                  |
| AC5.1                | —                                                                                 | Phase 1: Verify raw ZodRawShape (steps 1–5)        |
| AC5.2                | —                                                                                 | Phase 2: Verify `.match()` pattern (steps 1–6)     |
| AC5.3                | —                                                                                 | Phase 3: Verify no PaprikaClient usage (steps 1–6) |
