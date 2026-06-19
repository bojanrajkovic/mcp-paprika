import type { SyncContribution } from "../../../kernel/registry.js";
import type { RecipeState } from "../module.js";

import { syncReplaceAllEntity } from "../../../paprika/sync.js";
import { categoriesEqual } from "../category/types.js";

/**
 * Category sync — replace-all with pending-write filtering via `syncReplaceAllEntity`.
 * Categories have create/update/delete write tools (#108), so they need the same
 * pending-write protection as pantry/grocery — a just-deleted category must not be
 * resurrected by an in-flight snapshot.
 *
 * `reference` tier — a lookup catalog recipe rendering resolves category names
 * against at read time; runs best-effort ahead of core, so a transient
 * categories-fetch failure degrades to the last-good catalog instead of aborting the
 * primary data sync. Category is a reference entity with no MCP resource
 * surface, so it emits NO `sync:complete` (returns `void`).
 *
 * A rename/removal must re-embed referencing recipes (the display name is baked into
 * their embedding text, but no recipe hash changes, so the recipe diff never re-fetches
 * them). The reconcile emits `category-changed` on the kernel re-index seam, which
 * discover's `index` boot hook subscribes to.
 */
export function categoriesSync(state: RecipeState): SyncContribution<RecipeState, never> {
  return {
    tier: "reference",
    reconcile: (ctx) =>
      syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listCategories(),
        cache: ctx.state.category.cache,
        store: ctx.state.category.store,
        equals: categoriesEqual,
        label: "categories",
        log: ctx.infra.log,
      }).map((changes) => {
        // `added` is excluded: a brand-new category has no referencing recipes yet — those
        // arrive via update_recipe, which re-embeds through recipe sync. `updated` may also
        // carry re-parents/order changes, but discover relies on the vector store's
        // content-hash skip to make those a no-op.
        if (changes.updated.length > 0 || changes.removedUids.length > 0) {
          ctx.infra.indexEvents.emit({
            type: "category-changed",
            uids: [...changes.updated.map((c) => c.uid), ...changes.removedUids],
          });
        }
      }),
    sweep: () => state.category.store.sweepPending(),
  };
}
