import type { SyncContribution } from "../../../kernel/registry.js";
import type { RecipeState } from "../module.js";
import type { Photo } from "../photo/types.js";

import { syncReplaceAllEntity } from "../../../paprika/sync.js";

function photosEqual(a: Photo, b: Photo): boolean {
  return (
    a.uid === b.uid &&
    a.recipeUid === b.recipeUid &&
    a.filename === b.filename &&
    a.name === b.name &&
    a.orderFlag === b.orderFlag &&
    a.hash === b.hash
  );
}

/**
 * Photo sync — replace-all via `syncReplaceAllEntity`. `additive` tier (best-effort):
 * photos are a recipe-child read/write surface with no standalone resource (the recipe
 * resource inlines photo fields), so — exactly like meals — a photo-side failure must
 * not abort core sync. Emits NO `sync:complete` and adds NO SyncResult variant (returns
 * `void`).
 */
export function photosSync(state: RecipeState): SyncContribution<RecipeState, never> {
  return {
    tier: "additive",
    reconcile: async (ctx) => {
      ctx.infra.log.debug("fetching photos");
      await syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listPhotos(),
        cache: ctx.state.photo.cache,
        store: ctx.state.photo.store,
        equals: photosEqual,
        label: "photos",
        log: ctx.infra.log,
      });
    },
    sweep: () => state.photo.store.sweepPending(),
  };
}
