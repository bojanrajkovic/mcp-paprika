import type { SyncContribution } from "../../../kernel/registry.js";
import type { GrocerySelf } from "../module.js";

import { pruneOrphanCache } from "../../../paprika/sync.js";

/**
 * Grocery-ingredient sync — the bespoke replace-all reconcile. NOT
 * `syncReplaceAllEntity`: the ingredient catalog is a plain name-keyed store with no
 * pending-writes, so it does a direct `listGroceryIngredients`,
 * a no-aisle-row filter, manual
 * orphan-cache cleanup, then `store.load` + re-`put`. Reaches the domain's own
 * ingredient store and cache via `ctx.self.ingredients.*`.
 *
 * The no-aisle drop preserves the documented failure semantics: Paprika returns
 * `aisle_uid: null` for an ingredient never filed into an aisle (the schema coerces
 * null → ""). Such a row carries no aisle memory — resolving it yields the same
 * Miscellaneous default as no catalog entry at all — so it is dropped, with a single
 * `warn`-level count so the drop is observable. (Historically the un-nullable schema
 * also threw on these rows, aborting the whole cycle before meals/menus could sync.)
 *
 * `core` tier — inside the outer try that aborts the cycle on failure. Returns `void`
 * — the ingredient catalog has no
 * MCP resource surface and emits no `sync:complete`. NO `sweep` — the plain store
 * tracks no pending writes, so there is nothing to sweep; and so (unlike the
 * list/item sync factories) this one takes no `self` — its own store/cache are
 * reached through the `BootCtx` the kernel passes to `reconcile`.
 */
export function groceryIngredientsSync(): SyncContribution<GrocerySelf, "aisle" | "pantry"> {
  return {
    tier: "core",
    reconcile: async (ctx): Promise<void> => {
      const { store, cache } = ctx.self.ingredients;
      const { client, log } = ctx.infra;

      // 6. Ingredient catalog sync (replace-all, no pending-writes)
      log.debug("fetching grocery ingredients");
      const groceryIngredients = await client.listGroceryIngredients();
      log.debug({ count: groceryIngredients.length }, "fetched grocery ingredients");

      // Drop entries with no aisle. Paprika returns aisle_uid: null for an ingredient
      // that was never filed into an aisle (GroceryIngredientSchema coerces that to "").
      // Such a row carries no aisle memory — add_grocery_items resolves it to "" and the
      // item then defaults to "Miscellaneous", identical to having no catalog entry at
      // all — so keeping it just bloats the catalog. (Historically the null value also
      // aborted the whole sync cycle before meals/menus could sync.) Warn on the dropped
      // count so the drop is observable rather than silent.
      const filteredIngredients = groceryIngredients.filter((i) => i.aisleUid !== "");
      const droppedNoAisle = groceryIngredients.length - filteredIngredients.length;
      if (droppedNoAisle > 0) {
        log.warn({ count: droppedNoAisle }, "dropped grocery ingredients with no aisle");
      }

      const cachedIngredientUids = new Set((await cache.getAll()).map((i) => i.uid));
      const filteredIngredientUids = new Set(filteredIngredients.map((i) => i.uid));
      await pruneOrphanCache(cache, cachedIngredientUids, filteredIngredientUids, log, "grocery ingredients");

      store.load(filteredIngredients);
      await Promise.all(filteredIngredients.map((i) => cache.put(i)));
    },
  };
}
