# ADR-0019: Add an interactive widget surface fed by a structured output channel

**Status:** Accepted (2026-06-18)

## Context

Every tool returns a single Markdown text block, and that one block has to serve two consumers whose needs pull apart. A person reading a result wants clean, scannable prose — a grocery list as ingredient, quantity, aisle, and purchased state, with no identifier noise. The model driving the next call needs the machine identifiers (item and child UIDs) that the follow-up tools consume. Today these are reconciled per renderer by a flag that toggles a UID column on or off, which forces an either/or: a block is clean _or_ it carries identifiers, never both, and the same fork is re-implemented in each renderer rather than solved once (#303).

A larger gap sits behind that one. The server's primary consumer is a mobile client talking to the self-hosted HTTP deployment over its OAuth-gated public endpoint, used in exactly the situations — standing in a grocery aisle, working at a stove — where a tap target beats a paragraph of prose and a typed instruction. A Markdown table cannot offer a checkbox; the user must narrate every act ("mark milk purchased") instead of tapping it. MCP defines an interactive UI surface in which a tool references a `ui://` resource that the host renders in a sandboxed iframe and bridges to, but whether a given client renders it is a host capability rather than a protocol guarantee, and the mobile client's support was unknown.

[ADR-0004](0004-tool-vs-resource-classification.md) places every entity on exactly two delivery surfaces — a tool the model calls and a resource the user attaches — and explicitly refuses to add a surface without a demonstrated consumer. An interactive widget is a third surface, so it must clear that bar rather than assume it. That bar is now met: the interactive surface renders and round-trips on both the desktop and mobile clients through the existing connector — the host fetches the `ui://` resource, renders it in an iframe, feeds the tool's result in, honors the host theme, and carries an action back out from the widget. The consumer ADR-0004 demanded exists, and on the primary surface.

## Decision

Adopt two complementary, standard-MCP mechanisms for delivering tool results.

**A structured output channel.** List- and container-shaped reads gain a declared output schema and return their data as structured content carrying the machine identifiers, alongside a clean, identifier-free Markdown block for the human. The host shows the Markdown to the user and feeds the structured payload to the model, so the two consumers no longer contend for one channel and the per-renderer UID-column flag is retired. This is the broadly applicable change.

**An interactive widget surface.** A tool whose result is spatial, list-pick, or action-bearing declares a `ui://` view through its UI metadata, and a companion resource serves that view's HTML under the MCP-app MIME type for the host to render in a sandboxed iframe. The same structured payload is the widget's data feed, so the structured channel does double duty. Widget-bearing tools degrade gracefully: a host without the apps surface ignores the UI hint and shows the textual/structured result, so the surface is additive and never required.

Which tools earn a widget is governed by the demonstrated-need discipline ADR-0004 already applies to resources: a widget is warranted only where interaction or spatial layout genuinely beats text — a tappable purchased-checklist, a recipe card, a step-anchored cooking view — while a flat confirmation or a short pick routes to spec-native elicitation instead.

This option beat the field because it resolves both pressures with one coherent data contract. A typed structured channel is the idiomatic MCP vehicle for machine-readable output, so the model never scrapes an identifier out of prose; it keeps the human's view clean without a per-renderer flag; and it is exactly the feed an interactive widget consumes — making the structured-output work both valuable on its own and the foundation the widget surface builds on.

## Rejected alternatives

### A second JSON text block beside the Markdown

Rejected because both text blocks render to the human, so a raw JSON block becomes noise in the user's result view — defeating the clean-human-channel goal that motivated the split. Structured content is the field the protocol provides precisely so machine data travels in a lane the host need not show the user.

### Keep the per-renderer UID-column flag

Rejected because it is one channel toggled two ways: a block is clean or it carries identifiers, never both, so the model and the human can never be handed the same result, and the fork is duplicated in every renderer instead of solved once.

### Defer the widget surface until a consumer is demonstrated

Rejected because the consumer is now demonstrated: the apps surface renders and round-trips on the primary mobile client, which is the exact bar ADR-0004 sets for adding a surface. Continuing to defer would decline a validated, high-value interaction on the surface where the server is most used.

### Pursue rich interaction through MCP elicitation alone

Rejected because elicitation cannot scroll, search, preview, or live-update — it fits a flat confirmation or a short enum, not a searchable checklist with per-row actions or a spatial cooking view. Elicitation stays the right tool for the flat cases; it cannot carry the interactions that motivate the widget surface.

## Consequences

**Positive**

- The model receives a typed, validated identifier channel instead of scraping UIDs from a Markdown table, and the human keeps a clean view — both from one envelope — directly serving the [ADR-0008](0008-tool-surface-command-language.md) principle of minimizing the agent's chance of getting a call wrong.
- The interactive surface is validated on the primary client in both directions and on both desktop and mobile, unlocking tap-to-act experiences where text is weakest (in a store, at a stove).
- The structured channel and the widget feed are the same payload, so the foundational work is reused rather than duplicated when widgets are added.
- The surface is additive and degrades to text on hosts without the apps surface, so non-widget clients and the stdio transport are unaffected.

**Negative**

- A widget is a new kind of artifact in a codebase that had no front-end: HTML/JS served as a resource, an iframe sandbox with its CSP constraints, a browser runtime bundle served with the HTML, and a dependency on the apps SDK — each maintained per widget. (The runtime was originally **inlined** into every widget's self-contained HTML; [ADR-0025](0025-externalize-widget-vendor-runtime.md) later **externalized** it as one shared, content-hashed vendor module — served from a self-hosted, immutable-cached route over HTTP and an inline `data:` URL over stdio — so the build-time-only apps-SDK constraint stands but the runtime is no longer re-shipped per widget.)
- Declaring an output schema makes the structured payload a contract the SDK validates on every non-error result, forcing a decision on the existing uid-or-text lookup tools' non-happy-path returns (a not-found or a multiple-match outcome) — most cleanly resolved by signaling those as errors with a remediation hint rather than as plain text.
- The kernel's tool-definition seam carries no UI metadata today; adding the widget surface through the kernel (rather than registering on the session server outside it) requires extending that seam to thread UI metadata as data, consistent with the specs-as-data principle of [ADR-0011](0011-tool-specs-as-data.md).
- Each widget is a small product surface to design and keep theme-aware and viewport-correct across light/dark and mobile safe-area insets — an ongoing cost the text path does not carry.

## References

- Issue: [#303](https://github.com/bojanrajkovic/mcp-paprika/issues/303) — the structured-vs-Markdown channel question this resolves.
- Related: [ADR-0004](0004-tool-vs-resource-classification.md) — the two-surface (tool/resource) classification this amends by adding a third, widget surface under the same demonstrated-consumer discipline.
- Related: [ADR-0008](0008-tool-surface-command-language.md) — the tool-surface command-language principle the structured channel serves.
- Related: [ADR-0011](0011-tool-specs-as-data.md) — the specs-as-data principle the kernel's UI-metadata seam should follow.
- Related: [ADR-0021](0021-reliable-structured-content-channel.md) — commits `structuredContent` as the model's reliable identifier channel and removes the UID text fallback, completing the R1 clean-text half of this decision.
- Superseded in part: [ADR-0025](0025-externalize-widget-vendor-runtime.md) — externalizes the inlined ext-apps runtime as one shared, content-hashed vendor module (transport-conditional self-host + import map).
- Follow-on feature work (not decided here): the grocery purchased-checklist widget as the first widget, and the cooking step-anchored ingredient/step view; specific widget designs are captured with their features.
- External: the Model Context Protocol apps/UI surface (`ui://` resources and the app bridge) and the `@modelcontextprotocol/ext-apps` SDK.
