# Domain Modules

Last verified: 2026-06-04

## Purpose

One directory per cohesive domain — the unit the kernel constructs, isolates, and sync-drives. A domain owns one or more Paprika entities, declares its dependencies, and exposes a public contract (`api.ts`) that sibling domains reach along a declared `dependsOn` edge.

## Layout (per domain)

- `module.ts` — the domain's kernel registration (`defineModule(…).state(…).build(…)`), augmenting `DomainRegistry` with its contract type. The builder shape and the pure-`*State` / `ctx.writes` split live in `../kernel/CLAUDE.md` and [ADR-0012](../../docs/adr/0012-pure-state-and-writes-seam.md), not here.
- `api.ts` — the read contract siblings depend on (kept narrow; this is the only surface another domain sees).
- The defining entity's `types.ts` / `store.ts` / `disk.ts` at the domain root; each **additional** owned entity in an `<entity>/` subdir (e.g. `recipe/category/`, `recipe/photo/`, `grocery/grocery-item/`, `menu/menu-item/`).
- `tools/`, `resources/`, `syncs/` — co-located, tests beside them. Domain-specific markdown formatters live here too (e.g. `recipe-markdown.ts`, `grocery-helpers.ts`); genuinely cross-cutting helpers live in `src/shared/`.

The domain graph (who `dependsOn` whom) and the ownership rule are in [ADR-0009 §3](../../docs/adr/0009-domain-isolated-tool-modules-kernel.md), drawn there as a diagram.

## Key References

- `../kernel/CLAUDE.md` — the kernel these register on (the `state`/`writes`/`deps`/`infra` narrowing, the sync driver, boot phases).
- `../entity/CLAUDE.md` — the `EntityStore` base and the pending-write (#57) invariants every store inherits.
- `../cache/CLAUDE.md` — the per-entity `DiskCache` each `disk.ts` describes.
- ADR-0004 (tool-vs-resource) — resources are Content-domain-only (recipe, grocery-list, menu).
- `../../docs/documentation-system.md` §4 — how a registrar / contract / `*State` / `*Writes` doc-comment is written (lead with purpose, keep only real WHY, no kernel-mechanism recital; names are nouns that name the tool).

## Sharp edges

- **Disk stays flat; the source layout is namespaced but the cache dir is not.** A child entity nested at `src/domains/recipe/category/` still writes to `<cacheDir>/categories` — its `DiskCacheDescriptor.subdir` is the flat on-disk name, reuse-in-place, so the reshape needed no on-disk migration. Don't "align" the subdir to the source path; that would orphan every deployed cache. See ADR-0009 §3.
- **Cross-domain access is `ctx.deps.<id>.<contract>` only.** A tool reaches a sibling domain through its declared dependency's `api` — never another domain's store or `state`. Adding a new edge means adding it to the `dependsOn` tuple (the single source of truth for what `deps` carries) AND importing the dependency's brand along that same edge.
- **A domain that owns a parent + its children fires its own `resourceListChanged()`.** Grocery owns lists + items, menu owns menus + items; a child-item change invalidates the parent resource, so the commit chokepoint (assembled in `module.ts`'s `.build`, reached by the domain's own tools via `ctx.writes`) emits it. There is no central change-type table.
- **`hasSynced` has two layers — don't blanket-expose it on a contract.** Every store carries `hasSynced` (the `EntityStore` base property) for INTERNAL cold-start self-gating, reached via `ctx.state.<store>.hasSynced` (grocery's `groceryStartGuard`, aisle's list tool). A domain's `api.ts` exposes `hasSynced()` to siblings (via `extends HasSynced` from the kernel) ONLY when a SIBLING gates a cross-domain call on it — recipe / meal / menu / meal-type / pantry have such a consumer; grocery (no sibling reads it) and aisle (consumers resolve against the last-good catalog, ADR-0010) self-gate and expose nothing. Adding it to a contract with no sibling consumer is speculative surface — the same "scoped to live cross-domain call sites" discipline every `api.ts` header states.
