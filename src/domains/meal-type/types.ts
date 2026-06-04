import { z } from "zod";

import { MealTypeUidSchema } from "../../ids.js";

// MealTypeStoredSchema — validates camelCase JSON read back from disk. No transform.
// `exportTime` is seconds since midnight (e.g. 28800 = 08:00, 64800 = 18:00).
// `originalType` is the integer mapping back to one of the four built-in types
// (Breakfast=0, Lunch=1, Dinner=2, Snacks=3) for built-in types, or `null` for
// user-created custom types. Verified via mealtypes.har.json capture.
// `deleted` mirrors the other catalog entities (aisles, grocery ingredients):
// optional+default false because GET responses omit it for live items, but
// the soft-delete wire format POSTs it as `true` (see mealtypes.har.json
// "delete mealtype" capture).
// None of these fields are used by the read-only history feature; preserved
// for fidelity and so the sync layer can filter tombstones.
export const MealTypeStoredSchema = z.object({
  uid: MealTypeUidSchema,
  name: z.string(),
  color: z.string(),
  orderFlag: z.number().int(),
  originalType: z.number().int().nullable(),
  exportAllDay: z.boolean(),
  exportTime: z.number().int().nonnegative(),
  deleted: z.boolean().optional().default(false),
});

export type MealType = z.infer<typeof MealTypeStoredSchema>;

// MealTypeSchema — accepts snake_case wire format, transforms to camelCase MealType.
export const MealTypeSchema = z
  .object({
    uid: MealTypeUidSchema,
    name: z.string(),
    color: z.string(),
    order_flag: z.number().int(),
    original_type: z.number().int().nullable(),
    export_all_day: z.boolean(),
    export_time: z.number().int().nonnegative(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ order_flag, original_type, export_all_day, export_time, ...rest }): MealType => ({
      ...rest,
      orderFlag: order_flag,
      originalType: original_type,
      exportAllDay: export_all_day,
      exportTime: export_time,
    }),
  );
