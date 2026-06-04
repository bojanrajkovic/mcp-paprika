import type { SyncContribution } from "../../kernel/registry.js";
import type { GrocerySelf } from "../module.js";

/**
 * Grocery-ingredient sync — the bespoke replace-all reconcile. NOT
 * `syncReplaceAllEntity`: the ingredient catalog is a plain name-keyed store with no
 * tombstones and no pending-writes, so it does a direct `listGroceryIngredients`,
 * a two-stage filter (drop `deleted`, then drop the no-aisle rows), manual
 * orphan-cache cleanup, then `store.load` + re-`put`. Lifted VERBATIM from the legacy
 * `SyncEngine` (`src/paprika/sync.ts:436-467`), adapting only the references
 * (`this._deps.*` → `ctx.self.ingredients.*` / `ctx.infra.*`).
 *
 * The no-aisle drop preserves the documented failure semantics: Paprika returns
 * `aisle_uid: null` for an ingredient never filed into an aisle (the schema coerces
 * null → ""). Such a row carries no aisle memory — resolving it yields the same
 * Miscellaneous default as no catalog entry at all — so it is dropped, with a single
 * `warn`-level count so the drop is observable. (Historically the un-nullable schema
 * also threw on these rows, aborting the whole cycle before meals/menus could sync.)
 *
 * `core` tier — step 6 of the legacy in-order core sequence, inside the outer try
 * that aborts the cycle on failure. Returns `void` — the ingredient catalog has no
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

      // Drop deleted entries AND entries with no aisle. Paprika returns
      // aisle_uid: null for an ingredient that was never filed into an aisle
      // (GroceryIngredientSchema coerces that to ""). Such a row carries no aisle
      // memory — add_grocery_items resolves it to "" and the item then defaults to
      // "Miscellaneous", identical to having no catalog entry at all — so keeping it
      // just bloats the catalog. (Historically the null value also aborted the whole
      // sync cycle before meals/menus could sync.) Warn on the dropped count so the
      // drop is observable rather than silent.
      const liveIngredients = groceryIngredients.filter((i) => !i.deleted);
      const filteredIngredients = liveIngredients.filter((i) => i.aisleUid !== "");
      const droppedNoAisle = liveIngredients.length - filteredIngredients.length;
      if (droppedNoAisle > 0) {
        log.warn({ count: droppedNoAisle }, "dropped grocery ingredients with no aisle");
      }

      const cachedIngredients = await cache.getAll();
      const cachedIngredientUids = new Set(cachedIngredients.map((i) => i.uid));
      const filteredIngredientUids = new Set(filteredIngredients.map((i) => i.uid));
      const orphanIngredientUids = [...cachedIngredientUids].filter((uid) => !filteredIngredientUids.has(uid));

      await Promise.all(orphanIngredientUids.map((uid) => cache.remove(uid)));
      store.load(filteredIngredients);
      await Promise.all(filteredIngredients.map((i) => cache.put(i)));

      if (orphanIngredientUids.length > 0) {
        log.debug({ count: orphanIngredientUids.length }, "removed orphan grocery ingredients");
      }
    },
  };
}
