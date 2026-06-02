# Documentation system

**Last verified:** 2026-06-01

This is the rubric every other doc in this repo points at: where each kind of knowledge lives, which genres may go stale, and what stays deliberately un-automated. When you're unsure where something goes, the answer is here.

## 1. One canonical home per concept

Every fact has exactly one home. Non-duplication is the credibility test: the moment a fact lives in two places, a reader can't tell which copy is current, and both lose authority. When two docs would describe the same thing, one links to the other instead of repeating it.

Concretely: the startup sequence, the dual-layer cache, the sync engine, and the resilience policy live in `docs/architecture.md` and nowhere else. Configuration shape lives in `docs/configuration.md` (with `docs/http-transport.md` and `docs/oauth-configuration.md` for the HTTP and OAuth specifics). A module's contracts and boundaries live in that module's `CLAUDE.md`. If you catch yourself copying a paragraph from one of those into another doc, stop and link instead.

## 2. Genre boundaries

Each genre answers one question. Mixing genres is how docs rot.

**`docs/architecture.md`** is the current shape: what the components are, how they fit, why the structure is what it is. Maintained, and it tracks the code. No history, no "we used to," no journey.

**`docs/adr/`** holds durable decisions, one per file, each with the alternatives that were weighed and the trade-off that decided it. What's maintained is the accuracy of the decision record: status, context, what was chosen, what was rejected and why. An ADR exists because a choice had real alternatives someone might later question. No alternatives, no ADR: that's just architecture.

**`CONTRIBUTING.md`** is the human dev workflow: how a person sets up, builds, tests, and ships, plus the hook behavior, the commit and PR conventions, version sync, and boundaries. Workflow, not system shape.

**Directory `CLAUDE.md`** is a thin pointer to the canonical doc for that area, plus a reactively-accreted list of sharp edges: the gotcha that bit someone, the invariant that's easy to violate, the wire-format quirk you have to preserve. It is not a mini architecture doc. It doesn't re-derive the design; it warns. Sharp edges get added when something actually bites, never speculatively, and the same restraint applies to the files themselves: a directory earns a `CLAUDE.md` when it has a canonical doc to point at or edges worth recording, not reflexively for every new folder.

Pre-implementation planning is not a tracked genre. Decisions worth keeping graduate into an ADR (or `architecture.md`); the working notes that produced them stay local, gitignored scratch, outside this rubric. Don't link to those scratch paths from a tracked doc: the link is a silent failure on a fresh clone.

## 3. Reference content is read from source, never enumerated in prose

Counts and lists drift the instant code changes, so prose never enumerates them. The canonical sources:

- **The tool registry.** `src/server/build.ts` (the `register*` calls) is the authority on which tools exist and how each is gated. No doc states a tool count.
- **The Zod schemas.** The schemas in `src/tools/` and `src/utils/config.ts` are the authority on tool inputs, field shapes, and config keys. No doc reproduces a field or env-var table.
- **`--help`.** The authority on the runtime CLI surface.

This rule exists because its absence already bit us: the tool count drifted four ways across docs, none agreeing with the registry, with no single source to reconcile against. The fix isn't to update all four. It's to delete the count from prose and point at the registry. When you need to know how many tools there are, read `build.ts`; don't ask a doc.

## 4. "Last verified:" is the audit cadence, and there is deliberately no staleness gate

Every `CLAUDE.md`, every architecture-class doc, and every ADR carries a **`Last verified: <date>`** stamp. That date is the audit mechanism: it tells a reader how recently a human checked the doc against reality, and it tells a maintainer which docs are overdue. Bump it when you verify; leave it alone for a typo fix.

There is deliberately **no automated doc-staleness gate** mapping code paths or symbols to docs. Such a gate would false-positive constantly, flagging every "former-X" annotation and every intentionally-frozen historical note as drift, which trains people to ignore it. That violates the principle of preferring language and human audit over mechanical gates. Mechanical gates are reserved for unambiguous, near-zero-false-positive checks: commitlint, and the format, lint, typecheck, and test gates that run in CI and the git hooks. Doc freshness is a judgment call, so it stays one, backed by the verification stamp.

## References

- `docs/architecture.md` — the current-shape doc this rubric governs
- `src/server/build.ts` — canonical tool registry (read, never enumerate)
- Root `CLAUDE.md` — project conventions and the dev/PR workflow
