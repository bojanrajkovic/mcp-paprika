import type { ResultAsync } from "neverthrow";

import type { HasSynced } from "../../kernel/registry.js";
import type { MealTypeUid } from "../meal-type/ids.js";
import type { Meal } from "./types.js";

/**
 * Meal's public contract — the surface the meal-planner coordinator consumes via
 * `ctx.deps.meal` (meal owns only meals; meal-types are a separate module).
 *
 * Shaped around the coordinator's two tools. `schedule_menu` materializes a menu's
 * items into planner meals by gating on the meal store being synced, assigning a
 * per-DATE `order_flag` across the batch, then POSTing once and committing:
 *   - `hasSynced` (inherited from {@link HasSynced}) — the coordinator's meal-store start gate;
 *   - `orderFlagAssigner` — the stateful per-date `order_flag` assigner
 *     (`makeMealOrderFlagAssigner`, backed by `MealStore.getMaxOrderFlagOn`);
 *   - `createMeals` — the batch write (`client.saveMeals` + `commitMealsBatch`).
 * `delete_meal_type` reports how many meals will lose their type label:
 *   - `countByTypeUid` — the informational reference count (warn-and-proceed).
 *
 * `read_meal_plan` and `search_meal_history` read meal data directly inside the meal
 * module via `ctx.state`, so they don't drive the public `api`.
 */
export interface MealApi extends HasSynced {
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
  createMeals(meals: ReadonlyArray<Meal>): ResultAsync<ReadonlyArray<Meal>, string>;
  /**
   * How many meals (planned or logged) reference a meal type. Informational —
   * `delete_meal_type` warns-and-proceeds with this count; meal history is
   * append-only, so references never block a type's deletion.
   */
  countByTypeUid(uid: MealTypeUid): number;
}
