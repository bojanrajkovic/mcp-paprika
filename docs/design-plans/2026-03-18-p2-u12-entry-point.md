# Entry Point Design

## Summary

This unit wires together every module built in Phases 1 and 2 into a single working server. `src/index.ts` is the program entry point — it runs a strictly ordered startup sequence: load and validate config, authenticate against Paprika Cloud, initialize the on-disk cache, create the MCP server, assemble a `ServerContext` record that bundles all shared dependencies, register all 8 tools and the recipe resource, start the background sync engine, install a SIGINT handler, then connect the stdio transport. The file exports nothing and contains no business logic; every step is a call into an already-implemented module.

A prerequisite refactor ships alongside the entry point: `DiskCache` currently accepts an optional `log` callback injected by the caller. Since the entry point is the only constructor site, and since init-time diagnostics are safe to write directly to `process.stderr` (the transport is not yet connected at that point), the callback is removed and replaced with direct `process.stderr` writes. This simplifies construction and removes the entry point's only non-trivial wiring decision.

## Definition of Done

`src/index.ts` replaces the empty skeleton with a fully functional MCP server entry point that orchestrates the complete startup sequence: config loading (Result handling), Paprika auth, disk cache init, MCP server creation, ServerContext assembly, all 8 tool + resource registrations, optional sync engine start, SIGINT handler, and stdio transport connection. The entry point exports nothing, contains no business logic (pure wiring), and handles startup failures by logging to stderr and exiting with non-zero code.

**Success criteria:** Server starts, all tools are registered before transport connects, sync runs in background, SIGINT stops cleanly, startup failures exit with non-zero code and stderr message.

**Out of scope:** Phase 3 wiring (P3-U08), integration/E2E tests, OpenTelemetry.

## Acceptance Criteria

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

### p2-u12-entry-point.AC4: DiskCache Logging Refactor

- **p2-u12-entry-point.AC4.1 Success:** DiskCache no longer accepts a `log` callback parameter
- **p2-u12-entry-point.AC4.2 Success:** DiskCache diagnostic messages are written to `process.stderr`
- **p2-u12-entry-point.AC4.3 Success:** Existing DiskCache tests pass after refactor

### p2-u12-entry-point.AC5: Code Quality

- **p2-u12-entry-point.AC5.1 Success:** `src/index.ts` exports nothing (program entry point only)
- **p2-u12-entry-point.AC5.2 Success:** `pnpm typecheck` passes with no errors
- **p2-u12-entry-point.AC5.3 Success:** `pnpm build` succeeds

## Glossary

- **MCP (Model Context Protocol)**: An open protocol for connecting AI models to external tools and data sources. This server implements MCP over stdio transport, exposing Paprika recipe data as tools and resources.
- **stdio transport**: The MCP wire channel. The server reads JSON-RPC messages from stdin and writes responses to stdout. Any non-protocol output to stdout (including stray `console.log`) corrupts the framing.
- **McpServer**: The MCP SDK class that handles protocol framing, tool dispatch, resource dispatch, and in-protocol logging. Constructed once and passed through `ServerContext`.
- **ServerContext**: A plain immutable record (`{ client, cache, store, server }`) constructed once at startup and passed by reference into every tool and resource registration function. Acts as the project's dependency injection vehicle.
- **PaprikaClient**: The HTTP client for the Paprika Cloud Sync API. Handles authentication, JWT token management, recipe/category fetching, and recipe writes. Constructed with email and password; requires `authenticate()` before making API calls.
- **DiskCache**: The on-disk persistence layer. Stores full recipe and category JSON in a local directory and maintains an in-memory index (`uid -> hash`) used for sync diffing. Must be initialized with `init()` before use; writes are buffered in memory until `flush()` commits them atomically.
- **RecipeStore**: An in-memory index built on top of `DiskCache` data. Provides higher-level query methods (search, filter by ingredient, filter by time) used directly by MCP tools.
- **SyncEngine**: The background polling loop. Created unconditionally but only started when `config.sync.enabled` is true. `start()` is non-blocking — the polling loop runs as a detached async operation. Stopped via `AbortController` on SIGINT.
- **cold-start guard**: A pattern in tool handlers that returns a graceful empty/error response when the `RecipeStore` has not yet been populated by the first sync cycle.
- **neverthrow `Result<T, E>`**: A functional error-handling type from the `neverthrow` library. Represents either a success value (`Ok<T>`) or a failure value (`Err<E>`) without throwing. `loadConfig()` returns one; the entry point unwraps it with `.match()`.
- **oxlint**: The project's linter. Enforces a `no-console` rule throughout the codebase; the single `console.error` in the `main().catch()` handler is permitted via an inline suppression directive.
- **SIGINT**: The Unix signal sent when a user presses Ctrl+C (or when a process manager stops the server). The entry point registers a handler that stops the sync engine and calls `process.exit(0)`.
- **Phase 3 extension point**: A comment marker in the entry point that identifies where P3-U08 will inject additional wiring (sync event subscriptions, Phase 3 tool registrations) without requiring structural changes to `main()`.

