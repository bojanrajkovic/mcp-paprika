/**
 * Meal-planner's public contract — deliberately EMPTY.
 *
 * Meal-planner is a pure COORDINATOR: it owns no entity (no store, no cache, no
 * sync, no resource) and exists only to host the cross-domain `schedule_menu`
 * action, which spans menu + meal + recipe + meal-type. Nothing reads meal-planner
 * — it is a leaf in the dependency graph, depended on by no other module — so there
 * is nothing to expose.
 *
 * The contract stays `{}` (matching grocery, discover, and photo-gen, the other
 * consumer-only modules). Were a future surface to need scheduling state, it would
 * be added here; today the action's reads/writes all flow through its DECLARED
 * deps' contracts (`ctx.deps.menu` / `.meal` / `.recipe` / `["meal-type"]`).
 */
// oxlint-disable-next-line no-empty-object-type
export interface MealPlannerApi {}
