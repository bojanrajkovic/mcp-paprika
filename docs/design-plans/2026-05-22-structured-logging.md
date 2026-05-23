# Structured Logging Design

## Summary

The server's current diagnostic surface has two independent logging tracks: a `process.stderr.write` shim (inherited from the MCP stdio constraint that stdout is the wire format) and hand-duplicated `notifier.loggingMessage` calls scattered across `sync.ts`. These tracks are uncoordinated — a log event that should reach both the operator and the connected MCP client requires two separate call sites. Alongside this, the circuit breaker in `src/paprika/client.ts` fabricates HTTP 503 status codes when it trips, even though no network request ever left the process.

This design collapses both tracks into a single pino-rooted logger hierarchy. A `createLogger(opts)` function in `src/utils/log.ts` produces a pino root configured with a `pino.multistream` destination: one stream routes records to the primary output (stdout JSON for HTTP transport, pino-pretty to stderr for dev TTY, pino-pretty to a file under `getLogDir()` for non-TTY stdio production), and a second stream fans out `warn+` records to connected MCP clients via the existing `Notifier.loggingMessage` abstraction. One call to `log.warn(...)` reaches both the operator and any attached Claude session automatically.

The logger is constructed in `buildAppContext` and stored as `AppContext.log`, making it available to all downstream components through the existing composition-root pattern. Resilience policies in `PaprikaClient` move from module-level singletons into the constructor, which lets cockatiel's lifecycle hooks (`onRetry`, `onGiveUp`, `onBreak`) close over a per-instance logger. The breaker wrap order reverses so it counts distinct tool calls rather than internal retry attempts, and the synthetic 503 fabrication is replaced by a purpose-built `CircuitOpenError` that accurately describes what happened: the request never left the process.

## Definition of Done

**Goal:** The mcp-paprika server's diagnostic surface gets a structural overhaul that resolves the misleading-503 incident from 2026-05-21 and addresses the gap captured in issue #94. Today's two parallel ad-hoc logging surfaces (a `process.stderr.write` shim plus hand-duplicated `notifier.loggingMessage` calls) become one unified pino-based logger whose `warn+` records automatically fan out to connected MCP clients. The local circuit breaker stops fabricating "HTTP 503" responses when it trips.

**Primary deliverables:**

