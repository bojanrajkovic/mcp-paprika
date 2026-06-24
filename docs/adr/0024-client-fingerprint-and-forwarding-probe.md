# ADR-0024: Observe the client connection fingerprint, and measure structuredContent forwarding with an active probe

**Status:** Accepted (2026-06-24)

## Context

[ADR-0023](0023-json-or-widget-tool-results.md) settled that a schema-bearing tool carries its payload on **both** channels — `structuredContent` and the text block as JSON — because whether a host forwards `structuredContent` to its model is a per-host choice the server cannot detect at the handshake. [ADR-0021](0021-reliable-structured-content-channel.md) had named the structured-output telemetry as the ongoing, live-surface confirmation of that per-host behavior. Two gaps stood in the way of building it:

- **We did not know what each host advertises.** The server saw `clientInfo` and the client capability tree at `initialize`, but recorded none of it. There was no live census of the client population, no way to slice tool telemetry by host, and the capability tree (which `elicitation.form` drives the confirm/pick gates, what `experimental`/apps keys a host carries) was visible only as one debug log line on one transport. The MCP capability set advertises **identity and capabilities, not behavior** — there is no "I forward `structuredContent` to the model" flag — so identity has to be captured to anchor a behavior map.
- **Forwarding could no longer be observed passively.** Before ADR-0023, a UID present only in `structuredContent` was the behavioral tell: a model that chained on it had received the structured channel. Now every UID also rides the text, so there is no structured-only data left to watch. Confirming forwarding requires deliberately re-introducing a structured-only value.

Both must sit on the existing OTel substrate ([ADR-0018](0018-opentelemetry-instrumentation.md)): recording at the seams, custom names under the `mcp_paprika.` prefix, metric labels restricted to enum/name-class values, nothing that touches the stdio stdout wire, and no behavior change to the handshake. The HTTP transport is OAuth-gated, so the capture must be verified to carry no auth material.

## Decision

**Capture the connection fingerprint at the `initialize` handshake on both transports, and read it at call time.** A single recorder, invoked from each transport's post-handshake hook, reads `clientInfo` and the capability tree off the per-session server (the same per-session seam the elicitation gate already reads), and emits the fingerprint on three channels: a **point-in-time span** carrying the full capability tree, version, protocol version, and transport as attributes; a **census counter** labeled by the cardinality-bounded slice only (client name + major version + transport); and a **structured connect log** with the same fingerprint. The recorder stashes the census slice in a per-session-server `WeakMap`, which the kernel tool wrapper reads to tag every `tools/call` span (and the transports to label the session-duration histogram) — so the structured-output channel is sliceable by host without the fingerprint being threaded through the composition context. The full version string and capability tree live on spans (which tolerate detail); only name, major version, and transport ever label a metric. `clientInfo` is the client app's self-reported identity, not the OAuth user, so no PII or token rides on any attribute. Each transport sources the requested protocol version **and the raw capabilities** itself — the server does not retain the negotiated version, and the SDK's `ClientCapabilities` schema strips every key it does not model, including the top-level `extensions` map where the apps/widget capability (`io.modelcontextprotocol/ui`) lives — from the parsed initialize body (HTTP) or a post-connect message sniff (stdio). The connect log carries the raw capability tree verbatim (future-proof); the span derives bounded scalars from it.

**Measure forwarding with a config-gated active probe.** A diagnostics flag registers a single tool that returns a fresh random token in `structuredContent` only, never in the text — the deliberate inverse of the both-channels rule. Asking the model in a host to read the token back reveals whether that host forwards the structured channel to the model. The probe is **conditionally registered** (in the module's tool list only when the flag is on), so it is absent from the advertised surface in production, not merely inert — and it is excluded from the generated tool reference for the same reason. Identity (the fingerprint) and behavior (the probe result) are then maintained together as a host → forwarding matrix; the dual-channel result of ADR-0023 remains the unconditional fail-safe regardless of what the matrix shows.

This beat the field because it observes the live surface with the substrate already in place, keeps metric cardinality bounded while still capturing the full tree on traces, and restores a forwarding signal that the both-channels change had erased — all without altering any production tool result.

## Rejected alternatives

### Thread the fingerprint through `Infra` / `DomainCtx`

Rejected because the per-session client is already reachable on the session server the tool wrapper holds; widening the composition context to carry a telemetry value would couple every layer to it for no gain, exactly the reasoning [ADR-0018](0018-opentelemetry-instrumentation.md) used to keep telemetry off `Infra`.

### A session-lifetime span instead of a point-in-time connect span

Rejected because a span held open for the whole connection never exports until close — under stdio that is the entire process lifetime — the same never-exports anti-pattern the HTTP transport's long-lived `GET /mcp` SSE exclusion already avoids. Session duration is the existing close-time histogram; the connect span only needs to mark the handshake.

### Put the full fingerprint on metric labels

Rejected because a client-controlled full version string (and the capability tree) would multiply metric series without bound. The bounded census slice labels metrics; the detail rides spans, which are not aggregated.

### Observe forwarding passively, with no probe

Rejected because the both-channels decision ([ADR-0023](0023-json-or-widget-tool-results.md)) removed the only passive signal — there is no structured-only data left for a model to chain on. A structured-only value has to be injected on purpose to measure forwarding at all.

### Register the probe always and gate it in the handler

Rejected because a diagnostic that appears in `tools/list` in production is surface the model can call and a reviewer must reason about, even when inert. Conditional registration keeps the production surface byte-for-byte unchanged when diagnostics are off.

## Consequences

**Positive**

- The live client population is observable as a census, every `tools/call` span and the session histogram are sliceable by host, and the full capability tree (including `elicitation.form` and the apps/widget axis) is queryable per connection — the structured-output telemetry [ADR-0021](0021-reliable-structured-content-channel.md) called for.
- The connection and per-call seams now log on the same events they trace (`mcp client connected`/`disconnected`, `tool completed`), and the previously silent sync loop logs a per-cycle summary — a general thickening of operational logs alongside the spans.
- Forwarding behavior is measurable on demand per host without shipping anything into production, and the fingerprint anchors a durable identity → behavior matrix.

**Negative**

- The matrix's behavior column ages as clients change; it is maintained, not derived, and a renamed or updated client needs re-probing. The dual-channel fail-safe is what makes a stale matrix non-fatal.
- The stdio transport sniffs the requested protocol version off the message stream because the server retains no negotiated value — a small transport-specific seam the HTTP path (which has the parsed body) does not need.
- Tagging every tool span with the client adds attributes the trace backend stores. The metric labels (the census counter and the session-duration histogram) carry only the bounded slice — client name and major version — but those are client-supplied, so they are length-capped against a pathological string; the count of distinct values is bounded operationally by the OAuth allowlist (only admitted identities connect), with a buggy client that randomizes its own name as the accepted residual.

## References

- Builds on: [ADR-0018](0018-opentelemetry-instrumentation.md) (the telemetry substrate, recording at seams, attribute discipline).
- Serves: [ADR-0021](0021-reliable-structured-content-channel.md) (named this telemetry as the live confirmation) and [ADR-0023](0023-json-or-widget-tool-results.md) (the both-channels decision that erased the passive signal and that this measures, never overrides).
- Issue: #358.
- External: the Model Context Protocol initialize handshake — `clientInfo`, `protocolVersion`, and the client capability set (`roots` / `sampling` / `elicitation` / `experimental` / `extensions`, the last carrying `io.modelcontextprotocol/ui`).
