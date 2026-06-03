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
 *
 * A foreign **key reference** is not a primary key: it may be absent (`null`),
 * the `""` no-reference sentinel, or otherwise empty, so it must NOT inherit a
 * target PK's `.min(1)` non-empty invariant. Where a PK schema carries `.min(1)`
 * (Recipe, Menu, GroceryList), the matching `*RefSchema` is the same brand
 * without that constraint — so an FK field brands without tightening runtime.
 * Targets whose PK has no `.min(1)` (Category, Aisle, MealType, …) need no
 * variant: their identity schema is already a faithful FK schema and is reused
 * directly (e.g. `recipe.categories: z.array(CategoryUidSchema)`). Runtime-
 * enforced FK validation — whether `""`/`null` should parse at all — is #202.
 */

export const RecipeUidSchema = z.string().min(1).brand("RecipeUid");
export type RecipeUid = z.infer<typeof RecipeUidSchema>;
/** FK-reference form of {@link RecipeUidSchema} — same brand, no `.min(1)` (a
 * recipe link may be absent). Infers the identical `RecipeUid` type. */
export const RecipeUidRefSchema = z.string().brand("RecipeUid");

export const CategoryUidSchema = z.string().brand("CategoryUid");
export type CategoryUid = z.infer<typeof CategoryUidSchema>;

export const AisleUidSchema = z.string().brand("AisleUid");
export type AisleUid = z.infer<typeof AisleUidSchema>;
/** The "no aisle" foreign-key sentinel: an empty {@link AisleUid}. Grocery items,
 * pantry items, and grocery ingredients coerce a null wire `aisle_uid` to this
 * rather than carrying `null` (the un-nullable PK schema would reject it — #76).
 * `AisleUidSchema` carries no `.min(1)`, so `""` is a valid branded value. */
export const NO_AISLE_UID = "" as AisleUid;

export const PantryItemUidSchema = z.string().min(1).brand("PantryItemUid");
export type PantryItemUid = z.infer<typeof PantryItemUidSchema>;

export const GroceryListUidSchema = z.string().min(1).brand("GroceryListUid");
export type GroceryListUid = z.infer<typeof GroceryListUidSchema>;
/** FK-reference form of {@link GroceryListUidSchema} — same brand, no `.min(1)`. */
export const GroceryListUidRefSchema = z.string().brand("GroceryListUid");

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
/** FK-reference form of {@link MenuUidSchema} — same brand, no `.min(1)` (a
 * cascade-deleted menu item nulls its back-reference). */
export const MenuUidRefSchema = z.string().brand("MenuUid");

export const MenuItemUidSchema = z.string().min(1).brand("MenuItemUid");
export type MenuItemUid = z.infer<typeof MenuItemUidSchema>;

export const PhotoUidSchema = z.string().min(1).brand("PhotoUid");
export type PhotoUid = z.infer<typeof PhotoUidSchema>;
