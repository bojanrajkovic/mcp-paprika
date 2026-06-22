# ADR-0022: A module's `.build` receives its declared dependencies' contracts

**Status:** Accepted (2026-06-22)

## Context

[ADR-0009](0009-domain-isolated-tool-modules-kernel.md) makes a domain's public contract (`api.ts`) the only surface a sibling sees, reached along a declared `dependsOn` edge as `ctx.deps.<id>.<contract>`. The kernel narrows every per-call context — a tool's `DomainCtx`, a sync/boot hook's `BootCtx` — to `state` + `infra` + exactly the module's declared deps' contracts. The one assembly site that did NOT see `deps` was `.build` itself: its assemble callback was `(state, infra) => parts`.

That gap matters when a domain's own `api` method must project a row across a domain boundary. Two such projections exist:

- a pantry list-row resolves its aisle display name through the aisle catalog (pantry `dependsOn` aisle), and
- a meal structured-row resolves its meal-type name through the meal-type catalog (meal `dependsOn` meal-type).

Both are pure functions of `(entity, sibling-catalog)`. With `.build` blind to `deps`, the only ways to build such a row from a contract method were:

1. import the sibling's INTERNAL helper file (`pantry-helpers.ts`, `meal/tools/helpers.ts`) directly at the consuming call site — a cross-domain reach that bypasses the contract, violating ADR-0009's "contract-only" rule; or
2. make the contract method take the sibling catalog as a runtime parameter — which leaks the sibling's catalog into every call site and makes one domain's contract method accept another domain's contract as an argument.

Neither is acceptable. The catalogs the projections need are already declared deps, and the kernel already builds modules in dependency order — so by the time a dependent's `.build` runs, every declared dep's `api` is constructed and held in the kernel's `apis` map. The information is in hand; it simply was not threaded through.

## Decision

Thread the already-built declared deps into `.build`. The assemble callback becomes `(state, infra, deps) => parts`, where `deps` is the same `{ readonly [K in DepList[number]]: DomainRegistry[K] }` shape `BootCtx`/`DomainCtx` carry. `buildKernel`'s Phase-0 construction loop passes `depsOf(m.dependsOn)` — the existing helper that maps a module's `dependsOn` ids to their built apis — alongside `infra`. Topo-sort order guarantees every dep is already in the `apis` map when the dependent builds.

A domain's `api` method that projects across a boundary now closes over `deps.<id>` in `.build`, symmetrically with how its tools/syncs/boot hooks reach the same contracts through their narrowed ctx. The cross-domain row builders move onto the providing domain's contract — pantry exposes `itemsToRows`, meal exposes `toStructuredRows` — so a consumer calls `ctx.deps.pantry.itemsToRows(...)` / `ctx.deps.meal.toStructuredRows(...)` instead of importing the sibling's helper.

The erased boundary (`ErasedModule.build`) types `deps` as `Record<string, unknown>`; the typed shape reaches the assemble callback through the existing `as unknown as ErasedModule` cast that already erases the module's generics for uniform iteration. A 2-arg `(state, infra)` assemble stays assignable to the 3-arg type, so dependency-free modules and every existing builder compile unchanged.

## Rejected alternatives

### Pass the sibling catalog as a runtime parameter to the API method

Rejected. A row projection like `pantryItemToRow(item, aisles)` could stay a free function and take the catalog at each call. But then the contract method (`itemsToRows`) would have to accept the aisle catalog as an argument — one domain's published surface taking another domain's contract — and every consumer would have to fetch and pass `ctx.deps.aisle` itself, re-spreading the cross-domain knowledge the contract is supposed to encapsulate. Closing over the dep inside `.build` keeps the catalog dependency private to the providing domain.

### Keep the cross-domain builders as free-function imports from the sibling's helpers

Rejected. Leaving `grocery-move.ts` importing `pantryItemToRow` from `pantry/pantry-helpers.ts` (and `schedule-menu.ts` importing `mealToStructuredRow`/`resolveMealTypeName` from `meal/tools/helpers.ts`) is exactly the contract-bypassing reach ADR-0009 forbids: a consumer reaching into a sibling's internal file rather than its `api`. It compiles, but it erodes the isolation boundary the kernel exists to enforce.

## Consequences

- API construction is symmetric with the per-call contexts: `.build`, tools, syncs, and boot hooks all see `state` + `infra` + the declared deps' contracts.
- The change is DAG-safe: deps are built before dependents (topo-sort), and the projection methods call them at runtime, so there is no construction-time cycle.
- Dependency-free builds are unaffected — a module with `dependsOn: []` receives an empty `deps` object its assemble callback ignores.
- The cross-domain row builders and the meal-type resolve/create behavior ride the providing domains' contracts (`itemsToRows` / `toStructuredRows` / `resolveOrCreate` / `formatResolveError`), so the sibling-internal helpers (`pantryItemToRow`, `mealToStructuredRow`, `resolveOrCreateMealType`, `formatMealTypeResolveError`) stay exported only for same-domain callers, no longer imported across a boundary.
