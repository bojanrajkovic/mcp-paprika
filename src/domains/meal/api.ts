import type { ResultAsync } from "neverthrow";

import type { HasSynced } from "../../kernel/registry.js";
import type { MealTypeUid } from "../meal-type/ids.js";
import type { MealRow } from "./tools/helpers.js";
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
 *   - `createMeals` — the batch write (`client.saveMeals` + `commitMealsBatch`),
 *     distinguishing save failure from commit failure so `schedule_menu` can keep
 *     the created meal UIDs on a commit-only divergence;
 *   - `toRows` — projects saved meals into their structured rows, resolving
 *     each type name through meal's own meal-type dep, so the coordinator builds its
 *     structured response without reaching meal's internal row helper.
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
   * Persist a batch of new meals: POST them to Paprika, then commit to the local
   * cache and store through the meal commit chokepoint. Returns the server-saved
   * meals on success. On failure, the error names the phase — `"save"` (the POST
   * failed; nothing was created server-side, so the caller can surface a genuine
   * error) or `"commit"` (the POST succeeded but the local commit failed; the
   * meals exist server-side and appear after the next sync, so the caller must
   * NOT report them as failed) — and carries the saved meals so the caller can
   * surface their UIDs. Internalizes the `infra.client.saveMeals` +
   * `commitMealsBatch` sequence so the coordinator never reaches the meal store
   * or cache directly.
   */
  createMeals(meals: ReadonlyArray<Meal>): ResultAsync<ReadonlyArray<Meal>, MealCreateError>;
  /**
   * Project meals into their structured rows, resolving each meal's type name through
   * the live meal-type catalog (meal's own declared dep). `schedule_menu` uses it to
   * build the structured response for the meals it just created, so the meal-type
   * dependency stays private to meal.
   */
  toRows(meals: ReadonlyArray<Meal>): ReadonlyArray<MealRow>;
  /**
   * How many meals (planned or logged) reference a meal type. Informational —
   * `delete_meal_type` warns-and-proceeds with this count; meal history is
   * append-only, so references never block a type's deletion.
   */
  countByTypeUid(uid: MealTypeUid): number;
}

/** The phase that failed inside `createMeals`, with the underlying error message. */
export interface MealCreateError {
  readonly phase: "save" | "commit";
  readonly message: string;
  /** The server-saved meals — empty on a `"save"` failure, populated on `"commit"`. */
  readonly saved: ReadonlyArray<Meal>;
}
