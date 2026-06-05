import { z } from "zod";

import type { DiskCacheDescriptor } from "../../../cache/disk-cache.js";

import { AisleUidRef, GroceryIngredientUidSchema, NO_AISLE_UID } from "../../../ids.js";

// GroceryIngredientStoredSchema — validates camelCase JSON read back from disk. No transform.
export const GroceryIngredientStoredSchema = z.object({
  uid: GroceryIngredientUidSchema,
  name: z.string(),
  aisleUid: AisleUidRef,
  deleted: z.boolean().optional().default(false),
});

export type GroceryIngredient = z.infer<typeof GroceryIngredientStoredSchema>;

// Disk-cache descriptor — how the per-entity DiskCache persists & re-reads a grocery ingredient.
export const groceryIngredientDiskDescriptor: DiskCacheDescriptor<GroceryIngredient> = {
  subdir: "groceryingredients",
  parse: (raw) => GroceryIngredientStoredSchema.parse(raw),
  getKey: (i) => i.uid,
};

// GroceryIngredientSchema — accepts snake_case wire format, transforms to camelCase GroceryIngredient.
export const GroceryIngredientSchema = z
  .object({
    uid: GroceryIngredientUidSchema,
    name: z.string(),
    aisle_uid: AisleUidRef.nullable(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ aisle_uid, ...rest }): GroceryIngredient => ({
      ...rest,
      aisleUid: aisle_uid ?? NO_AISLE_UID,
    }),
  );
