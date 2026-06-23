# ADR-0022: A model-sourced widget feed for the step-anchored cooking surface

**Status:** Proposed (preliminary — the widget chip-language direction is still being settled in a design playground, and the `cook_recipe` tool + cooking widget are not yet built; see "Open" below)

## Context

Every interactive widget the server ships so far — the grocery and pantry checklists, the meal-week planner, the recipe browser — is fed by a **server-derived** structured payload: a tool reads Paprika data and emits typed `structuredContent` ([ADR-0019](0019-mcp-app-widget-surface.md), [ADR-0021](0021-reliable-structured-content-channel.md)), which the widget renders. The data the widget shows is something the server knows.

The cooking surface ([#337](https://github.com/bojanrajkovic/mcp-paprika/issues/337)) wants something the server does not know. The aim is a cook-mode view where each direction step shows the ingredients that step uses, with a confirm/adjust pass over that mapping and a log action at the end. That per-step ingredient-to-step anchoring **does not exist in Paprika**: a recipe stores its ingredients and its directions as two unrelated free-text blobs, and `read_recipe` surfaces them exactly that way (`ingredients: string`, `directions: string`, both newline-delimited). Nothing links an ingredient line to the step that consumes it, and nothing ever has.

The server cannot manufacture the link. It has no language model; the only tool available to it is string matching, which fails on the cases that matter — a step that says "add the dry ingredients" or "stir in the mixture" names no ingredient literally, quantities split across steps, and a recipe that builds an intermediate (a spice paste, a glaze, a crust) and uses it later has no raw line to point at. A spike confirmed the opposite is true of a capable model: given the two blobs and a target schema, the assistant parses real, messy recipes reliably — multi-component ingredient blobs with section headers, near-duplicate ingredients across components, and intermediate products — and its output is stable across repeated runs, so a human confirm step is a glance rather than an audit.

## Decision

Introduce `cook_recipe`, a tool whose **structured widget feed is authored by the model, not derived from stored data** — the first such tool in the codebase.

The flow inverts the usual one. The assistant first reads the recipe (`read_recipe`), then parses it into a canonical structure and passes that structure to `cook_recipe`:

- `ingredients[]` — the model's canonical parse, each `{ text, group }` (section headers demoted to `group`, near-duplicate lines kept distinct).
- `steps[]` — each `{ text, group, ingredientRefs[], produces, usesIntermediate[] }`, where `ingredientRefs` index into `ingredients[]` for the raw ingredients added fresh in that step.

The server is a **validator and enricher, never a deriver**. It validates internal consistency with no language model — `recipe_uid` resolves in the store, at least one step, every `ingredientRef` in range, every `usesIntermediate` name produced by an _earlier_ step, and `produces` names unique — returning a remediation hint on each failure. It enriches the echo with the stored recipe's identity (name, servings, total time, photo resource), so the model never retypes what the store already holds, and returns the validated structure as `structuredContent` plus a clean Markdown cook-view as the text fallback. The result references a `ui://widget/cooking` resource: the widget renders the anchored steps with a confirm/adjust gate (toggle a wrong raw chip off; a "re-anchor differently" feedback path back to the model), a big-type cook stepper, and a one-tap log.

**Intermediates are first-class.** A step may declare it `produces` a named sub-component (a spice paste, a baked crust) that later steps consume via `usesIntermediate`, referenced by name rather than by re-listing the intermediate's raw constituents. A description-level lean keeps a named intermediate to genuine set-asides — something made and returned to later, not a result handed straight to the next step. The residual ambiguity (a fridge-rested marinade is arguably a set-aside, arguably not) is exactly what the human confirm/adjust step absorbs.

The mapping is **ephemeral**. Paprika has no field to hold it, so every cook re-derives. Authoring recipes step-anchored from creation — so the structure is born with the recipe instead of reverse-engineered each time — is a real future once the server owns its own database, but it is captured as an idea, not decided here.

## Rejected alternatives

### Derive the mapping server-side

Rejected because the server has no language model, and string matching fails on the cases that motivate the feature: category references ("the dry ingredients"), intermediates with no raw line to point at, and quantities split across steps. A server-derived mapping would be wrong often enough that the confirm step becomes correction work.

### A plain cook stepper with no anchoring

Rejected because the spike proved the anchoring is feasible, and the per-step mise-en-place is the point of the surface. A stepper that only pages through directions is a rung down that drops the one thing this surface adds over `read_recipe`.

### Client-side heuristic anchoring in the widget

Rejected for the same reason as server-side derivation, moved to the browser: a weak matcher turns the confirm/adjust step into heavy correction rather than a confirming glance — the opposite of the intended interaction.

### Persist the mapping on the Paprika recipe

Rejected because no such field exists; persisting it would require owning the database, which is a separate, larger future rather than part of this surface.

## Consequences

**Positive**

- Delivers the stove-side anchoring that text is weakest at, on the surface (mobile, hands busy) where the server is most used.
- The server stays dumb: a pure validator and enricher with no language model, and the validation is mechanical, total, and cheap.
- The confirm/adjust step turns a model mistake into a one-tap user fix, and the same step absorbs the genuinely ambiguous cases the model cannot be expected to settle.
- The `cook_recipe` schema is the same shape a future native-authoring model would write, so the structured contract is reusable rather than throwaway.

**Negative**

- A new kind of artifact: a widget feed whose correctness rests on the model plus the human confirm, not on server-derived truth. This is a different trust model from every other widget and must be documented as such.
- The mapping is ephemeral — re-derived per cook, with harmless cross-cook naming drift in the intermediate names.
- A large structured input is more for the agent to get right than a typical tool call (the concern [ADR-0008](0008-tool-surface-command-language.md) raises); it is mitigated by the mechanical validation and the human confirm, but it is real.
- If the model calls `cook_recipe` without having read the recipe it can confabulate ingredients; v1 leans on the `recipe_uid`-resolves check plus the confirm view, with a server-side ingredients-vs-blob cross-check held as a hedged follow-up.

## Open (preliminary status)

- The widget **chip-language direction** — how a raw-ingredient chip and an intermediate chip are visually distinguished, and which intermediate encoding reads clearest — is being settled in a design playground before the Svelte components are built.
- The `cook_recipe` tool and the `ui://widget/cooking` widget are **not yet implemented**; this ADR records the decision, and the implementation design (schema, validation, widget modes, component reuse) lives in the Outline "C6 (#337): cooking widget" design doc.
- Two follow-ups are intended after the design lands: a hedged "cook widget hardening" item (the confabulation cross-check + a step-text coverage check, which may prove unnecessary if confabulation stays as low as the spike suggests) and a v2 "cook-mode timers + Wake Lock" item.

## References

- Issue: [#337](https://github.com/bojanrajkovic/mcp-paprika/issues/337) — the step-anchored cooking widget + log-cooked action.
- Builds on: [ADR-0019](0019-mcp-app-widget-surface.md) (the widget surface) and [ADR-0021](0021-reliable-structured-content-channel.md) (the reliable structured channel the feed travels on).
- Serves: [ADR-0008](0008-tool-surface-command-language.md) — the tool-surface command-language principle, and the big-input concern this decision weighs.
- Related future (not decided here): authoring recipes step-anchored at creation once the server owns its database.
