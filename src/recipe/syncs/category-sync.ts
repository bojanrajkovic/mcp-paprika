import type { Category } from "../../category/types.js";
import type { SyncContribution } from "../../kernel/registry.js";
import type { RecipeSelf } from "../module.js";

import { syncReplaceAllEntity } from "../../paprika/sync.js";

// Field-wise comparator copied verbatim from `src/paprika/sync.ts:29` alongside the
// reconcile it serves (the production comparator moves into the owning domain).
function categoriesEqual(a: Category, b: Category): boolean {
  return a.uid === b.uid && a.name === b.name && a.orderFlag === b.orderFlag && a.parentUid === b.parentUid;
}

/**
 * Category sync — replace-all with pending-write filtering, over the SAME proven
 * `syncReplaceAllEntity` helper the monolith used (`src/paprika/sync.ts:354-371`).
 * Categories gained create/update/delete write tools (#108), so they need the same
 * pending-write protection as pantry/grocery — a just-deleted category must not be
 * resurrected by an in-flight snapshot.
 *
 * `core` tier — recipe rendering resolves category names on read, so the catalog
 * must reconcile alongside recipes. Category is a reference entity with no MCP
 * resource surface, so it emits NO `sync:complete` (returns `void`).
 *
 * A rename/removal must re-embed referencing recipes (the display name is baked into
 * their embedding text, but no recipe hash changes, so the recipe diff never re-fetches
 * them). The reconcile emits `category-changed` on the kernel re-index seam, which
 * discover's `index` boot hook subscribes to — the faithful port of the legacy
 * `sync:category-change` event (sync.ts:369-371).
 */
export function categoriesSync(self: RecipeSelf): SyncContribution<RecipeSelf, never> {
  return {
    tier: "core",
    reconcile: async (ctx) => {
      const changes = await syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listCategories(),
        cache: ctx.self.category.cache,
        store: ctx.self.category.store,
        equals: categoriesEqual,
        label: "categories",
        log: ctx.infra.log,
      });
      // `added` is excluded: a brand-new category has no referencing recipes yet — those
      // arrive via update_recipe, which re-embeds through recipe sync. `updated` may also
      // carry re-parents/order changes, but discover relies on the vector store's
      // content-hash skip to make those a no-op (verbatim legacy gate + UID set,
      // discover-feature.ts:163).
      if (changes.updated.length > 0 || changes.removedUids.length > 0) {
        ctx.infra.indexEvents.emit({
          type: "category-changed",
          uids: [...changes.updated.map((c) => c.uid), ...changes.removedUids],
        });
      }
    },
    sweep: () => self.category.store.sweepPending(),
  };
}
