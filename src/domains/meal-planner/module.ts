import type { MealPlannerApi } from "./api.js";

import { defineModule, register } from "../../kernel/registry.js";
import { scheduleMenuTool } from "./tools/schedule-menu.js";

declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    // Hyphenated id → quoted key (mirrors how siblings reference `deps["meal-type"]`).
    "meal-planner": MealPlannerApi;
  }
}

/**
 * The meal-planner COORDINATOR. It owns NO entity: no store, no cache, no sync
 * `reconcile`, no resource. Its sole job is the cross-domain `schedule_menu`
 * action — materialize a saved menu's items into planner meals — which is the one
 * legitimately >2-domain span in the surface, so it lives in a coordinator rather
 * than on any single owning module (ADR-0009).
 *
 * Because it has no internals it SKIPS `.state` and goes straight to `.build` (its
 * `state` is `{}`). `dependsOn ["menu","meal","recipe","meal-type"]`: `schedule_menu`
 * reads all four domains — menu + menu-items (resolve the menu, fetch its items),
 * recipe (re-resolve each linked item's display name), meal-type (resolve the wire
 * type integer + name), and meal (the batch write + per-date `order_flag`).
 *
 * `api` is the empty object: nothing reads meal-planner (it is a leaf coordinator),
 * so it contributes only a tool and exposes no contract.
 */
register(
  defineModule("meal-planner", ["menu", "meal", "recipe", "meal-type"]).build(() => ({
    api: {},
    tools: [scheduleMenuTool],
  })),
);
