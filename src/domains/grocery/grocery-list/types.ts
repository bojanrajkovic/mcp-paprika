import { z } from "zod";

import type { DiskCacheDescriptor } from "../../../cache/disk-cache.js";

import { makeSchemaEquals } from "../../../entity/index.js";
import { GroceryListUidSchema } from "../../../ids.js";

// GroceryListStoredSchema — validates camelCase JSON read back from disk. No transform.
export const GroceryListStoredSchema = z.object({
  uid: GroceryListUidSchema,
  name: z.string(),
  orderFlag: z.number().int(),
  isDefault: z.boolean(),
  remindersList: z.string(),
  deleted: z.boolean().optional().default(false),
});

export type GroceryList = z.infer<typeof GroceryListStoredSchema>;

// Disk-cache descriptor — how the per-entity DiskCache persists & re-reads a grocery list.
export const groceryListDiskDescriptor: DiskCacheDescriptor<GroceryList> = {
  subdir: "grocerylists",
  parse: (raw) => GroceryListStoredSchema.parse(raw),
  getKey: (l) => l.uid,
};

// Schema-derived content equality (all stored fields but the inert `deleted`).
export const groceryListsEqual = makeSchemaEquals(GroceryListStoredSchema);

// GroceryListSchema — accepts snake_case wire format, transforms to camelCase GroceryList.
export const GroceryListSchema = z
  .object({
    uid: GroceryListUidSchema,
    name: z.string(),
    order_flag: z.number().int(),
    is_default: z.boolean(),
    reminders_list: z.string(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ order_flag, is_default, reminders_list, ...rest }): GroceryList => ({
      ...rest,
      orderFlag: order_flag,
      isDefault: is_default,
      remindersList: reminders_list,
    }),
  );
