# Telemetry

Last verified: 2026-06-06

mcp-paprika emits OpenTelemetry **traces and metrics**, off by default and opt-in by configuring an OTLP destination. The design decisions (global-API recording, the dual-path bootstrap, vendored Development-status conventions) are recorded in [ADR-0018](adr/0018-opentelemetry-instrumentation.md); this page is the operator's view: how to turn it on, what comes out, and how to stand up a local stack to look at it.

## Enabling

Telemetry activates when any standard OTLP endpoint variable is set (and `OTEL_SDK_DISABLED` is not `"true"`):

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318   # OTLP over HTTP; /v1/traces + /v1/metrics appended per signal
```

With no endpoint configured, the SDK is never even imported — the process pays one env read, and every instrumented seam talks to the OTel API's no-op singletons.

All other tuning rides the [standard OTel environment variables](https://opentelemetry.io/docs/languages/sdk-configuration/) (`OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_METRIC_EXPORT_INTERVAL`, `OTEL_RESOURCE_ATTRIBUTES`, …) — none of this is mirrored into the server's own Zod config. These can live in the same XDG-config `.env` file the rest of the configuration uses (the bootstrap loads it before the gate check; see `docs/configuration.md` § ".env file"). Two deliberate deviations from stock SDK behavior, both for the stdio wire:

- **`OTEL_LOG_LEVEL` routes diag output to stderr**, never the SDK's console logger (whose info/debug levels write to stdout — the MCP protocol wire in stdio mode). Default diag level is `error`, so a dead collector is visible without being chatty.
- **No console exporters exist**, even behind flags. Export is OTLP/HTTP only; to eyeball telemetry locally, run a collector with a debug exporter (below).

## How it loads (the two bootstrap paths)

One bootstrap module (`src/telemetry/bootstrap.ts`), loaded two ways:

- **Container / HTTP**: the image CMD preloads it with `node --import`, which evaluates the telemetry graph _before_ the application graph resolves — this is what makes the OTel ESM loader hook effective, giving headroom for any future module-patching instrumentation.
- **npm bin / stdio**: `src/index.ts` declares it as its first static import. A bin script cannot carry node flags, and nothing currently configured needs module patching (the undici and runtime instrumentations are diagnostics_channel/perf-hooks based), so the two paths emit identical telemetry today.

## What comes out

**Traces.** Spans follow the OTel [MCP](https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/) and [GenAI](https://opentelemetry.io/docs/specs/semconv/gen-ai/) semantic conventions (pinned at spec v1.39.0 — both families are **Development** stability, so a rename pass is expected when they stabilize; the vendored constants in `src/telemetry/semconv.ts` are the single rename site). The trace shape, by seam:

- `tools/call {tool}` and `resources/read` spans at the kernel chokepoints, with `mcp.method.name` / `gen_ai.tool.name` attributes and outcome classing on `error.type` (`tool_error`, `precondition_gated`, protocol error-code names). SDK-internal listing operations (`initialize`, `tools/list`, …) are not instrumented — the MCP TypeScript SDK exposes no interceptor seam.
- Under HTTP, request SERVER spans from the `@hono/otel` middleware (probe paths and the long-lived `GET /mcp` SSE stream excluded), with incoming `traceparent` extraction; tool spans parent under them.
- `paprika.sync_cycle` root spans per sync cycle with per-domain `paprika.sync.reconcile` children and outcome/changes attributes; the boot-time cycle parents under the `mcp_paprika.boot` trace (construction → initial sync → boot phases, one child per module build).
- `paprika.{entity}` logical spans per Paprika API operation — covering retries, backoff, and 401 re-auth — with per-attempt HTTP CLIENT spans from the undici instrumentation nested inside.
- `embeddings {model}` / `generate_content {model}` GenAI CLIENT spans, and `discover.reindex` / `discover.query` around the vector pipeline.
- Every upstream OIDC call in the OAuth flow appears as an undici CLIENT span under its route's request span.

**Metrics.** Spec-named instruments where the conventions define them — `mcp.server.operation.duration`, `mcp.server.session.duration`, `gen_ai.client.operation.duration`, `gen_ai.client.token.usage`, `http.server.request.duration` — and `mcp_paprika.*`-prefixed instruments for everything the spec doesn't cover: sync cycles and changes, resilience (retries/giveups/breaker state/bulkhead), cache flush/hydrate, notification and index-event outcomes (the two seams that swallow errors by contract), auth decision points, image-generation cost, vector-index size, and SSRF-guard rejections. The source is the inventory: `rg '"mcp_paprika\.' src` lists every custom name, and `src/telemetry/semconv.ts` + `src/telemetry/instruments.ts` carry the spec-named ones.

**Logs** are _not_ exported via OTLP; pino stays the logging pipeline. Every record emitted inside an active span carries `trace_id`/`span_id` (a pino mixin), so log↔trace pivoting works in both directions.

**Attribute discipline.** Metric attributes are enum- or name-class values only — tool names, entity names, outcome enums. No UIDs, URIs, free text, emails, subjects, or token material appears in any span or metric attribute; identity and payload detail stay in the (redacted) logs.

## Session semantics on stdio

The MCP semconv leaves stdio session boundaries open. This server's answer: **one stdio session = the process lifetime**, recorded to `mcp.server.session.duration {mcp_paprika.transport="stdio"}` once at graceful shutdown. Under HTTP, sessions are the Streamable-HTTP sessions (initialize → close/eviction), with `mcp_paprika.sessions.active` as the live gauge.

## Local testing setup

The quickest full stack is Grafana's all-in-one [otel-lgtm](https://github.com/grafana/docker-otel-lgtm) image (OTLP collector + Tempo + Loki + Mimir + Grafana):

```bash
docker run --rm -p 3001:3000 -p 4317:4317 -p 4318:4318 grafana/otel-lgtm
```

Then run the server against it (any transport):

```bash
# stdio (first-import path), straight from the repo:
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_METRIC_EXPORT_INTERVAL=5000 \
PAPRIKA_EMAIL=… PAPRIKA_PASSWORD=… pnpm dev