## Architecture

The entry point is an `async function main()` that orchestrates a strictly ordered startup sequence. It contains no business logic — every step delegates to an existing module. The overall structure is:

1. **Foundation init** — load config (unwrap Result or throw), authenticate Paprika client, initialize disk cache, create empty recipe store
2. **MCP server setup** — create `McpServer`, assemble `ServerContext`, register all tools and resources
3. **Background sync** — create `SyncEngine`, conditionally start it
4. **Lifecycle** — install SIGINT handler, connect stdio transport (blocks until shutdown)

All startup failures propagate to a top-level `main().catch()` handler that writes to stderr (with oxlint no-console suppression) and exits with code 1. After transport connects, errors are handled within their respective modules — nothing propagates back to `main()`.

### Config Result Handling

`loadConfig()` returns `Result<PaprikaConfig, ConfigError>`. The entry point uses `.match()` to unwrap the value on success or throw on error. This feeds into the uniform `main().catch()` error path alongside `client.authenticate()` and `cache.init()` failures.

### Registration Signatures

All tool and resource registration functions take `(server: McpServer, ctx: ServerContext): void`. The entry point calls each one, passing the server and assembled context. `registerFilterTools` registers both `filter_by_ingredient` and `filter_by_time` in a single call.

### DiskCache Logging

DiskCache accepts an optional `log` callback in its constructor. As a prerequisite refactor, this will be changed to write directly to `process.stderr` internally, removing the callback parameter. This is safe because DiskCache init happens before the MCP transport connects — stderr output cannot corrupt the stdio protocol. After transport connects, the sync engine handles all ongoing diagnostics via `server.sendLoggingMessage()`.

### Sync Engine Lifecycle

`SyncEngine` is created unconditionally but only started when `config.sync.enabled` is true (default). `sync.start()` is non-blocking — it fires the polling loop as a detached async operation. The first sync runs in the background while the transport connects, and tools handle the pre-sync empty store via the cold-start guard.

### SIGINT Handler

Registered before `server.connect(transport)`. Calls `sync.stop()` (aborts the AbortController loop) then `process.exit(0)`. No `server.close()` needed — `process.exit()` tears down stdio. No `cache.flush()` needed — sync and tools flush after each mutation.

### Phase 3 Extension Point

A comment marker between `sync.start()` and the SIGINT handler indicates where P3-U08 will add feature wiring (sync event subscriptions, Phase 3 tool registrations). No structural changes will be needed.

## Existing Patterns

Investigation found consistent patterns across the codebase:

- **Registration functions** all follow `(server: McpServer, ctx: ServerContext): void` — the entry point matches this convention
- **ServerContext** is the standard dependency injection vehicle, constructed once and passed by reference
- **neverthrow Result** is used by `loadConfig()` — the entry point uses idiomatic `.match()` to unwrap, consistent with the project's "never use `.isOk()`/`.isErr()`" rule
- **ESM imports** with `.js` extensions and `import type` for type-only imports — followed throughout
- **No console output** — enforced by oxlint `no-console` rule; the single `console.error` in `main().catch()` uses lint suppression

No new patterns are introduced. The entry point is pure wiring that composes existing modules.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: DiskCache Logging Refactor + Entry Point Implementation

**Goal:** Remove DiskCache's log callback parameter (replace with direct `process.stderr.write`), then implement the complete `src/index.ts` entry point with full startup sequence, tool/resource registration, sync engine wiring, SIGINT handler, and stdio transport connection.

**Components:**

- Refactor `src/cache/disk-cache.ts` — remove `log?` constructor parameter, write diagnostics to `process.stderr` directly
- Update `src/cache/disk-cache.test.ts` — adjust tests that use the log callback (spy on `process.stderr.write` instead)
- Create `src/index.ts` — complete entry point replacing the empty skeleton

**Dependencies:** All Phase 1 and Phase 2 units (P1-U01 through P2-U11) are complete.

**Done when:** `pnpm typecheck` passes, `pnpm build` succeeds, `pnpm test` passes (existing tests still green after DiskCache refactor), entry point compiles and follows the startup sequence specified in the architecture section.

<!-- END_PHASE_1 -->

## Additional Considerations

**Startup error messages:** The `main().catch()` handler uses `console.error` (writing to stderr by default). This is the only place in the codebase where console output is permitted, suppressed with an oxlint directive. The message should include enough context for an operator to diagnose the issue (e.g., "Failed to authenticate: invalid credentials").

**`config.sync` defaults:** The config schema applies zod defaults — `sync.enabled` defaults to `true`, `sync.interval` defaults to 15 minutes (in milliseconds). The entry point accesses these as `config.sync.enabled` and `config.sync.interval` without additional defaulting.
