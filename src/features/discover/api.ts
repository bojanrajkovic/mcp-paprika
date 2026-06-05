import type { EmptyApi } from "../../kernel/registry.js";

/**
 * Discover's public contract — empty. Discover is a FEATURE module: it owns the
 * derived vector/semantic-search index, exposes the `discover_recipes` tool, and
 * re-indexes on the post-sync `index` boot phase. Nothing else in the tree reads
 * discover state, so there is no surface to expose.
 *
 * The index is built by reading recipe data through `ctx.deps.recipe`, never by
 * exposing anything back; that is why this is {@link EmptyApi} and not, say, a
 * `search()` the recipe domain would call.
 */
export type DiscoverApi = EmptyApi;
