import type { Logger } from "pino";

import type { DiskCache } from "../cache/disk-cache.js";
import type { TombstoneEntityStore } from "../entity/tombstone-store.js";
import type { EntityChanges } from "./sync-types.js";

type ReplaceAllEntityOptions<T extends { uid: UID }, UID extends string> = {
  readonly fetch: () => Promise<ReadonlyArray<T>>;
  readonly cache: Pick<DiskCache<T>, "getAll" | "put" | "remove">;
  readonly store: TombstoneEntityStore<T, UID>;
  readonly equals: (a: T, b: T) => boolean;
  readonly label: string;
  readonly log: Logger;
  readonly afterLoad?: () => void;
};

/**
 * Replace-all reconcile for every entity except recipes (recipes use the bespoke
 * diff-and-fetch in `src/domains/recipe/syncs/recipe-sync.ts`). Each domain's sync
 * contribution calls this with its own `fetch`/`equals`/`store`/`cache`. It filters
 * the canonical snapshot through pending-writes (#57) and clears pending-upserts only
 * on content match (#92): a UID can appear in the canonical list with PRE-write
 * content while propagation is in flight, so clearing on presence alone would drop
 * protection and let the next cycle overwrite a local edit.
 */
export async function syncReplaceAllEntity<T extends { uid: UID }, UID extends string>(
  opts: ReplaceAllEntityOptions<T, UID>,
): Promise<EntityChanges<T>> {
  const rawIncoming = await opts.fetch();
  const cached = await opts.cache.getAll();
  const cachedByUid = new Map<UID, T>(cached.map((item) => [item.uid, item]));
  const cachedUids = new Set<UID>(cached.map((item) => item.uid));

  const incomingFiltered = rawIncoming.filter(
    (item) => !opts.store.isPendingDelete(item.uid) && !opts.store.isPendingUpsert(item.uid),
  );
  const pendingUpserted = cached.filter((item) => opts.store.isPendingUpsert(item.uid));
  const effective = [...incomingFiltered, ...pendingUpserted];
  const effectiveUids = new Set<UID>(effective.map((item) => item.uid));

  const orphanUids = [...cachedUids].filter((uid) => !effectiveUids.has(uid));
  const newUids = new Set<UID>([...effectiveUids].filter((uid) => !cachedUids.has(uid)));

  const updated = effective.filter((incoming) => {
    const cachedItem = cachedByUid.get(incoming.uid);
    return cachedItem !== undefined && !opts.equals(cachedItem, incoming);
  });
  const added = effective.filter((item) => newUids.has(item.uid));

  await Promise.all(orphanUids.map((uid) => opts.cache.remove(uid)));
  opts.store.load(effective);
  opts.afterLoad?.();
  await Promise.all(effective.map((item) => opts.cache.put(item)));

  // Observation-based clearing: walk rawIncoming (not effective) so pending-upsert
  // UIDs that were spliced out still get checked against the snapshot.
  for (const item of rawIncoming) {
    if (!opts.store.isPendingUpsert(item.uid)) continue;
    const cachedItem = cachedByUid.get(item.uid);
    if (cachedItem !== undefined && opts.equals(cachedItem, item)) {
      opts.store.clearPending(item.uid);
    }
  }

  if (orphanUids.length > 0) {
    opts.log.debug({ count: orphanUids.length }, `removed orphan ${opts.label}`);
  }

  return { added, updated, removedUids: orphanUids };
}
