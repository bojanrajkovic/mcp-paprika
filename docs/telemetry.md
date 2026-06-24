# Telemetry

mcp-paprika emits OpenTelemetry **traces and metrics**, off by default and opt-in by configuring an OTLP destination. The design decisions (global-API recording, the dual-path bootstrap, vendored Development-status conventions) are recorded in [ADR-0018](https://github.com/bojanrajkovic/mcp-paprika/blob/main/docs/adr/0018-opentelemetry-instrumentation.md); this page is the operator's view: how to turn it on, what comes out, and how to stand up a local stack to look at it.

## Enabling

Telemetry activates when any standard OTLP endpoint variable is set (and `OTEL_SDK_DISABLED` is not `"true"`):

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318   # OTLP over HTTP; /v1/traces + /v1/metrics appended per signal
```

With no endpoint configured, the SDK is never even imported — the process pays one env read, and every instrumented seam talks to the OTel API's no-op singletons.

Signals gate individually past that: each exports only when its own endpoint is configured (the general endpoint, or the signal-specific `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `…_METRICS_ENDPOINT`), and the standard `OTEL_TRACES_EXPORTER=none` / `OTEL_METRICS_EXPORTER=none` opt-outs are honored — so a metrics-only configuration never points a trace exporter at the localhost default.

