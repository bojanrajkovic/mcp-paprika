# Documentation system

**Last verified:** 2026-06-01

This is the rubric every other doc in this repo points at. It defines where each kind of knowledge lives, which genres are allowed to go stale, and what is deliberately _not_ automated. It is short on purpose. If you are about to write something down and you are not sure where it goes, the answer is here.

This doc declares the non-duplication rule, so this doc must itself follow it: it states each principle once and links to the artifact that owns the detail rather than restating it.

## 1. One canonical home per concept

Every fact has exactly one home. Non-duplication is the credibility test: the moment the same fact lives in two places, a reader cannot tell which copy is current, and both lose authority. When two docs would describe the same thing, one of them links to the other instead of repeating it.

Concretely: the startup sequence, the dual-layer cache, the sync engine, and the resilience policy are described in `docs/architecture.md` and nowhere else. Configuration shape lives in `docs/configuration.md`. A module's contracts and boundaries live in that module's `CLAUDE.md`. When you find yourself copying a paragraph from one of those into another doc, stop and link instead.

## 2. Genre boundaries

Each doc genre answers one question. Mixing genres is how docs rot.

- **`docs/architecture.md` — current shape (what / why).** Describes the system as it is _today_: components, how they fit, why the structure is what it is. Maintained. No history, no "we used to," no journey. If the code changes, this changes with it.

- **`docs/adr/` — durable decisions.** One decision per file, with the alternatives that were weighed and the deciding trade-off. ADRs are maintained for accuracy of the _decision record_: status, context, what was chosen, what was rejected and why. An ADR exists because a choice had real alternatives someone might later question. If there were no alternatives, it is not an ADR — it is just architecture.

- **`CONTRIBUTING.md` — human dev workflow.** How a _person_ sets up, builds, tests, and ships: the commands, the hook behavior, the commit/PR conventions, version sync, and boundaries. This is workflow, not system shape.

- **Directory `CLAUDE.md` — thin pointer + sharp edges.** A module `CLAUDE.md` is a _thin pointer_ to the canonical doc for that area plus a reactively-accreted list of **sharp edges**: the non-obvious gotcha that bit someone, the invariant that is easy to violate, the wire-format quirk that must be preserved. It is **not** a mini architecture doc. It does not re-derive the design; it warns. Sharp edges are added when something actually bites, not speculatively.

Pre-implementation planning is not a tracked doc genre. Decisions worth keeping graduate into an ADR (or `architecture.md`); the working notes that produced them are local scratch (see §5).

## 3. Reference content is read from source, never enumerated in prose

Counts and lists drift the instant code changes. Therefore prose never enumerates them. The canonical sources are:

- **The tool registry** — `src/server/build.ts` (the `register*` calls) is the authority on which tools exist and under what condition each is gated. No doc states a tool count.
- **The Zod schemas** — the schemas in `src/tools/` and `src/utils/config.ts` are the authority on tool inputs, field shapes, and configuration keys. No doc reproduces a field table or an env-var table.
- **`--help`** — the authority on the runtime CLI surface.

This rule exists because its absence produced a real failure: the tool count drifted four ways across docs, none agreeing with the registry, and there was no single source to reconcile against. The fix is not to update all four — it is to delete the count from prose and point at the registry. When you need to know how many tools there are, read `build.ts`; do not ask a doc.

## 4. "Last verified:" is the audit cadence — and there is deliberately no staleness gate

Every `CLAUDE.md`, every architecture-class doc, and every ADR carries a **`Last verified: <date>`** stamp. That date _is_ the audit mechanism: it tells a reader how recently a human confirmed the doc against reality, and it tells a maintainer which docs are overdue for a re-check. Bump it when you verify; do not bump it for a typo fix.

There is intentionally **no automated doc-staleness gate** mapping code paths or symbols to docs. Such a gate would false-positive constantly: it would flag every "former-X" annotation and every intentionally-frozen historical note as a drift error, training people to ignore it. That violates the principle of preferring language and human audit over mechanical gates. Mechanical gates are reserved for unambiguous, near-zero-false-positive checks — commitlint, and the format / lint / typecheck / test gates run in CI and the git hooks. Doc freshness is a judgment call, so it stays a judgment call backed by the verification stamp.

## 5. Tracked docs vs. local scratch

Not everything under `docs/` (or in the repo tree) is part of the tracked documentation system. These locations are **local-only scratch, gitignored, and outside this rubric**:

- `.ed3d/` — local planning and brainstorming scratch
- `docs/implementation-plans/` — per-feature implementation scratch
- `docs/test-plans/` — per-feature test scratch

Treat them as a working surface, not as published docs. Anything that should survive and be maintained must graduate into a tracked genre above (architecture, an ADR, or a `CLAUDE.md` sharp edge). Do not link to scratch paths from tracked docs — the link is a silent failure on any fresh clone.

## References

- `.ed3d/design-plan-guidance.md` — the non-duplication and CLAUDE.md-discipline principles this rubric extends (local scratch)
- `docs/architecture.md` — the current-shape doc this rubric governs
- `src/server/build.ts` — canonical tool registry (read, never enumerate)
- Root `CLAUDE.md` — project conventions and the dev/PR workflow
