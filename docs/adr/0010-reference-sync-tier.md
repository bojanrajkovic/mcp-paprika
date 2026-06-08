# ADR-0010: A `reference` sync tier for lookup catalogs

**Status:** Accepted (2026-06-04)
**Refines:** [ADR-0009](0009-domain-isolated-tool-modules-kernel.md) (the kernel sync driver)

> **Note (2026-06-05, [ADR-0014](0014-neverthrow-core-foreign-boundaries.md)):** the abort seam this ADR describes in throw terms is now `Result`-based. A reconcile returns `ResultAsync<AnySyncResult | void, SyncError>` and never throws; "a core failure aborts the cycle" means a core reconcile's `err` (the driver logs it and returns `[]`), and a `reference`/`additive` `err` is logged best-effort instead of being caught. The tier model, ordering, and blast-radius semantics decided here are unchanged.

## Context

The kernel's sync driver ran two tiers (ADR-0009): `core` reconciles in dependency order, where one failure aborts the whole cycle (no flush, no sweep, remaining reconciles skipped), and `additive` reconciles, each wrapped in its own best-effort try/catch so a soft read surface can't abort the primary sync.

The domain model has three **reference catalogs** — aisle, category, meal-type (ADR-0004's _Reference_ class): small lookup tables other entities resolve a display name against. They had been split across both tiers with no principled basis — aisle and category in `core`, meal-type in `additive`. The split was incidental, and reviewing meal-type ([#224](https://github.com/bojanrajkovic/mcp-paprika/issues/224)) surfaced the question of where a reference catalog belongs.

Two facts decide it:

- **Tiers scope abort-blast-radius, not data ordering.** No reconcile reads a sibling domain's store: each touches only its own `ctx.state` and `ctx.infra` (the Paprika client + log), never `ctx.deps`. Catalog UID→name resolution happens at _tool-invocation_ time against the warm in-memory store, and the cold-start "synced before tools" guarantee comes from the boot sequence (the initial `syncOnce` completes before any tool registers), not from intra-cycle ordering. So a tier assignment governs only which reconciles a failure takes down — not whether one reconcile sees another's fresh data.
- **A catalog in `core` is over-protected, and the protection runs the wrong way.** Putting aisle/category in `core` means a transient `listAisles()` / `listCategories()` blip aborts the entire cycle — including recipe and grocery, the primary user data. A lookup catalog is the _softest_ thing in the cycle (its consumers degrade gracefully to the last-good catalog), yet `core` lets it abort the _hardest_ reconciles. Meanwhile meal-type in `additive` was correct by accident: its consumers (meal, menu) are themselves `additive`, so it happened not to gate anything.

## Decision

Add a third tier, `reference`, and move all three lookup catalogs (aisle, category, meal-type) into it. The driver runs three tiers per cycle, in order: **`reference` → `core` → `additive`**.

- `reference` runs FIRST, each reconcile in its own best-effort try/catch (like `additive`). A catalog fetch failure is logged and the cycle continues; consumers resolve names at read time against the last-good in-memory catalog and gate on `hasSynced` (which latches true after the first sync and never clears), so they never see a torn or empty catalog.
- `core` (recipe, pantry, grocery) is unchanged: dependency-ordered, recipe-first, one failure aborts the cycle.
- `additive` (meals, menus, photos) is unchanged: best-effort, last.

The `reference`-runs-first position is convention, not a data requirement (nothing reads a sibling store mid-reconcile) — it reads as "refresh the lookup tables, then the data that references them." The recipe-leads invariant is unaffected: `reference` reconciles cannot abort, so they cannot gate recipe; recipe still leads the `core` tier, latching `hasSynced` before any abort-capable peer.

## Rejected alternatives

### Keep the two-tier split (aisle/category `core`, meal-type `additive`)

Rejected: it has no principled basis, leaves aisle/category with an abort-on-failure they don't need (a catalog blip taking down recipe/grocery), and leaves "reference catalog" with no home in the sync model even though it is a first-class class in the surface model (ADR-0004). It also re-invites the same placement question every time a catalog is touched.

### Promote meal-type to `core` (the original #224 framing)

Rejected: meal-type's consumers (meal, menu) are themselves `additive`, so `core` would buy no ordering and only widen the abort blast-radius — a meal-type blip would newly abort recipe/grocery. That is the inverse of what's wanted.

### Overload `additive` — move aisle/category there too, no new tier

Rejected: it gives the same failure isolation with no kernel change, but overloads `additive` to mean both "soft secondary data (meals/menus/photos)" and "reference catalog," so the tier name stops being self-documenting, and it reconciles the catalogs _last_ (harmless but counterintuitive). A named `reference` tier costs one driver branch and keeps the model legible; with three catalogs already sharing the shape, the abstraction is demonstrated, not speculative.

## Consequences

**Positive**

- A catalog fetch failure can no longer abort the primary data sync; aisle/category gain the failure isolation meal-type already had. The risk gradient is corrected — the softest reconciles can't take down the hardest.
- "Reference catalog" has one home in the sync model, matching ADR-0004's surface class. A new reference catalog has an obvious tier, ending the per-catalog placement question.
- The `category-changed` re-index event self-heals under best-effort: a failed categories fetch leaves the cache untouched, so the next successful cycle's replace-all still detects the change and emits then — strictly better than `core`, where a category failure also skipped recipe and its index events.

**Negative**

- One more tier to understand. Mitigated: it is mechanically identical to `additive` (best-effort), differing only in run-order and intent, and the driver branch is three lines.
- aisle/category change from abort-on-failure to best-effort — a behavior change. It is the intended improvement, but it means a partial cache (a catalog refreshed, its siblings not) is now a normal end-of-cycle state rather than a discarded one. That is correct: the stores were never transactionally linked, and a mid-cycle crash already produced partial state.

## References

- [ADR-0009](0009-domain-isolated-tool-modules-kernel.md) — the kernel sync driver this refines.
- [ADR-0004](0004-tool-vs-resource-classification.md) — the Content / Data / **Reference** classification this mirrors into the sync model.
- Issue [#224](https://github.com/bojanrajkovic/mcp-paprika/issues/224) — surfaced the meal-type tier question that led here.
- `src/kernel/registry.ts` — `SyncTier` and the `syncOnce` driver; `src/kernel/registry.test.ts` — the tier-ordering and best-effort tests.
