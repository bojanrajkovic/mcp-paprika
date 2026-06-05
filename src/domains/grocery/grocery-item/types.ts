import { z } from "zod";

import type { DiskCacheDescriptor } from "../../../cache/disk-cache.js";

import { makeSchemaEquals } from "../../../entity/index.js";
import { AisleUidRef, GroceryItemUidSchema, GroceryListUidSchema, NO_AISLE_UID } from "../../../ids.js";

// GroceryItemStoredSchema — validates camelCase JSON read back from disk. No transform.
export const GroceryItemStoredSchema = z.object({
  uid: GroceryItemUidSchema,
  name: z.string(),
  ingredient: z.string(),
  aisle: z.string(),
  aisleUid: AisleUidRef,
  listUid: GroceryListUidSchema,
  purchased: z.boolean(),
  deleted: z.boolean().optional().default(false),
  orderFlag: z.number().int(),
  quantity: z.string(),
  instruction: z.string(),
  recipe: z.string().nullable(),
  separate: z.boolean(),
});

export type GroceryItem = z.infer<typeof GroceryItemStoredSchema>;

// Disk-cache descriptor — how the per-entity DiskCache persists & re-reads a grocery item.
export const groceryItemDiskDescriptor: DiskCacheDescriptor<GroceryItem> = {
  subdir: "groceryitems",
  parse: (raw) => GroceryItemStoredSchema.parse(raw),
  getKey: (i) => i.uid,
};

// Schema-derived content equality (all stored fields but the inert `deleted`).
export const groceryItemsEqual = makeSchemaEquals(GroceryItemStoredSchema);

// GroceryItemSchema — accepts snake_case wire format, transforms to camelCase GroceryItem.
export const GroceryItemSchema = z
  .object({
    uid: GroceryItemUidSchema,
    name: z.string(),
    ingredient: z.string(),
    aisle: z.string(),
    aisle_uid: AisleUidRef.nullable(),
    list_uid: GroceryListUidSchema,
    purchased: z.boolean(),
    deleted: z.boolean().optional().default(false),
    order_flag: z.number().int(),
    quantity: z.string(),
    instruction: z.string(),
    recipe: z.string().nullable(),
    separate: z.boolean(),
  })
  .transform(
    ({ aisle_uid, list_uid, order_flag, ...rest }): GroceryItem => ({
      ...rest,
      aisleUid: aisle_uid ?? NO_AISLE_UID,
      listUid: list_uid,
      orderFlag: order_flag,
    }),
  );
