# ADR-0018: OpenTelemetry via the global API, an opt-in dual-path bootstrap, and vendored Development-status conventions

**Status:** Accepted (2026-06-06)
**Last verified:** 2026-06-06

## Context

The server has rich structured logging but no traces or metrics: a slow sync cycle, a wedged HTTP session, a retried-then-abandoned Paprika call, or a silently failing notification fan-out are all reconstructable only by reading logs. OpenTelemetry is the obvious answer, but three forces make the integration non-standard here:

- **stdio's stdout is the MCP wire.** Any library that writes to stdout — the OTel `DiagConsoleLogger` the NodeSDK installs when `OTEL_LOG_LEVEL` is set, console exporters, dotenv banners — corrupts the protocol. Telemetry must be structurally incapable of touching stdout.
- **The npm `bin` cannot carry node flags.** The standard OTel Node.js recipe (`node --import telemetry.js app.js`, plus an ESM loader hook for module-patching instrumentations) works for the container but not for `mcp-paprika` launched by Claude Desktop, Cursor, or mcp-cli, where the executable is the bin script itself.
- **The relevant semantic conventions are immature.** The MCP conventions (semconv v1.39.0) and the GenAI conventions both carry Development stability; the npm package exposes them only through an `incubating` entry point that is documented to break in minor versions.

There is no official MCP instrumentation package (the TypeScript SDK exposes no middleware/interceptor API), so instrumentation lands manually at the seams this codebase already concentrates behavior into: the `defineTool` wrapper, the kernel sync driver, the shared resilience executor, the commit chokepoints.

## Decision

### Recording goes through the global `@opentelemetry/api`, not `Infra`

Every seam records via the API's global tracer/meter accessors under one instrumentation scope (`src/telemetry/scope.ts`). The API is designed as a process-wide ambient with a no-op default, which is precisely the off-by-default property the bootstrap relies on; it also keeps telemetry out of the signatures of layers that deliberately import nothing heavy (`src/entity/`, `src/cache/`). Instruments are memoized on first use, never created at module scope: the metrics API has no late-binding proxy, so a module-scope instrument created before SDK start would stay a no-op forever. Span lifecycle in the neverthrow core is Result-native (`traceResultAsync` draws span status from the `ok`/`err` arms) rather than try/catch-based.

### One bootstrap module, loaded two ways, opt-in by OTLP endpoint

`src/telemetry/bootstrap.ts` gates on the standard `OTEL_EXPORTER_OTLP_ENDPOINT` family (after loading the same XDG-config `.env` the config loader uses) and dynamically imports the SDK assembly only when enabled — a non-observing process never parses the SDK. The container CMD preloads it with `--import`, which makes the OTel ESM loader hook registered during startup effective for application modules; `src/index.ts` keeps the same module as its first static import for the bin/stdio path, where the hook is inert and irrelevant — every configured instrumentation (undici, runtime-node) is diagnostics_channel- or perf-hooks-based and patches nothing. ESM module caching makes the two paths idempotent. Telemetry startup failure degrades to a stderr warning, never a boot failure; the SDK's stdout-writing diag logger is preempted by consuming `OTEL_LOG_LEVEL` and installing a stderr-only logger.

### Development-status convention names are vendored; everything else is honestly custom

Spec-defined names (`mcp.server.operation.duration`, `gen_ai.tool.name`, bucket advisories, …) are used verbatim but vendored into `src/telemetry/semconv.ts` with the spec version pinned, per the package's own guidance that the `incubating` entry point is not a safe dependency — the same reasoning that vendored the vector index (ADR-0003). Names the spec does not define carry an `mcp_paprika.` prefix, so nothing squats on namespace the conventions may later claim. Metric attributes are restricted to enum- or name-class values (tool names, entity names, outcome enums) — never UIDs, URIs, subjects, or free text — and `error.type` on duration histograms is the error-rate signal, per the semconv pattern.

## Rejected alternatives

### Threading a telemetry handle through `Infra`

Rejected because it would widen signatures across layers that the architecture deliberately keeps dependency-free (the entity base, the disk caches) while buying nothing: the OTel-blessed test pattern is swapping the global provider, so DI adds no testability, and the global API's no-op default already provides the disabled path.

### The full unquote-style `--import`-only bootstrap (single path)

Rejected because the npm bin would lose telemetry entirely — a bin script cannot carry node flags, and demanding `NODE_OPTIONS` in every MCP client's config trades a structural guarantee for per-client documentation that will be skipped.

### Importing convention constants from `@opentelemetry/semantic-conventions/incubating`

Rejected because the incubating entry point may break on minor bumps of a package that other dependencies also pin, turning routine updates into convention drift; a vendored single file makes the eventual stabilization rename a one-file diff.

### Skipping the loader hook everywhere

Rejected (the inverse of the shipped hybrid) because registering the hook costs one line in the container path and gives any future module-patching instrumentation a place to Just Work; refusing it would make that future need a deployment redesign instead of a dependency addition.

## Consequences

**Positive**

- Telemetry is off by default, costs one env read when off, and cannot corrupt the stdio wire by construction (OTLP-only exporters, stderr-only diag).
- Tool calls, resource reads, sync cycles, outbound HTTP, and the resilience layer become traceable with consistent naming, and dashboards can be built on spec-defined metric names.
- The seams instrumented are the ones the architecture already funnels behavior through, so coverage is broad while the diff stays at chokepoints.

**Negative**

- The MCP/GenAI conventions are Development-status: a stabilization rename pass over `src/telemetry/semconv.ts` (and any dashboards) is expected future work.
- Two bootstrap paths must stay behaviorally identical; a future instrumentation that requires module patching will silently not patch under the bin/stdio path and must be caught in review.
- SDK-internal MCP operations (`initialize`, `tools/list`, `resources/list`) are uninstrumented — the TypeScript SDK exposes no interceptor seam — so `mcp.server.operation.duration` covers `tools/call` and `resources/read` only.
- The diag logger adds a third sanctioned `process.stderr.write` site.

## References

- Related: ADR-0003 (vendoring precedent), ADR-0009 (the kernel seams), ADR-0014 (Result-native span lifecycle; boot-edge throw containment), ADR-0015 (the tool chokepoint instrumented)
- External: OTel MCP semantic conventions — https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/ (introduced semconv v1.39.0)
- External: OTel GenAI semantic conventions — https://opentelemetry.io/docs/specs/semconv/gen-ai/
- External: OTel JS ESM support — https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md
