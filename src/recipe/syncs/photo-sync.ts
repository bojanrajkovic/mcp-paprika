import type { SyncContribution } from "../../kernel/registry.js";
import type { Photo } from "../../photo/types.js";
import type { RecipeSelf } from "../module.js";

import { syncReplaceAllEntity } from "../../paprika/sync.js";

// Field-wise comparator copied verbatim from `src/paprika/sync.ts:99` alongside the
// reconcile it serves (the production comparator moves into the owning domain).
function photosEqual(a: Photo, b: Photo): boolean {
  return (
    a.uid === b.uid &&
    a.recipeUid === b.recipeUid &&
    a.filename === b.filename &&
    a.name === b.name &&
    a.orderFlag === b.orderFlag &&
    a.hash === b.hash &&
    a.deleted === b.deleted
  );
}

/**
 * Photo sync — replace-all via `syncReplaceAllEntity` (`src/paprika/sync.ts:559-572`).
 * `additive` tier (best-effort): photos are a recipe-child read/write surface with no
 * standalone resource (the recipe resource inlines photo fields), so — exactly like
 * meals — a photo-side failure must not abort core sync. Emits NO `sync:complete` and
 * adds NO SyncResult variant (returns `void`).
 */
export function photosSync(self: RecipeSelf): SyncContribution<RecipeSelf, never> {
  return {
    tier: "additive",
    reconcile: async (ctx) => {
      ctx.infra.log.debug("fetching photos");
      await syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listPhotos(),
        cache: ctx.self.photo.cache,
        store: ctx.self.photo.store,
        equals: photosEqual,
        label: "photos",
        log: ctx.infra.log,
      });
    },
    sweep: () => self.photo.store.sweepPending(),
  };
}
