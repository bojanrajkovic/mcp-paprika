/**
 * The widget-facing view of the server's structured-output shapes — the single, TYPE-ONLY surface
 * the widgets consume so a widget binds to the server's own inferred types instead of hand-mirroring
 * them. A server output-field rename now breaks the consuming widget at COMPILE time (a `svelte-check`
 * error) rather than drifting silently against a re-declared interface.
 *
 * TYPE-ONLY by hard constraint (ADR-0025, the `prod-widgets` CI gate): every name here is re-exported
 * with `export type`, so esbuild erases the whole module from the widget bundle — no value import
 * (zod, the kernel, server internals) ever reaches the browser. Each source is an import-CLEAN leaf
 * (zod + branded-id leaves only): the kernel-heavy tool files (`cook.ts`, `search.ts`, the recipe/
 * pantry `list.ts`) and the catalog-importing `meal/tools/helpers.ts` would drag the Node-typed
 * server graph into the DOM-lib `svelte-check` and fail it, so their output schemas live in these
 * leaves (`recipe-markdown.ts`, `pantry-helpers.ts`, `meal-schema.ts`) instead.
 *
 * These are the parse TARGET, not a validator. The widgets discriminate the host payload by shape and
 * spot-check only the arrays they iterate (a malicious host owns the iframe — full re-validation is
 * theater; a buggy host is the honest residual, and only a non-array `.map` actually throws).
 */

export type {
  BrowseContext,
  CookRecipeStructured,
  RecipeListStructured,
  RecipeReadStructured,
  RecipeRow,
  RecipeSearchStructured,
} from "../../../domains/recipe/recipe-markdown.js";

export type { GroceryItemRow, GroceryListReadStructured } from "../../../domains/grocery/grocery-helpers.js";

export type { MenuItemRow, MenuReadStructured } from "../../../domains/menu/menu-helpers.js";

export type { PantryItemRow, PantryListStructured } from "../../../domains/pantry/pantry-helpers.js";

export type { MealRow, MealTypeRef, MealWeekStructured } from "../../../domains/meal/meal-schema.js";
