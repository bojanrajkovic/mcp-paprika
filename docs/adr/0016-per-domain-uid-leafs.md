# ADR-0016: UID brands live in per-domain leaf files

**Status:** Accepted (2026-06-06)
**Last verified:** 2026-06-06
**Related:** [ADR-0007](0007-uid-branding-compile-time-only.md) (what a brand _is_ — compile-time-only semantics, unchanged here), [ADR-0009](0009-domain-isolated-tool-modules-kernel.md) (the per-domain ownership this completes), [ADR-0014](0014-neverthrow-core-foreign-boundaries.md) (the conformance-gate idiom this reuses). Resolves [#242](https://github.com/bojanrajkovic/mcp-paprika/issues/242).

## Context

Through the kernel migration, every branded UID schema lived in one central leaf, `src/ids.ts`, imported by ~150 files. ADR-0009 moved every entity into `src/domains/<domain>/`, but the brands stayed central: distributing them was considered and dropped mid-refactor on the theory that a foreign-key brand import would create domain↔domain coupling the central "neutral" leaf avoided.

Measured against the tree as it stands, that theory does not hold:

- **Domain↔domain imports already exist, and are heavier than brands.** Along declared `dependsOn` edges, meal imports meal-type's helpers and types plus recipe's api; menu imports meal-type's; grocery imports pantry's types; meal-planner imports meal's and meal-type's. A two-line brand import is the lightest thing that could travel an edge already carrying full contracts.
- **Layers outside the domains already name them.** The paprika client imports every domain's `types.js`; the features import recipe's types and helpers. Distribution adds no new kind of edge.
- **Brands are cross-domain goods.** `MealTypeUid` appears in roughly four times as many files outside `meal-type/` as inside it; `RecipeUid` in ~20 files outside `recipe/`. The central file did not prevent identifier-level coupling — it disguised it, making meal → recipe read as two imports of a neutral hub.
- **`src/ids.ts` was the last hand-written central file enumerating every entity**, against the self-registration grain of ADR-0009, where modules register themselves and the kernel barrel is generated.

Two real properties of the central file did need preserving — they are what a replacement must reproduce rather than lose. **Cycle-safety:** brands are runtime zod values (the phantom type hangs off a schema), so identifier declarations living in files that import richer neighbors could create a value-level import cycle — a TDZ failure at import time — the day a domain grows a back-reference. The central file was trivially acyclic because it imported nothing but `zod`. **Collision visibility:** all brand strings on one screen meant a duplicated brand — two UID kinds made silently cross-assignable — could not slip in unseen.

## Decision

**Each domain declares its UID brands in its own leaf, `src/domains/<domain>/ids.ts`**, sub-entity brands included: recipe's leaf carries `RecipeUid`, `CategoryUid`, and `PhotoUid`; menu's carries `MenuUid` and `MenuItemUid`; the aisle no-ref sentinel machinery (`NoAisleRef` / `AisleUidRef` / `NO_AISLE_UID`) moves whole into aisle's. A domain that owns no entity has no leaf (meal-planner). A foreign-key consumer imports the owning domain's leaf with a plain relative path — meal's `types.ts` imports `../recipe/ids.js` — so the FK dependency is visible in the import graph.

**The leaf rule: a UID leaf imports nothing but `zod`.** That single constraint reproduces the central file's cycle-safety — a pure leaf cannot participate in a value-level cycle, no matter what back-references domains grow.

**A conformance test replaces what one-screen visibility gave for free** (`test/conformance/uid-leafs.test.ts`, the ADR-0014 gate idiom: a syntactic AST walk, violations collected as `file:line` with a remediation hint):

1. **Purity** — every leaf references no module but `zod`, in any value-edge form (import, re-export, dynamic import, require).
2. **Ownership** — a brand string is declared in exactly one leaf. Intra-leaf reuse stays legal: aisle's sentinel deliberately brands `""` as `AisleUid`. A `.brand(...)` argument that is not a single string literal is itself a violation, so ownership stays syntactically checkable.
3. **Containment** — `.brand(...)` appears nowhere in `src/` outside the leafs, which both keeps an inline brand from bypassing purity and backstops the other assertions against glob rot.

The FK-absence doctrine the old file's header carried (nullable vs. sentinel vs. strict) now lives in `docs/architecture.md` (Identifiers). ADR-0007's semantics — compile-time-only branding, `.min(1)` non-emptiness, absence spelled at the field — are untouched; the per-domain `ids.test.ts` beside each leaf carries the runtime contracts `src/ids.test.ts` carried.

## Alternatives considered

- **Keep the central `src/ids.ts`.** Zero churn, one table-driven test, collision visibility for free. Rejected: it misrepresents the dependency graph (an FK reads as two imports of a neutral file), it is the last all-entity enumeration outside generated code, and the coupling it claims to avoid demonstrably exists already in heavier form.
- **Fold brands into each entity's `types.ts`.** Maximum locality, no new files. Rejected: brands are runtime values, so FK references would make `types.ts` files import each other's _values_ — acyclic today, one back-reference away from a runtime TDZ break. The dedicated pure leaf forecloses the failure class instead of betting against it.
- **Per-entity leafs (`recipe/category/ids.ts`).** Strict identifier-beside-entity. Rejected: several two-line files per domain for no isolation gain; the domain is the unit of change, so the domain root is where its brands collect.
- **Hybrid — distribute domain-local brands, keep cross-domain ones central.** Rejected: "where does this brand live" becomes a per-brand judgment call, and an incoherent convention is worse than either pole.

## Consequences

- The domain directory is the full unit of change: adding or deleting a domain touches no central identifier file.
- FK coupling is honest in the import graph — who depends on recipe identifiers is answerable from imports of `domains/recipe/ids.js`, structurally.
- A brand collision or an impure leaf fails `pnpm test` with a pointed message, instead of relying on someone eyeballing one file.
- ~150 import sites were re-pointed once, mechanically; behavior is unchanged.
- The gate is syntactic, like the ADR-0014 throw gate: aliasing `.brand` through a variable would evade it. That is review's problem, not the gate's — the same trade the throw gate made.
