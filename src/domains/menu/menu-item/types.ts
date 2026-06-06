import { z } from "zod";

import type { DiskCacheDescriptor } from "../../../cache/disk-cache.js";

import { makeSchemaEquals } from "../../../entity/index.js";
import { MealTypeUidSchema } from "../../meal-type/ids.js";
import { RecipeUidSchema } from "../../recipe/ids.js";
import { MenuItemUidSchema, MenuUidSchema } from "../ids.js";

// MenuItemStoredSchema — validates camelCase JSON read back from disk. No transform.
// `menuUid` is nullable: a cascade-deleted menuitem has `menu_uid: null` on the wire
// (the menu's soft-delete nulls the back-reference). `recipeUid` is nullable as a
// defensive read — the wire format does not guarantee a recipe link exists.
export const MenuItemStoredSchema = z.object({
  uid: MenuItemUidSchema,
  menuUid: MenuUidSchema.nullable(),
  recipeUid: RecipeUidSchema.nullable(),
  name: z.string(),
  day: z.number().int().nonnegative(),
  typeUid: MealTypeUidSchema,
  // `orderFlag` is menu-wide (not per-day) — one field covers ordering across all days.
  orderFlag: z.number().int(),
  deleted: z.boolean().optional().default(false),
});

export type MenuItem = z.infer<typeof MenuItemStoredSchema>;

// Disk-cache descriptor — how the per-entity DiskCache persists & re-reads a menu item.
export const menuItemDiskDescriptor: DiskCacheDescriptor<MenuItem> = {
  subdir: "menuitems",
  parse: (raw) => MenuItemStoredSchema.parse(raw),
  getKey: (mi) => mi.uid,
};

// Schema-derived content equality (all stored fields but the inert `deleted`).
export const menuItemsEqual = makeSchemaEquals(MenuItemStoredSchema);

// MenuItemSchema — accepts snake_case wire format, transforms to camelCase MenuItem.
export const MenuItemSchema = z
  .object({
    uid: MenuItemUidSchema,
    menu_uid: MenuUidSchema.nullable(),
    recipe_uid: RecipeUidSchema.nullable(),
    name: z.string(),
    day: z.number().int().nonnegative(),
    type_uid: MealTypeUidSchema,
    order_flag: z.number().int(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ menu_uid, recipe_uid, type_uid, order_flag, ...rest }): MenuItem => ({
      ...rest,
      menuUid: menu_uid,
      recipeUid: recipe_uid,
      typeUid: type_uid,
      orderFlag: order_flag,
    }),
  );

// menuItemToApiPayload — inverse of MenuItemSchema's read transform. Accepts the
// camelCase MenuItem shape and emits the snake_case wire payload.
export function menuItemToApiPayload(item: Readonly<MenuItem>): Record<string, unknown> {
  return {
    uid: item.uid,
    menu_uid: item.menuUid,
    recipe_uid: item.recipeUid,
    name: item.name,
    day: item.day,
    type_uid: item.typeUid,
    order_flag: item.orderFlag,
    deleted: item.deleted,
  };
}
