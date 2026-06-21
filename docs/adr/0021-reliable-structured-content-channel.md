# ADR-0021: Trust structuredContent as the model's reliable identifier channel

**Status:** Accepted (2026-06-21)

## Context

[ADR-0019](0019-mcp-app-widget-surface.md) added a structured output channel: schema-bearing reads and echoes return machine identifiers in `structuredContent` beside a clean Markdown block for the human. B1 (#321) shipped that channel but kept the single top-level `**UID:**` line in each entity formatter as a text fallback — pending a deliberate decision that `structuredContent` is the channel the model can be trusted to receive. This ADR is that decision.

The decision is gated because consumption is host-dependent, not a protocol guarantee. A host can feed `structuredContent` to a widget iframe (host → iframe) without feeding it to the model's tool-result context (host → LLM message); these are different consumers, and only the widget path was previously validated ([ADR-0019](0019-mcp-app-widget-surface.md) / #324). The MCP specification reinforces the doubt: it recommends servers ALSO serialize structured data into a text content block "for backwards compatibility," which only makes sense because some hosts ignore `structuredContent` on the model path.

The property is also not negotiable at the handshake. The MCP client capability set is `roots` / `sampling` / `elicitation` / `experimental`; none advertises "I deliver `structuredContent` to the model." `outputSchema` is server-advertised, with no reciprocal client-consumer capability, and the apps/widget capability describes a different axis (host → iframe). So a server cannot detect a non-conforming host at connection time and adapt — the decision must rest on per-client verification, and any fallback must be unconditional.

## Decision

Treat `structuredContent` as the model's reliable identifier channel: the human-readable text need not carry machine UIDs, because the model receives them through the structured field on every targeted client.

Per-client verification is the basis:

| Client                  | Delivers structuredContent to the model | Basis                                                                                                                         |
| ----------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Claude Code             | Yes                                     | direct observation over the HTTP connector — a child-item UID present only in `structuredContent` (post-B1) reaches the model |
| Claude mobile (primary) | Yes                                     | widget renders from the channel; the model path shares the same server, transport, and client family as Claude Code           |
| ChatGPT / Codex         | Yes                                     | structured output present in the client's debug surface                                                                       |
| Cursor                  | Yes                                     | prioritizes `structuredContent` over the text content field                                                                   |
| mcp-cli                 | No                                      | routes `structuredContent` to its dashboard, never the model message — text-only to the LLM                                   |

Consequent commitments:

- **The entity `**UID:**` text lines are removed** from the read formatters (#369); `structuredContent` is the sole machine-UID carrier in tool results.
- **The fallback for a non-conforming host is the `paprika://` resource**, which always carries the entity UID in its header. Because non-conformance is undetectable at runtime, this is unconditional — the resource always exists; there is no per-session text fallback.
- **mcp-cli is best-effort, not a gating target.** It is a development / testing CLI, not a shipped surface. Supporting its model path would require either keeping UID text everywhere (abandoning the clean-text goal) or serializing structured data into the text block (rejected below).
- **Coverage rule.** A tool carries `structuredContent` + `outputSchema` when its result returns a resolvable entity a follow-up call could key on — one it mints (creators / movers) or echoes (mutating acks). A tool that returns no such entity (a delete or clear) or whose payload is a non-text content block with no useful identifier does not. This predicate, not a per-tool list, governs which tools adopt the channel; the remaining coverage is tracked as #398.

## Rejected alternatives

### Serialize structuredContent into a text block (the spec's backwards-compat fallback)

Rejected. It would make even mcp-cli's model receive the UIDs, but [ADR-0019](0019-mcp-app-widget-surface.md) already rejected a JSON block beside the Markdown because both render to the human — reintroducing the identifier noise the clean-text split exists to remove.

### A per-capability runtime fallback (keep UID text only for non-conforming hosts)

Rejected as infeasible. Consumption is not handshake-detectable, so a server cannot identify a non-conforming host to serve it a different result. This is the reason the resource fallback is unconditional rather than gated.

### Keep the top-level UID text line as a permanent fallback

Rejected. It is the status quo B1 staged for removal; retaining it concedes the clean-text half of the R1 rung permanently to protect a non-shipped client.

### Treat mcp-cli as a gating target

Rejected. Gating the decision on the one non-conforming, non-shipped client would forfeit the clean-text goal for every shipped client.

## Consequences

**Positive**

- The human-readable result is free of machine identifiers on every shipped client, while the model receives them through a typed, validated channel — the [ADR-0008](0008-tool-surface-command-language.md) goal of minimizing the agent's chance of a wrong call.
- The coverage rule gives a new tool a self-classifying test, so the channel's reach stays principled rather than ad hoc.
- The fallback reuses the existing `paprika://` resource surface — no new plumbing for degraded hosts.

**Negative**

- A host that consumes `structuredContent` only for presentation, not the model — mcp-cli today, possibly others — cannot drive a follow-up call on a UID that appears only in the structured field; its recourse is the resource. This is an accepted limitation for non-shipped clients.
- The decision rests on per-client verification that can age as clients change. The structured-output telemetry (#358) is the ongoing confirmation: it observes the behavioral proxy — a schema-bearing read followed by a call keyed on a structured-only UID — on the live surface.
- Cursor's preference for `structuredContent` over the text field means the structured payload must be complete; it is, since the text is human-only prose.

## References

- [ADR-0019](0019-mcp-app-widget-surface.md) — the structured output channel and widget surface this decision completes (the R1 clean-text half).
- [ADR-0008](0008-tool-surface-command-language.md) — the tool-surface command-language principle the reliable channel serves.
- Issues: #368 (verification + this ADR), #367 (R1 clean-text completion), #369 (strip the UID text lines), #358 (structured-output telemetry / live confirmation), #398 (structured-output coverage across the remaining tools).
- External: the Model Context Protocol tools specification — `outputSchema` / `structuredContent`, and its recommendation to also serialize structured content into a text block for backwards compatibility.
