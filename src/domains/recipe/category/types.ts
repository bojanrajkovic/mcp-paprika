import { z } from "zod";

import { makeSchemaEquals } from "../../../entity/index.js";
import { CategoryUidSchema } from "../../../ids.js";

// StoredSchema — validates camelCase JSON read back from disk. No transform.
export const CategoryStoredSchema = z.object({
  uid: CategoryUidSchema,
  name: z.string(),
  orderFlag: z.number().int(),
  parentUid: CategoryUidSchema.nullable(),
});

// Category type derived from CategoryStoredSchema.
export type Category = z.infer<typeof CategoryStoredSchema>;

// Schema-derived content equality (all four stored fields; no `deleted` to exclude).
export const categoriesEqual = makeSchemaEquals(CategoryStoredSchema);

// CategorySchema — accepts snake_case wire format, transforms to camelCase Category.
export const CategorySchema = z
  .object({
    uid: CategoryUidSchema,
    name: z.string(),
    order_flag: z.number().int(),
    parent_uid: CategoryUidSchema.nullable(),
  })
  .transform(
    ({ order_flag, parent_uid, ...rest }): Category => ({
      ...rest,
      orderFlag: order_flag,
      parentUid: parent_uid,
    }),
  );
