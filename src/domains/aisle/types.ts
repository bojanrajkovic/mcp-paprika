import { z } from "zod";

import type { DiskCacheDescriptor } from "../../cache/disk-cache.js";

import { AisleUidSchema } from "./ids.js";

// AisleStoredSchema — validates camelCase JSON read back from disk. No transform.
export const AisleStoredSchema = z.object({
  uid: AisleUidSchema,
  name: z.string(),
  orderFlag: z.number().int(),
  deleted: z.boolean().optional().default(false),
});

// Aisle type derived from AisleStoredSchema.
export type Aisle = z.infer<typeof AisleStoredSchema>;

// Disk-cache descriptor — how the per-entity DiskCache persists & re-reads an aisle.
export const aisleDiskDescriptor: DiskCacheDescriptor<Aisle> = {
  subdir: "aisles",
  parse: (raw) => AisleStoredSchema.parse(raw),
  getKey: (a) => a.uid,
};

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
