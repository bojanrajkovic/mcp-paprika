import { ResultAsync } from "neverthrow";
import type { Logger } from "pino";

import type { CacheError, DiskCache } from "../cache/disk-cache.js";
import type { EntityStore } from "../entity/store.js";
import type { PaprikaClientError } from "./errors.js";
import type { EntityChanges, SyncError } from "./sync-types.js";

type ReplaceAllEntityOptions<T extends { uid: UID }, UID extends string> = {
  readonly fetch: () => ResultAsync<ReadonlyArray<T>, PaprikaClientError>;
  readonly cache: Pick<DiskCache<T>, "getAll" | "put" | "remove">;
  readonly store: EntityStore<T, UID>;
  readonly equals: (a: T, b: T) => boolean;
  readonly label: string;
  readonly log: Logger;
  readonly afterLoad?: () => void;
};

/**
 * Evict cache entries whose UID is no longer in the live snapshot, returning the
 * removed UIDs. The shared orphan-eviction step of every replace-all reconcile —
 * `syncReplaceAllEntity` and the bespoke reference-catalog syncs (aisle, meal-type,
 * grocery-ingredient) that can't use it. An entity dropped from Paprika's canonical
 * list must leave the disk cache too, or a warm restart would rehydrate a ghost.
 * `liveUids` is the set present AFTER pending-write filtering; anything
 * cached-but-not-live is an orphan.
 */
export function pruneOrphanCache<UID extends string>(
  cache: { remove: (key: string) => ResultAsync<void, CacheError> },
  cachedUids: Iterable<UID>,
  liveUids: ReadonlySet<UID>,
  log: Logger,
  label: string,
): ResultAsync<ReadonlyArray<UID>, CacheError> {
  const orphanUids = [...cachedUids].filter((uid) => !liveUids.has(uid));
  return ResultAsync.combine(orphanUids.map((uid) => cache.remove(uid))).map(() => {
    if (orphanUids.length > 0) {
      log.debug({ count: orphanUids.length }, `removed orphan ${label}`);
    }
    return orphanUids;
  });
}

/**
 * Replace-all reconcile for every entity except recipes (recipes use the bespoke
 * diff-and-fetch in `src/domains/recipe/syncs/recipe-sync.ts`). Each domain's sync
 * contribution calls this with its own `fetch`/`equals`/`store`/`cache`. It filters
 * the canonical snapshot through pending-writes (#57) and clears pending-upserts only
 * on content match (#92): a UID can appear in the canonical list with PRE-write
 * content while propagation is in flight, so clearing on presence alone would drop
 * protection and let the next cycle overwrite a local edit.
 *
 * An `err` anywhere in the chain (the fetch, a cache read/put/remove) propagates
 * to the sync driver, which decides the blast radius by tier.
 */
export function syncReplaceAllEntity<T extends { uid: UID }, UID extends string>(
  opts: ReplaceAllEntityOptions<T, UID>,
): ResultAsync<EntityChanges<T>, SyncError> {
  return opts.fetch().andThen((rawIncoming) =>
    opts.cache.getAll().andThen((cached) => {
      const cachedByUid = new Map<UID, T>(cached.map((item) => [item.uid, item]));
      const cachedUids = new Set<UID>(cached.map((item) => item.uid));

      const incomingFiltered = rawIncoming.filter(
        (item) => !opts.store.isPendingDelete(item.uid) && !opts.store.isPendingUpsert(item.uid),
      );
      const pendingUpserted = cached.filter((item) => opts.store.isPendingUpsert(item.uid));
      const effective = [...incomingFiltered, ...pendingUpserted];
      const effectiveUids = new Set<UID>(effective.map((item) => item.uid));

      const newUids = new Set<UID>([...effectiveUids].filter((uid) => !cachedUids.has(uid)));

      const updated = effective.filter((incoming) => {
        const cachedItem = cachedByUid.get(incoming.uid);
        return cachedItem !== undefined && !opts.equals(cachedItem, incoming);
      });
      const added = effective.filter((item) => newUids.has(item.uid));

      return pruneOrphanCache(opts.cache, cachedUids, effectiveUids, opts.log, opts.label).andThen((removedUids) => {
        opts.store.load(effective);
        opts.afterLoad?.();
        return ResultAsync.combine(effective.map((item) => opts.cache.put(item))).map(() => {
          // Observation-based clearing: walk rawIncoming (not effective) so pending-upsert
          // UIDs that were spliced out still get checked against the snapshot.
          for (const item of rawIncoming) {
            if (!opts.store.isPendingUpsert(item.uid)) continue;
            const cachedItem = cachedByUid.get(item.uid);
            if (cachedItem !== undefined && opts.equals(cachedItem, item)) {
              opts.store.clearPending(item.uid);
            }
          }
          return { added, updated, removedUids };
        });
      });
    }),
  );
}
