# ADR-0004: Classify every entity as Content, Data, or Reference to decide its MCP surface

**Status:** Accepted (2026-06-01, backfilled)
**Last verified:** 2026-06-01

## Context

The Paprika domain has many entity types — recipes, categories, pantry items, grocery lists and their items, aisles, menus and their items, meal-planner entries, and meal types. Each one could, in principle, be exposed to an MCP client three ways: as a **tool** the model invokes on its own, as a **resource** the user attaches into a conversation, or as both. Exposing everything as everything is the path of least resistance and the path to an unusable surface: hundreds of redundant tools and resources, each carrying maintenance cost and each diluting the model's ability to pick the right one.

Two facts about MCP drove the need for a deliberate rule:

- **Tools and resources have different invocation paths, and they are not interchangeable.** A resource is reachable only when a _user_ attaches it (via `@` in Claude Code, or the attach UI in Claude Desktop). The model cannot reach a resource on its own. The only way the model can pull an entity into context autonomously is through a tool. So the two surfaces serve two different consumers — the user (resource) and the model (tool) — not two implementations of one need.
- **Not every entity is something a person would ever attach.** A whole recipe or a whole grocery list is a coherent document a user might drop into a chat to discuss. A single pantry row or one grocery line-item is not — it is meaningful only inside its container or in aggregate. And some entities exist purely so the model can resolve a display name to a UID; nobody attaches an aisle.

The consuming audience is an LLM agent acting on behalf of a non-technical Paprika user, so the surface is optimized for model UX (the right tool is obvious and there is no redundant noise), not for the convenience of whoever is wiring up the server.

The authoritative list of what is actually registered lives in code (`src/server/build.ts`); this ADR governs the _reasoning_ that decides what belongs there, not the enumeration itself.

## Decision

Classify every entity type into exactly one of three classes, and let the class dictate the surface.

The classifying question is: **would a user attach this entity into a conversation to discuss it?**

- **Content** — yes, a user would attach it. It gets a **resource** surface (a list callback plus a `paprika://<entity>/{uid}` URI template with rich rendering) **and** a full tool surface for model-driven read, query, and mutation. Recipes, grocery lists, and menus are Content.
- **Data** — no, a user would not attach an individual record, but the model still needs to query and mutate single records. It gets **tools only** (list, get, write operations) and **no** resource surface. Pantry items, grocery items, menu items, and meal-planner entries are Data.
- **Reference** — no, it is organizational lookup data the model resolves names against when creating or filtering other entities. It gets a **single list tool** — no individual read, no CRUD, no resource. Categories, aisles, and meal types are Reference.

For ambiguous entities the tiebreaker is container-vs-row: a container (it has children) or a standalone document (rich enough to read on its own) is Content; a row that is meaningful only in aggregate or as part of a container is Data. This is why a meal _type_ (the catalog "Breakfast / Dinner / Brunch") is Reference while a meal _entry_ (a recipe scheduled on a date) is Data — and why a menu (a container with inlined items) is Content while its menu items are Data.

The load-bearing consequence of this scheme — and the thing it is most often challenged on — is that **a `read_X` tool is not redundant with the `paprika://X/{uid}` resource for the same entity.** They live on the two different invocation paths above: `read_recipe` exists so the model can fetch a recipe by UID or title without the user lifting a finger; the recipe resource exists so the _user_ can inject that recipe as context. Content entities therefore legitimately carry both. The two paths also render differently: tool output is clean, action-oriented markdown (the model already holds the UID in its call chain), while resource output prepends a small metadata header (URI, last-synced, and, for containers, the inlined child items) so a single resource read gives the user complete standalone context.

For Content containers, the resource read inlines all children (a grocery-list resource embeds its items; a menu resource embeds its menu items) so one attach yields the full picture. This is also why a container's sync changes — including changes to its child items — trigger a resource-list-changed notification, while pure-Data entities like pantry items emit none.

## Rejected alternatives

### Treat `read_X` tools as redundant with the `paprika://X/{uid}` resource and drop one of them

Rejected because the two are not redundant: they sit on different invocation paths. A resource is only reachable through a user attach action; the model can never pull it autonomously. Dropping the `read_X` tool would leave the model unable to fetch a Content entity by UID or title on its own — it would have to wait for the user to attach it. Dropping the resource would deny the user the ability to inject the entity as discussion context. Content entities need both, deliberately.

### Expose Data-class entities (pantry items, grocery items, meal entries) as resources too

Rejected on cost-without-benefit grounds. These records are too granular for a user to attach individually — nobody `@`-mentions a single grocery line. The model reaches them through list/get tools, which is sufficient. Adding a resource surface would duplicate the tool output with no consumer on the other end while adding a second rendering path to maintain.

### Give Reference-class entities (categories, aisles, meal types) individual read tools, CRUD, or a resource surface

Rejected because these entities exist only to let the model resolve a display name to a UID when authoring or filtering other entities. A single list tool satisfies that. There is no document to read on its own and (in the case of meal types) no content the model authors — creating a meal type is a one-time configuration act performed by preference in the Paprika app, not model-authored content. Categories do carry write tools, but as a deliberate exception for an organizational structure the model legitimately curates; they still get no individual read and no resource, since category data is resolved on demand when rendering the recipes that reference it.

### Other weighed alternatives

_Not recorded at decision time — needs owner input._

## Consequences

**Positive**

- The surface stays small and legible to the model: each entity has exactly the affordances its class warrants, so the model is not choosing among redundant tools or unreachable resources.
- The Content/Data/Reference label is a fast, repeatable test for any _new_ entity. When a domain type is added, its class is decided first and its surface falls out mechanically, which keeps the surface internally consistent as it grows.
- Users get rich attachable context exactly where it makes sense (whole recipes, lists, menus) without the surface being cluttered by attachable single rows nobody would attach.
- The split keeps two rendering paths honest: tool output optimized for the model (no echoed UID), resource output optimized for the user (metadata header plus inlined children).

**Negative**

- The classification is a judgment call at the margins. The container-vs-row tiebreaker resolves most cases, but a genuinely ambiguous future entity still needs a human decision, and a wrong call ships either a missing affordance or a redundant one.
- Content entities maintain two rendering paths (tool markdown and resource markdown) for the same data, which must be kept consistent — a shared markdown helper mitigates this but does not eliminate the duplication.
- The rule is a convention, not a compile-time constraint. Nothing in the type system prevents someone from registering a resource for a Data entity or a redundant read tool; conformance is enforced by review against this ADR, not by the build.

## References

- `docs/mcp-surface-design.md` — the original surface-design note this ADR supersedes; its drift-prone decision/audit tables (tool counts, per-entity surface inventory) are intentionally **not** carried forward, because `src/server/build.ts` is the canonical registration list.
- `src/server/build.ts` — authoritative list of registered tools and resource families.
- Related: `docs/architecture.md` for the in-memory-store / disk-cache / sync model that backs both surfaces; the per-entity store contracts in `src/server/CLAUDE.md` annotate each store with its Content/Data/Reference role.
