# ADR-0020: Fail-open elicitation gates — CONFIRM on high-cost acts, disambiguation PICK

**Status:** Accepted (2026-06-19)

**Builds on:** [ADR-0019](0019-mcp-app-widget-surface.md) (the presentational-delivery ladder; this is its rung 3) · [ADR-0015](0015-precondition-chain-definetool.md) (the precondition chain this deliberately does _not_ extend) · [ADR-0014](0014-neverthrow-core-foreign-boundaries.md) (neverthrow core / foreign-boundary throws) · [ADR-0008](0008-tool-surface-command-language.md) (the tool surface as a forward-intent command language)

## Context

MCP defines _elicitation_: mid-handler, a server may ask the client to put a prompt to the user and return their answer. [ADR-0019](0019-mcp-app-widget-surface.md)'s rung 3 earmarks two uses — a **CONFIRM** before a costly act, and a short **PICK** to disambiguate a fuzzy lookup — as the spec-native alternative to a widget for flat interactions. Four forces shape how it lands here.

First, elicitation is a **client capability, not a protocol guarantee**. The SDK's elicitation call throws if the client never advertised the capability, and the primary consumer — a mobile client over the OAuth-gated HTTP deployment — may not support it, while the common desktop clients (Claude Desktop/Code, Cursor) do. Every gate must therefore have a defined behavior on a client that cannot be asked.

Second, those same desktop clients **already prompt the user to approve each tool call**. A server-side CONFIRM is additive only in two situations: the host's prompt is set to always-allow (the user has opted _out_ of per-call confirmation), or the client has no granular approval surface at all. Its honest extra value is a tailored, entity-named question ("Permanently delete _Grandma's Pie_?") the generic host prompt cannot phrase — not a second universal gate.

Third, the gate is **asynchronous and argument-dependent**: it awaits a client round-trip, and both the confirm message and the PICK candidates derive from the call's arguments and the resolved entity. [ADR-0015](0015-precondition-chain-definetool.md)'s precondition chain is neither — its guards are synchronous and receive only the domain context, never the arguments.

Fourth, the cost of a destructive mistake is **not uniform**. Some acts are permanent with no undo verb; some cascade or move in bulk; some delete behind an opaque identifier the user cannot read; and some — a soft-delete with a restore verb, a reschedule, a field edit — are cheap to reverse. A gate that fires on all of them trains the user to dismiss it.

## Decision

Adopt rung-3 elicitation as a **capability-checked, handler-level async helper** with two shapes — CONFIRM and short-PICK — that **fails open** when the client cannot be asked, and gate CONFIRM by **cost-of-mistake, not by destructiveness**.

**One primitive, checked before it speaks.** A shared elicitation helper (a new cross-cutting leaf under `src/shared/`) reads the per-session client's advertised capability off the session server before issuing any request, and returns a typed outcome — proceed, declined, or unsupported — so a raw SDK throw never crosses into the neverthrow core ([ADR-0014](0014-neverthrow-core-foreign-boundaries.md)). It is called from inside the tool handler, after the entity is resolved, rather than as an [ADR-0015](0015-precondition-chain-definetool.md) precondition: the chain is synchronous and argument-blind, while the message and candidates are functions of the arguments.

**Fail open.** On a client that does not support elicitation, a CONFIRM gate proceeds and a PICK falls back to its existing disambiguation prose. The human checkpoint is thus an _enhancement_ that capable clients receive — and can themselves set to always-allow — layered over the host's own tool-approval prompt, which remains the backstop everywhere. A declined or cancelled CONFIRM aborts the act and returns a plain result ("Cancelled — nothing was deleted"), not an error, so the agent does not read a user's "no" as a failure to retry.

**Gate CONFIRM by cost-of-mistake.** A destructor earns a confirm when any of three holds: it is permanent _and_ non-trivial to reconstruct; it is bulk or cascading; or it deletes behind an opaque identifier the user cannot verify. Reversible acts (a soft-delete with a restore verb, a reschedule) and ordinary field edits are not gated; a trivially re-addable single item is not gated. The PICK replaces the "multiple matches — re-invoke with a uid" arm of the shared lookup resolver, which is what the A2 lookup refactor consumes.

