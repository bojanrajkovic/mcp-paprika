import type { Result } from "neverthrow";

import type { Meal } from "./types.js";

/**
 * Meal's public contract — the surface the meal-planner coordinator consumes via
 * `ctx.deps.meal`. Meal owns only meals (meal-types are a separate standalone
 * module). The store and cache stay private; the coordinator reaches only these
 * methods.
 *
 * Designed from the verified live `schedule_menu` (`src/tools/meal-add-menu.ts`)
 * call sites, not the spike's illustrative `count()` (which has no live consumer).
 * `schedule_menu` materializes a menu's items into planner meals: it gates on the
 * meal store being synced, assigns a per-DATE `order_flag` across the batch, then
 * POSTs once and commits — so the contract is exactly those three operations:
 *   - `hasSynced` — the coordinator's meal-store start gate;
 *   - `orderFlagAssigner` — the stateful per-date `order_flag` assigner
 *     (`makeMealOrderFlagAssigner`, backed by `MealStore.getMaxOrderFlagOn`);
 *   - `createMeals` — the batch write (`client.saveMeals` + `commitMealsBatch`),
 *     bound in the `.self` factory because it needs `infra.client`.
 *
 * `read_meal_plan` and `search_meal_history` read meal data directly inside the
 * meal module via `self`, so they don't drive the public `api`.
 */
export interface MealApi {
  /** Whether the meal store has completed its first sync (start-guard gate). */
  hasSynced(): boolean;
  /**
   * Build a fresh stateful per-DATE `order_flag` assigner for one batch. Each
   * returned closure seeds each date from the persisted store
   * (`getMaxOrderFlagOn`) and increments within the batch, so multiple meals on
   * the same date in ONE batch get sequential flags. `order_flag` sequences per
   * calendar date across all meal types (not per `(date, type)`).
   */
  orderFlagAssigner(): (date: string) => number;
  /**
   * Persist a batch of new/edited meals: POST them to Paprika, then commit each
   * to the local cache and store through the meal commit chokepoint. Returns the
   * server-saved meals on success, or a user-facing error message on a write
   * failure (mirrors the live tool's `toMessage` formatting). Internalizes the
   * `infra.client.saveMeals` + `commitMealsBatch` sequence so the coordinator
   * never reaches the meal store or cache directly.
   */
  createMeals(meals: ReadonlyArray<Meal>): Promise<Result<ReadonlyArray<Meal>, string>>;
}
