import type { SyncContribution } from "../../kernel/registry.js";
import type { RecipeSyncResult } from "../../paprika/sync-types.js";
import type { RecipeSelf } from "../module.js";
import type { Recipe } from "../types.js";

/**
 * Recipe sync — the bespoke DIFF-AND-FETCH reconcile. NOT `syncReplaceAllEntity`:
 * recipes are the only entity with real content hashes, so `RecipeDiskCache.diff()`
 * classifies the canonical list against the local uid→hash index and only the
 * added/changed UIDs are fetched. Lifted verbatim from the legacy `SyncEngine`
 * (`src/paprika/sync.ts:280-346` + the result partition `:623-634`): pending-write
 * filtering (#57) and observation-clearing-by-hash (#92) come along UNCHANGED. The
 * kernel's driver only sequences it.
 *
 * `core` tier — runs first and in dependency order; `markSynced()` mid-cycle keeps
 * recipe tools available even if a later core reconcile (category) fails. Returns a
 * `RecipeSyncResult` to be emitted as `sync:complete`.
 */
export function recipesSync(self: RecipeSelf): SyncContribution<RecipeSelf, never> {
  return {
    tier: "core",
    reconcile: async (ctx): Promise<RecipeSyncResult> => {
      const { client, log } = ctx.infra;
      const { store, cache } = ctx.self.recipe;

      // 1. Recipe sync path
      log.debug("fetching recipe list");
      const entries = await client.listRecipes();
      log.debug({ count: entries.length }, "fetched recipe list");
      const diff = cache.diff(entries);
      log.debug(
        { added: diff.added.length, changed: diff.changed.length, removed: diff.removed.length },
        "recipe diff computed",
      );

      // Filter the diff through pending-writes (issue #57). A pending-upsert
      // means we just wrote this UID and the canonical list reflects pre-write
      // state; skip add/change/remove for it so sync doesn't roll back or
      // delete our local copy. A pending-delete means we just trashed this UID
      // and the canonical list may still have it; skip add/change so sync
      // doesn't resurrect our just-deleted recipe. We leave diff.removed
      // alone for pending-deletes: if the server actually no longer lists
      // the UID, honoring the removal is correct.
      const filteredRemoved = diff.removed.filter((uid) => !store.isPendingUpsert(uid));
      const filteredAdded = diff.added.filter((uid) => !store.isPendingUpsert(uid) && !store.isPendingDelete(uid));
      const filteredChanged = diff.changed.filter((uid) => !store.isPendingUpsert(uid) && !store.isPendingDelete(uid));

      // Compute UIDs to fetch
      const uidsToFetch = [...filteredAdded, ...filteredChanged];

      // Fetch recipes if any exist
      let fetchedRecipes: Array<Recipe> = [];
      if (uidsToFetch.length > 0) {
        log.debug({ count: uidsToFetch.length }, "fetching recipes");
        fetchedRecipes = await client.getRecipes(uidsToFetch);
        log.debug({ count: fetchedRecipes.length }, "fetched recipes");
      }

      // Write fetched recipes to cache and store
      for (const recipe of fetchedRecipes) {
        await cache.put(recipe);
        store.set(recipe);
      }

      // Remove deleted recipes (async, use Promise.all for concurrency)
      await Promise.all(filteredRemoved.map((uid) => cache.remove(uid)));
      for (const uid of filteredRemoved) {
        store.delete(uid);
      }

      // Observation-based clearing for recipe pending-upserts: clear only when
      // the canonical entry's hash matches our local cache. UID presence alone
      // is insufficient for updates — the UID is already in entries with the
      // PRE-write hash while propagation is in flight, and clearing on UID
      // presence would drop protection on the first sync cycle and let the
      // next cycle re-fetch and overwrite our edit (codex P1, PR #92).
      for (const entry of entries) {
        if (!store.isPendingUpsert(entry.uid)) continue;
        const local = store.get(entry.uid);
        if (local !== undefined && local.hash === entry.hash) {
          store.clearPending(entry.uid);
        }
      }

      // Recipe sync is complete; mark the store as synced now so recipe tools
      // remain available even if category or pantry sync subsequently fails.
      store.markSynced();
      store.setLastSyncedAt();

      // Partition fetched recipes: added vs updated.
      const addedSet = new Set(filteredAdded);
      const addedRecipes = fetchedRecipes.filter((r) => addedSet.has(r.uid));
      const updatedRecipes = fetchedRecipes.filter((r) => !addedSet.has(r.uid));
      return {
        changeType: "recipes",
        changes: { added: addedRecipes, updated: updatedRecipes, removedUids: filteredRemoved },
      };
    },
    sweep: () => self.recipe.store.sweepPending(),
  };
}
