# Human Test Plan: p2-u12-entry-point

## Prerequisites

- Node.js 24 installed (via mise)
- `pnpm install` completed
- `pnpm test` passing (380 tests, 0 failures)
- `pnpm typecheck` passing with no errors
- `pnpm build` producing `dist/` without errors
- Valid `.env` file with `PAPRIKA_EMAIL` and `PAPRIKA_PASSWORD` set (for operational verification only)

## Phase 1: Startup Sequence (AC1)

| Step | Action                                                                                    | Expected                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | Open `src/index.ts` and inspect the `main()` function body.                               | Line 21-22: `loadConfig()` is called and its result is matched. Line 30-31: `PaprikaClient` is constructed with `config.paprika.email` and `config.paprika.password`, then `client.authenticate()` is awaited. Line 34-35: `DiskCache` is constructed with `getCacheDir()` and `cache.init()` is awaited.                                                         |
| 1.2  | Count tool registration calls between lines 55-61, before `server.connect()` on line 81.  | Seven registration function calls: `registerSearchTool`, `registerFilterTools`, `registerCategoryTools`, `registerReadTool`, `registerCreateTool`, `registerUpdateTool`, `registerDeleteTool`. `registerFilterTools` registers 2 tools (by-ingredients and by-time), totaling 8 tools. All appear before `server.connect(new StdioServerTransport())` on line 81. |
| 1.3  | Verify `registerRecipeResources(server, ctx)` appears before `server.connect(transport)`. | Line 64: `registerRecipeResources(server, ctx)` appears. Line 81: `server.connect(new StdioServerTransport())`. Resources registered before transport connects.                                                                                                                                                                                                   |
| 1.4  | Verify that `sync.start()` is called conditionally before `server.connect(transport)`.    | Lines 67-70: `const sync = new SyncEngine(ctx, config.sync.interval);` followed by `if (config.sync.enabled) { sync.start(); }`. Line 81: `server.connect(...)`. Sync starts before connect when enabled.                                                                                                                                                         |
| 1.5  | Verify SyncEngine is always constructed but only started when enabled.                    | Line 67: `new SyncEngine(ctx, config.sync.interval)` is unconditional. Line 68-70: `sync.start()` is inside `if (config.sync.enabled)`. When `config.sync.enabled` is false, the engine exists but is never started.                                                                                                                                              |

## Phase 2: Error Handling (AC2)

| Step | Action                                                             | Expected                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | Verify `loadConfig()` error propagation by inspecting lines 21-27. | `configResult.match()` throws on the error branch (`(err) => { throw err; }`). The thrown error propagates to the `main().catch()` handler on lines 84-88, which calls `console.error(err.message)` and `process.exit(1)`. |
| 2.2  | Verify `client.authenticate()` error propagation at line 31.       | `await client.authenticate()` is called with no surrounding try/catch. A rejection propagates to `main().catch()`, which exits with code 1 and prints the error to stderr.                                                 |
| 2.3  | Verify `cache.init()` error propagation at line 35.                | `await cache.init()` is called with no surrounding try/catch. A rejection (e.g., permission denied on cache directory) propagates to `main().catch()`, exiting with code 1.                                                |

## Phase 3: Shutdown (AC3)

| Step | Action                                                                   | Expected                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3.1  | Inspect the SIGINT handler at lines 75-78.                               | The handler calls `sync.stop()` then `process.exit(0)`. This ensures the sync engine's interval timer is cleared before the process terminates cleanly with exit code 0. |
| 3.2  | Verify SIGINT handler registration order relative to `server.connect()`. | Line 75: `process.on("SIGINT", ...)` is registered. Line 81: `server.connect(...)` is called. Handler is registered before transport connects.                           |

## Phase 4: Code Quality (AC5)

| Step | Action                                          | Expected                                                                                                                             |
| ---- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1  | Search `src/index.ts` for any `export` keyword. | No `export` statements exist. The file contains only `async function main()` (not exported) and the top-level `main().catch()` call. |
| 4.2  | Run `pnpm typecheck` from the project root.     | Exits with code 0, no errors printed.                                                                                                |
| 4.3  | Run `pnpm build` from the project root.         | Exits with code 0, `dist/` directory is populated with compiled JS files including `dist/index.js`.                                  |

## End-to-End: Full Startup and Shutdown Sequence

**Purpose:** Validates that the entire wiring in `src/index.ts` produces a functioning MCP server that can start, accept a connection, and shut down cleanly.

1. Ensure `.env` has valid `PAPRIKA_EMAIL` and `PAPRIKA_PASSWORD` values.
2. Run `pnpm build` to produce `dist/index.js`.
3. Run `node dist/index.js` in a terminal. The process should start without errors (no output to stderr, as the server uses stdio transport and waits for MCP protocol messages on stdin).
4. After a few seconds, send SIGINT (Ctrl+C). The process should exit with code 0 (verify with `echo $?`).
5. If sync is enabled in config, check stderr for any sync-related diagnostic output during the brief run.

## End-to-End: Invalid Credentials

**Purpose:** Validates that authentication failure produces a user-readable error and non-zero exit.

1. Set `PAPRIKA_PASSWORD` to an invalid value in `.env`.
2. Run `node dist/index.js`.
3. Verify the process exits with code 1 and prints an authentication error message to stderr.
4. Restore the correct password in `.env`.

## End-to-End: Missing Configuration

**Purpose:** Validates that missing required environment variables produce a clear error.

1. Unset `PAPRIKA_EMAIL` from the environment (e.g., `unset PAPRIKA_EMAIL`).
2. Run `node dist/index.js`.
3. Verify the process exits with code 1 and prints a config validation error to stderr.
4. Restore the environment variable.

## Traceability

| Acceptance Criterion                              | Automated Test                                              | Manual Step                                       |
| ------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| AC1.1: Server starts with valid config            | --                                                          | Phase 1, Step 1.1                                 |
| AC1.2: All 8 tools registered before connect      | --                                                          | Phase 1, Step 1.2                                 |
| AC1.3: Resources registered before connect        | --                                                          | Phase 1, Step 1.3                                 |
| AC1.4: sync.start() before connect when enabled   | --                                                          | Phase 1, Step 1.4                                 |
| AC1.5: Sync created but not started when disabled | --                                                          | Phase 1, Step 1.5                                 |
| AC2.1: Invalid config exits non-zero              | --                                                          | Phase 2, Step 2.1; E2E: Missing Configuration     |
| AC2.2: Auth failure exits non-zero                | --                                                          | Phase 2, Step 2.2; E2E: Invalid Credentials       |
| AC2.3: Cache init failure exits non-zero          | --                                                          | Phase 2, Step 2.3                                 |
| AC3.1: SIGINT stops sync and exits 0              | --                                                          | Phase 3, Step 3.1; E2E: Full Startup and Shutdown |
| AC3.2: SIGINT handler before connect              | --                                                          | Phase 3, Step 3.2                                 |
| AC4.1: DiskCache no log parameter                 | `disk-cache.test.ts` (all tests use single-arg constructor) | --                                                |
| AC4.2: DiskCache writes to stderr                 | `disk-cache.test.ts` AC1.4 (stderr spy)                     | --                                                |
| AC4.3: All DiskCache tests pass                   | `disk-cache.test.ts` (36 tests pass)                        | --                                                |
| AC5.1: index.ts exports nothing                   | --                                                          | Phase 4, Step 4.1                                 |
| AC5.2: typecheck passes                           | --                                                          | Phase 4, Step 4.2                                 |
| AC5.3: build succeeds                             | --                                                          | Phase 4, Step 4.3                                 |