1. **Structured logger** (`src/utils/log.ts`) — pino root, transport-aware destination:
   - HTTP → pino JSON to stdout (k8s convention; `kubectl logs | jq .` works).
   - stdio + TTY (e.g. `pnpm dev` in a terminal, detected via `process.stderr.isTTY`) → pino-pretty to stderr (developer sees inline).
   - stdio + non-TTY (production: Claude Desktop / Code / Cursor, where stderr is plumbed nowhere reachable) → pino-pretty to a file at `getLogDir() + '/mcp-paprika.log'` (uses the existing `src/utils/xdg.ts` helper; macOS: `~/Library/Logs/mcp-paprika/`, Linux: `~/.local/state/mcp-paprika/` or `$XDG_STATE_HOME/mcp-paprika`, Windows: `%LOCALAPPDATA%\mcp-paprika\Log\`). `MCP_LOG_FILE` env var overrides the default path.
   - Single growing file, no built-in rotation; documented as known limitation. Operators can rotate externally with logrotate / newsyslog / launchctl as needed.
   - Severity filtering via `MCP_LOG_LEVEL`, credential redact via pino `redact` config. One pino root per process, cheap children per component.

2. **Unified call site for operator logs and MCP-protocol notifications** — `warn+` pino records fan out to `Notifier.loggingMessage` via a pino `multistream` destination, eliminating today's hand-duplicated calls in `sync.ts`. The fan-out stream is a synchronous in-process Writable (not a worker-thread transport); its `_write` parses the JSON record, filters by severity ≥ `notifyLevel`, maps pino's level to MCP's RFC 5424 level (`trace`/`debug` → `debug`, `info` → `info`, `warn` → `warning`, `error` → `error`, `fatal` → `critical`), and calls `notifier.loggingMessage()` with a curated `data: { msg, ...meaningfulFields }` payload (drops pino internals like numeric level, numeric time, hostname, pid). Tool failures reach both surfaces (the tool's `textResult` AND the structured `notifications/message` fan-out) — intentional; both audiences benefit.

3. **Context threading** — `AppContext.log: pino.Logger` field populated by `buildAppContext` (which constructs the pino root via the new `createLogger(opts)` function and threads it through). `AuthContext.log: { auth, oidcClient }` populated by `buildAuthContext` with child loggers for the two auth-subsystem components. `PaprikaClient` constructor takes an optional `log?: pino.Logger` argument (defaults to a silent pino so existing tests are unaffected).

4. **Per-attempt request logging** in `src/paprika/client.ts`, `src/auth/oidc-client.ts`, and `src/features/embeddings.ts` — uses cockatiel's lifecycle hooks (`onRetry({attempt, delay, error})` for backoff-aware retry telemetry, `onGiveUp({error})` for retry exhaustion). Per-instance retry/breaker policies move from module level into the constructor so hooks close over `this.log`. `IRetryContext.attempt` (provided by cockatiel, starts at 1) is the source of attempt numbers — no manual counter.

5. **Breaker A — reverse wrap order** in `src/paprika/client.ts`: `wrap(this.breakerPolicy, this.retryPolicy)` (breaker outside retry) so the breaker counts distinct tool calls rather than internal retry attempts. Material behavior change: a single transient network blip exhausting 3 retries no longer adds 3 to the breaker's consecutive-failure counter; it adds 1.

6. **Breaker B — `CircuitOpenError`** (new class in `src/paprika/errors.ts`, extends `PaprikaError`) replaces the synthetic `PaprikaAPIError("Service unavailable (circuit open)", 503, url)` thrown today at `client.ts:270` and `:293`. The error carries `endpoint: string` and an ES2024 `cause: BrokenCircuitError` for diagnostic chaining. No fabricated HTTP status — the request never left our process, so we don't pretend it did.

7. **Breaker observability** — `breakerPolicy.onBreak()` logs at `warn` (reaches MCP clients via fan-out so Claude sees "Paprika subsystem unhealthy"); `breakerPolicy.onReset()` and `breakerPolicy.onHalfOpen()` log at `info` (operator-only).

8. **Existing-site migration** — 13 `createLogger` call sites migrated to `ctx.log.child({component: "..."})` with the `mcp-paprika:` prefix dropped from component names (flat single-word values: `sync`, `paprika-client`, `update_pantry_item`, etc.; `transport-stdio` / `transport-http` for the transport entry-points). 3 ad-hoc `process.stderr.write("[auth] ...")` writes in `src/auth/routes.ts` replaced with `auth` (local logic) or `oidc-client` (upstream-OIDC calls) component logger. `SyncEngine._log` private helper deleted. Duplicate `notifier.loggingMessage` calls in `src/paprika/sync.ts:262-265` and `:273-276` deleted (fan-out handles them automatically). `src/e2e-server.ts` test harness migrated to the new API with a silent default notifier.

9. **New instrumentation in previously-silent layers:**
   - `src/cache/disk-cache.ts` — audit 5 catch sites; classify silent cold-start (file not found) vs. true failure (warn/error). Component: `disk-cache`.
   - `src/features/vector-store.ts` — audit ~8 catch sites; same classification. Component: `vector-store`.
   - `src/features/embeddings.ts` — per-attempt logging on external HTTP fetch to embedding provider (Ollama / OpenAI). Component: `embeddings`.
   - `src/features/discover-feature.ts` — error log on sync-driven re-index failure. Component: `discover`.
   - `src/transport/http.ts` — Hono middleware that logs `{method, path, status, durationMs}` at `info` per request; 5xx responses log at `error` (which reaches MCP clients). Component: `transport-http`.
   - `src/auth/oidc-client.ts` — per-attempt logging on the `fetch()` to OIDC discovery / JWKS / token-exchange endpoints. Component: `oidc-client`.
   - `src/auth/routes.ts` — OAuth state-transition info logs (client registered, token minted, token revoked, allowlist hit/miss). Component: `auth`.
   - `src/auth/cleanup.ts`, `src/auth/dcr-validator.ts`, `src/auth/client-registration.ts` — debug-level logs in silent catches so DCR rejections and cleanup failures are diagnosable. Component: `auth`.

10. **Config integration** — new `PaprikaConfig.logging: { level, notifyLevel, pretty, file }` block in `src/utils/config.ts`:
    - `level: "trace" | "debug" | "info" | "warn" | "error" | "fatal"` — default `"info"`. Routed from env var `MCP_LOG_LEVEL`.
    - `notifyLevel: <same enum>` — default `"warn"`. Routed from env var `MCP_LOG_NOTIFY_LEVEL`. Threshold for MCP fan-out.
    - `pretty: boolean | "auto"` — default `"auto"`. Routed from env var `MCP_LOG_PRETTY`. When `"auto"`, pretty-prints if `process.stderr.isTTY` is true (TTY developer terminal) OR if the transport is stdio and the destination is a file (non-TTY stdio production); raw JSON otherwise (HTTP transport).
    - `file: string | undefined` — default derived from `getLogDir()` for stdio non-TTY; `undefined` (no file output) for HTTP transport and stdio TTY. Routed from env var `MCP_LOG_FILE` to override the default path.

11. **Startup file-creation safety** — when a file destination is in use, the logger ensures the log directory exists at construction time (`mkdir -p` style). If the directory cannot be created or the file cannot be opened for writing, the process fails fast at startup with a clear error message — matches the existing "config errors throw and crash" pattern. No silent fallback to stderr.

12. **CLAUDE.md cleanup** — delete the "Dependency Policy" section (lines 76-82 of project root `CLAUDE.md`). Separate commit on the same PR.

**Success criteria:**

- `pnpm test`, `pnpm lint`, `pnpm typecheck` all green.
- New tests cover: logger plumbing (multistream wiring, redact rules, level mapping), notifier fan-out (level filtering, MCP level mapping, curated data field), per-attempt client logging (no token leaks in records, structural invariants), Breaker A+B behavior (5 failing tool calls trip the breaker; the 6th throws `CircuitOpenError`, not `PaprikaAPIError(status=503)`), HTTP access log middleware, file destination path resolution.
- Behavioral verification on the dev path: batch tool invocations don't trip the breaker spuriously; per-attempt records appear in pod logs / log file with method/URL/status/attempt fields; no synthetic-503 surfaces appear in tool errors or pod logs; pod log lines are JSON-parseable (HTTP mode); stdio non-TTY mode writes to the configured log file at the env-paths-derived location.
- PR merged to main via squash-merge.

**Out of scope (deferred to future work):**

- `/healthz` ring buffer for live diagnostics (1.3.0 candidate).
- File rotation (single growing file accepted as known limitation; users rotate externally with logrotate / newsyslog / launchctl).
- Per-method circuit breakers, `SamplingBreaker` (1.3.0 candidate, gated on real-world data this design will produce).
- Bridging pino's level set to MCP's full RFC 5424 levels — we use a 6-to-9 mapping without `notice` / `critical` / `alert` / `emergency` differentiation (only `critical` is used, for pino `fatal`; `notice` / `alert` / `emergency` are never emitted).
- Per-connection `logging/setLevel` MCP request handling (per-process env-driven only for now).
- `src/utils/config.ts` instrumentation — config errors throw and crash by design; logging there would break the "logger exists before any log call" invariant.
- Correlation IDs propagating through downstream Paprika / OIDC / embeddings calls (future direction; would benefit from a request-scoped child logger pattern).

## Acceptance Criteria

### structured-logging.AC1: Logger routes records to correct destination per transport

- **structured-logging.AC1.1 Success — HTTP:** When `transport === "http"`, log records are written as pino JSON to stdout (fd 1) and parse cleanly via `JSON.parse` line-by-line.
- **structured-logging.AC1.2 Success — stdio + TTY:** When `transport === "stdio"` and `process.stderr.isTTY === true`, log records are written as pino-pretty formatted text to stderr (fd 2).
- **structured-logging.AC1.3 Success — stdio + non-TTY:** When `transport === "stdio"` and `process.stderr.isTTY === false`, log records are written as pino-pretty formatted text to the file at `getLogDir() + '/mcp-paprika.log'`.
- **structured-logging.AC1.4 Success — file path override:** When `MCP_LOG_FILE=/custom/path/log.txt` is set, the stdio non-TTY destination uses that path instead of the env-paths default.

### structured-logging.AC2: MCP fan-out filters by severity and maps levels correctly

- **structured-logging.AC2.1 Success — warn fans out:** A `log.warn(...)` call invokes `notifier.loggingMessage` exactly once with `level: "warning"` and a curated `data` payload.
- **structured-logging.AC2.2 Success — info doesn't fan out (default):** A `log.info(...)` call (with default `notifyLevel: "warn"`) does NOT invoke `notifier.loggingMessage`; the record is written to the primary destination only.
- **structured-logging.AC2.3 Success — configurable threshold:** Setting `MCP_LOG_NOTIFY_LEVEL=info` causes info-level calls to fan out; setting `MCP_LOG_NOTIFY_LEVEL=error` prevents warn-level calls from fanning out.
- **structured-logging.AC2.4 Success — level mapping:** Pino `trace`/`debug` map to MCP `debug`; `info` → `info`; `warn` → `warning`; `error` → `error`; `fatal` → `critical`.
- **structured-logging.AC2.5 Success — curated data:** The `data` field on the wire contains `{ msg, ...meaningfulFields }` and excludes pino internals (`level` numeric, `time` numeric, `hostname`, `pid`).
- **structured-logging.AC2.6 Success — fire-and-forget:** A rejected promise from `notifier.loggingMessage` does NOT propagate to the originating log-call site; pino's stream `_write` callback completes synchronously regardless.
- **structured-logging.AC2.7 Failure — credential redact:** Log records containing values at any configured redact path (`*.authorization`, `*.password`, `*.token`, `*.client_secret`, `*.access_token`, `*.refresh_token`, `*.id_token`) have those values replaced with `"[Redacted]"` in both the primary stream and the fan-out payload.

### structured-logging.AC3: Per-attempt request logging surfaces lifecycle events

- **structured-logging.AC3.1 Success — request start:** Each Paprika request attempt emits a debug record with `{method, url, attempt}`.
- **structured-logging.AC3.2 Success — request ok:** A successful response emits a debug record with `{method, url, attempt, status, attemptDurationMs}`.
- **structured-logging.AC3.3 Success — retry telemetry:** Cockatiel's `onRetry` hook emits a warn record with `{attempt, nextBackoffMs, err}` for each failed attempt that will be retried.
- **structured-logging.AC3.4 Success — give-up telemetry:** Cockatiel's `onGiveUp` hook emits an error record when retries are exhausted.
- **structured-logging.AC3.5 Success — non-retryable failure:** A non-retryable HTTP failure (4xx other than 401) emits an error record at the call site with `{method, url, attempt, status, attemptDurationMs}`.
- **structured-logging.AC3.6 Success — 401 re-auth:** A 401 response emits an info record indicating that re-authentication will occur.
- **structured-logging.AC3.7 Failure — no token leaks:** Records emitted from `paprika/client.ts` and `oidc-client.ts` never contain Bearer token values, password values, or `id_token` payloads (verified by pino redact configuration).

### structured-logging.AC4: Breaker A — counts tool calls, not retry attempts

- **structured-logging.AC4.1 Success — single-call retry counts as 1:** A single failing tool call that exhausts 3 retries increments the breaker's consecutive-failure counter by exactly 1, not 3.
- **structured-logging.AC4.2 Success — 5th call trips breaker:** 5 distinct failing tool calls (each exhausting retries) transition the breaker to `open`; the `onBreak` hook fires exactly once across the run.
- **structured-logging.AC4.3 Success — 6th call short-circuits:** With the breaker open, the 6th tool call throws synchronously without attempting any network request.

### structured-logging.AC5: Breaker B — surface error is `CircuitOpenError`

- **structured-logging.AC5.1 Success — error class:** When the breaker rejects a call, the thrown error satisfies `error instanceof CircuitOpenError === true`.
- **structured-logging.AC5.2 Success — no fabricated status:** The thrown `CircuitOpenError` does NOT have a `.status` property and `error instanceof PaprikaAPIError === false`.
- **structured-logging.AC5.3 Success — message names the endpoint:** The error's `.message` includes the endpoint URL that was about to be called and does not include any fabricated HTTP status.
- **structured-logging.AC5.4 Success — cause chain:** The error's `.cause` is the underlying cockatiel `BrokenCircuitError`.
- **structured-logging.AC5.5 Success — tool error surface:** The user-visible tool error (via `toMessage(err)`) reads `"Paprika client circuit breaker is open (endpoint=...)"` and does not include the substring `"HTTP 503"`.

### structured-logging.AC6: Breaker observability via lifecycle hooks

- **structured-logging.AC6.1 Success — onBreak at warn:** When the breaker opens, exactly one warn-level record is emitted with `"paprika circuit breaker opened"` and component `paprika-client`; this record fans out to MCP clients.
- **structured-logging.AC6.2 Success — onReset at info:** When the breaker closes after a successful half-open probe, an info-level record is emitted; this does NOT fan out (below default `notifyLevel: "warn"`).
- **structured-logging.AC6.3 Success — onHalfOpen at info:** When the breaker transitions to half-open, an info-level record is emitted.

### structured-logging.AC7: Component logger naming uses flat single-word names

- **structured-logging.AC7.1 Success — no `mcp-paprika:` prefix:** No log record emitted from production code has a `component` field beginning with `mcp-paprika:` or `mcp-paprika`. Migrated sites emit values like `sync`, `paprika-client`, `update_pantry_item`.
- **structured-logging.AC7.2 Success — auth components:** Records originating in `src/auth/` use `component: "auth"` (local logic) or `component: "oidc-client"` (upstream-OIDC calls).
- **structured-logging.AC7.3 Success — transport components:** Records from `src/transport/stdio.ts` use `component: "transport-stdio"`; records from `src/transport/http.ts` use `component: "transport-http"`.

### structured-logging.AC8: Existing site migration removes legacy logging shims

- **structured-logging.AC8.1 Success — no callable form:** No production call site uses the old `log("string")` callable form; all migrated sites use pino's structured methods (`log.info({...}, "msg")`).
- **structured-logging.AC8.2 Success — `_log` deleted:** `SyncEngine._log` is removed; sync engine uses `this.log` (a child of `ctx.log`).
- **structured-logging.AC8.3 Success — no duplicate notifier calls:** The two `this._context.notifier.loggingMessage(...)` invocations in `src/paprika/sync.ts` are removed; sync events are logged via `this.log.info` / `this.log.error`, which fans out automatically.
- **structured-logging.AC8.4 Success — no `[auth]` prefix:** No `process.stderr.write("[auth] ...")` calls remain in `src/auth/routes.ts`; the 3 sites use the `auth` or `oidc-client` component logger.

### structured-logging.AC9: Previously-silent layers emit structured records on failure

- **structured-logging.AC9.1 Success — disk-cache failures:** True I/O failures in `src/cache/disk-cache.ts` emit records at warn or error levels; cold-start file-not-found paths remain silent per the per-site classification documented in code.
- **structured-logging.AC9.2 Success — vector-store failures:** Vector index read/write failures in `src/features/vector-store.ts` emit records at appropriate levels.
- **structured-logging.AC9.3 Success — embeddings external HTTP:** A failed `fetch()` to the embedding provider emits per-attempt records (component `embeddings`).
- **structured-logging.AC9.4 Success — sync-driven re-index failure:** A failure in `src/features/discover-feature.ts` during sync-driven re-indexing emits an error-level record.
- **structured-logging.AC9.5 Success — HTTP access log:** Each request through `src/transport/http.ts` emits exactly one info-level record with `{method, path, status, durationMs}`; records with `status >= 500` emit at error level (fans out to MCP clients).
- **structured-logging.AC9.6 Success — OAuth state transitions:** Info-level records are emitted in `src/auth/routes.ts` for client registration, token minting, token revocation, and allowlist hits/misses.

### structured-logging.AC10: Logger config knobs route through `PaprikaConfig`

- **structured-logging.AC10.1 Failure — schema validates:** `paprikaConfigSchema` rejects an invalid `logging.level` value (e.g., `"info-ish"`) at startup with a clear validation error.
- **structured-logging.AC10.2 Success — env var routing:** Setting `MCP_LOG_LEVEL=debug` sets pino's root level to `debug`; setting `MCP_LOG_NOTIFY_LEVEL=info` sets the fan-out stream filter to `info`; setting `MCP_LOG_FILE=/tmp/test.log` sets the file destination path (when applicable).
- **structured-logging.AC10.3 Success — defaults:** With no env vars set, `level` is `info`, `notifyLevel` is `warn`, `pretty` is `auto`, and `file` resolves to `getLogDir() + '/mcp-paprika.log'` for stdio non-TTY (undefined for HTTP and stdio TTY).
- **structured-logging.AC10.4 Success — pretty auto-detection:** With `pretty: "auto"` (default), TTY stdio emits pretty output to stderr; non-TTY stdio emits pretty output to the file; HTTP emits raw JSON to stdout.

### structured-logging.AC11: File destination startup safety

- **structured-logging.AC11.1 Success — mkdir on construction:** When a file destination is in use, the logger ensures the log directory exists (via `mkdir -p` semantics) at logger construction time.
- **structured-logging.AC11.2 Failure — fail-fast on unwritable:** When the log directory cannot be created or the file cannot be opened for writing, the process exits non-zero at startup with a clear error message; no silent fallback to stderr.

## Glossary

- **MCP (Model Context Protocol)**: The protocol this server implements. Clients (Claude Desktop, Claude Code, Cursor) connect over stdio or HTTP and invoke tools, read resources, and receive `notifications/message` log fan-out records.
- **pino**: A low-overhead Node.js structured logging library. Records are emitted as newline-delimited JSON; child loggers are created with `parent.child({...})` and inherit the parent's configuration with additional bound fields.
- **pino-pretty**: A pino transform that renders pino JSON records as human-readable colored output, used here for developer TTY sessions and file-based non-TTY output.
- **pino.multistream**: A pino utility that fans a single logger's output to multiple destination streams, each with its own minimum level filter. Used here to split records between the primary output and the MCP fan-out stream.
- **Notifier**: An abstraction in `src/server/notifier.ts` that wraps `server.sendLoggingMessage()`. Implementations include `singleServerNotifier` (stdio) and `broadcastNotifier` (HTTP, one per connected session). Pre-server calls silently no-op via a deferred-getter pattern.
- **AppContext**: The process-wide composition root in `src/server/app-context.ts`. Owns all heavyweight shared state (`client`, `cache`, `store`, `vectorStore`, `notifier`, and after this change, `log`). `SessionContext` extends it.
- **AuthContext**: A parallel composition root for the auth subsystem, built by `buildAuthContext` inside `buildAppContext`. Holds `auth` and `oidcClient` component state (and after this change, their child loggers).
- **PaprikaClient**: The HTTP client in `src/paprika/client.ts` that calls the Paprika recipe manager's REST API. Wraps all requests in cockatiel resilience policies.
- **cockatiel**: A TypeScript resilience library providing retry and circuit-breaker policies with lifecycle hooks (`onRetry`, `onGiveUp`, `onBreak`, `onReset`, `onHalfOpen`).
- **circuit breaker**: A cockatiel policy that tracks consecutive failures and, after a threshold is exceeded, short-circuits further calls without hitting the network. Today's implementation wraps retry inside the breaker; this design reverses the order (breaker wraps retry) so the breaker counts tool calls, not retry attempts.
- **CircuitOpenError**: A new error class in `src/paprika/errors.ts` that replaces the fabricated `PaprikaAPIError(status=503)` thrown when the circuit is open. Carries `endpoint` and a `cause` chain to the underlying cockatiel `BrokenCircuitError`. No `.status` property.
- **BrokenCircuitError**: The error cockatiel throws internally when a circuit-breaker policy rejects a call because the breaker is open. Used as the `cause` on `CircuitOpenError`.
- **RFC 5424**: The syslog severity scale. MCP's `notifications/message` levels (`debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`) follow this scale. This design maps pino's 6-level set to a subset of it.
- **deferred-getter notifier pattern**: The existing technique in `singleServerNotifier(() => server)` where the notifier is constructed before the McpServer exists, with a getter closure that returns `undefined` until the server is set. Pre-server fan-out calls silently no-op.
- **XDG (via `env-paths`)**: The XDG Base Directory specification for platform-native config/data/log paths. `src/utils/xdg.ts` wraps the `env-paths` package to resolve `getLogDir()` to `~/Library/Logs/mcp-paprika/` (macOS), `~/.local/state/mcp-paprika/` (Linux), or `%LOCALAPPDATA%\mcp-paprika\Log\` (Windows).
- **multistream level constraint**: A pino-specific behavior where the root logger's level must be at least as permissive as the lowest per-stream level. The root level is computed as `min(config.logging.level, config.logging.notifyLevel)`.
- **fire-and-forget fan-out**: The design requirement that the MCP notifier fan-out Writable's `_write` callback calls `callback()` synchronously without awaiting the `loggingMessage()` promise, so a rejected fan-out does not block or fail the originating `log.warn(...)` call.

## Architecture

The design replaces the project's existing two-track logging (a `process.stderr.write` shim plus hand-duplicated `notifier.loggingMessage` calls) with one pino-rooted hierarchy whose `warn+` records automatically fan out to connected MCP clients. The same call site reaches both audiences.

**Module layout:**

- `src/utils/log.ts` exports a single `createLogger(opts: LoggerOptions): pino.Logger` function. Each invocation returns the per-process pino root, configured per-call (the function is called exactly once, by `buildAppContext`). All component-scoped loggers are cheap children of that root via `parent.child({component: "<flat-name>"})`.
- `AppContext.log: pino.Logger` and `AuthContext.log: { auth, oidcClient }` are the fields through which the logger reaches all post-bootstrap callers. The transport entry-points (`src/transport/stdio.ts`, `src/transport/http.ts`) construct the notifier first, then call `buildAppContext(config, notifier)`, which constructs the logger and threads it into `AppContext`.
- Per-component children are created at the call site. Tools create theirs inside `register*Tool(server, ctx)` so the logger lives for the session lifetime, captured in handler closures. `PaprikaClient` and `SyncEngine` take a logger via their constructor.

**Primary destination (per-transport):**

- **HTTP transport** → raw pino JSON to stdout (fd 1). Container runtimes capture this as the pod log stream; `kubectl logs <pod> | jq '.'` parses every line.
- **Stdio + TTY** (`process.stderr.isTTY === true`; the `pnpm dev` developer case) → `pino-pretty` Writable to stderr (fd 2). Stdout is reserved for the MCP wire format and must never be touched in stdio mode.
- **Stdio + non-TTY** (production Claude Desktop / Code / Cursor pipe, where stderr is plumbed nowhere reachable) → `pino-pretty` Writable to a file at `getLogDir() + '/mcp-paprika.log'`. Uses the existing `src/utils/xdg.ts` `getLogDir()` helper, which honors `XDG_STATE_HOME` overrides and resolves to `~/Library/Logs/mcp-paprika/` on macOS, `~/.local/state/mcp-paprika/` on Linux, `%LOCALAPPDATA%\mcp-paprika\Log\` on Windows. `MCP_LOG_FILE=/path` overrides the default.

**Fan-out destination (MCP wire):**

Implemented as a synchronous in-process Writable composed via `pino.multistream`. The Writable's `_write` callback parses each pino JSON record, applies the `notifyLevel` filter, maps the pino level to MCP's RFC 5424 level, curates a `data: { msg, ...meaningfulFields }` payload (drops pino internals: numeric level, numeric time, hostname, pid), and calls `notifier.loggingMessage()`. Fire-and-forget — a rejected `loggingMessage` promise is swallowed by the existing notifier implementations; pino's stream `_write` completes its callback synchronously regardless of fan-out success or failure.

**Contracts:**

```typescript
interface LoggerOptions {
  readonly transport: "stdio" | "http";
  readonly notifier: Notifier;
  readonly level: pino.Level;          // primary stream threshold (default "info")
  readonly notifyLevel: pino.Level;    // fan-out threshold (default "warn")
  readonly pretty: boolean | "auto";   // TTY auto-detect when "auto" (default "auto")
  readonly file?: string;              // override default file path
}

// MCP fan-out level mapping (pino → RFC 5424):
//   trace → debug, debug → debug, info → info,
//   warn → warning, error → error, fatal → critical
//   (no emission of notice / alert / emergency)

interface MCPFanoutRecord {
  level: "debug" | "info" | "warning" | "error" | "critical";
  logger: string;          // pino child's component binding
  data: {
    msg: string;
    [key: string]: unknown;  // structured fields, excluding pino internals
  };
}

class CircuitOpenError extends PaprikaError {
  constructor(readonly endpoint: string, options?: ErrorOptions);
  readonly name: "CircuitOpenError";
  // No fabricated HTTP status. The request never left the process,
  // so we don't pretend it did.
}

class PaprikaClient {
  constructor(
    email: string,
    password: string,
    log?: pino.Logger,                 // default: pino({ level: "silent" })
  );
  // ... existing methods ...
}
```

**Per-instance resilience policies:**

`PaprikaClient` constructs its `RetryPolicy` and `CircuitBreakerPolicy` in its constructor (moved from today's module-level singletons) so cockatiel's `onRetry` / `onGiveUp` / `onBreak` / `onReset` / `onHalfOpen` hooks close over the per-instance logger. The wrap order reverses to `wrap(this.breakerPolicy, this.retryPolicy)` (breaker outside retry). The breaker now counts distinct tool calls rather than internal retry attempts — a single transient blip exhausting 3 retries adds 1 to the consecutive-failure counter, not 3.

**Bootstrap order (load-bearing):**

```
1. Build notifier with closure-based getter for server   (unchanged)
2. Build logger with notifier baked in                   (NEW step)
3. Build AppContext (logger constructed inside)          (logger field added)
4. Build McpServer (or session map for HTTP)             (unchanged)
5. server.connect / app.listen                           (unchanged)
```

Pre-server log calls' fan-out invokes the notifier whose server-getter returns `undefined`; the notifier silently no-ops. Once step 4 completes, fan-out reaches connected clients.

**Data flow on a 3-attempt failed Paprika request:**

```
PaprikaClient.savePantryItem(item)
  └── this.resilience.execute(execute)
        └── this.breakerPolicy.execute(execute)        (now outer)
              └── this.retryPolicy.execute(execute)    (now inner)
                    ├── attempt 1 → fetch() throws → NetworkRetryableError
                    │     └── retryPolicy onRetry fires:
                    │           log.warn({attempt: 1, nextBackoffMs: 523, err},
                    │                    "paprika request failed, retrying")
                    │           └── fan-out → notifier.loggingMessage(...)
                    ├── attempt 2 → fetch() throws → NetworkRetryableError
                    │     └── onRetry fires (attempt: 2)
                    ├── attempt 3 → fetch() throws → NetworkRetryableError
                    │     └── retryPolicy onGiveUp fires:
                    │           log.error({err}, "paprika retries exhausted")
                    └── throws NetworkRetryableError
                       (unwrapped to original TypeError in catch chain)

  Breaker consecutive-failure counter: +1  (not +3)
  After 5 such tool calls: breaker opens, onBreak emits warn record,
  fan-out reaches MCP clients with "paprika circuit breaker opened"
```

## Existing Patterns

The design follows several established patterns in the codebase:

**Deferred-getter notifier pattern** (`src/server/notifier.ts`) — `singleServerNotifier(() => server)` already solves the chicken-and-egg between Notifier construction and McpServer construction. The new logger sits in the same window: it's constructed after the notifier but before the McpServer, and pre-server log calls' fan-out invokes a notifier whose getter returns `undefined`, which silently no-ops. No new bootstrap primitive needed.

**AppContext as composition root** (`src/server/build.ts`, `src/server/app-context.ts`) — `AppContext` already owns process-wide heavyweight state (`client`, `cache`, `store`, `pantryStore`, `vectorStore`, `notifier`, `auth`). Adding `log: pino.Logger` follows the same pattern. `SessionContext extends AppContext` already, so per-session views inherit the logger automatically without further plumbing.

**AuthContext as auth-subsystem composition root** (`src/auth/build.ts`) — `AuthContext` (built by `buildAuthContext` during step 2.5 of `buildAppContext`) mirrors AppContext for the auth subsystem. Adding `log: { auth, oidcClient }` keeps auth-specific child loggers in the same shape.

**Paprika error class hierarchy** (`src/paprika/errors.ts`) — `PaprikaError` (base) → `PaprikaAPIError` (HTTP errors with `status` and `endpoint`), `PaprikaAuthError` (auth failures). `CircuitOpenError` extends the base directly: it's neither an HTTP error (no fabricated status) nor auth-related. The taxonomy already supports this differentiation.

**`src/utils/xdg.ts` for platform-native paths** — already wraps `env-paths` with `{suffix: ""}` and adds `XDG_*` env-var overrides for cross-platform test repeatability (tests set `XDG_STATE_HOME` to a temp dir to redirect log writes). `getLogDir()` returns the right thing on macOS / Linux / Windows. The new file destination uses this helper — no new platform-handling code.

**Cockatiel resilience policies** (`src/paprika/client.ts`) — the project already wraps Paprika requests in cockatiel `retry` + `circuitBreaker` policies. The reshape moves construction from module level into the `PaprikaClient` constructor (so hooks close over per-instance state) but keeps the same policy types and matchers.

**Tool registration pattern** (`src/tools/*.ts`) — every tool exports a `register*Tool(server, ctx)` function that registers its handler against the server. The new design moves the `createLogger(...)` call from module top _into_ the register function, where `ctx.log` is available — the logger is created at the same time the handler closures are registered, captured for the session lifetime.

**Component-prefix logger convention** — today's 13 sites already follow `createLogger("mcp-paprika:<thing>")`. The new design preserves the per-site-name convention but shifts the prefix from a string-concat to a pino binding (`{component: "<thing>"}`), and drops the redundant `mcp-paprika:` qualifier since k8s pod metadata and MCP connection identity already establish which service emitted the record.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Logger module foundation + config integration + CLAUDE.md cleanup

**Goal:** Implement the structured logger module and integrate logging knobs into `PaprikaConfig`. Delete the project's "Dependency Policy" section.

**Components:**

- `src/utils/log.ts` — new `createLogger(opts: LoggerOptions): pino.Logger` exporting one function per the Architecture contract. Builds a pino root with `multistream([{stream: primary}, {level: notifyLevel, stream: fanoutStream(notifier)}])`. Internal helpers: `pinoLevelToMcp` (level mapping), `notifierStream` (the fan-out Writable), `resolvePrimaryDestination` (transport/TTY/file branch with `mkdir -p` and fail-fast on unwritable destinations). Redact paths are baked in at construction.
- `package.json` — add runtime deps: `pino` (current major version compatible with Node 24), `pino-pretty`.
- `src/utils/config.ts` — add `logging: { level, notifyLevel, pretty, file }` block to `paprikaConfigSchema`. Env-var mapping: `MCP_LOG_LEVEL`, `MCP_LOG_NOTIFY_LEVEL`, `MCP_LOG_PRETTY`, `MCP_LOG_FILE`. Update `PaprikaConfig` type export.
- `src/utils/CLAUDE.md` — rewrite the `log.ts` contract row for the pino-based API; add the `logging` block table to the `config.ts` contract; add `MCP_LOG_*` rows to the env-var mapping table.

**Dependencies:** None (first phase). The root `CLAUDE.md` "Dependency Policy" section was removed in a separate commit on this branch (`6d5dcc0`) before this design plan was committed, so the policy isn't violated transiently when `pino` and `pino-pretty` are added to `package.json` here.

**Done when:** `pnpm install` succeeds with new deps; `pnpm typecheck` clean; unit tests in `src/utils/log.test.ts` verify multistream wiring, per-stream level filtering, fan-out invocation gated on threshold, pino→MCP level mapping, redact rules applied to all configured paths, file-destination `mkdir -p` + fail-fast behavior. Covers ACs `structured-logging.AC1.1`–`AC1.4`, `AC2.1`–`AC2.7`, `AC10.1`–`AC10.4`, `AC11.1`–`AC11.2`.

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: AppContext + AuthContext threading; transport wiring

**Goal:** Thread the logger through `AppContext` and `AuthContext`, and wire transport entry-points to construct the logger between Notifier and McpServer.

**Components:**

- `src/server/app-context.ts` — add `readonly log: pino.Logger` to `AppContext`.
- `src/server/build.ts` — `buildAppContext(config, notifier)` constructs the logger via `createLogger({transport: config.transport, notifier, ...config.logging})` and stores it in the returned context. Threads it into `new PaprikaClient(email, password, log.child({component: "paprika-client"}))` and into `buildAuthContext(config, cache, log)`.
- `src/auth/build.ts` — `buildAuthContext(config, cache, appLog)` adds `log: { auth: appLog.child({component: "auth"}), oidcClient: appLog.child({component: "oidc-client"}) }` to the returned `AuthContext`.
- `src/paprika/client.ts` — `PaprikaClient` constructor gains optional `log?: pino.Logger` (defaults to a silent pino). Stored as `this.log`. No behavior changes yet — policy construction stays at module level; Phase 3 moves it.
- `src/transport/stdio.ts` — build notifier first, call `buildAppContext` (which builds the logger), then build McpServer. Pre-server startup logging uses the logger directly (which no-ops on fan-out until the server is set).
- `src/transport/http.ts` — same pattern.
- `src/server/CLAUDE.md` — add `log: pino.Logger` row to the `AppContext` field table; update the "Deferred-getter pattern" section to describe step 2 (logger construction).

**Dependencies:** Phase 1 (logger module exists).

**Done when:** `pnpm typecheck` clean; existing test suite still green (logger arg is optional, no test changes); stdio + http transports start successfully against a mock Paprika and an empty AuthContext; integration test confirms pre-server log calls don't crash (notifier getter returns `undefined` → silent no-op).

<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->

### Phase 3: Paprika client breaker reshape + per-attempt logging

**Goal:** Move resilience policies into the `PaprikaClient` constructor; reverse wrap order; replace synthetic 503 with `CircuitOpenError`; emit per-attempt telemetry via cockatiel hooks.

**Components:**

- `src/paprika/client.ts` — constructor builds `this.retryPolicy`, `this.breakerPolicy`, and `this.resilience = wrap(this.breakerPolicy, this.retryPolicy)` (reversed from today's `wrap(retryPolicy, breakerPolicy)`). Hooks attached: `this.retryPolicy.onRetry` (warn-level record), `onGiveUp` (error), `this.breakerPolicy.onBreak` (warn — fans out to MCP clients), `onReset` (info), `onHalfOpen` (info), all closing over `this.log`. The `request()` method's `execute` closure receives `IRetryContext` and uses `ctx.attempt`; per-attempt logging happens inside `execute` for the _response_ path (debug for ok, error for non-retryable HTTP, info for 401). Retry telemetry is fully delegated to cockatiel hooks.
- `src/paprika/errors.ts` — new `CircuitOpenError extends PaprikaError`.
- `src/paprika/client.ts` — both `BrokenCircuitError → PaprikaAPIError(503)` translations (today lines 270 and 293) replaced with `throw new CircuitOpenError(url, { cause: error })`.
- `src/paprika/client.test.ts` — update tests asserting on `PaprikaAPIError.status === 503` for circuit-open paths → assert on `CircuitOpenError`. Add tests for: per-attempt records on retry, breaker state-change hook records, Breaker A semantics (5 distinct tool calls trip the breaker; not 5 retry attempts of one call).
- `src/paprika/CLAUDE.md` — update the `request()` contract row (CircuitOpenError replaces synthetic 503); document the reversed wrap order; document the hook-based telemetry shape; document the new error class.

**Dependencies:** Phase 2 (`PaprikaClient` ctor accepts `log` arg).

**Done when:** `pnpm test` green; new tests cover ACs `structured-logging.AC3.1`–`AC3.7`, `AC4.1`–`AC4.3`, `AC5.1`–`AC5.5`, `AC6.1`–`AC6.3`. End-to-end test: a stub server returning 503 for 5 distinct requests must cause the 6th to throw `CircuitOpenError` with `onBreak` having fired exactly once.

<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->

### Phase 4: Migrate existing sites (sync engine, tools, transports, e2e harness)

**Goal:** Convert all existing `createLogger`-based call sites to the new pino-child shape; drop the `mcp-paprika:` prefix; delete duplicate logging shims.

**Components:**

- `src/paprika/sync.ts` — `SyncEngine` constructor stores `this.log = ctx.log.child({component: "sync"})`. Delete `SyncEngine._log` private method. Replace the two duplicate `this._context.notifier.loggingMessage(...)` calls with `this.log.info(...)` / `this.log.error(...)` (fan-out handles the MCP wire).
- `src/tools/pantry-add.ts`, `src/tools/pantry-update.ts`, `src/tools/pantry-delete.ts`, `src/tools/create.ts`, `src/tools/update.ts`, `src/tools/delete.ts` — move `createLogger(...)` from module top into the `register*Tool(server, ctx)` body. Component name = MCP tool name (`update_pantry_item`, `create_recipe`, etc.). All 6 tool catch sites use `log.error({...}, "...")`.
- `src/index.ts`, `src/transport/stdio.ts`, `src/transport/http.ts` — replace `createLogger("mcp-paprika")` with `log.child({component: "main"})` / `"transport-stdio"` / `"transport-http"` as appropriate (logger created in the transport entry-point per Phase 2).
- `src/e2e-server.ts` — same migration; uses a silent notifier (no-op `loggingMessage`) and `createLogger({transport: "stdio", notifier: silentNotifier, ...})`.
- `src/paprika/sync.test.integration.ts`, `src/tools/*.test.ts` — update assertions: tests previously asserting on `notifier.loggingMessage` directly switch to asserting on captured-stream records via a test-only Writable that captures pino JSON output.
- `src/tools/tool-test-utils.ts` — extend `makeStubNotifier()` (or add a new helper) to include a capture-stream factory for tests that exercise fan-out behavior.
- `src/paprika/CLAUDE.md` — update sync engine documentation to reflect `_log` deletion and fan-out behavior.
- `src/tools/CLAUDE.md` — note the new "create logger inside `register*Tool`" pattern.

**Dependencies:** Phase 2 (`ctx.log` exists). Phase 3 should land before this so `PaprikaClient` is already constructing per-instance policies — but the migration here is independent of the breaker reshape.

**Done when:** `pnpm test` green; `grep -rn 'createLogger\("mcp-paprika' src/ --include="*.ts"` (the old string-prefix form) returns zero hits; no `_log` shim remains in `sync.ts`; no module-top `createLogger` in tool files; tests cover ACs `structured-logging.AC7.1`–`AC7.3`, `AC8.1`–`AC8.4`.

<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->

### Phase 5: Auth subsystem instrumentation

**Goal:** Replace ad-hoc `process.stderr.write("[auth] ...")` writes; add per-attempt logging in the OIDC client; add OAuth state-transition info logs; add debug logs in silent auth catches.

**Components:**

- `src/auth/routes.ts` — 3 `process.stderr.write("[auth] ...")` sites (lines 109, 128, 168) replaced. Use the `oidcClient` logger for "upstream token exchange failed" and "id_token verification failed"; use the `auth` logger for the remaining route-handler errors. Add info-level state-transition logs at the appropriate points: client registered, token minted, token revoked, allowlist hit/miss.
- `src/auth/oidc-client.ts` — per-attempt logging on the `fetch()` at line 78 (used for discovery, JWKS, and token-exchange calls). Same shape as `paprika/client.ts`'s per-attempt logging (component `oidc-client`). Note: the OIDC client has no retry policy today, so `attempt` is always 1, `nextBackoffMs` is always 0; fields are included for consistency with the per-attempt schema.
- `src/auth/cleanup.ts` (L130, L135), `src/auth/dcr-validator.ts` (L66, L97), `src/auth/client-registration.ts` (L220) — debug-level logs in silent catches with structured fields (e.g., reason for DCR rejection, cleanup failure cause).
- `src/auth/CLAUDE.md` — update `AuthContext` contract row for the `log` field; document the per-attempt OIDC logging shape; document the OAuth state-transition records; note that auth instrumentation now flows through structured logging.

**Dependencies:** Phase 2 (`AuthContext.log` exists).

**Done when:** `pnpm test` green; `grep -rn 'process.stderr.write."\[auth\]"' src/auth/` returns no production sources; OIDC failure paths emit structured records visible in test capture; OAuth state-transition records emitted on register / mint / revoke flows. Covers ACs `structured-logging.AC8.4` (no `[auth]` prefix), `AC9.6` (OAuth state transitions).

<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->

### Phase 6: Catch-block audit and new instrumentation (cache, vector-store, embeddings, discover, HTTP access log)

**Goal:** Fill previously-silent layers with structured records on failure paths; add HTTP access-log middleware.

**Components:**

- `src/cache/disk-cache.ts` — audit 5 catch sites (L84, L95, L300, L325, L360). Classify per-site: "expected cold-start file-not-found (silent)" vs. "true I/O failure (warn or error)". Add `disk-cache` component logger threaded via optional `log?` constructor arg on `DiskCache`.
- `src/features/vector-store.ts` — audit ~8 catch sites; same classification. Add `vector-store` component logger.
- `src/features/embeddings.ts` — per-attempt logging on the `fetch()` at L127. Component `embeddings`. As with oidc-client, no retry policy yet so `attempt` is always 1; fields present for consistency.
- `src/features/discover-feature.ts` — error-level log at L75 for sync-driven re-index failure. Component `discover`.
- `src/transport/http.ts` — Hono middleware `accessLog(log)`: captures `t0 = performance.now()`, awaits `next()`, logs `{method, path, status, durationMs}` at info; status ≥ 500 logged at error (fans out to MCP clients). Wired via `app.use("*", accessLog(log.child({component: "transport-http"})))` in `startHttp`. Sample shape: see Architecture's contract block.
- `src/cache/CLAUDE.md` — note the `disk-cache` component logger; document the per-site catch classification.
- `src/features/CLAUDE.md` — note `vector-store`, `embeddings`, `discover` component loggers.

**Dependencies:** Phase 2 (`ctx.log` exists, which parents all these child loggers).

**Done when:** `pnpm test` green; existing tests for these modules pass with the addition of optional `log?` constructor args (silent default); new tests verify failure-path records (e.g., disk-write failure → error record); HTTP access-log middleware test asserts one record per request and the 5xx → error upgrade. Covers ACs `structured-logging.AC9.1`–`AC9.5`.

<!-- END_PHASE_6 -->

## Additional Considerations

**Documents to Update** (per `.ed3d/design-plan-guidance.md` #2):

The root `CLAUDE.md` "Dependency Policy" deletion has already landed on this branch in commit `6d5dcc0` and is not listed below.

| CLAUDE.md file           | Change                                                                                                                                                                                                                                                              | Phase |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `src/utils/CLAUDE.md`    | Rewrite `log.ts` contract for pino-based API; add `logging` block to `config.ts` contract with env-var mapping table; add `MCP_LOG_*` env vars                                                                                                                      | 1     |
| `src/server/CLAUDE.md`   | Add `log: pino.Logger` to `AppContext` field table; update bootstrap order to insert step 2                                                                                                                                                                         | 2     |
| `src/paprika/CLAUDE.md`  | Update `request()` contract: `CircuitOpenError` replaces synthetic 503; document reverse wrap order; document `onRetry`/`onGiveUp`/`onBreak`/`onReset`/`onHalfOpen` hook semantics; describe per-attempt logging shape; update sync engine docs for `_log` deletion | 3, 4  |
| `src/tools/CLAUDE.md`    | Note tool registration now creates child logger inside `register*Tool` (vs. module top)                                                                                                                                                                             | 4     |
| `src/auth/CLAUDE.md`     | Add `log: { auth, oidcClient }` to `AuthContext`; document per-attempt OIDC logging; document OAuth state transitions                                                                                                                                               | 5     |
| `src/cache/CLAUDE.md`    | Note `disk-cache` component logger; document catch-site classification per audit                                                                                                                                                                                    | 6     |
| `src/features/CLAUDE.md` | Note `vector-store`, `embeddings`, `discover` component loggers                                                                                                                                                                                                     | 6     |

**Fire-and-forget fan-out semantics:** The MCP-notifier fan-out is fire-and-forget by design. Pino's `multistream` Writable contract is synchronous — `_write(chunk, encoding, callback)` calls `callback()` immediately, regardless of whether `notifier.loggingMessage()` resolves or rejects. The existing notifier implementations (`singleServerNotifier`, `broadcastNotifier`) already swallow `sendLoggingMessage` failures silently to preserve `SyncEngine.syncOnce()`'s never-throws contract. The design preserves this: future maintainers must NOT add `await notifier.loggingMessage(...)` inside the pino stream `_write` callback, because that would (a) violate the Writable contract by deferring `callback()` until the network round-trip completes, slowing every `warn+` log call, and (b) propagate fan-out failures to the originating `log.warn(...)` call site.

**UX latency tradeoff with reverse wrap order:** Today (before Breaker A), the breaker opens fast — roughly 2 failing tool calls × 3 attempts = 6 ticks > the 5-threshold, after which subsequent calls short-circuit in ~1ms. Fast pain, fast recovery. After Breaker A, the breaker opens after 5 failing _tool calls_. Each can take up to 3 attempts × the per-attempt timeout — potentially tens of seconds. So 5 failing tool calls × ~15s per call ≈ 75 seconds of slow failures before short-circuiting kicks in. **This is the right tradeoff for the design's purpose** (stop fabricating "HTTP 503" surfaces; let operators see the truth), but it's a real UX regression in the rare sustained-outage case. Recorded here so the decision is visible, not stumbled upon later.

**Tool-error duplication on the MCP wire (intentional):** When a tool fails, the MCP client receives both the tool's `textResult` (the LLM sees the error in its tool-call output) AND a `notifications/message` fan-out at error level (structured record the LLM can correlate). Both surfaces are intentional: the `textResult` is the natural Claude UX for "this tool call failed and here's why"; the `notifications/message` is the structured-fields equivalent that lets the LLM reason about whether to retry (e.g., differentiating a network failure from an application-level error). Operators see only the structured fan-out in pod logs.

**Pino multistream level constraint:** With pino's `multistream`, the root pino `level` must be at least as permissive as the _lowest_ per-stream level. In our case: primary stream's level is `config.logging.level` (default `info`); fan-out stream's level is `config.logging.notifyLevel` (default `warn`). Root pino level is computed as the minimum of the two. Practically: if a user sets `MCP_LOG_LEVEL=warn` and `MCP_LOG_NOTIFY_LEVEL=info`, the root pino level is `info`, which means the primary stream receives info records (its per-stream `level: "warn"` filters them out — slightly wasteful but correct). Worth noting; not a behavior bug.

**Pino redact wildcard limitation:** Pino's `redact.paths` supports `*.<key>` wildcards matching any key literally named `<key>` at any nesting depth, and supports patterns with up to 2 wildcards (e.g., `*.*.token`). Patterns with 3+ consecutive wildcards (`*.*.*.token`) are known not to work reliably in current pino versions. Our redact paths (`*.authorization`, `*.password`, `*.token`, `*.client_secret`, `*.access_token`, `*.refresh_token`, `*.id_token`) all use a single leading wildcard, well within the supported range.

**File rotation as known limitation:** The stdio non-TTY file destination is a single growing file. Pino offers `pino-roll` for built-in size/time-based rotation, but we're not adopting it in this design — the growth rate is bounded by sync interval (~15 min/cycle) plus tool invocations, putting steady-state at perhaps 1-10 MB/month. Users who need rotation can configure it externally via `logrotate` (Linux), `newsyslog` (macOS), or `launchctl` for the macOS LaunchAgent case. If file size becomes a real problem, `pino-roll` is a small follow-up — it slots into the same `pino.destination` slot.

**Future direction — correlation IDs:** Not in scope for this design, but worth recording: a future request-scoped child logger pattern would let one HTTP request's downstream Paprika / OIDC / embeddings calls all share a `correlationId` field. The HTTP access log middleware would mint the ID at request entry, attach it to a request-scoped child logger via `ctx.set('log', log.child({correlationId}))`, and downstream code would read from `ctx.get('log')` instead of `ctx.log` directly. Requires hono context plumbing that doesn't exist today. Mentioned here so a future maintainer doesn't reinvent it from scratch.
