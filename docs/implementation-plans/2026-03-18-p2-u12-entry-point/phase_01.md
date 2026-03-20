# Entry Point Implementation Plan

**Goal:** Wire together all Phase 1-2 modules into a working MCP server entry point, with a prerequisite DiskCache logging refactor.

**Architecture:** Remove DiskCache's `log` callback parameter (replace with direct `process.stderr.write`), then implement `src/index.ts` as an `async function main()` that orchestrates startup: config → auth → cache → store → MCP server → tools → resources → sync → SIGINT → transport.

**Tech Stack:** TypeScript 5.9, Node.js 24, @modelcontextprotocol/sdk, neverthrow, env-paths

**Scope:** 1 phase from original design (phase 1 of 1)

**Codebase verified:** 2026-03-18

---

## Acceptance Criteria Coverage

This phase implements and tests:

### p2-u12-entry-point.AC4: DiskCache Logging Refactor

- **p2-u12-entry-point.AC4.1 Success:** DiskCache no longer accepts a `log` callback parameter
- **p2-u12-entry-point.AC4.2 Success:** DiskCache diagnostic messages are written to `process.stderr`
- **p2-u12-entry-point.AC4.3 Success:** Existing DiskCache tests pass after refactor

### p2-u12-entry-point.AC1: Startup Sequence

- **p2-u12-entry-point.AC1.1 Success:** Server starts successfully with valid config and credentials
- **p2-u12-entry-point.AC1.2 Success:** All 8 tools are registered before `server.connect(transport)` is called
- **p2-u12-entry-point.AC1.3 Success:** Recipe resources are registered before `server.connect(transport)` is called
- **p2-u12-entry-point.AC1.4 Success:** `sync.start()` is called before `server.connect(transport)` when sync is enabled
- **p2-u12-entry-point.AC1.5 Edge:** Sync engine is created but NOT started when `config.sync.enabled` is false

### p2-u12-entry-point.AC2: Error Handling

- **p2-u12-entry-point.AC2.1 Failure:** Invalid config (e.g., missing email) exits with non-zero code and stderr message
- **p2-u12-entry-point.AC2.2 Failure:** Authentication failure exits with non-zero code and stderr message
- **p2-u12-entry-point.AC2.3 Failure:** Cache init failure exits with non-zero code and stderr message

### p2-u12-entry-point.AC3: Shutdown

- **p2-u12-entry-point.AC3.1 Success:** SIGINT stops the sync engine and exits with code 0
- **p2-u12-entry-point.AC3.2 Edge:** SIGINT handler is registered before transport connects

### p2-u12-entry-point.AC5: Code Quality

- **p2-u12-entry-point.AC5.1 Success:** `src/index.ts` exports nothing (program entry point only)
- **p2-u12-entry-point.AC5.2 Success:** `pnpm typecheck` passes with no errors
- **p2-u12-entry-point.AC5.3 Success:** `pnpm build` succeeds

---

## Reference Files

These files contain project conventions and contracts. Read them before implementing:

- `/home/brajkovic/Projects/mcp-paprika/CLAUDE.md` — Project-wide conventions
- `/home/brajkovic/Projects/mcp-paprika/src/cache/CLAUDE.md` — DiskCache contracts
- `/home/brajkovic/Projects/mcp-paprika/src/utils/CLAUDE.md` — Config and XDG contracts
- `/home/brajkovic/Projects/mcp-paprika/src/paprika/CLAUDE.md` — PaprikaClient and SyncEngine contracts
- `/home/brajkovic/Projects/mcp-paprika/docs/verified-api.md` — MCP SDK verified import paths
- `/home/brajkovic/Projects/mcp-paprika/.ed3d/implementation-plan-guidance.md` — Project implementation guidance

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Refactor DiskCache to remove log callback and write to stderr

**Verifies:** p2-u12-entry-point.AC4.1, p2-u12-entry-point.AC4.2

**Files:**

- Modify: `src/cache/disk-cache.ts:30-51` (class fields and constructor)
- Modify: `src/cache/disk-cache.ts:77` (invalid JSON log call)
- Modify: `src/cache/disk-cache.ts:84` (schema mismatch log call)

**Implementation:**

Remove the `log` callback parameter from DiskCache and replace internal `this._log(...)` calls with `process.stderr.write(...)`. The specific changes:

1. **Remove the `_log` field declaration** (line 35):
   Delete `private readonly _log: (msg: string) => void;`

2. **Remove `log?` from constructor parameter** (line 46):
   Change `constructor(cacheDir: string, log?: (msg: string) => void)` → `constructor(cacheDir: string)`

3. **Remove `_log` assignment** (line 51):
   Delete `this._log = log ?? (() => undefined);`

4. **Replace `this._log(...)` calls with `process.stderr.write(...)`** (lines 77, 84):
   - Line 77: `this._log("DiskCache: corrupt index.json (invalid JSON), resetting to empty index")` → `process.stderr.write("DiskCache: corrupt index.json (invalid JSON), resetting to empty index\n")`
   - Line 84: `this._log("DiskCache: corrupt index.json (schema mismatch), resetting to empty index")` → `process.stderr.write("DiskCache: corrupt index.json (schema mismatch), resetting to empty index\n")`

Note: `process.stderr.write` requires a trailing `\n` since unlike `console.error` it does not append a newline automatically.

**Verification:**

