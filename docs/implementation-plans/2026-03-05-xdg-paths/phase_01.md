# XDG Paths Implementation Plan

**Goal:** Create a thin wrapper module around `env-paths` v4 that provides platform-native application directory paths for `mcp-paprika`.

**Architecture:** Single leaf module in `src/utils/` that calls `envPaths('mcp-paprika', { suffix: '' })` once at module load time and re-exports the five resolved paths as named functions. No I/O, no async, no internal dependencies.

**Tech Stack:** TypeScript 5.9, env-paths v4 (pure ESM, ships TypeScript types), vitest

**Scope:** 1 phase from original design (phase 1 of 1)

**Codebase verified:** 2026-03-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### xdg-paths.AC1: Module exports 5 path functions

- **xdg-paths.AC1.1 Success:** `getConfigDir()` returns an absolute path string ending with `/mcp-paprika` (or platform equivalent)
- **xdg-paths.AC1.2 Success:** `getCacheDir()` returns an absolute path string ending with `/mcp-paprika` (or platform equivalent)
- **xdg-paths.AC1.3 Success:** `getDataDir()` returns an absolute path string ending with `/mcp-paprika` (or platform equivalent)
- **xdg-paths.AC1.4 Success:** `getLogDir()` returns an absolute path string ending with `/mcp-paprika` (or platform equivalent)
- **xdg-paths.AC1.5 Success:** `getTempDir()` returns an absolute path string ending with `/mcp-paprika` (or platform equivalent)

### xdg-paths.AC2: Module characteristics

- **xdg-paths.AC2.1 Success:** All 5 functions are synchronous and perform no filesystem I/O
- **xdg-paths.AC2.2 Success:** `env-paths` is listed as a runtime dependency in `package.json`
- **xdg-paths.AC2.3 Success:** `pnpm build` and `pnpm typecheck` pass with zero errors

### xdg-paths.AC3: Leaf dependency contract

- **xdg-paths.AC3.1 Success:** `src/utils/xdg.ts` imports only from `env-paths` (no imports from other `src/` modules)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Install env-paths and create xdg.ts wrapper module

**Verifies:** None (infrastructure task — operational verification only)

**Files:**

- Modify: `package.json` (add `env-paths` to `dependencies`)
- Create: `src/utils/xdg.ts`

**Step 1: Install env-paths as a runtime dependency**

Run:

```bash
pnpm add env-paths
```

Expected: `env-paths` appears in `dependencies` in `package.json`. `pnpm-lock.yaml` updated.

**Step 2: Create `src/utils/xdg.ts`**

Create the wrapper module at `src/utils/xdg.ts` with the following implementation:

```typescript
import envPaths from "env-paths";

const paths = envPaths("mcp-paprika", { suffix: "" });

export function getConfigDir(): string {
  return paths.config;
}

export function getCacheDir(): string {
  return paths.cache;
}

export function getDataDir(): string {
  return paths.data;
}

export function getLogDir(): string {
  return paths.log;
}

export function getTempDir(): string {
  return paths.temp;
}
```

Key implementation details for the executor:

- `env-paths` is a pure ESM package with a **default export** (a function). Import it as `import envPaths from "env-paths"` — not a named import.
- Pass `{ suffix: "" }` to disable the default `-nodejs` suffix, so paths end with `mcp-paprika` exactly.
- The `paths` object is computed once at module load time. Each function returns the corresponding property.
- This module is a **leaf dependency** per `src/utils/CLAUDE.md` — it must NOT import from any other `src/` module. Only `env-paths` (an npm package) is imported.
- All functions are synchronous, return `string`, and perform no filesystem I/O.

**Step 3: Verify build and type-check pass**

Run:

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: All commands succeed with zero errors.

**Step 4: Commit**

