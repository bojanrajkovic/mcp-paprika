# ADR-0024: Observe the client connection fingerprint at the initialize handshake

**Status:** Accepted (2026-06-24)

## Context

[ADR-0023](0023-json-or-widget-tool-results.md) settled that a schema-bearing tool carries its payload on **both** channels — `structuredContent` and the text block as JSON — because whether a host forwards `structuredContent` to its model is a per-host choice the server cannot detect at the handshake. [ADR-0021](0021-reliable-structured-content-channel.md) named the structured-output telemetry as the ongoing, live-surface confirmation of that per-host behavior. But the server recorded nothing about what each host even is: it saw `clientInfo` and the client capability tree at `initialize` and dropped both.

So there was no live census of the client population, no way to slice tool telemetry by host, and the capability tree (which `elicitation.form` drives the confirm/pick gates; what `extensions`/apps keys a host carries) was visible only as one debug log line on one transport. The MCP capability set advertises **identity and capabilities, not behavior** — there is no "I forward `structuredContent` to the model" flag — so identity has to be captured to anchor any per-host behavior map (e.g. the host → forwarding matrix the reliable-channel work needs).

The capture must sit on the existing OTel substrate ([ADR-0018](0018-opentelemetry-instrumentation.md)): recording at the seams, custom names under the `mcp_paprika.` prefix, metric labels restricted to enum/name-class values, nothing that touches the stdio stdout wire, and no behavior change to the handshake. The HTTP transport is OAuth-gated, so the capture must carry no auth material.

## Decision

**Capture the connection fingerprint at the `initialize` handshake on both transports, and read it at call time.** A single recorder, invoked from each transport's post-handshake hook, reads `clientInfo` and the capability tree off the per-session server (the same per-session seam the elicitation gate already reads), and emits the fingerprint on three channels: a **point-in-time span** carrying the full capability tree, version, protocol version, and transport as attributes; a **census counter** labeled by the cardinality-bounded slice only (client name + major version + transport); and a **structured connect log** with the same fingerprint. The recorder stashes the census slice in a per-session-server `WeakMap`, which the kernel tool wrapper reads to tag every `tools/call` span (and the transports to label the session-duration histogram) — so the structured-output channel is sliceable by host without the fingerprint being threaded through the composition context. The full version string and capability tree live on spans (which tolerate detail); only name, major version, and transport ever label a metric. `clientInfo` is the client app's self-reported identity, not the OAuth user, so no PII or token rides on any attribute. Each transport sources the requested protocol version **and the raw capabilities** itself — the server does not retain the negotiated version, and the SDK's `ClientCapabilities` schema strips every key it does not model, including the top-level `extensions` map where the apps/widget capability (`io.modelcontextprotocol/ui`) lives — from the parsed initialize body (HTTP) or a post-connect message sniff (stdio). The connect log carries the raw capability tree verbatim (future-proof); the span derives bounded scalars from it.

This beat the field because it observes the live surface with the substrate already in place and keeps metric cardinality bounded while still capturing the full tree on traces — all without altering the handshake.

## Rejected alternatives

### Thread the fingerprint through `Infra` / `DomainCtx`

Rejected because the per-session client is already reachable on the session server the tool wrapper holds; widening the composition context to carry a telemetry value would couple every layer to it for no gain, exactly the reasoning [ADR-0018](0018-opentelemetry-instrumentation.md) used to keep telemetry off `Infra`.

### A session-lifetime span instead of a point-in-time connect span

Rejected because a span held open for the whole connection never exports until close — under stdio that is the entire process lifetime — the same never-exports anti-pattern the HTTP transport's long-lived `GET /mcp` SSE exclusion already avoids. Session duration is the existing close-time histogram; the connect span only needs to mark the handshake.

### Put the full fingerprint on metric labels

Rejected because a client-controlled full version string (and the capability tree) would multiply metric series without bound. The bounded census slice labels metrics; the detail rides spans, which are not aggregated.

### Read capabilities from the SDK's parsed `getClientCapabilities()`

Rejected because the SDK's `ClientCapabilities` schema strips every key it does not model — including the top-level `extensions` map where the apps/widget capability lives — so the parsed view silently loses it. The raw initialize params (already in hand on both transports) are the authoritative source.

## Consequences

**Positive**

- The live client population is observable as a census, every `tools/call` span and the session histogram are sliceable by host, and the full capability tree (including `elicitation.form` and the apps/widget `extensions`) is queryable per connection — the structured-output telemetry [ADR-0021](0021-reliable-structured-content-channel.md) called for.
- The connection and per-call seams now log on the same events they trace (`mcp client connected`/`disconnected`, `tool completed`), and the previously silent sync loop logs a per-cycle summary — a general thickening of operational logs alongside the spans.
- The fingerprint anchors the host → forwarding matrix: the behavior column is established empirically per host (the handshake cannot reveal it), keyed on the captured `clientInfo.name`.

**Negative**

- The forwarding behavior the matrix records is maintained, not derived — a renamed or updated client needs re-checking, and the handshake gives no signal to automate it. The dual-channel fail-safe ([ADR-0023](0023-json-or-widget-tool-results.md)) is what makes a stale matrix non-fatal.
- The stdio transport sniffs the requested protocol version and raw capabilities off the message stream because the server retains neither in a readable form — a small transport-specific seam the HTTP path (which has the parsed body) does not need.
- Tagging every tool span with the client adds attributes the trace backend stores. The metric labels (the census counter and the session-duration histogram) carry only the bounded slice — client name and major version — but those are client-supplied, so they are length-capped against a pathological string; the count of distinct values is bounded operationally by the OAuth allowlist (only admitted identities connect), with a buggy client that randomizes its own name as the accepted residual.

## References

- Builds on: [ADR-0018](0018-opentelemetry-instrumentation.md) (the telemetry substrate, recording at seams, attribute discipline).
- Serves: [ADR-0021](0021-reliable-structured-content-channel.md) (named this telemetry as the live confirmation) and [ADR-0023](0023-json-or-widget-tool-results.md) (the both-channels decision whose per-host forwarding this fingerprint anchors a matrix for, never overrides).
- Issue: #358.
- External: the Model Context Protocol initialize handshake — `clientInfo`, `protocolVersion`, and the client capability set (`roots` / `sampling` / `elicitation` / `experimental` / `extensions`, the last carrying `io.modelcontextprotocol/ui`).
