import { z } from "zod";

import { PhotoUidSchema } from "../ids.js";

// PhotoStoredSchema — validates camelCase JSON read back from disk. No transform.
// `recipeUid` is the foreign key to the owning recipe (plain `z.string()`, like
// `meal.recipeUid` / `menuItem.recipeUid` — the wire format does not brand FKs).
// Invariant: `name === String(orderFlag + 1)` (1-indexed gallery label vs the
// 0-indexed `orderFlag`); maintained by the writer (#169), not enforced here.
export const PhotoStoredSchema = z.object({
  uid: PhotoUidSchema,
  recipeUid: z.string(),
  filename: z.string(),
  name: z.string(),
  orderFlag: z.number().int().nonnegative(),
  hash: z.string(),
  deleted: z.boolean().optional().default(false),
});

export type Photo = z.infer<typeof PhotoStoredSchema>;

// PhotoSchema — accepts snake_case wire format, transforms to camelCase Photo.
// The GET /sync/photos/ catalog row carries six fields (no `deleted`); `deleted`
// is a write-only soft-delete flag, so it is `optional().default(false)` here
// (same pattern as recipes/meals — read responses omit it, but the parsed object
// always carries a concrete boolean).
export const PhotoSchema = z
  .object({
    uid: PhotoUidSchema,
    recipe_uid: z.string(),
    filename: z.string(),
    name: z.string(),
    order_flag: z.number().int().nonnegative(),
    hash: z.string(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ recipe_uid, order_flag, ...rest }): Photo => ({
      ...rest,
      recipeUid: recipe_uid,
      orderFlag: order_flag,
    }),
  );

// photoToApiPayload — inverse of PhotoSchema's read transform. Emits the seven
// snake_case fields the Paprika Cloud Sync API expects on a photo POST. Exported
// from the photo module (not client.ts) so the #169 write tools can use it without
// a client dependency, following the mealToApiPayload / menuItemToApiPayload convention.
export function photoToApiPayload(item: Readonly<Photo>): Record<string, unknown> {
  return {
    uid: item.uid,
    recipe_uid: item.recipeUid,
    filename: item.filename,
    name: item.name,
    order_flag: item.orderFlag,
    hash: item.hash,
    deleted: item.deleted,
  };
}