This beat the field because it puts the real human checkpoint exactly where it adds value — a tailored confirm on a costly act, on a client that can show it — without breaking the tool on clients that can't, without double-gating the cheap acts, and without re-imposing confirmation on a user who has deliberately turned the host's prompt off.

## Rejected alternatives

### Fail closed — block when the client can't confirm

Rejected because it makes a destructor uncallable on any client without elicitation, including the primary mobile consumer whose support is unknown — trading a rare accidental delete for a tool that simply does not work, and bypassing the host's own approval prompt that already guards the act.

### A `confirm: true` argument as the degradation path

Rejected because the agent supplies the argument, not the human, so on a no-elicitation client it adds a round-trip with no human checkpoint — and the model learns to pass it unconditionally, collapsing it to noise while adding a field the surface should hide ([ADR-0008](0008-tool-surface-command-language.md)).

### Make CONFIRM an async precondition in the kernel chain

Rejected because [ADR-0015](0015-precondition-chain-definetool.md)'s chain is synchronous and receives only the domain context; an async, argument-dependent gate would force every guard signature to become async and thread the arguments through, re-plumbing the whole chain for one new caller. The gate lives in the handler, where the arguments and the resolved entity already are.

### Gate every destructive verb uniformly

Rejected because the cost of the mistake is not uniform: a confirm on deleting a single re-addable grocery item, or on a reversible soft-delete, trains the user to dismiss the prompt — devaluing it on the acts (a permanent purge, a bulk clear) where it matters.

## Consequences

**Positive**

- The human gets a tailored, entity-named checkpoint on exactly the costly acts, on the clients that can render it, and can set it to always-allow — while no client loses the ability to run the tool.
- The PICK removes a model round-trip from the ambiguous-lookup path and hands the lookup refactor (A2) the disambiguation primitive it is blocked on.
- The neverthrow core stays total: the capability check keeps the SDK's throw at the foreign boundary, inside the one helper.
- The gate is a small, declarative call at the top of a handler's act, so the un-gated reversible acts stay frictionless.

**Negative**

- Pre-handler interaction now lives in the handler rather than the visible precondition list — a tool's gate is no longer surfaced at its head the way [ADR-0015](0015-precondition-chain-definetool.md) guards are, so the design leans on the helper's uniformity to keep the gates recognizable.
- Fail-open means a destructive act on a no-elicitation client proceeds with only the host's prompt behind it; the server makes no guarantee of a confirmation it cannot deliver.
- The cost-of-mistake test is a judgment, not a property the type system checks — the gated set is a curated list a new destructor must be consciously slotted into, and the boundary (which single-item deletes count) will need re-litigation as tools are added.
- Elicitation adds a server-initiated request mid-tool-call, which under HTTP must travel the session's streaming channel; a gate therefore depends on the transport carrying server→client requests, not just responses.

## References

- Related: [ADR-0019](0019-mcp-app-widget-surface.md) (the presentational-delivery ladder — this is rung 3), [ADR-0015](0015-precondition-chain-definetool.md) (the synchronous precondition chain this does not extend), [ADR-0014](0014-neverthrow-core-foreign-boundaries.md) (neverthrow core / foreign-boundary throws — the capability check keeps the SDK throw contained), [ADR-0008](0008-tool-surface-command-language.md) (the forward-intent command language — the hidden-field and remediation discipline), [ADR-0004](0004-tool-vs-resource-classification.md) (the demonstrated-consumer bar elicitation clears for flat interactions).
- Issue/PR: [#308](https://github.com/bojanrajkovic/mcp-paprika/issues/308) (the R3 epic) with [#309](https://github.com/bojanrajkovic/mcp-paprika/issues/309) (the primitive), [#310](https://github.com/bojanrajkovic/mcp-paprika/issues/310) / [#311](https://github.com/bojanrajkovic/mcp-paprika/issues/311) (the CONFIRM gates), [#312](https://github.com/bojanrajkovic/mcp-paprika/issues/312) (the disambiguation PICK that A2 [#313](https://github.com/bojanrajkovic/mcp-paprika/issues/313) consumes).
- External: the Model Context Protocol elicitation surface (`elicitation/create`, the `accept` / `decline` / `cancel` result) and the SDK's elicitation call / client-capability negotiation.
