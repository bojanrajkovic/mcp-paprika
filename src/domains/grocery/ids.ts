import { z } from "zod";

/**
 * The grocery domain's UID brands — lists, items, ingredients. Branding is
 * compile-time kind-safety only, and every primary key is non-empty;
 * a UID leaf imports nothing but zod (conformance-tested); how a
 * foreign key spells absence lives in `docs/architecture.md` (Identifiers).
 */

export const GroceryListUidSchema = z.string().min(1).brand("GroceryListUid");
export type GroceryListUid = z.infer<typeof GroceryListUidSchema>;

export const GroceryItemUidSchema = z.string().min(1).brand("GroceryItemUid");
export type GroceryItemUid = z.infer<typeof GroceryItemUidSchema>;

export const GroceryIngredientUidSchema = z.string().min(1).brand("GroceryIngredientUid");
export type GroceryIngredientUid = z.infer<typeof GroceryIngredientUidSchema>;
