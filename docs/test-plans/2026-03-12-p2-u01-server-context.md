# Human Test Plan: P2-U01 ServerContext

## Prerequisites

- Node.js 24+ available (managed via mise)
- `pnpm install` has been run
- `pnpm typecheck` exits 0
- `pnpm test` exits 0 (253 tests passing)

## Phase 1: Dependency Installation Verification

| Step | Action                                                                                        | Expected                                                                         |
| ---- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1.1  | Open `/home/brajkovic/Projects/mcp-paprika/package.json` and locate the `dependencies` object | The key `"mitt"` is present with value `"^3.0.1"`                                |
| 1.2  | Run `pnpm install --frozen-lockfile` in the project root                                      | Command exits 0 with "Lockfile is up to date" message; no lockfile modifications |
| 1.3  | Run `node -e "require.resolve('mitt')"` in the project root                                   | Prints a path under `node_modules/mitt`; exits 0                                 |

## Phase 2: Interface Definition Verification

| Step | Action                                                                  | Expected                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | Open `/home/brajkovic/Projects/mcp-paprika/src/types/server-context.ts` | File exists and is 12 lines long                                                                                                                                 |
| 2.2  | Verify the declaration on line 7                                        | Reads `export interface ServerContext {` -- uses `interface`, not `type`                                                                                         |
| 2.3  | Count the fields inside the interface body (lines 8-11)                 | Exactly 4 fields: `client`, `cache`, `store`, `server`                                                                                                           |
| 2.4  | Verify each field is prefixed with `readonly`                           | Line 8: `readonly client: PaprikaClient;`, Line 9: `readonly cache: DiskCache;`, Line 10: `readonly store: RecipeStore;`, Line 11: `readonly server: McpServer;` |
| 2.5  | Check all import statements (lines 1, 3-5)                              | All four use `import type` (not bare `import`). All relative paths end with `.js` extension                                                                      |
| 2.6  | Search the file for the string `PaprikaConfig`                          | Not found anywhere in the file                                                                                                                                   |
| 2.7  | Search the file for `@ts-ignore` or `@ts-expect-error`                  | Neither string appears in the file                                                                                                                               |

## Phase 3: Type System Integration

| Step | Action               | Expected                                                                        |
| ---- | -------------------- | ------------------------------------------------------------------------------- |
| 3.1  | Run `pnpm typecheck` | Exits 0 with no errors, confirming all imports resolve and types are compatible |
| 3.2  | Run `pnpm test`      | All 253 tests pass; no regressions from the new file                            |
| 3.3  | Run `pnpm lint`      | No new lint warnings or errors from `src/types/server-context.ts`               |

## Phase 4: Documentation Quality (AC4.1)

| Step | Action                                                                     | Expected                                                                                                                                                     |
| ---- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1  | Open `/home/brajkovic/Projects/mcp-paprika/src/types/CLAUDE.md`            | File exists with "Last verified: 2026-03-13"                                                                                                                 |
| 4.2  | Locate the "Purpose" section                                               | Describes `ServerContext` as a dependency injection vehicle; mentions "immutable record"                                                                     |
| 4.3  | Locate the field table under "Contracts > ServerContext"                   | Table lists all 4 fields: `client` (PaprikaClient), `cache` (DiskCache), `store` (RecipeStore), `server` (McpServer) with accurate descriptions              |
| 4.4  | Verify the import example code block                                       | Reads exactly: `import type { ServerContext } from "../types/server-context.js";`                                                                            |
| 4.5  | Confirm the documentation mentions `readonly` and `interface` (not `type`) | The sentence "All fields are `readonly`. The interface is declared with `interface` (not `type`) so Phase 3 can extend it cleanly via `extends`." is present |
| 4.6  | Check the "Dependencies" section                                           | Lists the 4 imports under "Uses"; states "Used by: All Phase 2 tool and resource modules"; notes all imports are `import type`                               |

## End-to-End: Full CI Pipeline Simulation

**Purpose:** Validate that the new file integrates cleanly with the entire CI pipeline, not just individual checks.

| Step  | Action                                          | Expected                                                                                                                   |
| ----- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| E2E.1 | Run `pnpm format:check`                         | Exits 0 -- new file is properly formatted                                                                                  |
| E2E.2 | Run `pnpm lint`                                 | Exits 0 -- no lint violations in new or changed files                                                                      |
| E2E.3 | Run `pnpm typecheck`                            | Exits 0 -- all types resolve                                                                                               |
| E2E.4 | Run `pnpm test`                                 | All 253 tests pass                                                                                                         |
| E2E.5 | Verify `git diff --name-only 6203bf65..1c43d05` | Shows exactly 5 files: `CLAUDE.md`, `package.json`, `pnpm-lock.yaml`, `src/types/CLAUDE.md`, `src/types/server-context.ts` |

## Human Verification Required

| Criterion                               | Why Manual                                                                                                   | Steps                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| AC4.1 CLAUDE.md accuracy                | Documentation quality, correctness, and helpfulness are human judgments                                      | Phase 4 steps 4.1-4.6 above                                                                                                   |
| Interface design intent                 | Confirming `interface` (not `type`) was chosen for extensibility requires understanding the design rationale | Phase 2 step 2.2 and Phase 4 step 4.5                                                                                         |
| Field descriptions match implementation | CLAUDE.md field descriptions should accurately reflect what each dependency does                             | Compare Phase 4 step 4.3 descriptions against `src/paprika/client.ts`, `src/cache/disk-cache.ts`, `src/cache/recipe-store.ts` |

## Traceability

| Acceptance Criterion         | Automated Test                             | Manual Step       |
| ---------------------------- | ------------------------------------------ | ----------------- |
| AC1.1 mitt in dependencies   | N/A (shell verification)                   | Phase 1: 1.1, 1.3 |
| AC1.2 lockfile not stale     | N/A (CI: `pnpm install --frozen-lockfile`) | Phase 1: 1.2      |
| AC2.1 `interface` not `type` | N/A (file inspection)                      | Phase 2: 2.2      |
| AC2.2 exactly 4 fields       | N/A (typecheck + inspection)               | Phase 2: 2.3      |
| AC2.3 all fields `readonly`  | N/A (file inspection)                      | Phase 2: 2.4      |
| AC2.4 `import type` only     | N/A (file inspection)                      | Phase 2: 2.5      |
| AC2.5 `.js` extensions       | N/A (CI: `pnpm typecheck`)                 | Phase 3: 3.1      |
| AC2.6 no PaprikaConfig       | N/A (file inspection)                      | Phase 2: 2.6      |
| AC3.1 typecheck passes       | N/A (CI: `pnpm typecheck`)                 | Phase 3: 3.1      |
| AC3.2 no suppressions        | N/A (file inspection)                      | Phase 2: 2.7      |
| AC4.1 CLAUDE.md updated      | N/A (human review)                         | Phase 4: 4.1-4.6  |
