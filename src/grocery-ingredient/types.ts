import { z } from "zod";

import { GroceryIngredientUidSchema, AisleUidSchema, NO_AISLE_UID } from "../ids.js";

// GroceryIngredientStoredSchema — validates camelCase JSON read back from disk. No transform.
export const GroceryIngredientStoredSchema = z.object({
  uid: GroceryIngredientUidSchema,
  name: z.string(),
  aisleUid: AisleUidSchema,
  deleted: z.boolean().optional().default(false),
});

export type GroceryIngredient = z.infer<typeof GroceryIngredientStoredSchema>;

// GroceryIngredientSchema — accepts snake_case wire format, transforms to camelCase GroceryIngredient.
export const GroceryIngredientSchema = z
  .object({
    uid: GroceryIngredientUidSchema,
    name: z.string(),
    aisle_uid: AisleUidSchema.nullable(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ aisle_uid, ...rest }): GroceryIngredient => ({
      ...rest,
      aisleUid: aisle_uid ?? NO_AISLE_UID,
    }),
  );
