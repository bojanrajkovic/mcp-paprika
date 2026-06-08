# ADR-0012: Pure state interfaces and the `ctx.writes` chokepoint seam

**Status:** Accepted (2026-06-04)
**Refines:** [ADR-0009](0009-domain-isolated-tool-modules-kernel.md) (the kernel's module/ctx shape)

## Context

A module is authored as `defineModule(id, deps).state(factory).build((state, infra) => parts)`. Originally only the `.state` factory received `infra`, so it was the only place a function that WRITES (one closing over `infra.client` / `infra.notifier` / `infra.indexEvents`) could be assembled. Every such function was therefore bound inside `.state` and threaded back out through the state object, and the per-module state interface (`AisleSelf`, `RecipeSelf`, …) carried those bound closures alongside its stores and caches.

That conflated two different things on one interface:

- **A contract write** — e.g. `aisle`'s `ensureAisle`, consumed by sibling modules through `ctx.deps.aisle`. `AisleSelf` literally declared `ensureAisle: AisleApi["ensureAisle"]` — a published contract method squatting in the module's private state interface.
- **An internal chokepoint** — e.g. `recipe`'s `commitRecipe`, the `markPending → cache → flush → store → notify` closure invoked only by recipe's own tools as `ctx.self.commitRecipe`. These sat next to `recipe.store` in the state interface.

So `.state` (state construction) and `.build` (contract assembly) were not cleanly separated: the state phase also built behavior, and the state interface was a grab-bag of stores plus bound write closures. "What does this module persist?" could not be read off the state interface, because functions lived there too.

## Decision

**1. `infra` is passed to `.build` as well:** `build((state, infra) => parts)`. Every infra-dependent function is now assembled in `.build`, next to the read contract — `.state` returns to constructing pure state (stores + caches).

**2. The infra-dependent functions split by audience, into two distinct homes:**

- **Contract writes** (consumed by sibling modules) are assembled in `.build` and exposed ONLY through `api`. A sibling already reaches them via `ctx.deps.<id>`; they never needed to be on the state object. These are `aisle.ensureAisle`, `meal-type.ensureMealType`, `pantry.createItems`, `meal.createMeals`, and `recipe.attachGeneratedPhoto`.
- **Internal chokepoints** (consumed by the module's OWN tools) are assembled in `.build` and surfaced through a new per-module ctx seam, **`ctx.writes`** (typed `*Writes`). A tool's `ctx` exposes exactly `state` / `writes` / `deps` / `infra` / `server`; a chokepoint cannot live in `ctx.state` because `state` is typed from the `.state` factory, which runs before `.build` has `infra`. So the chokepoints need their own slot.

**3. The state interface is pure and renamed.** `*Self` → `*State`, carrying only stores and caches; `ctx.self` → `ctx.state`. The ctx now carries three per-module seams — `state` (what it persists), `writes` (how it persists), `deps` (sibling contracts) — plus `infra` and `server`.

`Writes` defaults to empty on `DomainCtx` / `ToolDef` / `defineTool` / `ModuleParts`, so a read-only tool keeps a two-generic `DomainCtx<XState, Deps>` and never mentions it; resources (read-only by ADR-0004) likewise ignore it. `writes` rides the per-session `DomainCtx` only — NOT `BootCtx`: syncs and boot hooks never invoke a chokepoint (each sync reconcile drives its own store directly), so the boot/sync ctx stays writes-free.

## Rejected alternatives

### Narrow — move only the contract writes to `.build`, leave internal chokepoints on `state`

The issue's title framing ("bind infra-dependent _contract_ methods in `.build`"). It removes the published-method-in-state smell (the `ensureAisle`-on-`AisleSelf` case) and fully purifies `aisle`/`meal-type` (whose only non-state field IS the contract write). Rejected as the end state: it leaves the internal commit chokepoints on the state interface for the five other stateful modules (`pantry`, `meal`, `recipe`, `grocery`, `menu`), so "the state interface carries only state" does not hold and the construction/behavior conflation survives where it is densest (recipe carries eight chokepoints). The narrow form is strictly contained in this one, so nothing is lost by going all the way.

### Two-phase merged `self` — keep a single `ctx.self` typed `State & Writes`

Split construction (`.state` builds stores, `.build` builds chokepoints) but merge them back into one `ctx.self` whose type is the intersection, so tools keep `ctx.self.commitRecipe` AND `ctx.self.recipe.store`. Rejected: the tool-facing internals type is still a state-plus-behavior grab-bag — only the construction splits, not the interface. It does not deliver a pure state declaration, which is the point.

### Keep chokepoints on `state`, hand `infra` to tools at call time

Leave the commit closures unbound and have each tool call `commit(ctx.state, ctx.infra, saved)`. Rejected: it pushes the same `infra` plumbing into every call site and re-exposes the wiring the chokepoint exists to hide; assembling once in `.build` is the whole point.

## Consequences

**Positive**

- `*State` is a pure "what this module persists" declaration — stores and caches, nothing else.
- Reads (`ctx.state`) and writes (`ctx.writes`) are visually distinct at every call site, so a tool's effect surface is legible.
- All behavior is assembled in one phase (`.build`), next to the read contract, with `infra` uniformly in scope; `.state` is pure construction.
- The contract/internal distinction is now structural: a sibling-facing write is in `api`, an own-tool write is in `ctx.writes`, and neither pollutes the state interface.

**Negative**

- A third per-module ctx seam and a `Writes` generic threaded through `DomainCtx` / `ToolDef` / `defineTool` / `ModuleParts`. Mitigated: it defaults to empty, so read-only tools and resources never name it, and the kernel erases it like the other generics.
- ~30 tool call sites distinguish `ctx.state.<store>` from `ctx.writes.<chokepoint>`. Mitigated: mechanical and fully type-checked — a chokepoint reached through the wrong seam is a compile error.

## References

- Issue [#236](https://github.com/bojanrajkovic/mcp-paprika/issues/236) — bind infra-dependent contract methods in `.build`; parent [#228](https://github.com/bojanrajkovic/mcp-paprika/issues/228).
- [ADR-0009](0009-domain-isolated-tool-modules-kernel.md) — the kernel, the `.state`/`deps`/`infra` ctx, and the `defineModule` builder this extends.
- `src/kernel/registry.ts` — `DomainCtx` (the `state`/`writes`/`deps` seams), `ModuleParts`, the `.build((state, infra) => …)` step; `src/kernel/tool.ts` — `ToolDef`/`defineTool` and the `Writes` generic.
