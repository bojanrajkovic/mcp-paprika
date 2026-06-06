# ADR-0017: Reference catalogs gain full management tools (sole-surface completeness)

**Status:** Accepted (2026-06-06)

## Context

[ADR-0004](0004-tool-vs-resource-classification.md) classified aisles and meal types as Reference-class entities with a list tool only, on the reasoning that creating or editing one was "a one-time configuration act performed by preference in the Paprika app." The LLM-only direction (the audit in [#245](https://github.com/bojanrajkovic/mcp-paprika/issues/245), following [#224](https://github.com/bojanrajkovic/mcp-paprika/issues/224)) removed that premise: when this server is the _sole_ surface, every intent the app could express must be expressible through tools, or it is expressible nowhere. #224's amendment gave both catalogs **auto-create** (`ensureAisle` / `ensureMealType`); [#244](https://github.com/bojanrajkovic/mcp-paprika/issues/244) named the missing removal half; the #245 audit added the missing edit half (rename / reorder / recolor) and demanded a per-catalog deletion-semantics design.

Completeness here is measured in **intents, not wire columns** ([ADR-0008](0008-tool-surface-command-language.md)'s "hide fields with no meaningful agent choice" survives the flip): meal-type's `exportAllDay`/`exportTime` configure the retired app's device-calendar export and stay unexposed; a recipe's `scale` is app display state the agent computes on the fly.

Three design forces shaped the tools:

- **Grocery and pantry items denormalize the aisle NAME** (and UID), and the renderers grouped/displayed that copied string — so a bare rename would strand stale names on every existing item.
- **The kernel's dependency graph makes the catalogs leaves.** Aisle cannot see the grocery/pantry items that reference it (those domains depend _on_ aisle; the reverse edge would cycle), and meal-type cannot see meals or menus. A delete guard needs the referencing side.
- **The two catalogs' referencing sets differ in kind.** Aisle references are current, reassignable state (items on a list, items in the pantry). Meal-type references are dominated by append-only history (every meal ever logged under a type references it forever).

## Decision

### Edit tools, in the owning domain

`update_aisle` (rename + reorder) and `update_meal_type` (rename + recolor + reorder) live in their catalog's own domain — pure intra-catalog writes need no cross-domain reads. Reorder is a 1-based `position` on the update tool (the "put Produce first" phrasing), not a separate full-order tool; the server renumbers order flags contiguously and batch-saves only entries that changed. Rename/recolor-only edits leave order flags untouched (they may be sparse; renumbering would rewrite the whole catalog for a one-entry edit). Built-in meal types are editable; `originalType` is never touched, so a renamed built-in keeps resolving for `{builtin}` specs.

### Renames propagate by render-resolution, not cascade

The grocery/pantry renderers resolve an item's aisle display name through the live catalog (`aisleDisplayName` in `src/domains/aisle/display.ts` — the contract's one definition), falling back to the item's denormalized copy only for a dangling/no-aisle reference. This is the same pattern recipes already use for category names (FK-only, resolve at render — see `src/cache/CLAUDE.md`), and it makes a rename one catalog write. The denormalized name on the wire copies of old items goes stale; nothing this server renders reads it anymore.

Render-resolution has a notification consequence: a catalog commit changes the rendered content of grocery-list and menu RESOURCES without any grocery/menu entity changing, so the aisle and meal-type commit effects fire `resourceListChanged()` even though neither catalog has a resource surface of its own. And it sets the dangling-reference presentation: a `typeUid` whose type was deleted renders with NO type label (the meal card omits the Type line, the grouped meal lists group under "—", a menu item line drops its type prefix) — never a raw UID or a misleading `Type N`; the legacy `typeUid: null` meals keep their integer-derived label, which is a different case.

### Delete tools, homed where the references are visible

- **`delete_aisle` lives in grocery** (which owns grocery items, reaches pantry's count via `ctx.deps.pantry.countItemsInAisle`, and reaches the catalog write via the new `AisleApi.deleteAisle`). It **blocks** while unpurchased grocery items or pantry items reference the aisle, with an executable remediation hint (`update_grocery_item` / `update_pantry_item`) — the `delete_category` precedent. Purchased grocery items don't block (shopping history; render-resolve degrades them to the denormalized name). The grocery-ingredient catalog's aisle memory never blocks and is **not scrubbed**: the add flow already treats a dangling catalog reference as "no memory" (it falls through to the Miscellaneous placement), so a scrub would be behaviorally invisible — and a guard must never block on state the user has no tool to fix.
- **`delete_meal_type` lives in the meal-planner coordinator** (which sees meal + menu for the impact counts, and the catalog write via `MealTypeApi.deleteMealType`). For CUSTOM types it **warns-and-proceeds**: the response reports how many meals/menu items referenced the type, the renderers omit a dangling `typeUid`, and blocking on append-only meal history would make any type ever used in a logged meal permanently undeletable. **Built-ins refuse deletion**: `{builtin: N}` specs — including `log_cooked_meal`'s Dinner default — resolve by `originalType`, and auto-create can only mint a custom type (`originalType: null`), so a deleted built-in would break builtin-spec resolution permanently with no recovery path. Built-ins remain fully editable (`update_meal_type` never touches `originalType`).

Both deletes are wire tombstones (`deleted: true` POSTed to the collection URL — the uniform shape every collection-POST entity uses) followed by the local delete commit; the contract methods err with ready-to-surface messages and are retry-safe after a successful POST.

### The mutation-surface rationale (#244's rubric gate)

These are the first explicit destructive tools on any reference catalog. The demonstrated need ADR-0008's rubric requires is the sole-surface premise itself: a mistyped auto-created catalog entry (the direct byproduct of #224's auto-create) is otherwise permanent. The verbs stay bare `update_`/`delete_` core commands — no intent-verb promotion, since no richer user phrase exists than the act itself.

## Rejected alternatives

### Cascade-rewrite referencing items on aisle rename

Rejected: N item rewrites across two collections per rename, with mid-cascade partial-failure states, to keep a denormalized copy true that nothing rendered by this server needs — render-resolution makes the copy a fallback instead.

### A separate full-order reorder tool (`reorder_aisles` taking the complete order)

Rejected as surface without demonstrated need: single-move phrasing dominates, and the `position` field covers it. Revisit only if "match my store layout: [list]" turns out to be a real repeated intent.

### Block `delete_meal_type` on references (the `delete_category` mirror)

Rejected because meal references are append-only history: the guard's remediation would be "rewrite your cooking log," which is not a real action. The hybrid (block on menu items, warn over meals) was considered and dropped — one warn-and-proceed rule is easier for the agent to predict, and menu items degrade identically.

### Scrub the grocery-ingredient catalog on aisle delete

Rejected after reading the add flow: a dangling catalog reference already degrades to the same Miscellaneous placement a scrubbed one would produce, so the scrub costs wire writes and failure modes for zero observable change.

## Consequences

**Positive**

- The Reference class is now lifecycle-complete under the sole-surface premise: auto-create + list + edit + delete, with deletion semantics matched to each catalog's reference kind.
- The "tool homed where its references are visible" rule keeps the dependency graph acyclic without weakening the catalogs' leaf position; the catalog writes stay with their owners via narrow contract methods.
- Render-resolution retires the stale-denormalized-name class of bugs for every future catalog rename, not just this one.

**Negative**

- The two delete tools live outside their entity's domain directory (grocery, meal-planner), so "where is delete_aisle?" is no longer answerable from the directory layout alone — the contract methods' doc comments and this ADR carry the pointer.
- Wire copies of items keep pre-rename aisle names forever (no cascade); any future consumer that reads the denormalized field directly (instead of resolving) would resurface stale names.
- `delete_meal_type` can orphan meal/menu references by design; anything new that renders a `typeUid` must follow the omit-dangling convention (no raw UIDs, no `Type N` for a deleted type).
- Built-in meal types are permanently undeletable through this surface. If Paprika's own clients ever delete one remotely, the replace-all sync honors it — the refusal protects only against this server doing the irreversible thing itself.

## References

- [#244](https://github.com/bojanrajkovic/mcp-paprika/issues/244) (delete tooling), [#245](https://github.com/bojanrajkovic/mcp-paprika/issues/245) (the completeness audit), [#224](https://github.com/bojanrajkovic/mcp-paprika/issues/224) (auto-create).
- [ADR-0004](0004-tool-vs-resource-classification.md) (classification; amended for the sole-surface premise), [ADR-0008](0008-tool-surface-command-language.md) (command language + promotion rubric), [ADR-0010](0010-reference-sync-tier.md) (reference catalogs in sync).
- `src/domains/aisle/tools/update-aisle.ts`, `src/domains/grocery/tools/delete-aisle.ts`, `src/domains/meal-type/tools/update-meal-type.ts`, `src/domains/meal-planner/tools/delete-meal-type.ts` — the four tools this ADR governs.
