import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { MealTypeUid, RecipeUid } from "../../ids.js";
import type { DomainCtx } from "../../kernel/registry.js";
import type { MenuItem } from "../../menu-item/types.js";
import type { MenuSelf } from "../module.js";

import { MenuItemUidSchema, RecipeUidSchema } from "../../ids.js";
import { textResult } from "../../tools/helpers.js";
import { mealTypeSpecSchema } from "../../tools/meal-helpers.js";
import { toMessage } from "../../utils/log.js";
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
 * Registers `update_menu_item`, kernel-shaped — reads/writes this module's own
 * menu-item store via `ctx.self`, re-resolves the recipe display name via
 * `ctx.deps.recipe.get`, resolves the meal type via `ctx.deps["meal-type"].resolveSpec`,
 * and commits through `ctx.self.commitMenuItem`. Lifted verbatim from
 * `src/tools/menu-item-write.ts`.
 */
export function updateMenuItemTool(ctx: DomainCtx<MenuSelf, "recipe" | "meal-type">): void {
  const log = ctx.infra.log.child({ component: "update_menu_item" });
  ctx.server.registerTool(
    "update_menu_item",
    {
      title: "Edit a menu item",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      description:
        "Update an existing menuitem's meal type or recipe link by UID. Provide at least one of type or " +
        "recipe_uid; omitted fields keep their current values. Changing recipe_uid re-resolves the display " +
        "name from the new recipe. To move an item to a different day, use move_menu_item. The menu link " +
        "(menu_uid) is not editable via this tool — delete and re-add to move an item between menus.",
      inputSchema: updateMenuItemInputSchema,
    },
    async (args) => {
      log.info({ tool: "update_menu_item", uid: args.uid }, "tool invoked");
      return menuStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          if (args.type === undefined && args.recipe_uid === undefined) {
            return textResult("Nothing to update. Provide at least one of type or recipe_uid.");
          }

          const uid = args.uid;
          const existing = ctx.self.items.store.get(uid);
          if (existing === undefined) {
            if (ctx.self.items.store.isTombstone(uid)) {
              return textResult(`Menu item with UID "${uid}" is already deleted.`);
            }
            return textResult(`No menu item found with UID "${uid}".`);
          }
          if (existing.deleted) {
            // Defense-in-depth
            return textResult(`Menu item "${existing.name}" is already deleted.`);
          }

          // Resolve type if supplied via the shared meal-type contract.
          let newTypeUid: MealTypeUid | undefined;
          if (args.type !== undefined) {
            const result = ctx.deps["meal-type"].resolveSpec(args.type);
            if (!result.ok) {
              if (result.reason === "unknown_uid") {
                return textResult(`Unknown meal type UID "${result.uid}".`);
              }
              if (result.reason === "unknown_name") {
                const knownList = result.knownNames.join(", ");
                return textResult(
                  `Unknown meal type "${result.name}". Known types: ${knownList}. ` +
                    `Use the {uid} or {builtin} discriminator to reference a custom meal type.`,
                );
              }
              return textResult(
                `No built-in meal type found with index ${result.index.toString()} ` +
                  `(expected 0=Breakfast, 1=Lunch, 2=Dinner, 3=Snacks).`,
              );
            }
            newTypeUid = result.resolved.uid;
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

          const merged: MenuItem = {
            ...existing,
            ...(newTypeUid !== undefined && { typeUid: newTypeUid }),
            ...(args.recipe_uid !== undefined && { recipeUid: newRecipeUid, name: newName }),
          };

          let saved: MenuItem;
          try {
            saved = (await ctx.infra.client.saveMenuItems([merged]))[0]!;
            await ctx.self.commitMenuItem(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid }, "saveMenuItems (update_menu_item) failed");
            return textResult(`Failed to update menu item: ${message}`);
          }

          return textResult(`Menu item "${saved.name}" updated.`);
        },
        (guard) => guard,
      );
    },
  );
}
