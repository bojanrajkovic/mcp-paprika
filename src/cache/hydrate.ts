import type { ResultAsync } from "neverthrow";

import type { CacheError } from "./disk-cache.js";

/**
 * Warm an in-memory store from its disk cache at module construction, so tools
 * answer correctly on a warm restart before the first sync completes. Every
 * domain `.state` factory runs this once per owned store, unwrapping the result
 * via `unwrapAtBoot` (a cache that cannot be read at construction is a boot
 * failure, fail-fast boot).
 *
 * The empty-snapshot guard is load-bearing: `store.load()` marks the store synced
 * (`EntityStore.baseLoad` sets `hasSynced` unconditionally — an empty array is a
 * valid synced state), so loading an empty cache would flip a cold store to
 * "synced" and gate-open tools before any real data arrived. On a cold start the
 * cache is empty, `load` is skipped, and the store stays unsynced until the first
 * sync runs. (Recipe does NOT use this: it hydrates per-item via `set` + the
 * separate `markSynced()` so its diff-sync warm-start invariant holds.)
 */
export function hydrateStore<T>(
  cache: { getAll(): ResultAsync<Array<T>, CacheError> },
  store: { load(items: ReadonlyArray<T>): void },
): ResultAsync<void, CacheError> {
  return cache.getAll().map((all) => {
    if (all.length > 0) store.load(all);
  });
}
