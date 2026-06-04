# Domain Modules

Last verified: 2026-06-04

## Purpose

One directory per cohesive domain — the unit the kernel constructs, isolates, and sync-drives. A domain owns one or more Paprika entities, declares its dependencies, and exposes a public contract (`api.ts`) that sibling domains reach along a declared `dependsOn` edge.

## Layout (per domain)

- `module.ts` — `defineModule(id, dependsOn).self(factory).build(self => parts)`: the factory hydrates the domain's stores/caches and binds its write chokepoints; `build` returns `api` + `tools` + optional `resources`/`syncs`/`onReady`/`flush`. It augments `DomainRegistry` with the domain's contract type.
- `api.ts` — the read contract siblings depend on (kept narrow; this is the only surface another domain sees).
- The defining entity's `types.ts` / `store.ts` / `disk.ts` at the domain root; each **additional** owned entity in an `<entity>/` subdir (e.g. `recipe/category/`, `recipe/photo/`, `grocery/grocery-item/`, `menu/menu-item/`).
- `tools/`, `resources/`, `syncs/` — co-located, tests beside them. Domain-specific markdown formatters live here too (e.g. `recipe-markdown.ts`, `grocery-helpers.ts`); genuinely cross-cutting helpers live in `src/shared/`.

`aisle` and `meal-type` stay standalone single-entity domains because each is referenced by two domains. `meal-planner` is a coordinator (no owned entity). The ownership rule and the domain graph: `docs/adr/0009-domain-isolated-tool-modules-kernel.md` §3.

## Key References

- `../kernel/CLAUDE.md` — the kernel these register on (the `self`/`deps`/`infra` narrowing, the sync driver, boot phases).
- `../entity/CLAUDE.md` — the `EntityStore`/`TombstoneEntityStore` base and the pending-write/tombstone invariants every store inherits.
- `../cache/CLAUDE.md` — the per-entity `DiskCache` each `disk.ts` describes.
- ADR-0004 (tool-vs-resource) — resources are Content-domain-only (recipe, grocery-list, menu).

## Sharp edges

- **Disk stays flat; the source layout is namespaced but the cache dir is not.** A child entity nested at `src/domains/recipe/category/` still writes to `<cacheDir>/categories` — its `DiskCacheDescriptor.subdir` is the flat legacy name, reuse-in-place, so the reshape needed no on-disk migration. Don't "align" the subdir to the source path; that would orphan every deployed cache. See ADR-0009 §3.
- **Cross-domain access is `ctx.deps.<id>.<contract>` only.** A tool reaches a sibling domain through its declared dependency's `api` — never another domain's store or `self`. Adding a new edge means adding it to the `dependsOn` tuple (the single source of truth for what `deps` carries) AND importing the dependency's brand along that same edge.
- **A domain that owns a parent + its children fires its own `resourceListChanged()`.** Grocery owns lists + items, menu owns menus + items; a child-item change invalidates the parent resource, so the commit chokepoint in `module.ts`'s `.self` emits it. There is no central change-type table.
