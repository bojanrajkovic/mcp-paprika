import { z } from "zod";

import type { DiskCacheDescriptor } from "../../cache/disk-cache.js";

import { makeSchemaEquals } from "../../entity/index.js";
import { AisleUidRef, NO_AISLE_UID, PantryItemUidSchema } from "../../ids.js";

// PantryItemStoredSchema — validates camelCase JSON read back from disk. No transform.
export const PantryItemStoredSchema = z.object({
  uid: PantryItemUidSchema,
  ingredient: z.string(),
  quantity: z.string(),
  aisle: z.string(),
  aisleUid: AisleUidRef,
  expirationDate: z.string().nullable(),
  hasExpiration: z.boolean(),
  inStock: z.boolean(),
  purchaseDate: z.string().nullable(),
  notes: z.string().nullable(),
  deleted: z.boolean().optional().default(false),
});

// PantryItem type derived from PantryItemStoredSchema.
export type PantryItem = z.infer<typeof PantryItemStoredSchema>;

// Disk-cache descriptor — how the per-entity DiskCache persists & re-reads a pantry item.
export const pantryDiskDescriptor: DiskCacheDescriptor<PantryItem> = {
  subdir: "pantry",
  parse: (raw) => PantryItemStoredSchema.parse(raw),
  getKey: (i) => i.uid,
};

// Schema-derived content equality (every stored field but the inert `deleted`).
export const pantryItemsEqual = makeSchemaEquals(PantryItemStoredSchema);

// PantryItemSchema — accepts snake_case wire format, transforms to camelCase PantryItem.
// The `: PantryItem` annotation on the transform return ensures the compiler enforces
// that PantryItemSchema's output is always structurally identical to PantryItemStoredSchema.
export const PantryItemSchema = z
  .object({
    uid: PantryItemUidSchema,
    ingredient: z.string(),
    quantity: z.string(),
    aisle: z.string(),
    aisle_uid: AisleUidRef.nullable(),
    expiration_date: z.string().nullable(),
    has_expiration: z.boolean(),
    in_stock: z.boolean(),
    purchase_date: z.string().nullable(),
    notes: z.string().nullable(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ aisle_uid, expiration_date, has_expiration, in_stock, purchase_date, ...rest }): PantryItem => ({
      ...rest,
      aisleUid: aisle_uid ?? NO_AISLE_UID,
      expirationDate: expiration_date,
      hasExpiration: has_expiration,
      inStock: in_stock,
      purchaseDate: purchase_date,
    }),
  );
