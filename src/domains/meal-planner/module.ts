import type { MealPlannerApi } from "./api.js";

import { defineModule, register } from "../../kernel/registry.js";
import { deleteMealTypeTool } from "./tools/delete-meal-type.js";
import { scheduleMenuTool } from "./tools/schedule-menu.js";

declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    // Hyphenated id → quoted key (mirrors how siblings reference `deps["meal-type"]`).
    "meal-planner": MealPlannerApi;
  }
}

/**
 * The meal-planner COORDINATOR. It owns NO entity: no store, no cache, no sync
 * `reconcile`, no resource. It houses the cross-domain actions that span more
 * domains than any single owning module can see:
 *
 * - `schedule_menu` — materialize a saved menu's items into planner meals. Reads
 *   all four deps: menu + menu-items (resolve the menu, fetch its items), recipe
 *   (re-resolve each linked item's display name), meal-type (resolve the wire
 *   type integer + name), and meal (the batch write + per-date `order_flag`).
 * - `delete_meal_type` — the catalog write goes through the meal-type contract,
 *   but the warn-and-proceed reference counts need meal + menu, which the
 *   meal-type leaf cannot see.
 *
 * Because it has no internals it SKIPS `.state` and goes straight to `.build` (its
 * `state` is `{}`).
 *
 * `api` is the empty object: nothing reads meal-planner (it is a leaf coordinator),
 * so it contributes only tools and exposes no contract.
 */
register(
  defineModule("meal-planner", ["menu", "meal", "recipe", "meal-type"]).build(() => ({
    api: {},
    tools: [scheduleMenuTool, deleteMealTypeTool],
  })),
);
