import { z } from "zod";

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
