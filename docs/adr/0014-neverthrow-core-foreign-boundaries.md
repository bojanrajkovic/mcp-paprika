# ADR-0014: neverthrow in the core — throws only at foreign boundaries

**Status:** Accepted (2026-06-05)
**Last verified:** 2026-06-05
**Related:** [ADR-0010](0010-reference-sync-tier.md) (the sync driver whose abort seam this reworks), [ADR-0013](0013-test-pyramid-and-tiers.md) (the test tier the conformance check joins), [ADR-0011](0011-tool-specs-as-data.md) (tool-as-data, which the companion gate-idiom decision extends), [ADR-0003](0003-vendored-json-vector-index.md) (the JSON vector index this treats as owned code, not a foreign boundary)

## Context

The functional core uses neverthrow `Result<T, E>`, and the convention has lived as a one-line invariant in `CLAUDE.md` plus a sentence in `docs/architecture.md` that admitted it was "enforced by review, not the type system." That left the rule both imprecise and unguarded, and it had begun to drift.

An AST audit (a walk for `throw` statements, which finds 122 real ones — the grep-level count was inflated by comments) showed the core is already about 95% consistent, but with telling seams. Three of the five sibling-facing contract writes return `Result`; the other two (`aisle`'s and `meal-type`'s auto-create writes) throw for predictable outcomes like "name empty" or "catalog not yet synced." Tool readiness gates return `Result`, but the write path below them propagates cache-I/O throws. And the rule "the core never throws" had no machine check at all — the project lints with oxlint, which has no throw-related rule.

The forces in tension: the tool surface is consumed by an LLM agent, which is better served by typed, message-bearing failures than by the MCP SDK's fallback behavior of flattening a thrown `Error` to its bare `.message`; the pure core should stay total and composable; and the genuinely messy edges — HTTP, the filesystem, JWT verification, image transcoding, the retry/circuit library — really do throw and must be contained somewhere. Without a precise, enforced line, "somewhere" kept moving, and the convention's drift (the neverthrow import count grew while two writes diverged from their siblings) was invisible until audited.

## Decision

**All code we own returns `Result` for its predictable outcomes and never throws to signal them.** The boundary is drawn by _who expects the throw_, not by which directory the code lives in:

- A foreign **producer** that throws _at_ us — the filesystem (under `DiskCache`), `fetch`/`undici` (under the paprika client and the OIDC fetches), `jose`, `sharp` — is caught at our wrapper's public edge and converted to a `Result` there. The wrapper's _internals_ may still use throw-based control flow where a library demands it (the retry/circuit library is governed by throwing a transient marker), but its public surface returns `Result`. An algorithm we reimplemented ourselves is **owned, not foreign**: the JSON vector index — a from-scratch rewrite of the slice of `vectra` we need, despite ADR-0003's "vendored" label — returns `Result` like the rest of the core, rather than throwing its invariant violations.
- A foreign **consumer** that expects a throw _as its protocol_ is spoken to in throws — and only there.

Exactly **five recognized throw forms** survive; every other `throw` in owned code is a defect:

1. a `resourceNotFound` helper for the MCP resource read path, where the protocol carries no in-band error and the SDK's Protocol layer turns a thrown error into a JSON-RPC error response;
2. the OAuth error types the SDK's authorization-server router renders into spec-compliant responses;
3. the transient-HTTP marker thrown inside a retry/circuit-governed call so the policy can catch and retry it;
4. an `assertNever` exhaustiveness assertion on an unreachable branch;
5. fail-fast at process entry and kernel construction — off the request path entirely.

The rule is **enforced by a conformance test**, not only by review: a unit-tier AST walk that recognizes the five forms and fails any other throw in owned code, backed by a seeded allowlist that **ratchets to empty** as each foreign wrapper is converted. The decision is applied **in full** — `DiskCache`, the paprika client, the feature wrappers, the auth OIDC-fetch wrappers, and the domain core (the commit chokepoints, every contract write including the two auto-create stragglers, resource lookups, and spec resolution) all return `Result` — and delivered as a phased migration tracked on the issue, so each step lands green and the end state is an allowlist holding nothing but the five recognized forms.

It beat the field because the audit showed the core is already mostly `Result`-shaped, so committing is cheap relative to the consistency and typed-error ergonomics it buys, whereas the messy edges genuinely need _a_ containment strategy regardless — and "convert at the owned edge, return `Result`" is the one that keeps the core total.

## Rejected alternatives

### Remove neverthrow; standardize on throw plus `try`/`catch` contained at boundaries

Rejected because it deletes the typed, message-bearing error channels that three contract writes and the entire tool-gate system already depend on — replacing them with a catch block at every call site — while throws would still have to exist at every foreign edge, so it trades two mechanisms for a single _worse_ one rather than for simplicity.

### Keep the convention review-enforced (the status quo)

Rejected because review demonstrably let the rule drift — the import count grew and two writes diverged from their three siblings without anyone catching it — and nothing mechanical stops the next drift; a written-but-unguarded rule is, at the margin, indistinguishable from no rule.

### Draw the line by directory — a `core` versus `boundary` path allowlist

Rejected because a single file legitimately holds both a domain decision that must return `Result` and a foreign-wrapper edge that may convert a throw; the honest boundary is _who expects the throw_, which a per-path rule cannot express. Recognizing the small, enumerable set of throw _forms_ captures the real line precisely, where a directory allowlist would have to wave through every throw in a "boundary" file.

## Consequences

**Positive**

- One rule, machine-checked: code we own returns `Result`, and the five recognized throw forms are the complete, enumerable exception set — a reviewer's "can I throw here?" has a definite answer.
- Tool and resource failures become typed and message-bearing — a crafted `CallToolResult`, a real JSON-RPC error — instead of the SDK's flattened `error.message`.
- The pure core is total and composable; a foreign exception is converted at the earliest owned edge, so the origin of a failure stays legible.
- The ratcheting allowlist makes a regression impossible to merge silently and turns the migration's progress into a visible, shrinking list.

**Negative**

- A large, mechanical, multi-PR migration before the allowlist empties — on the order of two hundred call sites (`DiskCache` and the paprika client dominate, with the feature wrappers behind them) on top of the core flip.
- The kernel sync driver's "a throw aborts the cycle" contract (ADR-0010) becomes "a `Result` error aborts the cycle"; the reconcile-and-abort seam is reworked, not merely rewrapped.
- `ResultAsync` enters the codebase, where it was previously unused — a new idiom contributors must learn for the async wrapper edges.
- Two new helpers (`assertNever`, `resourceNotFound`) and a standing discipline: keeping the recognized set at five means every proposed sixth is a real architectural question, not a quiet addition.

## References

- Issue/PR: [#241](https://github.com/bojanrajkovic/mcp-paprika/issues/241) (parent [#228](https://github.com/bojanrajkovic/mcp-paprika/issues/228)). The companion precondition gate-idiom decision is recorded separately in ADR-0015.
- External: the neverthrow library; the Model Context Protocol resource and authorization-server specs.
