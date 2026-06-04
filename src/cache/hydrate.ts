/**
 * Warm an in-memory store from its disk cache at module construction, so tools
 * answer correctly on a warm restart before the first sync completes. Every
 * domain `.self` factory runs this once per owned store.
 *
 * `filter` drops items the target store must not hold. A store with no
 * tombstone-aware read path (the `aisle` / `meal-type` reference catalogs and the
 * name-keyed `GroceryIngredientStore`) passes `(x) => !x.deleted`, so a
 * soft-deleted row can't resurface as a live entry before the next sync clears it.
 *
 * The empty-snapshot guard is load-bearing: `store.load()` marks the store synced
 * (`EntityStore.baseLoad` sets `hasSynced` unconditionally — an empty array is a
 * valid synced state), so loading an empty cache would flip a cold store to
 * "synced" and gate-open tools before any real data arrived. On a cold start the
 * cache is empty, `load` is skipped, and the store stays unsynced until the first
 * sync runs. (Recipe does NOT use this: it hydrates per-item via `set` + the
 * separate `markSynced()` so its diff-sync warm-start invariant holds.)
 */
export async function hydrateStore<T>(
  cache: { getAll(): Promise<ReadonlyArray<T>> },
  store: { load(items: ReadonlyArray<T>): void },
  filter?: (item: T) => boolean,
): Promise<void> {
  const all = await cache.getAll();
  const items = filter === undefined ? all : all.filter(filter);
  if (items.length > 0) store.load(items);
}
