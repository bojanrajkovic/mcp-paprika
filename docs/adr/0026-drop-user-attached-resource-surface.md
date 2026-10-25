# ADR-0026: Drop the user-attached resource surface — the MCP surface is tools + widgets

**Status:** Accepted (2026-10-24)
**Supersedes:** the resource-classification decision of [ADR-0004](0004-tool-vs-resource-classification.md) (the rule that Content entities get a `paprika://` resource, and the "a `read_X` tool is not redundant with the `paprika://X/{uid}` resource" reasoning).

## Context

[ADR-0004](0004-tool-vs-resource-classification.md) placed every entity on up to two delivery surfaces: a **tool** the model calls on its own, and a `paprika://<entity>/{uid}` **resource** the user attaches into a conversation. It classified entities Content / Data / Reference and let the class pick the surface: Content (recipe, grocery list, menu) got **both** a resource and tools; Data got tools only; Reference got a list tool plus a managed lifecycle. The load-bearing claim — the thing the ADR said it was most often challenged on — was that a `read_X` tool is **not** redundant with the `paprika://X/{uid}` resource, because they sit on two different invocation paths serving two different consumers: the model (tool, autonomous) and the user (resource, reachable only through an `@`-attach the model cannot trigger).

Two things have shifted that premise since ADR-0004 was written, both already decided:

- **A third surface exists and is validated.** [ADR-0019](0019-mcp-app-widget-surface.md) added interactive `ui://` **widgets**, fed by the structured-output channel ([ADR-0021](0021-reliable-structured-content-channel.md)), and confirmed they render and round-trip on the primary mobile and desktop clients. The rich "show me this" view the resource's metadata-header-plus-inlined-children rendering used to serve — a whole recipe, a grocery list with its items, a menu with its courses — is now a widget (the recipe card, the grocery checklist, the menu view, the cooking view).
- **Tool results now carry the whole payload to the model on every host.** [ADR-0023](0023-json-or-widget-tool-results.md) made every schema-bearing tool emit its full structured payload as compact JSON on the text channel as well as `structuredContent`. The model gets the complete, identifier-carrying result — the thing it would have attached a resource for — from an ordinary `read_recipe` / `read_menu` / `read_grocery_list` call, on every host, with no attach.

The consumer is unchanged — still a person working through an LLM client. What changed is that, with those two surfaces in place, the resource-attach path no longer earns its keep:

- **Its model-facing half is now genuinely redundant.** ADR-0004's defense of `read_X`-and-resource rested on the resource reaching a consumer the tool could not. With ADR-0023, the tool reaches the model with the same complete payload; the resource hands the model nothing the read tool doesn't.
- **Its human-facing half is better served by a widget.** A person wanting to _see_ an entity gets a tappable, theme-aware widget, not a Markdown blob they manually attach.
- **`@`-attach is a host capability, not a protocol guarantee.** Across MCP clients, attach support is inconsistent — so the one consumer the resource existed for (the user, attaching) cannot be relied on to exist.
- **The attach list is poor UX at the library's scale.** `resources/list` over a 200-plus-recipe library is a wall, not a picker.

Finally, the notification seam exists **only** to serve this path. `resourceListChanged()` maps to exactly one wire notification, `notifications/resources/list_changed` — "re-fetch the browsable list." There is no `resources/updated` and no subscription machinery, so it never delivered live content refresh of an open view; it only refreshed the attach picker. And recipe **photo uploads already do not fire it** (`attachPhotoToRecipe` is deliberately silent), so the surviving `ui://recipe/{uid}/photo` proxy's browse list was never maintained by it either. With the content resources gone, `resourceListChanged()` has no consumer at all.

## Decision

**The MCP surface is tools (for the model) and widgets (for tap-first human interaction). There is no user-attached resource surface.**

- **Remove the three `paprika://` content resources** (recipe, grocery list, menu) and the `paprika://` URI scheme. The model read path is the `read_*` / `list_*` / `search_*` tools (carrying the full structured payload, ADR-0023); the rich human view is the widget surface (ADR-0019).
- **Remove `resourceListChanged()` wholesale** — the `Notifier` method, every call site (recipe, grocery, menu, aisle, meal-type commits and the shared catalog delete), and the `notifyFromResults` sync-loop fan-out — because its sole consumer, the attach picker, is gone. The `Notifier` shrinks to logging.
- **Retire Content / Data / Reference as a _surface-deciding_ taxonomy.** With resources gone, Content and Data both reduce to "tools, plus a widget where [ADR-0019](0019-mcp-app-widget-surface.md)'s demonstrated-need bar is met"; the Content-vs-Data line no longer changes any surface. What survives of the taxonomy lives elsewhere and is unchanged: which tools earn a widget is ADR-0019; the command-language shape of the tool surface is [ADR-0008](0008-tool-surface-command-language.md); Reference's "list tool + managed lifecycle" is [ADR-0017](0017-reference-catalog-management-tools.md) (Reference never had a resource, so it is untouched). The container-vs-row intuition still informs what a read inlines and what earns a widget — it just no longer decides a resource surface.

