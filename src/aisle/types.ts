import { z } from "zod";

import { AisleUidSchema } from "../ids.js";

// AisleStoredSchema — validates camelCase JSON read back from disk. No transform.
export const AisleStoredSchema = z.object({
  uid: AisleUidSchema,
  name: z.string(),
  orderFlag: z.number().int(),
  deleted: z.boolean().optional().default(false),
});

// Aisle type derived from AisleStoredSchema.
export type Aisle = z.infer<typeof AisleStoredSchema>;

// AisleSchema — accepts snake_case wire format, transforms to camelCase Aisle.
export const AisleSchema = z
  .object({
    uid: AisleUidSchema,
    name: z.string(),
    order_flag: z.number().int(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ order_flag, ...rest }): Aisle => ({
      ...rest,
      orderFlag: order_flag,
    }),
  );
