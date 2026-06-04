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
 * FLIP: a category rename/removal must re-embed referencing recipes
 * (`sync:category-change` → discover). The kernel's `reconcile` return type has no
 * channel for that signal yet; the flip resolves it (an emitter on `Infra`, or a
 * widened return union). The inert module doesn't need it to compile.
 */
export function categoriesSync(self: RecipeSelf): SyncContribution<RecipeSelf, never> {
  return {
    tier: "core",
    reconcile: async (ctx) => {
      await syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listCategories(),
        cache: ctx.self.category.cache,
        store: ctx.self.category.store,
        equals: categoriesEqual,
        label: "categories",
        log: ctx.infra.log,
      });
    },
    sweep: () => self.category.store.sweepPending(),
  };
}