All other tuning rides the [standard OTel environment variables](https://opentelemetry.io/docs/languages/sdk-configuration/) (`OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_METRIC_EXPORT_INTERVAL`, `OTEL_RESOURCE_ATTRIBUTES`, …) — none of this is mirrored into the server's own Zod config. These can live in the same XDG-config `.env` file the rest of the configuration uses (the bootstrap loads it before the gate check; see `docs/configuration.md` § ".env file"). Two deliberate deviations from stock SDK behavior, both for the stdio wire:

- **`OTEL_LOG_LEVEL` routes diag output to stderr**, never the SDK's console logger (whose info/debug levels write to stdout — the MCP protocol wire in stdio mode). Default diag level is `error`, so a dead collector is visible without being chatty.
- **No console exporters exist**, even behind flags. Export is OTLP/HTTP only; to eyeball telemetry locally, run a collector with a debug exporter (below).

## How it loads (the two bootstrap paths)

One bootstrap module (`src/telemetry/bootstrap.ts`), loaded two ways:

- **Container / HTTP**: the image CMD preloads it with `node --import`, which evaluates the telemetry graph _before_ the application graph resolves — this is what makes the OTel ESM loader hook effective, giving headroom for any future module-patching instrumentation.
- **npm bin / stdio**: `src/index.ts` declares it as its first static import. A bin script cannot carry node flags, and nothing currently configured needs module patching (the undici and runtime instrumentations are diagnostics_channel/perf-hooks based), so the two paths emit identical telemetry today.

## What comes out

**Traces.** Spans follow the OTel [MCP](https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/) and [GenAI](https://opentelemetry.io/docs/specs/semconv/gen-ai/) semantic conventions (pinned at spec v1.39.0 — both families are **Development** stability, so a rename pass is expected when they stabilize; the vendored constants in `src/telemetry/semconv.ts` are the single rename site). The trace shape, by seam:

- `tools/call {tool}` and `resources/read` spans at the kernel chokepoints, with `mcp.method.name` / `gen_ai.tool.name` attributes and outcome classing on `error.type` (`tool_error`, `precondition_gated`, protocol error-code names). Each `tools/call` span is also tagged with the connecting client's census slice (`mcp_paprika.client.name` / `…version_major` / `mcp_paprika.transport`) and a `mcp_paprika.tool.structured_output` boolean (whether the result carried `structuredContent`) — so the structured-output channel is sliceable by host. SDK-internal listing operations (`initialize`, `tools/list`, …) are not instrumented — the MCP TypeScript SDK exposes no interceptor seam.
- `mcp_paprika.client.connect` spans at the `initialize` handshake (one per session, both transports), carrying the full connection fingerprint as attributes — see "Connection fingerprint" below.
- Under HTTP, request SERVER spans from the `@hono/otel` middleware (probe paths and the long-lived `GET /mcp` SSE stream excluded); tool spans parent under them. Each `POST /mcp` is a **new root** — `OTEL_PROPAGATORS=none` disables inbound `traceparent` adoption, because the MCP clients (ChatGPT, Claude) send trace context but export to their own backends, so joining their trace would leave every trace rooted in a span this collector never receives.
- `paprika.sync_cycle` root spans per sync cycle with per-domain `paprika.sync.reconcile` children and outcome/changes attributes; the boot-time cycle parents under the `mcp_paprika.boot` trace (construction → initial sync → boot phases, one child per module build).
- `paprika.{entity}` logical spans per Paprika API operation — covering retries, backoff, and 401 re-auth — with per-attempt HTTP CLIENT spans from the undici instrumentation nested inside.
- `embeddings {model}` / `generate_content {model}` GenAI CLIENT spans, and `discover.reindex` / `discover.query` around the vector pipeline.
- Every upstream OIDC call in the OAuth flow appears as an undici CLIENT span under its route's request span.

**Metrics.** Spec-named instruments where the conventions define them — `mcp.server.operation.duration`, `mcp.server.session.duration`, `gen_ai.client.operation.duration`, `gen_ai.client.token.usage`, `http.server.request.duration` — and `mcp_paprika.*`-prefixed instruments for everything the spec doesn't cover: the client-connection census (`mcp_paprika.client.connections`, see "Connection fingerprint" below), sync cycles and changes, resilience (retries/giveups/breaker state/bulkhead), cache flush/hydrate, notification and index-event outcomes (the two seams that swallow errors by contract), auth decision points, image-generation cost, vector-index size, and SSRF-guard rejections. The source is the inventory: `rg '"mcp_paprika\.' src` lists every custom name, and `src/telemetry/semconv.ts` + `src/telemetry/instruments.ts` carry the spec-named ones.

Every histogram exports as a **base2 exponential histogram** (Prometheus/Mimir "native histograms") rather than the semconv specs' advisory explicit buckets — automatic bucketing at better resolution than any hand-picked boundary set. The trade: the pipeline must support native histograms end-to-end. The LGTM stack (and the otel-lgtm image below) does; a plain Prometheus needs `--enable-feature=native-histograms`, and a pipeline that can't ingest them needs a collector-side conversion or a code change in `src/telemetry/sdk.ts` (the `aggregationPreference` selector is the single switch).

**Logs** are _not_ exported via OTLP; pino stays the logging pipeline. Every record emitted inside an active span carries `trace_id`/`span_id` (a pino mixin), so log↔trace pivoting works in both directions. The connection-lifecycle and per-call seams log alongside their spans/metrics: `mcp client connected` (info, the full fingerprint) and `mcp client disconnected` (info, client + session duration) per session on both transports; `tool completed` (info, `{tool, structuredOutput, isError}`) closing every `tool invoked`; and `sync cycle complete` (info on a change-bearing cycle, debug on a clean no-op) closing the otherwise-silent interval loop.

## Connection fingerprint

At the MCP `initialize` handshake, each session's client fingerprint is captured on every channel — a span, a counter, and a log — so the live client population (and how it consumes the structured-output channel) is observable without guesswork. The fingerprint is the MCP **client app's** self-reported identity and capabilities, never the OAuth user: no token or PII rides on it, and the HTTP transport's OAuth context contributes nothing here.

**`mcp_paprika.client.connect` span** (point-in-time, opened and closed at the handshake — not a session-lifetime span, which would never export until close). Attributes:

| Attribute                                 | Example                      | Notes                                                             |
| ----------------------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| `mcp_paprika.client.name`                 | `claude-ai`, `Claude Code`   | client app name                                                   |
| `mcp_paprika.client.version`              | `1.4.2`                      | full version (span only)                                          |
| `mcp_paprika.client.version_major`        | `1`                          | bucketed version (the metric dimension)                           |
| `mcp_paprika.client.title`                | `Claude`                     | when advertised                                                   |
| `mcp_paprika.client.protocol_version`     | `2025-06-18`                 | the protocol version the client requested                         |
| `mcp_paprika.transport`                   | `stdio` \| `http`            | shared transport dimension                                        |
| `mcp_paprika.client.cap.roots`            | `true`                       | advertised `roots` capability                                     |
| `mcp_paprika.client.cap.sampling`         | `false`                      | advertised `sampling` capability                                  |
| `mcp_paprika.client.cap.elicitation`      | `true`                       | advertised `elicitation` capability                               |
| `mcp_paprika.client.cap.elicitation_form` | `true`                       | form-mode (the confirm/pick gates read this)                      |
| `mcp_paprika.client.cap.ui`               | `true`                       | the apps/widget axis — the `io.modelcontextprotocol/ui` extension |
| `mcp_paprika.client.cap.ui_mime_types`    | `text/html;profile=mcp-app`  | the UI extension's rendered MIME types, comma-joined (span only)  |
| `mcp_paprika.client.cap.extensions`       | `io.modelcontextprotocol/ui` | sorted, comma-joined `extensions` keys (span only)                |
| `mcp_paprika.client.cap.experimental`     | `…`                          | sorted, comma-joined `experimental` keys (span only)              |

The **log** (`mcp client connected`) additionally carries the **entire raw `capabilities` tree verbatim** under `client.capabilities` — the future-proof record, and the only place the apps/widget capability is visible whole. It must come from the raw initialize params, because the SDK's `ClientCapabilities` schema **strips** every key it does not model (`roots`/`sampling`/`elicitation`/`experimental`) — including the top-level `extensions` map where `io.modelcontextprotocol/ui` (with its `mimeTypes`) lives. So a host that supports widgets (Claude Desktop, claude-ai) shows `cap.ui=true` here even though `getClientCapabilities()` would report nothing.

**`mcp_paprika.client.connections` counter** — one per connection, labeled only by the cardinality-bounded census slice: `mcp_paprika.client.name`, `mcp_paprika.client.version_major`, `mcp_paprika.transport`. The same slice labels the `mcp.server.session.duration` histogram and tags every `tools/call` span.

Example queries (PromQL against the LGTM stack; counters export with a `_total` suffix):

```promql
# Live client population — connections by client + transport
sum by (mcp_paprika_client_name, mcp_paprika_transport) (mcp_paprika_client_connections_total)

# Adoption of the structured-output channel, sliced by client (TraceQL, Tempo)
{ name =~ "tools/call.*" && span.mcp_paprika.tool.structured_output = true } | count by (span.mcp_paprika.client.name)
```

**Behavior is not in the handshake.** The capabilities tell you what a client _advertises_, not whether it forwards `structuredContent` to its model — the MCP capability set has no such flag. That behavior is established empirically (a host's actual forwarding, observed on the live surface) and maintained as an identity→behavior matrix, not derived from the fingerprint.

**Attribute discipline.** Metric attributes are enum- or name-class values only — tool names, entity names, outcome enums. Attributes this server sets carry no UIDs, URIs, free text, emails, subjects, or token material; identity and payload detail stay in the (redacted) logs. The auto-instrumented HTTP spans (request middleware, undici) record URLs the libraries set themselves, so every span passes through a URL scrub at the trace exporter (`src/telemetry/url-scrub.ts`): queries (OAuth codes/state, presigned credentials), fragments, and userinfo never leave the process; origin + path survive. Path-embedded identifiers are accepted span-level detail in both directions — an outbound sync path's entity UID, and inbound the RFC 7592 `/register/{clientId}` client id (a public identifier per RFC 6749 §2.2, not a secret). Everything that actually needs protecting rides in the query, fragment, or userinfo, which is why the scrub draws the line there.

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

The `k8s/` kustomization sets `OTEL_EXPORTER_OTLP_ENDPOINT` (the cluster's Grafana Alloy collector) + `OTEL_SERVICE_NAME` + the downward-API resource attributes in `30-deployment.yaml`, so the deployment exports out of the box; repoint the endpoint for a different cluster. The deployment needs no other change — the image's CMD already preloads the bootstrap, and the shutdown path flushes telemetry inside the existing drain window so final session metrics survive a rolling restart. The flush is bounded (5s; see `SHUTDOWN_FLUSH_TIMEOUT_MS` in `src/telemetry/bootstrap.ts`): against an unreachable collector the final export is abandoned with a stderr note rather than holding termination into the SIGKILL.

**Pod identity on resources.** The SDK's container detector reads `container.id` from `/proc/self/cgroup`, which frequently comes up empty on cgroup-v2 hosts — don't rely on it for identity. The same manifest block sets downward-API env vars that feed `k8s.pod.name` / `k8s.namespace.name` / `k8s.pod.uid` / `k8s.node.name` / `k8s.deployment.name` through `OTEL_RESOURCE_ATTRIBUTES`, which the SDK's env detector reads natively — zero app support needed. (The alternative, a collector-side `k8sattributes` processor enriching by pod IP, also works if the cluster's collector already runs one; the downward API is the no-infrastructure option.)
