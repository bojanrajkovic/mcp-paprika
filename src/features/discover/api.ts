/**
 * Discover's public contract — empty. Discover is a FEATURE module: it owns the
 * derived vector/semantic-search index, exposes the `discover_recipes` tool, and
 * re-indexes on the post-sync `index` boot phase. Nothing else in the tree reads
 * discover state, so siblings have no surface to reach (mirrors the spike's
 * `discover: Record<never, never>`), and the registry augmentation in `module.ts`
 * registers exactly this empty contract.
 *
 * The index is built by reading recipe data through `ctx.deps.recipe`, never by
 * exposing anything back; that is why this is `{}` and not, say, a `search()` the
 * recipe domain would call.
 */
// oxlint-disable-next-line no-empty-object-type
export interface DiscoverApi {}
