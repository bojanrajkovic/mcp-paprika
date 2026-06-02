import { z } from "zod";

import { GroceryIngredientUidSchema } from "../ids.js";

// GroceryIngredientStoredSchema — validates camelCase JSON read back from disk. No transform.
export const GroceryIngredientStoredSchema = z.object({
  uid: GroceryIngredientUidSchema,
  name: z.string(),
  aisleUid: z.string(),
  deleted: z.boolean().optional().default(false),
});

export type GroceryIngredient = z.infer<typeof GroceryIngredientStoredSchema>;

// GroceryIngredientSchema — accepts snake_case wire format, transforms to camelCase GroceryIngredient.
export const GroceryIngredientSchema = z
  .object({
    uid: GroceryIngredientUidSchema,
    name: z.string(),
    aisle_uid: z.string().nullable(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ aisle_uid, ...rest }): GroceryIngredient => ({
      ...rest,
      aisleUid: aisle_uid ?? "",
    }),
  );
