import { z } from "zod";

import { MenuUidSchema } from "../ids.js";

// MenuStoredSchema — validates camelCase JSON read back from disk. No transform.
export const MenuStoredSchema = z.object({
  uid: MenuUidSchema,
  name: z.string(),
  days: z.number().int().nonnegative(),
  orderFlag: z.number().int(),
  notes: z.string(),
  deleted: z.boolean().optional().default(false),
});

export type Menu = z.infer<typeof MenuStoredSchema>;

// MenuSchema — accepts snake_case wire format, transforms to camelCase Menu.
export const MenuSchema = z
  .object({
    uid: MenuUidSchema,
    name: z.string(),
    days: z.number().int().nonnegative(),
    order_flag: z.number().int(),
    notes: z.string(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(({ order_flag, ...rest }): Menu => ({ ...rest, orderFlag: order_flag }));

// menuToApiPayload — inverse of MenuSchema's read transform. Accepts the camelCase
// Menu shape and emits the snake_case wire payload expected by the Paprika Cloud Sync API.
export function menuToApiPayload(item: Readonly<Menu>): Record<string, unknown> {
  return {
    uid: item.uid,
    name: item.name,
    days: item.days,
    order_flag: item.orderFlag,
    notes: item.notes,
    deleted: item.deleted,
  };
}
