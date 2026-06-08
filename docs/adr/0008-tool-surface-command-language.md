# ADR-0008: Shape the tool surface as a forward-intent command language with rubric-gated intent verbs

**Status:** Accepted (2026-06-03)

## Context

The tool surface accreted entity-by-entity and drifted off any single grammar: single-entity reads use both `read_` and a lone `get_`; one entity renames via a bespoke `rename_` while every other edits via `update_`; recipe querying spent several verbs that dropped the recipe noun; bulk and cross-entity actions carried entity-less or mechanical names; and the meal-planner read tool was named for a "history" it does not represent (it spans past and future). Most consequentially, the highest-frequency user intents — buying a grocery item, running out of a pantry staple, trashing a recipe — were buried as boolean fields on generic `update_` tools, so the act the user names in a sentence had no tool whose name carried that meaning.

The surface targets an AI agent acting for a non-technical user, where first-try tool selection is the metric that governs reliability and the tool name (not its prose) is the load-bearing signal. Two forces pull against each other: a uniform, predictable grammar lets the agent generalize one tool's shape to the next, while intent-preserving names let the agent match an utterance directly instead of reconstructing which field encodes the act. [#140](https://github.com/bojanrajkovic/mcp-paprika/issues/140) mandates a clean-break v2.0 refactor with latitude to rename freely, split, and add tools, so this is the moment to resolve the drift rather than paper over it.

## Decision

The tool surface is a small, regular command language. A **consistent core** — the `create` / `add` / `list` / `read` / `update` / `delete` verbs in a fixed `verb_entity` word order — is the default every entity obeys, so the agent generalizes the shape of an unseen tool from the ones it has used and the user reads any call as a plain sentence about one noun. `read` is the sole single-entity fetch verb; `update` is the open-ended field editor and is never the front door to a named state change; `delete` is the uniform removal verb, with the one reversible lifecycle (recipe trash → restore → purge) spoken in its own named steps rather than flattened into `delete`.

Onto that core sits a **short, governed bench of intent verbs** — for the moves a bare `update` would mumble, the bulk and cross-entity acts a generic name would obscure, and the few transitions the user has a word for. The promotion rubric distills to a single question — **does a human name this act?** — and a verb earns a place on the bench only when the answer is demonstrably yes: it **crosses entities**, OR it names a **state transition** a bare `update` would erase, OR it matches **high-frequency user phrasing**. The rubric is the whole discipline — teachable in one sentence, it admits the handful of verbs that carry meaning the core erased and visibly refuses the many it could spawn by mere symmetry, so a promoted state transition is set by exactly one intent verb (its field leaves the open-ended editor) and the surface stays boringly uniform everywhere a real user phrase does not exist.

The set of registered tools, their parameters, and their annotations are defined by the registry in `src/server/build.ts` and the per-tool Zod schemas; the generated reference under `docs/tools/` renders them. This ADR governs the naming philosophy and the promotion rule, not the roster — consult the registry for what is registered.

## Rejected alternatives

### A consistent CRUD spine only, with no intent verbs

Rejected because it is the most predictable and cheapest to migrate, yet leaves every high-frequency state transition (purchased, in-stock, in-trash) as a boolean on a generic `update_` tool — so the act the user names in a sentence has no tool name that carries it, which is the meaning-erasure this surface most needs to avoid for its primary mutations.

### A fully intent-shaped command language that extracts every transition

Rejected because it is the most intent-faithful, but it promotes by symmetry — spending a retrieval slot on rare inverse intents and a long tail of single-use verbs the agent cannot generalize from — which abandons the smallest-change-that-fits discipline and grows the costly mutation surface faster than the demonstrated need warrants.

## Consequences

**Positive**

- First-try tool selection improves where it matters most: a named user intent ("we're out of milk", "trash this recipe") maps to a tool whose name _is_ that intent, so the agent matches semantics instead of inferring which field on which `update_` tool to set.
- The core stays maximally learnable: a fixed `verb_entity` grammar lets the agent generalize an unseen tool's shape, and a non-technical user reads any call as a plain sentence about one noun.
- Sprawl is bounded by a stated rule, not by taste: the promotion rubric justifies each intent verb and visibly refuses the many it could have spawned, so the surface grows only where intent is demonstrated.
- Tool names double as user-facing explanations of what happened, and read/write separation plus per-tool annotations are preserved on every renamed and promoted tool, so client gating logic and the destructive/idempotent hints carry over.
- There is exactly one way to set each promoted transition (the field leaves the open-ended editor and is rejected there), so the agent cannot "win" by patching the field and the two paths cannot drift.

**Negative**

- A clean break with no aliases: every saved prompt, eval, and the server's own hand-maintained instructions block must be re-taught the renamed and promoted verbs in lockstep at v2.0.
- Promoting a transition off `update_` is a sharper migration than a rename — a caller that set the field must restructure to a different tool, not just swap a name — and these field-removals are the load-bearing, breaking part of the change.
- The core grammar is regular but not exception-free: reference entities are list-only and the recipe trash lifecycle is named rather than `delete_`, so the agent must learn the few places the spine bends from documentation rather than from the name alone.
- Drawing the promotion line still takes judgment at the margin (which edits are "open-ended" versus a "named transition"), so the rubric narrows the argument without fully ending it and must be policed in descriptions and evals.
- Some intent and cross-entity names are confident sentences over operations that are non-atomic or non-idempotent, so those tools carry an explicit caveat in their description to keep behavioral honesty in step with the naming.

## References

- Issue: [#140](https://github.com/bojanrajkovic/mcp-paprika/issues/140) — the tool-name harmonization mandate this ADR answers.
- Related: [ADR-0004](0004-tool-vs-resource-classification.md) — the Content/Data/Reference classification that decides which entities get tools; this ADR names those tools and inherits its model-UX-over-DX audience framing.
- Related: [ADR-0005](0005-composition-modules-and-identifiers.md) — the per-entity module shape the renamed tools live across.
- Registry (authority for the roster): `src/server/build.ts`; generated reference: `docs/tools/`.
- Tool-family sharp edges: `src/tools/CLAUDE.md`.
