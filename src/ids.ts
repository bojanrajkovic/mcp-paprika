import { z } from "zod";

/**
 * Branded UID schemas — the shared identifier leaf every entity module imports.
 *
 * Branding is **compile-time kind-safety only**: at runtime `z.string().brand()`
 * is a no-op (the brand is a phantom type), so each schema parses identically to
 * a plain string of the same shape. This buys a `RecipeUid` that won't silently
 * cross-assign to a `CategoryUid` in the type checker, without trying to enforce
 * a UID's *kind* at runtime — which is not available to us, because the UID
 * namespace is Paprika's, not ours (the server validates a client-minted UID as
 * canonical hex and itself mints shapes a client cannot reproduce). See
 * `docs/adr/0007-uid-branding-compile-time-only.md` and the "UID shapes" section
 * of `docs/wire-format.md`.
 *
 * The one runtime invariant these schemas carry is **non-emptiness**: every
 * primary-key schema is `.min(1)`, because no legitimate UID is empty. A foreign
 * key that may be *absent* spells that absence explicitly at the field, rather
 * than through a min-less twin of the brand:
 *
 *   - a nullable FK is `XUidSchema.nullable()` (`null` = no reference);
 *   - the grocery family's "no aisle" reference is the empty-string sentinel,
 *     named here as {@link NoAisleRef} / {@link AisleUidRef} ({@link NO_AISLE_UID}
 *     is its value);
 *   - a required FK confirmed never-empty against the wire captures uses the
 *     strict schema directly (e.g. `photo.recipeUid`, `groceryItem.listUid`).
 */

export const RecipeUidSchema = z.string().min(1).brand("RecipeUid");
export type RecipeUid = z.infer<typeof RecipeUidSchema>;

export const CategoryUidSchema = z.string().min(1).brand("CategoryUid");
export type CategoryUid = z.infer<typeof CategoryUidSchema>;

export const AisleUidSchema = z.string().min(1).brand("AisleUid");
export type AisleUid = z.infer<typeof AisleUidSchema>;
/**
 * The grocery family's "no aisle" foreign-key reference. Grocery items, pantry
 * items, and grocery ingredients coerce a null wire `aisle_uid` to the empty
 * string rather than carrying `null`, because a malformed/absent aisle reference
 * must not abort the whole sync (#76). {@link AisleUidSchema} is `.min(1)`, so
 * `""` is **not** a valid primary-key `AisleUid`; {@link NoAisleRef} names that
 * sentinel as its own branded literal, and {@link AisleUidRef} is the schema an
 * `aisle_uid` *field* accepts — a real aisle UID or the no-aisle sentinel.
 */
export const NoAisleRef = z.literal("").brand("AisleUid");
export const AisleUidRef = z.union([AisleUidSchema, NoAisleRef]);
/** The "no aisle" sentinel value: an empty {@link AisleUid} (parses via {@link AisleUidRef}). */
export const NO_AISLE_UID = "" as AisleUid;

export const PantryItemUidSchema = z.string().min(1).brand("PantryItemUid");
export type PantryItemUid = z.infer<typeof PantryItemUidSchema>;

export const GroceryListUidSchema = z.string().min(1).brand("GroceryListUid");
export type GroceryListUid = z.infer<typeof GroceryListUidSchema>;

export const GroceryItemUidSchema = z.string().min(1).brand("GroceryItemUid");
export type GroceryItemUid = z.infer<typeof GroceryItemUidSchema>;

export const GroceryIngredientUidSchema = z.string().min(1).brand("GroceryIngredientUid");
export type GroceryIngredientUid = z.infer<typeof GroceryIngredientUidSchema>;

export const MealUidSchema = z.string().min(1).brand("MealUid");
export type MealUid = z.infer<typeof MealUidSchema>;

export const MealTypeUidSchema = z.string().min(1).brand("MealTypeUid");
export type MealTypeUid = z.infer<typeof MealTypeUidSchema>;

export const MenuUidSchema = z.string().min(1).brand("MenuUid");
export type MenuUid = z.infer<typeof MenuUidSchema>;

export const MenuItemUidSchema = z.string().min(1).brand("MenuItemUid");
export type MenuItemUid = z.infer<typeof MenuItemUidSchema>;

export const PhotoUidSchema = z.string().min(1).brand("PhotoUid");
export type PhotoUid = z.infer<typeof PhotoUidSchema>;
