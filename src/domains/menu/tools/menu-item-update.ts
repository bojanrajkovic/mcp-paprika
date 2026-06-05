import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { MealTypeUid, RecipeUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuItem } from "../menu-item/types.js";
import type { MenuState, MenuWrites } from "../module.js";

import { MenuItemUidSchema, RecipeUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { mealTypeSpecSchema, resolveOrCreateMealType } from "../../meal-type/meal-type-helpers.js";
import { menuStartGuard } from "./guards.js";

// `.strict()` — `day` was promoted to move_menu_item (a day-move carries
// parent-menu auto-expand and menu-wide order_flag resequencing that a plain
// field edit would not), so a stray `day` key here is a hard rejection.
export const updateMenuItemInputSchema = z
  .object({
    uid: MenuItemUidSchema.describe("UID of the menuitem to update"),
    type: mealTypeSpecSchema.optional().describe("New meal type (same DU as add_menu_items)"),
    recipe_uid: RecipeUidSchema.optional().describe("New recipe UID. Display name re-resolves from the new recipe."),
  })
  .strict();

/**
 * `update_menu_item` — edit a menu item. Re-resolves the recipe display name via
 * `ctx.deps.recipe.get` and the meal type via `resolveOrCreateMealType` (an unknown
 * `{name}` auto-creates a custom type).
 */
export const updateMenuItemTool = defineTool(
  {
    name: "update_menu_item",
    title: "Edit a menu item",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description:
      "Update an existing menuitem's meal type or recipe link by UID. Provide at least one of type or " +
      "recipe_uid; omitted fields keep their current values. Changing recipe_uid re-resolves the display " +
      "name from the new recipe. To move an item to a different day, use move_menu_item. The menu link " +
      "(menu_uid) is not editable via this tool — delete and re-add to move an item between menus.",
    inputSchema: updateMenuItemInputSchema,
  },
  (ctx: DomainCtx<MenuState, "recipe" | "meal-type", MenuWrites>) => {
    const log = ctx.infra.log.child({ component: "update_menu_item" });
    return async (args) => {
      log.info({ tool: "update_menu_item", uid: args.uid }, "tool invoked");
      return menuStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          if (args.type === undefined && args.recipe_uid === undefined) {
            return textResult("Nothing to update. Provide at least one of type or recipe_uid.");
          }

          const uid = args.uid;
          const existing = ctx.state.items.store.get(uid);
          if (existing === undefined) {
            return textResult(`No menu item found with UID "${uid}" (it may not exist or was already deleted).`);
          }
          // Resolve recipe link + refreshed display name if a new recipe is supplied.
          let newRecipeUid: RecipeUid | null = existing.recipeUid;
          let newName: string = existing.name;
          if (args.recipe_uid !== undefined) {
            const recipe = ctx.deps.recipe.get(args.recipe_uid);
            if (recipe === undefined) {
              return textResult(
                `recipe_uid "${args.recipe_uid}" is not known to the local recipe store; ` +
                  `wait for the next sync and retry.`,
              );
            }
            newRecipeUid = args.recipe_uid;
            newName = recipe.name;
          }

          // Resolve the meal type LAST — after the recipe validation above. An unknown
          // {name} auto-creates a type, so creating only once the rest of the input is
          // known-good avoids leaving an orphan type behind on a rejected call.
          let newTypeUid: MealTypeUid | undefined;
          if (args.type !== undefined) {
            const result = await resolveOrCreateMealType(ctx.deps["meal-type"], args.type);
            if (!result.ok) {
              return textResult(result.message);
            }
            newTypeUid = result.resolved.uid;
          }

          const merged: MenuItem = {
            ...existing,
            ...(newTypeUid !== undefined && { typeUid: newTypeUid }),
            ...(args.recipe_uid !== undefined && { recipeUid: newRecipeUid, name: newName }),
          };

          let saved: MenuItem;
          try {
            saved = (await ctx.infra.client.saveMenuItems([merged]))[0]!;
            await ctx.writes.commitMenuItem(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid }, "saveMenuItems (update_menu_item) failed");
            return textResult(`Failed to update menu item: ${message}`);
          }

          return textResult(`Menu item "${saved.name}" updated.`);
        },
        (guard) => guard,
      );
    };
  },
);
