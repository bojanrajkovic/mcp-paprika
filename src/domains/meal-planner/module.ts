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
 * Because it has no internals it SKIPS `.self` and goes straight to `.build` (its
 * `self` is `{}`). `dependsOn ["menu","meal","recipe","meal-type"]` is wider than
 * the original target table's `["menu","meal"]` and wider than the spike's
 * `["recipe","meal"]`: the live tool reads all four domains directly — menu +
 * menu-items (resolve the menu, fetch its items), recipe (re-resolve each linked
 * item's display name), meal-type (resolve the wire type integer + name), and meal
 * (the batch write + per-date `order_flag`). Verified against
 * `src/tools/meal-add-menu.ts` (`:112,120,139,154,184`).
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
