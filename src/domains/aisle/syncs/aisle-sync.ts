import type { SyncContribution } from "../../../kernel/registry.js";
import type { AisleSelf } from "../module.js";

/**
 * Aisle sync — replace-all WITH pending-write filtering. This is NOT the
 * `syncReplaceAllEntity` helper: it filters deleted and pending-upsert rows,
 * merges cached pending-upserts back, removes orphans from the cache, then
 * observation-clears confirmed pending-upserts (a confirmed pending-upsert UID
 * present in the canonical list means the server confirmed the write — clear now
 * rather than at TTL). `core` tier — pantry and grocery resolve against aisles,
 * so this must reconcile before them.
 */
export function aisleSync(self: AisleSelf): SyncContribution<AisleSelf, never> {
  return {
    tier: "core",
    reconcile: async (ctx) => {
      const { store, cache } = ctx.self;
      const aisles = await ctx.infra.client.listAisles();
      const cachedAisles = await cache.getAll();

      const incomingAislesFiltered = aisles.filter((a) => !a.deleted && !store.isPendingUpsert(a.uid));
      const pendingUpsertedAisles = cachedAisles.filter((a) => store.isPendingUpsert(a.uid));
      const effectiveAisles = [...incomingAislesFiltered, ...pendingUpsertedAisles];

      const cachedAisleUids = new Set(cachedAisles.map((a) => a.uid));
      const effectiveAisleUids = new Set(effectiveAisles.map((a) => a.uid));
      const orphanAisleUids = [...cachedAisleUids].filter((uid) => !effectiveAisleUids.has(uid));
      await Promise.all(orphanAisleUids.map((uid) => cache.remove(uid)));

      store.load(effectiveAisles);
      await Promise.all(effectiveAisles.map((a) => cache.put(a)));

      for (const aisle of aisles) {
        if (store.isPendingUpsert(aisle.uid)) {
          store.clearPending(aisle.uid);
        }
      }
    },
    sweep: () => self.store.sweepPending(),
  };
}
