import { z } from "zod";

import type { DiskCacheDescriptor } from "../../cache/disk-cache.js";

import { makeSchemaEquals } from "../../entity/index.js";
import { MealTypeUidSchema, MealUidSchema, RecipeUidSchema } from "../../ids.js";

// MealStoredSchema — validates camelCase JSON read back from disk. No transform.
// `typeUid` is nullable because legacy meals (created before Paprika's mealtypes
// feature) carry `null` for this field; new meals always carry a real UID.
export const MealStoredSchema = z.object({
  uid: MealUidSchema,
  recipeUid: RecipeUidSchema.nullable(),
  name: z.string(),
  date: z.string(),
  type: z.number().int().nonnegative(),
  typeUid: MealTypeUidSchema.nullable(),
  orderFlag: z.number().int(),
  isIngredient: z.boolean(),
  scale: z.string().nullable(),
  deleted: z.boolean().optional().default(false),
});

export type Meal = z.infer<typeof MealStoredSchema>;

// Disk-cache descriptor — how the per-entity DiskCache persists & re-reads a meal.
export const mealDiskDescriptor: DiskCacheDescriptor<Meal> = {
  subdir: "meals",
  parse: (raw) => MealStoredSchema.parse(raw),
  getKey: (m) => m.uid,
};

// Schema-derived content equality (all stored fields but the inert `deleted`).
export const mealsEqual = makeSchemaEquals(MealStoredSchema);

// MealSchema — accepts snake_case wire format, transforms to camelCase Meal.
export const MealSchema = z
  .object({
    uid: MealUidSchema,
    recipe_uid: RecipeUidSchema.nullable(),
    name: z.string(),
    date: z.string(),
    type: z.number().int().nonnegative(),
    type_uid: MealTypeUidSchema.nullable(),
    order_flag: z.number().int(),
    is_ingredient: z.boolean(),
    scale: z.string().nullable(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ recipe_uid, type_uid, order_flag, is_ingredient, ...rest }): Meal => ({
      ...rest,
      recipeUid: recipe_uid,
      typeUid: type_uid,
      orderFlag: order_flag,
      isIngredient: is_ingredient,
    }),
  );

// mealToApiPayload — inverse of MealSchema's read transform. Accepts the camelCase
// Meal shape and emits the snake_case wire payload expected by the Paprika Cloud Sync API.
export function mealToApiPayload(item: Readonly<Meal>): Record<string, unknown> {
  return {
    uid: item.uid,
    recipe_uid: item.recipeUid,
    name: item.name,
    date: item.date,
    type: item.type,
    type_uid: item.typeUid,
    order_flag: item.orderFlag,
    is_ingredient: item.isIngredient,
    scale: item.scale,
    deleted: item.deleted,
  };
}
