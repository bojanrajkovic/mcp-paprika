import { z } from "zod";

/**
 * Branded UID schemas — the shared identifier leaf every entity module imports.
 *
 * Branding is **compile-time kind-safety only**: at runtime `z.string().brand()`
 * is a no-op (the brand is a phantom type), so each schema parses identically to
 * `z.string()`. This buys a `RecipeUid` that won't silently cross-assign to a
 * `CategoryUid` in the type checker, without changing what the wire/disk layer
 * accepts. Runtime-enforced branding (UIDs that actually carry their kind so a
 * cross-entity UID fails to parse) is tracked in #202.
 *
 * `.min(1)` reflects each entity's existing primary-key invariant and is left
 * exactly as it was before this leaf was hoisted — standardizing it is a runtime
 * change (it would reject the `""` "no reference" sentinel several foreign keys
 * rely on) and belongs with the #202 runtime-enforcement work, not here.
 */

export const RecipeUidSchema = z.string().min(1).brand("RecipeUid");
export type RecipeUid = z.infer<typeof RecipeUidSchema>;

export const CategoryUidSchema = z.string().brand("CategoryUid");
export type CategoryUid = z.infer<typeof CategoryUidSchema>;

export const AisleUidSchema = z.string().brand("AisleUid");
export type AisleUid = z.infer<typeof AisleUidSchema>;

export const PantryItemUidSchema = z.string().min(1).brand("PantryItemUid");
export type PantryItemUid = z.infer<typeof PantryItemUidSchema>;

export const GroceryListUidSchema = z.string().min(1).brand("GroceryListUid");
export type GroceryListUid = z.infer<typeof GroceryListUidSchema>;

export const GroceryItemUidSchema = z.string().min(1).brand("GroceryItemUid");
export type GroceryItemUid = z.infer<typeof GroceryItemUidSchema>;

export const GroceryIngredientUidSchema = z.string().brand("GroceryIngredientUid");
export type GroceryIngredientUid = z.infer<typeof GroceryIngredientUidSchema>;

export const MealUidSchema = z.string().brand("MealUid");
export type MealUid = z.infer<typeof MealUidSchema>;

export const MealTypeUidSchema = z.string().brand("MealTypeUid");
export type MealTypeUid = z.infer<typeof MealTypeUidSchema>;

export const MenuUidSchema = z.string().min(1).brand("MenuUid");
export type MenuUid = z.infer<typeof MenuUidSchema>;

export const MenuItemUidSchema = z.string().min(1).brand("MenuItemUid");
export type MenuItemUid = z.infer<typeof MenuItemUidSchema>;

export const PhotoUidSchema = z.string().min(1).brand("PhotoUid");
export type PhotoUid = z.infer<typeof PhotoUidSchema>;
