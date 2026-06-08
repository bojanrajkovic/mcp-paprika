import { z } from "zod";

import type { DiskCacheDescriptor } from "../../cache/disk-cache.js";

import { makeSchemaEquals } from "../../entity/index.js";
import { MealTypeUidSchema } from "../meal-type/ids.js";
import { RecipeUidSchema } from "../recipe/ids.js";
import { MealUidSchema } from "./ids.js";

// MealStoredSchema — validates camelCase JSON read back from disk.
// `typeUid` is nullable because legacy meals (created before Paprika's mealtypes
// feature) carry `null` for this field; new meals always carry a real UID.
//
// Every field but `uid` tolerates null/missing and coerces to the value the rest
// of the code already treats as "absent" (mirrors MealSchema; see the rationale
// there). Precedent: #76's recipe fix mirrored its coercions into the stored
// schema so a cache written by any client version still hydrates.
export const MealStoredSchema = z.object({
  uid: MealUidSchema,
  recipeUid: RecipeUidSchema.nullish().transform((v) => v ?? null),
  name: z
    .string()
    .nullish()
    .transform((v) => v ?? ""),
  date: z
    .string()
    .nullish()
    .transform((v) => v ?? ""),
  type: z
    .number()
    .int()
    .nullish()
    .transform((v) => v ?? 0),
  typeUid: MealTypeUidSchema.nullish().transform((v) => v ?? null),
  orderFlag: z
    .number()
    .int()
    .nullish()
    .transform((v) => v ?? 0),
  isIngredient: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false),
  scale: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  deleted: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false),
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
//
// Every field but `uid` tolerates null/missing: Paprika's meal wire format is
// looser than ours was — the macOS app POSTs meals without `is_ingredient` or
// `scale` at all (docs/wire-captures/meals.har.json), and the API sneaks `null`
// into nominally-required fields (#76 for recipes, #290 for meals). A single
// stricter-than-reality field aborts the all-or-nothing `z.array()` parse in
// listMeals, permanently wedging the meal store (#290). Each coercion picks the
// value downstream code already treats as "absent": a "" name renders as-is, a
// "" date fails `parseMealDate` and is hidden by the existing `isValid` guards,
// `type: 0` only matters when `typeUid` is also null (legacy built-in matching),
// and `isIngredient: false` is a normal served meal. `type`'s old `nonnegative()`
// bound is dropped for the same reason — no consumer relies on it, so an
// unexpected sentinel must not kill the sync.
export const MealSchema = z
  .object({
    uid: MealUidSchema,
    recipe_uid: RecipeUidSchema.nullish().transform((v) => v ?? null),
    name: z
      .string()
      .nullish()
      .transform((v) => v ?? ""),
    date: z
      .string()
      .nullish()
      .transform((v) => v ?? ""),
    type: z
      .number()
      .int()
      .nullish()
      .transform((v) => v ?? 0),
    type_uid: MealTypeUidSchema.nullish().transform((v) => v ?? null),
    order_flag: z
      .number()
      .int()
      .nullish()
      .transform((v) => v ?? 0),
    is_ingredient: z
      .boolean()
      .nullish()
      .transform((v) => v ?? false),
    scale: z
      .string()
      .nullish()
      .transform((v) => v ?? null),
    deleted: z
      .boolean()
      .nullish()
      .transform((v) => v ?? false),
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
