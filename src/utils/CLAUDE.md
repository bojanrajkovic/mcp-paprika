# Cross-Cutting Utilities

Last verified: 2026-06-03

## Purpose

Shared leaf-ish utilities used across every `src/` module: config loading, the process-wide logger, Paprika wire-date helpers, the shared resilience executor, XDG path resolution, duration parsing, and cross-domain error classes.

## Key References

- **Config schema + every env-var mapping** — `docs/configuration.md` (core/sync/logging), `docs/http-transport.md` and `docs/oauth-configuration.md` (the HTTP + OAuth specifics), all operator-facing, plus `src/utils/config.ts` (the Zod schema is the source of truth). The schema's `.superRefine`s carry their own rationale comments (OAuth-required-when-http, image-gen exactly-one-credential-path).
- **Resilience / logging as cross-cutting concerns** — `docs/architecture.md` ("Cross-cutting concerns"); tuning numbers are config, not prose; see `docs/configuration.md` + `src/utils/resilience.ts`.
- **Logger bootstrap ordering** (notifier built first around a deferred getter) — `src/server/CLAUDE.md`.
- **Wire-date format origin** — `docs/wire-format.md`; meal-at-midnight storage confirmed by `docs/wire-captures/meals.har.json`.
- Source: `config.ts`, `log.ts`, `dates.ts`, `resilience.ts`, `xdg.ts`, `duration.ts`, `errors.ts`.

## Sharp edges

**`dates.ts` two-axis naming, and why calendar days survive a UTC boundary.** A helper's name answers two questions: its _return type_ (`parse*` → `DateTime | null` for comparison/arithmetic; `format*`/`today*`/`normalize*` → a wire `string`) and its _semantics_ (`*Instant*` models a UTC moment; `*CalendarDay*` models a day on the user's calendar). The calendar-day variants honor an embedded ISO offset and render in the input's _own_ zone, so a US-Pacific "June 15, 10 PM" stays June 15 instead of rolling to June 16 when naively converted to UTC. That is the entire reason meal-date helpers (`plan_meals`/`update_meal`) route through `parseCalendarDayWire`, while `parseInstant` (the `*Instant*` axis) handles UTC-anchored window/ordering comparisons (where UTC ordering is what you want). `normalizeWire` is the one branch that preserves time-of-day (already-wire input returned verbatim), so a round-tripped pantry timestamp is unchanged. This module absorbed the former `src/paprika/dates.ts` so exactly one place owns "produce a Paprika wire date string."

**`xdg.ts` re-implements the XDG override on every platform (including macOS) on purpose.** `env-paths`' macOS branch hard-codes `~/Library/{Preferences,Caches,…}` and ignores `XDG_*` entirely. Re-reading `XDG_CONFIG_HOME` / `XDG_CACHE_HOME` / `XDG_DATA_HOME` / `XDG_STATE_HOME` here means tests that set those vars actually redirect on macOS, not just Linux. Consequence: these functions read `process.env` on every call, so they are _not_ pure leaf functions. `getTempDir()` deliberately does **not** honor an override; temp paths come from the OS regardless.

**The logger contract.** `createLogger` is called _exactly once_ per process (by `buildAppContext`); components get children via `parent.child({ component: "<flat-name>" })`. Two things are baked in at construction and apply to both output streams: credential redaction (the `REDACT_PATHS` list; import that constant in tests rather than maintaining a parallel one) and a notifier fan-out where records at or above `notifyLevel` (default `warn`) are forwarded to connected MCP clients via `notifier.loggingMessage(...)`, fire-and-forget. **In stdio mode stdout _is_ the MCP wire format**, so nothing may log to stdout; the logger routes to stderr (TTY) or a file (non-TTY); HTTP mode emits raw JSON to stdout. The `no-console` oxlint rule enforces the stdout ban. The Zod schema deliberately excludes `"silent"` from the operator-facing level enums so production logging can't be disabled via env var (the `"silent"` level is reachable only by constructing `LoggerOptions` directly, which the e2e harness does).

**`SILENT_LOG` is the canonical optional-logger default.** Use it as the fallback for any optional `log?: Logger` parameter rather than scattering `pino({ level: "silent" })` calls. Pino's silent level short-circuits every method to a no-op, so the single shared instance is safe across modules (production callers fall back to it when no logger is threaded; tests import it).

**Resilience policies are per-instance; no shared breaker state between clients.** `createResilientExecutor` builds the retry + circuit-breaker stack fresh per instance, so a breaker tripping in one client (or one test) never leaks into another. The breaker wraps the retry, so it counts one failure per `execute()` call regardless of internal retries. `PaprikaClient` deliberately keeps its _own_ bespoke stack, layering undici-network-error and 401 token-refresh retries on top; those would leak provider-specific concerns into this shared abstraction. Adding a new resilient client means extending the `CircuitService` union in `errors.ts`; the compile error forces a deliberate decision rather than letting a typo through.