This task modifies only the source file. Tests are updated in Task 2. Do not run tests between tasks 1 and 2 — the test file still passes `logSpy` to the constructor which will cause a TypeScript error.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Update DiskCache tests for process.stderr.write spy

**Verifies:** p2-u12-entry-point.AC4.3

**Files:**

- Modify: `src/cache/disk-cache.test.ts:74-91` (AC1.4 test case)

**Implementation:**

The AC1.4 test ("resets to empty index and calls log when schema validation fails") currently creates a `vi.fn()` spy and passes it as the `log` callback to `DiskCache`. After the refactor, the test must spy on `process.stderr.write` instead.

Changes to the AC1.4 test (lines 74-91):

1. **Remove** `const logSpy = vi.fn();` (line 79)
2. **Add** `const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);` before creating the cache. The `.mockReturnValue(true)` prevents actual stderr output during tests (write returns boolean).
3. **Change** `new DiskCache(tempDir, logSpy)` → `new DiskCache(tempDir)` (line 80)
4. **Change** `expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("corrupt"))` → `expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("corrupt"))` (line 84)
5. **Add** `stderrSpy.mockRestore();` after the assertions (before the test ends) to clean up the spy and restore original `process.stderr.write` behavior for subsequent tests.

No other tests in `disk-cache.test.ts` use the log callback — all 36 other DiskCache construction sites use `new DiskCache(tempDir)` without the second argument, so they require no changes.

**Testing:**

Run: `pnpm test`
Expected: All 41 DiskCache tests pass. The AC1.4 test now verifies stderr output instead of callback invocation.

**Commit:** `refactor(cache): remove DiskCache log callback, write diagnostics to stderr`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->

### Task 3: Implement entry point

**Files:**

- Create: `src/index.ts`

**Implementation:**

Create `src/index.ts` with a complete startup sequence. The file exports nothing — it is the program entry point only. The entire file is an `async function main()` and a top-level `main().catch()` handler.

**Startup sequence (strictly ordered):**

1. Load and validate config via `loadConfig()` — unwrap `Result` with `.match()`, throw on error
2. Construct `PaprikaClient` with email/password from config, call `authenticate()`
3. Construct `DiskCache` with `getCacheDir()`, call `init()`
4. Construct `RecipeStore` (no-arg constructor)
5. Construct `McpServer` with `{ name: "mcp-paprika", version: "0.0.0" }`
6. Assemble `ServerContext` record: `{ client, cache, store, server }`
7. Register all 8 tools (7 function calls — `registerFilterTools` registers 2 tools)
8. Register recipe resources via `registerRecipeResources`
9. Construct `SyncEngine` with `(ctx, config.sync.interval)`, conditionally call `start()` if `config.sync.enabled`
10. Register SIGINT handler: calls `sync.stop()` then `process.exit(0)`
11. Connect stdio transport: `await server.connect(new StdioServerTransport())`

**Error handling:**

All startup failures propagate to `main().catch()` which writes to stderr via `console.error` (the only permitted console call, suppressed with an oxlint inline directive) and exits with code 1.

**Import paths (verified in `docs/verified-api.md`):**

- `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`
- `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`
- All internal imports use `.js` extensions per project convention

**Tool registration functions (all from `src/tools/`):**

| Function                | File            | Tools Registered                         |
| ----------------------- | --------------- | ---------------------------------------- |
| `registerSearchTool`    | `search.ts`     | `search_recipes`                         |
| `registerFilterTools`   | `filter.ts`     | `filter_by_ingredient`, `filter_by_time` |
| `registerCategoryTools` | `categories.ts` | `list_categories`                        |
| `registerReadTool`      | `read.ts`       | `read_recipe`                            |
| `registerCreateTool`    | `create.ts`     | `create_recipe`                          |
| `registerUpdateTool`    | `update.ts`     | `update_recipe`                          |
| `registerDeleteTool`    | `delete.ts`     | `delete_recipe`                          |

**Resource registration:**

| Function                  | File         | Resources Registered     |
| ------------------------- | ------------ | ------------------------ |
| `registerRecipeResources` | `recipes.ts` | `paprika://recipe/{uid}` |

**Key patterns:**

- `loadConfig()` returns `Result<PaprikaConfig, ConfigError>`. Use `.match()` to unwrap (never `.isOk()`/`.isErr()`). The error case throws, feeding into the `main().catch()` handler.
- `getCacheDir()` from `src/utils/xdg.ts` returns the platform-native cache directory path.
- `SyncEngine` constructor takes `(context: ServerContext, intervalMs: number)`. `config.sync.interval` is already in milliseconds (zod transforms the duration string).
- `process` is used as a global (matching codebase convention — no explicit import).
- The oxlint suppression for `console.error` uses the comment format: `/* oxlint-disable-next-line no-console */`
- Include a `// Phase 3 extension point` comment between sync start and SIGINT handler as specified by the design.

**Verification:**

Run: `pnpm typecheck`
Expected: No type errors

Run: `pnpm build`
Expected: Compiles successfully to `dist/`

Run: `pnpm test`
Expected: All existing tests still pass (entry point has no tests — out of scope per design)

Run: `pnpm lint`
Expected: No lint errors (console.error suppressed by inline directive)

**Commit:** `feat(entry): add MCP server entry point with startup sequence`

<!-- END_TASK_3 -->