**Kept, explicitly:**

- **The `ui://` widget scheme** ([ADR-0019](0019-mcp-app-widget-surface.md)) and the **`ui://recipe/{uid}/photo` proxy resource**. These are `ui://`, fetched **by URI** by the host/iframe (a widget resolves the specific photo URI from its structured feed), never browsed or attached — so they are unaffected by removing the attach surface and its list notification. The `photoResourceUri` field on browse rows and the `read_recipe` structured output stays; it is how a widget locates a recipe's photo.
- **Every non-content notification:** logging messages, the index-event seam (recipe writes → discover re-index), and the `notifySync` cloud-sync nudge. Only `resourceListChanged` is removed.

## Rejected alternatives

### Keep ADR-0004's dual surface (a `paprika://` resource for Content alongside its tools)

Rejected because both halves of ADR-0004's justification have lapsed. The model-facing half is redundant: ADR-0023 already delivers the full structured payload to the model through the read tool, on every host, without an attach. The human-facing half is superseded: the rich attachable view is now a widget (ADR-0019), which is interactive and theme-aware where the resource was static Markdown. And the path depends on a host `@`-attach capability that MCP clients support inconsistently, over an attach list that does not scale to the library.

### Keep one entity (menu, or recipe) as a resource — the "attachable document" case

Rejected because every content entity now has identical tool + widget coverage (`read_menu` for the model, `ui://widget/menu` for the human, and likewise for recipe and grocery list). Singling one out would reintroduce, for that entity alone, exactly the redundant surface this decision removes uniformly — with no consumer the tool and widget do not already serve.

### Deprecate the resources first, then delete later

Rejected because the removal can't be signaled at runtime in a way a user would notice: an attach picker that quietly shrinks says nothing. The clear signal is the version number. The removal ships as a breaking change in a major release, with migration notes pointing at the `read_*` tools and widgets, and the replacement surface is already validated on the primary clients.

### Keep `resourceListChanged` for the `ui://recipe/{uid}/photo` proxy list

Rejected because that proxy is fetched by URI, never browsed via `resources/list`, so a list-changed notification has no consumer for it; photo uploads already do not fire the notification, so it was never a maintained signal; and keeping it would preserve dead machinery threaded through the `Notifier`, the sync loop, and both transports for nothing.

## Consequences

**Positive**

- One model surface (tools, full structured payload reaching the model on every host) and one human surface (widgets, where interaction beats text). The `read_X`-vs-resource redundancy, the attach-list wall, and the two-rendering-paths-kept-consistent burden all disappear — including the three resource-only Markdown formatters (`recipeToMarkdown` / `groceryListToMarkdown` / `menuToMarkdown`) that ADR-0023 had kept alive solely for the resources.
- The `Notifier` shrinks to logging, and the sync loop stops fanning out list-changed notifications — less transport-conditional machinery, fewer per-commit effects to reason about.
- The surface no longer depends on a host `@`-attach capability that MCP clients support inconsistently.

**Negative**

- A user on a host that _did_ support `@`-attach loses the ability to inject a recipe / list / menu as literal conversation context. Accepted: the model already reaches that content through its tools, and the human view is richer as a widget.
- Removing `resourceListChanged` drops the cross-device refresh hint. Accepted: it only ever nudged the attach picker (there are no resource subscriptions, so it never refreshed an open view or widget), and background sync still keeps the local cache fresh for the next tool call.
- ADR-0004's single-label classification was a fast test for a _new_ entity's surface; its surface half is gone, so a new entity's surface is now decided by ADR-0008 (is the intent expressible as a tool?) plus ADR-0019 (does it clear the widget bar?) rather than one Content/Data/Reference label.

## References

- Supersedes the resource-classification decision of [ADR-0004](0004-tool-vs-resource-classification.md): the Content-gets-a-resource rule and the "`read_X` is not redundant with the resource" reasoning. ADR-0004's Data (tools-only) and Reference (list + managed lifecycle) guidance is unchanged and carried forward via [ADR-0008](0008-tool-surface-command-language.md) and [ADR-0017](0017-reference-catalog-management-tools.md).
- Builds on [ADR-0019](0019-mcp-app-widget-surface.md) (the widget surface that replaces the rich human view) and [ADR-0021](0021-reliable-structured-content-channel.md) / [ADR-0023](0023-json-or-widget-tool-results.md) (the structured channel and the full-payload-as-JSON-on-text that gives the model the complete result without an attach).
- Kept and out of scope: the `ui://` widget scheme and the `ui://recipe/{uid}/photo` proxy resource.
