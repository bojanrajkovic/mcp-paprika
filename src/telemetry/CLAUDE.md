# Telemetry Substrate

Last verified: 2026-06-06

## Purpose

The OpenTelemetry substrate every instrumented seam records through: the opt-in dual-path bootstrap (`bootstrap.ts` + `sdk.ts`), the single instrumentation scope, instrument memoization, and the seconds timer (`scope.ts`), the vendored Development-status semconv constants (`semconv.ts`), the shared spec-named instruments (`instruments.ts`), the operation lifecycle (`trace-result.ts`: `startOperation` — span + duration + latched exactly-once `end()` — with `traceResultAsync` as its Result-rail adapter), and the resilience-hook metric wiring (`resilience.ts`). **Recording lives at the seams** (the kernel tool/resource wrappers, the sync driver, the clients, the notifier) — this directory only provides the shared vocabulary and lifecycle.

## Key References

- **[ADR-0018](../../docs/adr/0018-opentelemetry-instrumentation.md)** — the canonical decisions: global API over `Infra` threading, the `--import`/first-import dual bootstrap, vendored conventions. Read it before changing the shape.
- **`docs/telemetry.md`** — the operator guide: enabling, what comes out, the local Grafana/collector stand-up, stdio session semantics.
- Source is the catalog: every custom metric name is `rg '"mcp_paprika\.' src`; spec-named instruments live in `instruments.ts` + `semconv.ts`. Histograms export exponential (no bucket advice anywhere — the `aggregationPreference` selector in `sdk.ts` is the single switch).

## Sharp edges

- **Never create an instrument at module scope.** The metrics API has no late-binding proxy (unlike tracers): an instrument created before the SDK registers the global MeterProvider is a no-op FOREVER. Use `lazy()` from `scope.ts` — first record always lands after SDK start in production, and tests install their provider at module scope before exercising a seam (`test/support/telemetry-test-utils.ts`'s doc-comment).
- **Nothing in the export path may touch stdout** — it is the stdio MCP wire. OTLP-only exporters; the diag logger writes to stderr (`sdk.ts` consumes `OTEL_LOG_LEVEL` _and deletes it_ so the NodeSDK can't install its stdout console logger). Never add a console exporter, even behind a flag. The diag logger's `process.stderr.write` is the third documented exception alongside `src/index.ts` and `src/transport/stdio.ts`.
- **`bootstrap.ts` must stay `src/index.ts`'s FIRST static import**, and the Dockerfile CMD must keep preloading it via `--import`. The two paths are idempotent through ESM module caching; only the `--import` path makes the ESM loader hook effective, so **a module-patching instrumentation added to `sdk.ts` silently does nothing under the npm-bin/stdio path** — catch that in review (ADR-0018 records the trade).
- **`semconv.ts` is vendored on purpose** — the package's `incubating` entry point breaks in minor versions. The MCP/GenAI conventions are Development-status (pinned at spec v1.39.0): when they stabilize, this file is the single rename site. Custom names take the `mcp_paprika.` prefix; never coin new `mcp.*`/`gen_ai.*` names the spec doesn't define.
- **Attribute discipline is stricter than the logs**: enum- or name-class values only (tool names, entity names, outcome enums). No UIDs, URIs, free text, emails, subs, or token material on any attribute WE set — the `REDACT_PATHS` key list is the reference for what must never appear. The conformance test (`test/conformance/telemetry-attributes.test.ts`) gates the custom-attribute namespace. URL attributes the AUTO-instrumentations set themselves (`url.full`, `url.query`) are scrubbed at the trace-exporter chokepoint (`url-scrub.ts` — neither library offers a sanitization hook); a new instrumentation inherits the scrub for free, but a NEW URL-shaped attribute key needs adding to `URL_ATTRIBUTE_KEYS` there.
- **Telemetry must never alter behavior.** `traceResultAsync` passes both Result arms through unchanged; the tool/resource wrappers are throw-transparent (their rethrows are pinned in the ADR-0014 conformance gate); recording inside never-throws contracts (notifier, index events) relies on OTel API calls not throwing — don't wrap recording in logic that can.
