import { join } from "node:path";

import type { ResultAsync } from "neverthrow";

import type { CacheError, DiskCache } from "../../cache/disk-cache.js";
import type { MealApi } from "./api.js";
import type { Meal } from "./types.js";

import { DiskCache as DiskCacheImpl } from "../../cache/disk-cache.js";
import { hydrateStore } from "../../cache/hydrate.js";
import { commitEntities, deleteOp, upsertOp } from "../../entity/commit.js";
import { defineModule, register } from "../../kernel/registry.js";
import { notifySyncBestEffort } from "../../paprika/client.js";
import { resolvePendingWriteTtl } from "../../utils/config.js";
import { unwrapAtBoot } from "../../utils/errors.js";
import { MealStore } from "./store.js";
import { mealSync } from "./sync.js";
import { logCookedMealTool } from "./tools/log-cooked-meal.js";
import { deleteMealTool, planMealsTool, updateMealTool } from "./tools/meal-writes.js";
import { readMealPlanTool } from "./tools/read-meal-plan.js";
import { readRecipeHistoryTool } from "./tools/recipe-history.js";
import { rescheduleMealTool } from "./tools/reschedule-meal.js";
import { searchMealHistoryTool } from "./tools/search-meal-history.js";
import { mealDiskDescriptor } from "./types.js";

declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    meal: MealApi;
  }
}

/** The meal module's state — the meal store + disk cache (meals only; meal-types are a separate module). */
export interface MealState {
  readonly store: MealStore;
  readonly cache: DiskCache<Meal>;
}

/**
 * Meal's write chokepoints (`ctx.writes`), invoked by its own plan / update /
 * delete / reschedule / log-cooked tools. No `resourceListChanged()` — meals have
 * no MCP resource surface.
 */
export interface MealWrites {
  /** Persist a saved meal locally (upsert or soft-delete), then nudge cloud sync. */
  commitMeal(saved: Readonly<Meal>): ResultAsync<void, CacheError>;
  /** Batch variant: commit N meals with one flush + one notifySync. */
  commitMealsBatch(items: ReadonlyArray<Readonly<Meal>>): ResultAsync<void, CacheError>;
}

register(
  defineModule("meal", ["recipe", "meal-type"])
    .state<MealState>(async (infra) => {
      const store = new MealStore({ pendingWriteTtlMs: resolvePendingWriteTtl(infra.config) });
      // Disk is flat: the cache's subdir is the original `<cacheDir>/meals`
      // (reuse-in-place — ADR-0009 keeps the cache un-namespaced, so there is no migration).
      const cache = new DiskCacheImpl<Meal>({
        ...mealDiskDescriptor,
        subdir: join(infra.cacheDir, mealDiskDescriptor.subdir),
        log: infra.log,
      });
      unwrapAtBoot(await cache.init(), "meal cache init");
      // Warm the store from cache so tools work on a warm restart before the first sync.
      unwrapAtBoot(await hydrateStore(cache, store), "meal cache hydrate");
      return { store, cache };
    })
    .build((state, infra) => {
      const { client } = infra;

      // ---- Meal write chokepoints ----
      // Assembled here (not in `.state`) because they close over `infra.client`,
      // keeping MealState pure (ADR-0012). The commit chokepoints are internal — meal's
      // own tools reach them via `ctx.writes` — while `createMeals` is the contract
      // write the meal-planner coordinator consumes via `ctx.deps.meal`.
      //
      // The commit protocol (mark-first → cache → flush → clear-on-failure → store
      // → notify) lives in src/entity/commit.ts; these bind meal's slice. No
      // resourceListChanged() — meals have no resource surface.
      const mealFx = { finish: () => notifySyncBestEffort(client, infra.log) };
      const mealOp = (m: Readonly<Meal>) => (m.deleted ? deleteOp(m.uid) : upsertOp(m));
      const commitMeal: MealWrites["commitMeal"] = (saved) => commitEntities(state, [mealOp(saved)], mealFx);
      const commitMealsBatch: MealWrites["commitMealsBatch"] = (items) =>
        commitEntities(state, items.map(mealOp), mealFx);

      // The coordinator's batch write (api): POST then commit through the in-scope
      // chokepoint. Returns the server-saved meals on success, a user-facing error
      // message on failure. The `hasSynced` gate is the coordinator's (it guards
      // before calling this), matching the live ordering.
      const createMeals: MealApi["createMeals"] = (meals) =>
        client
          .saveMeals(meals)
          .mapErr((e) => e.message)
          .andThen((saved) =>
            commitMealsBatch(saved)
              .map(() => saved)
              .mapErr((e) => e.message),
          );

      return {
        api: {
          hasSynced: () => state.store.hasSynced,
          // A fresh per-DATE order_flag assigner per call (stateful within one batch).
          orderFlagAssigner: () => {
            const next = new Map<string, number>();
            return (date: string) => {
              const flag = next.get(date) ?? (state.store.getMaxOrderFlagOn(date) ?? -1) + 1;
              next.set(date, flag + 1);
              return flag;
            };
          },
          createMeals,
        },
        writes: { commitMeal, commitMealsBatch },
        tools: [
          planMealsTool,
          updateMealTool,
          deleteMealTool,
          rescheduleMealTool,
          logCookedMealTool,
          searchMealHistoryTool,
          readRecipeHistoryTool,
          readMealPlanTool,
        ],
        syncs: [mealSync(state)],
        flush: () => state.cache.flush(),
      };
    }),
);
