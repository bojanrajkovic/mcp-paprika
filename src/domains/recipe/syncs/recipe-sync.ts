import { okAsync, ResultAsync } from "neverthrow";

import type { SyncContribution } from "../../../kernel/registry.js";
import type { RecipeSyncResult } from "../../../paprika/sync-types.js";
import type { RecipeState } from "../module.js";
import type { Recipe } from "../types.js";

/**
 * Recipe sync — the bespoke DIFF-AND-FETCH reconcile. NOT `syncReplaceAllEntity`:
 * recipes are the only entity with real content hashes, so `RecipeDiskCache.diff()`
 * classifies the canonical list against the local uid→hash index and only the
 * added/changed UIDs are fetched. Pending-write filtering (#57) and
 * observation-clearing-by-hash (#92) protect in-flight writes from being rolled
 * back by a concurrent sync cycle.
 *
 * `core` tier — runs first and in dependency order; `markSynced()` mid-cycle keeps
 * recipe tools available even if a later core reconcile (category) fails. Returns a
 * `RecipeSyncResult` for the `sync:complete` notifier path AND emits `recipe-changed`/
 * `recipe-removed` on the kernel re-index seam for discover (the two consumers are
 * independent — see the emit comment).
 */
export function recipesSync(state: RecipeState): SyncContribution<RecipeState, never> {
  return {
    tier: "core",
    reconcile: (ctx) => {
      const { client, log } = ctx.infra;
      const { store, cache } = ctx.state.recipe;

      // 1. Recipe sync path
      log.debug("fetching recipe list");
      return client
        .listRecipes()
        .andThen((entries) => {
          log.debug({ count: entries.length }, "fetched recipe list");
          return cache.diff(entries).map((diff) => {
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
            const filteredAdded = diff.added.filter(
              (uid) => !store.isPendingUpsert(uid) && !store.isPendingDelete(uid),
            );
            const filteredChanged = diff.changed.filter(
              (uid) => !store.isPendingUpsert(uid) && !store.isPendingDelete(uid),
            );
            return { entries, filteredAdded, filteredChanged, filteredRemoved };
          });
        })
        .andThen((acc) => {
          // Fetch recipes if any exist
          const uidsToFetch = [...acc.filteredAdded, ...acc.filteredChanged];
          if (uidsToFetch.length === 0) {
            return okAsync({ ...acc, fetchedRecipes: [] as Array<Recipe> });
          }
          log.debug({ count: uidsToFetch.length }, "fetching recipes");
          return client.getRecipes(uidsToFetch).map((fetchedRecipes) => {
            log.debug({ count: fetchedRecipes.length }, "fetched recipes");
            return { ...acc, fetchedRecipes };
          });
        })
        .andThen((acc) =>
          // Write fetched recipes to cache and store. The puts run concurrently;
          // the store mutations apply only once every put landed, so an err
          // (aborting the cycle) never leaves the store ahead of the cache.
          ResultAsync.combine(acc.fetchedRecipes.map((recipe) => cache.put(recipe))).map(() => {
            for (const recipe of acc.fetchedRecipes) {
              store.set(recipe);
            }
            return acc;
          }),
        )
        .andThen((acc) =>
          // Remove deleted recipes (concurrently; an err aborts the cycle)
          ResultAsync.combine(acc.filteredRemoved.map((uid) => cache.remove(uid))).map(() => {
            for (const uid of acc.filteredRemoved) {
              store.delete(uid);
            }
            return acc;
          }),
        )
        .map(({ entries, filteredAdded, filteredRemoved, fetchedRecipes }): RecipeSyncResult => {
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

          // Drive the discover re-index seam. `recipe-changed` fires
          // EVERY cycle — even with no changes — because discover's handler runs its
          // startup-reconcile retry off this signal, so a recovered embeddings backend
          // self-heals without a recipe edit or restart (#177); the handler skips the
          // empty case. A tool-written recipe is pending here, so it's filtered out of this
          // diff and re-embedded via its own commit emit instead — no double-index.
          ctx.infra.indexEvents.emit({ type: "recipe-changed", recipes: [...addedRecipes, ...updatedRecipes] });
          if (filteredRemoved.length > 0) {
            ctx.infra.indexEvents.emit({ type: "recipe-removed", uids: filteredRemoved });
          }

          return {
            changeType: "recipes",
            changes: { added: addedRecipes, updated: updatedRecipes, removedUids: filteredRemoved },
          };
        });
    },
    sweep: () => state.recipe.store.sweepPending(),
  };
}
