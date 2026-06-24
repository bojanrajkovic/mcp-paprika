# ADR-0023: A tool result is JSON-or-widget — carry the structured payload on both channels

**Status:** Accepted (2026-06-24)

## Context

[ADR-0019](0019-mcp-app-widget-surface.md) split a tool's result into two consumers: a clean human-readable Markdown block for the person and a `structuredContent` record carrying the machine identifiers for the model. [ADR-0021](0021-reliable-structured-content-channel.md) then committed `structuredContent` as the model's reliable identifier channel and **removed the machine UIDs from the text** — `read_recipe`'s UID moved to `structuredContent`-only — on the premise that every targeted host forwards `structuredContent` to the model's tool-result context.

That premise does not hold. Whether a host surfaces `structuredContent` to the **model** is a per-**host** choice, not per-model, and the server cannot detect it: the MCP client capability set advertises no "I deliver `structuredContent` to the model" flag, and the apps/widget capability describes a different consumer (host → iframe). Real-client testing of the cooking surface ([#337](https://github.com/bojanrajkovic/mcp-paprika/issues/337) / [#428](https://github.com/bojanrajkovic/mcp-paprika/issues/428)) confirmed the divergence directly: Claude Code and ChatGPT-in-chat surface `structuredContent` to the model, **Claude Desktop hands the model only the text content**. With `read_recipe`'s UID in `structuredContent` only, the model on Claude Desktop could not chain `read_recipe → cook_recipe` (or `→ rate_recipe` / `categorize_recipe` / `favorite_recipe`); it "got away with it" elsewhere only because `search_recipes` / `list_recipes` kept the UID in their text.

The text content block is therefore the only channel guaranteed to reach the model on every host. Anything the model needs to drive a follow-up must travel there, unconditionally — there is no host signal to gate on.

A second force compounds this. The two-consumer split made each tool maintain **two views of the same data** — a hand-authored Markdown formatter (`recipeToMarkdown`, `groceryListToMarkdown`, …) for the text and a structured builder (`recipeToReadStructured`, …) for `structuredContent`. The two drift: the Markdown view is where the UIDs the model needs got dropped, and "which identifiers live in which view" became a recurring per-renderer fragility ([#303](https://github.com/bojanrajkovic/mcp-paprika/issues/303)).

## Decision

A schema-bearing tool's result is **structured JSON or a widget — not hand-authored Markdown prose**. Both channels carry the **same payload**: `structuredContent` stays exactly as it was (it feeds widgets and the hosts that surface it to the model), and the **text block carries that same payload as compact JSON** (`JSON.stringify` of the structured record). `structuredResult(structured)` — built on the existing `toolResult(text, structured)` primitive — is the single emit point; it derives the text from the one structured payload, so the per-tool Markdown formatter that was a second source of truth falls away.

The text is the universal floor (the model everywhere, plus a complete machine-readable result a non-widget host's model renders its own human view from); `structuredContent` is the widget feed and the forward bet on evolving host support. The per-tool emit stays **localized** in `structuredResult`: if the dual channel ever measurably costs tokens on a structured-surfacing host, dropping `structuredContent` on a non-widget tool is a one-line change there (swap to `toolResult(JSON.stringify(s))` and remove its `outputSchema` — the SDK requires `structuredContent` once a schema is declared). The JSON is compact, not pretty-printed: the model reads either form and hosts that surface read results collapse them, so legibility buys little against the per-result token cost.

This beat the field because it is the only option that reaches the model on every host **and** collapses the two-view duplication, while keeping the widget feed and a clean per-tool seam intact.

Two surfaces are scoped out. The **`paprika://` resources** keep their Markdown rendering: a person attaches and reads them directly, so they are not subject to the model-channel concern (resources ≠ tool results) — which is why `recipeToMarkdown` / `groceryListToMarkdown` / `menuToMarkdown` survive while the tool-only formatters are deleted. The **photo tools** (`upload_recipe_photo` / `generate_recipe_photo`) keep their human caption: their human view is the inline image content block, their caption already carries the chainable UID, and they have no duplicated Markdown formatter — so flipping them to JSON would degrade the human view for no model-facing gain.

Where the old Markdown text carried **call-specific advisory data the structured payload lacked** and it is non-derivable, that data becomes a field on the payload: the batch-add duplicate-skip notices (an existing item's UID plus a merge hint, present nowhere else in the response) ride a `skipped` array on `add_pantry_items` / `add_grocery_items` / `add_recipe_to_grocery_list`. Advisory data that is purely display-only or model-derivable is dropped (an unverified-time caveat, an unknown-category warning, an orphan-category note, a meal-type export schedule).

## Rejected alternatives

### Keep the clean Markdown text beside `structuredContent` (the ADR-0021 status quo)

Rejected because it is exactly what broke: it relies on the host forwarding `structuredContent` to the model, which Claude Desktop does not do, so the model cannot chain on identifiers the text omits — and that is undetectable at the handshake, so there is no conditional fix.

### Drop `structuredContent` and ship JSON-as-text only (a single channel)

Rejected because `structuredContent` is the widget feed and the typed channel the apps surface and structured-surfacing hosts already consume; removing it would break every widget and forfeit the forward bet on hosts that do deliver it to the model. The cost of keeping both is one JSON serialization per result.

### Keep a hand-authored Markdown view for the model (re-derive identifiers into prose)

Rejected because it reinstates the two-views duplication this decision removes: a second source of truth that drifts from the structured payload and is precisely where the UIDs got dropped. One payload, mechanically serialized, cannot drift.

## Consequences

**Positive**

- The machine identifiers a follow-up keys on reach the model on **every** host, closing the `read_recipe → cook_recipe` gap on Claude Desktop and any host that withholds `structuredContent` from the model.
- One source of truth per tool (the structured payload); the per-tool Markdown formatter and the "which identifiers live where" fragility are gone.
- The emit is localized in `structuredResult`, so a future per-tool retreat from the dual channel is a one-line, low-risk change.

**Negative**

- A host that renders tool text **inline** (not collapsed) shows the user raw JSON instead of prose. This is accepted: the primary surfaces collapse read results, and a non-widget host's value is the model rendering its own view from the JSON.
- The hand-authored human prose (and the friendly per-call advisories that were display-only) is lost on the tool surface; only the resource surface retains Markdown.
- The dual channel serializes the payload twice (once as JSON text, once as `structuredContent`) and carries it twice on the wire — a token cost on every schema-bearing result, mitigated by the localized seam that makes dropping one channel cheap if it ever matters.
- This supersedes the clean-text half of [ADR-0021](0021-reliable-structured-content-channel.md): the read formatters no longer strip the UID from the text — the text now carries every machine field as JSON.

## References

- Supersedes the clean-text decision of [ADR-0021](0021-reliable-structured-content-channel.md); amends the human/structured split of [ADR-0019](0019-mcp-app-widget-surface.md).
- Serves: [ADR-0008](0008-tool-surface-command-language.md) — minimizing the agent's chance of getting a call wrong.
- Issue: [#429](https://github.com/bojanrajkovic/mcp-paprika/issues/429); discovered during [#337](https://github.com/bojanrajkovic/mcp-paprika/issues/337) / [#428](https://github.com/bojanrajkovic/mcp-paprika/issues/428) real-client testing on Claude Desktop.
- External: the Model Context Protocol tools specification — `outputSchema` / `structuredContent`, and its recommendation to also serialize structured content into a text content block for backwards compatibility.