# container (--import + loader-hook path):
docker run --rm -p 3000:3000 \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318 \
  -e PAPRIKA_EMAIL=… -e PAPRIKA_PASSWORD=… \
  ghcr.io/bojanrajkovic/mcp-paprika:<tag>
```

Open Grafana at `http://localhost:3001` (anonymous admin). What to look for:

- **Tempo → Search**: an `mcp_paprika.boot` trace from startup (module builds + the boot sync cycle nested under it), then a `paprika.sync_cycle` trace per interval with `paprika.{entity}` + undici fetch children — the recipe diff-and-fetch reads as one list call plus N detail fetches.
- Drive a tool call (e.g. `list_recipes` from MCP Inspector or Claude) and find its `tools/call …` span; under HTTP it nests inside the `POST /mcp` request span.
- **Drilldown → Metrics**: `mcp_server_operation_duration_*` and the `mcp_paprika_*` families appear after the first export interval.

For a bare-bones look without Grafana, run an OTel Collector with the debug exporter and watch its stdout:

```yaml
# collector.yaml
receivers: { otlp: { protocols: { http: { endpoint: 0.0.0.0:4318 } } } }
exporters: { debug: { verbosity: detailed } }
service:
  pipelines:
    traces: { receivers: [otlp], exporters: [debug] }
    metrics: { receivers: [otlp], exporters: [debug] }
```

```bash
docker run --rm -p 4318:4318 -v $PWD/collector.yaml:/etc/otelcol-contrib/config.yaml \
  otel/opentelemetry-collector-contrib
```

Never point the server's own output at stdout for this — in stdio mode stdout is the MCP wire; the collector is the only safe place to dump telemetry for inspection.

## Kubernetes

The `k8s/` kustomization carries a commented `OTEL_EXPORTER_OTLP_ENDPOINT` block in `30-deployment.yaml`; uncomment and point it at the cluster's collector. The deployment needs no other change — the image's CMD already preloads the bootstrap, and the shutdown path flushes telemetry inside the existing drain window so final session metrics survive a rolling restart.
