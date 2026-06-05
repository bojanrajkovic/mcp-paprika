import type { SyncContribution } from "../../kernel/registry.js";
import type { AisleState } from "./module.js";

import { pruneOrphanCache } from "../../paprika/sync.js";

/**
 * Aisle sync — replace-all WITH pending-write filtering. This is NOT the
 * `syncReplaceAllEntity` helper: it filters pending-upsert rows,
 * merges cached pending-upserts back, removes orphans from the cache, then
 * observation-clears confirmed pending-upserts (a confirmed pending-upsert UID
 * present in the canonical list means the server confirmed the write — clear now
 * rather than at TTL). `reference` tier — a lookup catalog pantry and grocery resolve
 * aisle names against at read time; runs best-effort ahead of core, so a transient
 * aisle-fetch failure degrades to the last-good catalog instead of aborting the
 * primary data sync (ADR-0010).
 */
export function aisleSync(state: AisleState): SyncContribution<AisleState, never> {
  return {
    tier: "reference",
    reconcile: async (ctx) => {
      const { store, cache } = ctx.state;
      const aisles = await ctx.infra.client.listAisles();
      const cachedAisles = await cache.getAll();

      // Intentionally NOT filtered by `deleted`: aisles hard-delete, so `listAisles()` never
      // returns a `deleted:true` row (only recipes soft-delete, via `inTrash`) — a deleted-row
      // filter here would guard a state that cannot occur. See docs/architecture.md (Caching and sync).
      const incomingAislesFiltered = aisles.filter((a) => !store.isPendingUpsert(a.uid));
      const pendingUpsertedAisles = cachedAisles.filter((a) => store.isPendingUpsert(a.uid));
      const effectiveAisles = [...incomingAislesFiltered, ...pendingUpsertedAisles];

      const cachedAisleUids = new Set(cachedAisles.map((a) => a.uid));
      const effectiveAisleUids = new Set(effectiveAisles.map((a) => a.uid));
      await pruneOrphanCache(cache, cachedAisleUids, effectiveAisleUids, ctx.infra.log, "aisles");

      store.load(effectiveAisles);
      await Promise.all(effectiveAisles.map((a) => cache.put(a)));

      for (const aisle of aisles) {
        if (store.isPendingUpsert(aisle.uid)) {
          store.clearPending(aisle.uid);
        }
      }
    },
    sweep: () => state.store.sweepPending(),
  };
}
