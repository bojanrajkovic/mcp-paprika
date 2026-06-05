import { join } from "node:path";

import { err, ok } from "neverthrow";

import type { DiskCache } from "../../cache/disk-cache.js";
import type { MealApi } from "./api.js";
import type { Meal } from "./types.js";

import { DiskCache as DiskCacheImpl } from "../../cache/disk-cache.js";
import { hydrateStore } from "../../cache/hydrate.js";
import { defineModule, register } from "../../kernel/registry.js";
import { resolvePendingWriteTtl } from "../../utils/config.js";
import { toMessage } from "../../utils/log.js";
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
  commitMeal(saved: Readonly<Meal>): Promise<void>;
  /** Batch variant: commit N meals with one flush + one notifySync. */
  commitMealsBatch(items: ReadonlyArray<Readonly<Meal>>): Promise<void>;
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
      await cache.init();
      // Warm the store from cache so tools work on a warm restart before the first sync.
      await hydrateStore(cache, store);
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
      // Order: markPending* (FIRST, before any cache I/O) → cache put/remove → flush
      // → store set/delete → notifySync. The pending mark shields this UID from
      // sync-cycle reconciliation during the propagation race. No resourceListChanged()
      // — meals have no resource surface.
      const commitMeal: MealWrites["commitMeal"] = async (saved) => {
        if (saved.deleted) {
          const uid = saved.uid;
          state.store.markPendingDelete(uid);
          try {
            await state.cache.remove(uid);
            await state.cache.flush();
          } catch (e) {
            state.store.clearPending(uid);
            throw e;
          }
          state.store.delete(uid);
          await client.notifySync();
        } else {
          state.store.markPendingUpsert(saved.uid);
          try {
            await state.cache.put(saved);
            await state.cache.flush();
          } catch (e) {
            state.store.clearPending(saved.uid);
            throw e;
          }
          state.store.set(saved);
          await client.notifySync();
        }
      };

      // Batch variant: commits N meals with a single cache.flush() and a single
      // notifySync(). Marks all pending writes before any cache I/O; on cache
      // failure, clears ALL marked UIDs before re-throwing so no UID is left
      // shielded until TTL. No resourceListChanged().
      const commitMealsBatch: MealWrites["commitMealsBatch"] = async (items) => {
        if (items.length === 0) return;
        const markedUids: Array<Meal["uid"]> = [];
        for (const item of items) {
          if (item.deleted) {
            state.store.markPendingDelete(item.uid);
          } else {
            state.store.markPendingUpsert(item.uid);
          }
          markedUids.push(item.uid);
        }
        const clearPending = (): void => {
          for (const uid of markedUids) state.store.clearPending(uid);
        };
        // allSettled (not Promise.all): fail-fast would let in-flight ops race the
        // clearPending call in the catch block. We wait for every op to settle first.
        const opsResults = await Promise.allSettled(
          items.map((item) => (item.deleted ? state.cache.remove(item.uid) : state.cache.put(item))),
        );
        const opsFailure = opsResults.find((r): r is PromiseRejectedResult => r.status === "rejected");
        if (opsFailure !== undefined) {
          clearPending();
          throw opsFailure.reason;
        }
        try {
          await state.cache.flush();
        } catch (e) {
          clearPending();
          throw e;
        }
        for (const item of items) {
          if (item.deleted) {
            state.store.delete(item.uid);
          } else {
            state.store.set(item);
          }
        }
        await client.notifySync();
      };

      // The coordinator's batch write (api): POST then commit through the in-scope
      // chokepoint. Returns the server-saved meals on success, a user-facing error
      // message on failure (mirrors the live `schedule_menu` `toMessage`). The
      // `hasSynced` gate is the coordinator's (it guards before calling this),
      // matching the live ordering.
      const createMeals: MealApi["createMeals"] = async (meals) => {
        try {
          const saved = await client.saveMeals(meals);
          await commitMealsBatch(saved);
          return ok(saved);
        } catch (error) {
          return err(toMessage(error));
        }
      };

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
