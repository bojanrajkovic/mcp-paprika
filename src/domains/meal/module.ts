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
import { mealDiskDescriptor } from "./disk.js";
import { MealStore } from "./store.js";
import { mealSync } from "./syncs/meal-sync.js";
import { logCookedMealTool } from "./tools/log-cooked-meal.js";
import { deleteMealTool, planMealsTool, updateMealTool } from "./tools/meal-writes.js";
import { readMealPlanTool } from "./tools/read-meal-plan.js";
import { rescheduleMealTool } from "./tools/reschedule-meal.js";
import { searchMealHistoryTool } from "./tools/search-meal-history.js";

declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    meal: MealApi;
  }
}

/**
 * The meal module's internals. Owns ONLY meals (meal-types are a separate
 * standalone module). One store + plain `DiskCache` pair.
 *
 * The write-capable methods (`commitMeal`, `commitMealsBatch`, and the api's
 * `createMeals`) are bound HERE in `.self`, not in `.build`, because they WRITE —
 * they close over `infra.client`, which the factory has and `.build` does not
 * (mirrors aisle's `ensureAisle`). The read-only contract methods (`hasSynced`,
 * `orderFlagAssigner`) are assembled from the store in `.build`. No
 * `resourceListChanged()` — meals have no MCP resource surface.
 */
export interface MealSelf {
  readonly store: MealStore;
  readonly cache: DiskCache<Meal>;

  /** Persist a saved meal locally (upsert or soft-delete), then nudge cloud sync. */
  commitMeal(saved: Readonly<Meal>): Promise<void>;
  /** Batch variant: commit N meals with one flush + one notifySync. */
  commitMealsBatch(items: ReadonlyArray<Readonly<Meal>>): Promise<void>;
  /** The api's batch write (POST + commit), bound here because it needs `infra.client`. */
  createMeals: MealApi["createMeals"];
}

register(
  defineModule("meal", ["recipe", "meal-type"])
    .self<MealSelf>(async (infra) => {
      const { client, log } = infra;

      const store = new MealStore({ pendingWriteTtlMs: resolvePendingWriteTtl(infra.config) });
      // Disk is flat: the cache's subdir is the original `<cacheDir>/meals`
      // (reuse-in-place — ADR-0009 keeps the cache un-namespaced, so there is no migration).
      const cache = new DiskCacheImpl<Meal>({
        ...mealDiskDescriptor,
        subdir: join(infra.cacheDir, mealDiskDescriptor.subdir),
        log,
      });
      await cache.init();
      // Warm the store from cache so tools work on a warm restart before the first sync.
      await hydrateStore(cache, store);

      // ---- Meal write chokepoints ----
      // Order: markPending* (FIRST, before any cache I/O) → cache put/remove → flush
      // → store set/delete → notifySync. The pending mark shields this UID from
      // sync-cycle reconciliation during the propagation race. No resourceListChanged()
      // — meals have no resource surface.
      const commitMeal: MealSelf["commitMeal"] = async (saved) => {
        if (saved.deleted) {
          const uid = saved.uid;
          store.markPendingDelete(uid);
          try {
            await cache.remove(uid);
            await cache.flush();
          } catch (e) {
            store.clearPending(uid);
            throw e;
          }
          store.delete(uid);
          await client.notifySync();
        } else {
          store.markPendingUpsert(saved.uid);
          try {
            await cache.put(saved);
            await cache.flush();
          } catch (e) {
            store.clearPending(saved.uid);
            throw e;
          }
          store.set(saved);
          await client.notifySync();
        }
      };

      // Batch variant: commits N meals with a single cache.flush() and a single
      // notifySync(). Marks all pending writes before any cache I/O; on cache
      // failure, clears ALL marked UIDs before re-throwing so no UID is left
      // shielded until TTL. No resourceListChanged().
      const commitMealsBatch: MealSelf["commitMealsBatch"] = async (items) => {
        if (items.length === 0) return;
        const markedUids: Array<Meal["uid"]> = [];
        for (const item of items) {
          if (item.deleted) {
            store.markPendingDelete(item.uid);
          } else {
            store.markPendingUpsert(item.uid);
          }
          markedUids.push(item.uid);
        }
        const clearPending = (): void => {
          for (const uid of markedUids) store.clearPending(uid);
        };
        // allSettled (not Promise.all): fail-fast would let in-flight ops race the
        // clearPending call in the catch block. We wait for every op to settle first.
        const opsResults = await Promise.allSettled(
          items.map((item) => (item.deleted ? cache.remove(item.uid) : cache.put(item))),
        );
        const opsFailure = opsResults.find((r): r is PromiseRejectedResult => r.status === "rejected");
        if (opsFailure !== undefined) {
          clearPending();
          throw opsFailure.reason;
        }
        try {
          await cache.flush();
        } catch (e) {
          clearPending();
          throw e;
        }
        for (const item of items) {
          if (item.deleted) {
            store.delete(item.uid);
          } else {
            store.set(item);
          }
        }
        await client.notifySync();
      };

      // The coordinator's batch write (api): POST then commit through the bound
      // chokepoint. Returns the server-saved meals on success, a user-facing error
      // message on failure (mirrors the live `schedule_menu` `toMessage`). The
      // `hasSynced` gate is the coordinator's (it guards before calling this),
      // matching the live ordering. Bound here because it needs `infra.client`.
      const createMeals: MealApi["createMeals"] = async (meals) => {
        try {
          const saved = await client.saveMeals(meals);
          await commitMealsBatch(saved);
          return ok(saved);
        } catch (error) {
          return err(toMessage(error));
        }
      };

      return { store, cache, commitMeal, commitMealsBatch, createMeals };
    })
    .build((self) => ({
      api: {
        hasSynced: () => self.store.hasSynced,
        // A fresh per-DATE order_flag assigner per call (stateful within one batch).
        orderFlagAssigner: () => {
          const next = new Map<string, number>();
          return (date: string) => {
            const flag = next.get(date) ?? (self.store.getMaxOrderFlagOn(date) ?? -1) + 1;
            next.set(date, flag + 1);
            return flag;
          };
        },
        // Bound in `.self` (it needs `infra.client`); exposed via `self` like aisle's
        // `ensureAisle`.
        createMeals: self.createMeals,
      },
      tools: [
        planMealsTool,
        updateMealTool,
        deleteMealTool,
        rescheduleMealTool,
        logCookedMealTool,
        searchMealHistoryTool,
        readMealPlanTool,
      ],
      syncs: [mealSync(self)],
      flush: () => self.cache.flush(),
    })),
);
