# P2-U01 ServerContext Implementation Plan

**Goal:** Install the `mitt` event-emitter runtime dependency and define the `ServerContext` interface that every Phase 2 module will depend on.

**Architecture:** `ServerContext` is a plain immutable record bundling four long-lived objects (`client`, `cache`, `store`, `server`) passed by reference into every tool and resource handler — a lightweight dependency injection pattern that avoids global singletons. It is constructed once in `src/index.ts` and never mutated.

**Tech Stack:** TypeScript 5.9, NodeNext module resolution, pnpm 10.30.3, `@modelcontextprotocol/sdk` v1.27.1

**Scope:** 1 phase (complete design)

**Codebase verified:** 2026-03-13

---

## Acceptance Criteria Coverage

This phase implements and verifies:

### p2-u01-server-context.AC1: mitt installed as runtime dependency

- **p2-u01-server-context.AC1.1 Success:** `package.json` `dependencies` contains `mitt`
- **p2-u01-server-context.AC1.2 Success:** `pnpm-lock.yaml` updated with mitt resolution (lockfile not stale)

### p2-u01-server-context.AC2: ServerContext interface is correct

- **p2-u01-server-context.AC2.1 Success:** `src/types/server-context.ts` exports an `interface ServerContext` (not `type`)
- **p2-u01-server-context.AC2.2 Success:** Interface has exactly 4 fields: `client: PaprikaClient`, `cache: DiskCache`, `store: RecipeStore`, `server: McpServer`
- **p2-u01-server-context.AC2.3 Success:** All 4 fields are `readonly`
- **p2-u01-server-context.AC2.4 Success:** All imports use `import type` — no value imports
- **p2-u01-server-context.AC2.5 Success:** All import paths use `.js` extension
- **p2-u01-server-context.AC2.6 Constraint:** `PaprikaConfig` is absent from the interface

### p2-u01-server-context.AC3: TypeScript compilation passes

- **p2-u01-server-context.AC3.1 Success:** `pnpm typecheck` exits 0
- **p2-u01-server-context.AC3.2 Constraint:** No `@ts-ignore` or `@ts-expect-error` suppressions in new files

### p2-u01-server-context.AC4: CLAUDE.md updated

- **p2-u01-server-context.AC4.1 Success:** `src/types/CLAUDE.md` documents `ServerContext` with field table and correct import path example

---

## Codebase Verification Findings

- ✓ `src/types/` exists with `.gitkeep` and a placeholder `CLAUDE.md` (ready to receive first real file)
- ✓ `src/paprika/client.ts:95` exports `export class PaprikaClient`; import path: `../paprika/client.js`
- ✓ `src/cache/disk-cache.ts` exports `export class DiskCache`; import path: `../cache/disk-cache.js`
- ✓ `src/cache/recipe-store.ts` exports `export class RecipeStore`; import path: `../cache/recipe-store.js`
- ✓ `docs/verified-api.md` documents McpServer import as `@modelcontextprotocol/sdk/server/mcp.js`
- ✓ `mitt` is absent from both `dependencies` and `devDependencies` — install required
- ✓ `pnpm-lock.yaml` exists and is current

## External Dependency Findings

- ✓ mitt v3.0.0: built-in TypeScript types, zero peer dependencies, ~900B gzipped
- ✓ `pnpm add mitt` installs as a runtime dependency (correct — not a devDep)
- ✓ No special installation requirements or post-install steps

---

<!-- START_TASK_1 -->

### Task 1: Install mitt as a runtime dependency

**Verifies:** p2-u01-server-context.AC1.1, p2-u01-server-context.AC1.2

**Files:**

- Modify: `package.json` (automatic — managed by pnpm)
- Modify: `pnpm-lock.yaml` (automatic — managed by pnpm)

**Step 1: Install mitt**

```bash
pnpm add mitt
```

Expected output: Installation completes with no errors. mitt appears under `dependencies` in `package.json`.

**Step 2: Verify package.json**

Open `package.json` and confirm the `dependencies` section contains a `mitt` entry (e.g., `"mitt": "^3.0.0"`). Confirm it is in `dependencies`, NOT `devDependencies`.

**Step 3: Verify lockfile updated**

```bash
git diff pnpm-lock.yaml | head -30
```

Expected: Diff shows mitt added to the lockfile. The lockfile must not be stale.

**Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add mitt event emitter as runtime dependency"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Create ServerContext interface

**Verifies:** p2-u01-server-context.AC2.1, p2-u01-server-context.AC2.2, p2-u01-server-context.AC2.3, p2-u01-server-context.AC2.4, p2-u01-server-context.AC2.5, p2-u01-server-context.AC2.6, p2-u01-server-context.AC3.1, p2-u01-server-context.AC3.2

**Files:**

- Create: `src/types/server-context.ts`

**Step 1: Create the file**

Create `src/types/server-context.ts` with the following exact content:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { DiskCache } from "../cache/disk-cache.js";
import type { RecipeStore } from "../cache/recipe-store.js";
import type { PaprikaClient } from "../paprika/client.js";

export interface ServerContext {
  readonly client: PaprikaClient;
  readonly cache: DiskCache;
  readonly store: RecipeStore;
  readonly server: McpServer;
}
```

Key constraints to verify before saving:

- The keyword `interface` is used, not `type` (required for Phase 3 extensibility via `extends`)
- All 4 fields are `readonly`
- All 4 imports use `import type` (not `import`)
- All import paths end in `.js` (NodeNext module resolution)
- `PaprikaConfig` is NOT present
- There are no `@ts-ignore` or `@ts-expect-error` comments

**Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: Exits 0 with no errors or warnings.

If typecheck fails, verify:

1. The McpServer import path matches `docs/verified-api.md` exactly: `@modelcontextprotocol/sdk/server/mcp.js`
2. All relative import paths use `.js` extensions
3. All 4 class names match: `PaprikaClient`, `DiskCache`, `RecipeStore`, `McpServer`

**Step 3: Run lint check**

```bash
pnpm lint
```

Expected: Exits 0. The `no-console` rule does not apply here (no console calls). The file uses only `import type` which satisfies the import conventions.

**Step 4: Commit**

```bash
git add src/types/server-context.ts
git commit -m "feat(types): add ServerContext interface for Phase 2 dependency injection"
```

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Update src/types/CLAUDE.md

**Verifies:** p2-u01-server-context.AC4.1

**Files:**

- Modify: `src/types/CLAUDE.md`

**Step 1: Replace the file content**

The current `src/types/CLAUDE.md` is a placeholder from P1-U01. Replace its entire content with:

````markdown
# Shared Type Definitions

Last verified: 2026-03-13

## Purpose

Defines TypeScript interfaces and types shared across Phase 2 modules. `ServerContext` is the primary export — it bundles the four shared runtime objects into a single immutable record used as a dependency injection vehicle throughout the codebase.

## Contracts

### ServerContext

A plain immutable record passed by reference into every tool and resource registration function. Constructed once during server startup in `src/index.ts` and never mutated.

| Field    | Type            | Description                                          |
| -------- | --------------- | ---------------------------------------------------- |
| `client` | `PaprikaClient` | HTTP client for the Paprika cloud API                |
| `cache`  | `DiskCache`     | Local on-disk persistence layer                      |
| `store`  | `RecipeStore`   | Higher-level recipe query abstraction over DiskCache |
| `server` | `McpServer`     | MCP wire protocol handler (stdio transport)          |

All fields are `readonly`. The interface is declared with `interface` (not `type`) so Phase 3 can extend it cleanly via `extends`.

**Correct import:**

```typescript
import type { ServerContext } from "../types/server-context.js";
```
````

## Dependencies

- **Uses:** `@modelcontextprotocol/sdk/server/mcp.js` (McpServer), `../paprika/client.js` (PaprikaClient), `../cache/disk-cache.js` (DiskCache), `../cache/recipe-store.js` (RecipeStore)
- **Used by:** All Phase 2 tool and resource modules
- **Boundary:** All imports in this module use `import type` — no runtime value imports

````

**Step 2: Verify format**

```bash
pnpm format:check
````

If formatting issues are reported, run:

```bash
pnpm format
```

Then re-check.

**Step 3: Commit**

```bash
git add src/types/CLAUDE.md
git commit -m "docs(types): update CLAUDE.md with ServerContext documentation"
```

<!-- END_TASK_3 -->

---

## Final Verification

After all three tasks are committed, run the full check suite to confirm the branch is clean:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: All three commands exit 0. The test suite should pass unchanged (no new tests were added — this unit is pure infrastructure verified by the TypeScript compiler).