```bash
git add src/utils/xdg.ts package.json pnpm-lock.yaml
git commit -m "feat(utils): add XDG path resolution module

Wrap env-paths v4 with app name 'mcp-paprika' to provide
platform-native directory paths for config, cache, data,
log, and temp directories."
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Write tests for xdg.ts

**Verifies:** xdg-paths.AC1.1, xdg-paths.AC1.2, xdg-paths.AC1.3, xdg-paths.AC1.4, xdg-paths.AC1.5, xdg-paths.AC2.1, xdg-paths.AC3.1

**Files:**

- Create: `src/utils/xdg.test.ts`

**Testing strategy:**

The existing test pattern (see `src/paprika/errors.test.ts`) uses `describe`/`it` blocks organized by acceptance criteria identifiers, with `import { describe, it, expect } from "vitest"` and `.js` extensions on relative imports.

Tests must verify each AC listed above:

- **xdg-paths.AC1.1–AC1.5:** Each of the 5 functions returns an absolute path string ending with `mcp-paprika` (or platform equivalent such as backslash on Windows). Use `path.isAbsolute()` to verify absoluteness. Check the path ends with the segment `mcp-paprika` (use `path.basename()` or similar — account for Windows where `path.sep` differs).
- **xdg-paths.AC2.1:** All 5 functions are synchronous — verify by confirming each return value is a `string` (not a `Promise`). No special async handling needed; if calls return strings synchronously, the criterion is met.
- **xdg-paths.AC3.1:** Read `src/utils/xdg.ts` source file (using `node:fs`) and verify it contains no imports from `../` or `./` paths (only `env-paths`). This is a static analysis test ensuring the leaf dependency contract holds.

Follow the project's test organization pattern: top-level `describe("XDG path utilities")` with nested `describe` blocks per AC group (e.g., `describe("xdg-paths.AC1: Module exports 5 path functions")`).

Import the module under test as: `import { getConfigDir, getCacheDir, getDataDir, getLogDir, getTempDir } from "./xdg.js";`

**Verification:**

Run:

```bash
pnpm test && pnpm lint && pnpm format:check
```

Expected: All tests pass. Lint and format checks pass.

**Coverage verification:**

Run:

```bash
pnpm test --coverage
```

Expected: `src/utils/xdg.ts` shows >= 70% coverage across statements, branches, functions, and lines.

**AC3.1 test reference implementation:**

For the leaf dependency contract test, use this pattern to read the source file and verify no relative imports exist:

```typescript
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, "xdg.ts"), "utf-8");
expect(source).not.toMatch(/from\s+["']\.\//);
expect(source).not.toMatch(/from\s+["']\.\.\//);
```

**Commit:**

```bash
git add src/utils/xdg.test.ts
git commit -m "test(utils): add tests for XDG path resolution module"
```

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->

### Task 3: Update src/utils/CLAUDE.md with xdg.ts contract

**Verifies:** None (documentation task)

**Files:**

- Modify: `src/utils/CLAUDE.md`

**Implementation:**

Update the existing `src/utils/CLAUDE.md` to document the `xdg.ts` module contract. The current file (verified via codebase investigation) has a placeholder "Contracts will be defined when this module is implemented." Replace that placeholder with the actual contract.

Add the following under the `## Contracts` section:

```markdown
### xdg.ts — Platform-native application directory paths

Wraps `env-paths` v4 with app name `mcp-paprika` (no suffix). Exports 5 synchronous functions
that return absolute path strings. No I/O. No internal dependencies (leaf module).

| Function         | Returns                          |
| ---------------- | -------------------------------- |
| `getConfigDir()` | Platform-native config directory |
| `getCacheDir()`  | Platform-native cache directory  |
| `getDataDir()`   | Platform-native data directory   |
| `getLogDir()`    | Platform-native log directory    |
| `getTempDir()`   | Platform-native temp directory   |
```

Also update the `Last verified` date to `2026-03-05`.

**Verification:**

Run:

```bash
pnpm lint && pnpm format:check
```

Expected: No lint or formatting errors.

**Commit:**

```bash
git add src/utils/CLAUDE.md
git commit -m "docs(utils): document xdg.ts module contract in CLAUDE.md"
```

<!-- END_TASK_3 -->
