import { z } from "zod";

import { MealTypeUidSchema, MenuItemUidSchema, MenuUidRefSchema, RecipeUidRefSchema } from "../ids.js";

// MenuItemStoredSchema — validates camelCase JSON read back from disk. No transform.
// `menuUid` is nullable: a cascade-deleted menuitem has `menu_uid: null` on the wire
// (the menu's soft-delete nulls the back-reference). `recipeUid` is nullable as a
// defensive read — the wire format does not guarantee a recipe link exists.
export const MenuItemStoredSchema = z.object({
  uid: MenuItemUidSchema,
  menuUid: MenuUidRefSchema.nullable(),
  recipeUid: RecipeUidRefSchema.nullable(),
  name: z.string(),
  day: z.number().int().nonnegative(),
  typeUid: MealTypeUidSchema,
  orderFlag: z.number().int(),
  deleted: z.boolean().optional().default(false),
});

export type MenuItem = z.infer<typeof MenuItemStoredSchema>;

// MenuItemSchema — accepts snake_case wire format, transforms to camelCase MenuItem.
export const MenuItemSchema = z
  .object({
    uid: MenuItemUidSchema,
    menu_uid: MenuUidRefSchema.nullable(),
    recipe_uid: RecipeUidRefSchema.nullable(),
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
