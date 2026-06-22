import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { TypedCallToolResult } from "../../../shared/tools.js";
import type { MealTypeUid } from "../../meal-type/ids.js";
import type { RecipeUid } from "../../recipe/ids.js";
import type { MenuItem } from "../menu-item/types.js";
import type { MenuState, MenuWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, errorResult, toolResult } from "../../../shared/tools.js";
import { mealTypeSpecSchema } from "../../meal-type/meal-type-helpers.js";
import { RecipeUidSchema } from "../../recipe/ids.js";
import { MenuItemUidSchema } from "../ids.js";
import { menuReadOutputSchema, menuToStructured } from "../menu-helpers.js";
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
 * `ctx.deps.recipe.get` and the meal type via `ctx.deps["meal-type"].resolveOrCreate`
 * (an unknown `{name}` auto-creates a custom type).
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
    outputSchema: menuReadOutputSchema,
  },
  [menuStartGuard],
  (ctx: DomainCtx<MenuState, "recipe" | "meal-type", MenuWrites>) => {
    const log = ctx.infra.log.child({ component: "update_menu_item" });
    return async (args): Promise<TypedCallToolResult<z.infer<typeof menuReadOutputSchema>>> => {
      if (args.type === undefined && args.recipe_uid === undefined) {
        return errorResult("Nothing to update. Provide at least one of type or recipe_uid.");
      }

      const uid = args.uid;
      const existing = ctx.state.items.store.get(uid);
      if (existing === undefined) {
        return errorResult(
          `No menu item found with UID "${uid}" (it may not exist or was already deleted). Use \`read_menu\` to inspect its menu.`,
        );
      }
      // Resolve recipe link + refreshed display name if a new recipe is supplied.
      let newRecipeUid: RecipeUid | null = existing.recipeUid;
      let newName: string = existing.name;
      if (args.recipe_uid !== undefined) {
        const recipe = ctx.deps.recipe.get(args.recipe_uid);
        if (recipe === undefined) {
          return errorResult(
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
        const result = await ctx.deps["meal-type"].resolveOrCreate(args.type);
        if (!result.ok) {
          return errorResult(result.message);
        }
        newTypeUid = result.resolved.uid;
      }

      const merged: MenuItem = {
        ...existing,
        ...(newTypeUid !== undefined && { typeUid: newTypeUid }),
        ...(args.recipe_uid !== undefined && { recipeUid: newRecipeUid, name: newName }),
      };

      const saved = (await ctx.infra.client.saveMenuItems([merged])).match(
        (items) => items[0]!,
        (e) => {
          log.error({ err: e, uid }, "saveMenuItems (update_menu_item) failed");
          return errorResult(`Failed to update menu item: ${e.message}`);
        },
      );
      if ("content" in saved) return saved;

      // The ack echoes the WHOLE parent menu (the item is one row of it), so the model
      // sees the menu the edited item now belongs to. An orphaned item (null menuUid)
      // has no parent menu to echo — it cannot satisfy the schema, so it is an error.
      if (saved.menuUid === null) {
        return errorResult(
          `Menu item "${saved.name}" was updated, but it has no parent menu to return. Use \`read_menu\` to inspect it.`,
        );
      }
      const parent = ctx.state.menus.store.get(saved.menuUid);
      if (parent === undefined) {
        return errorResult(
          `Menu item "${saved.name}" was updated, but its parent menu (UID "${saved.menuUid}") is not known locally; ` +
            `wait for the next sync, then use \`read_menu\`.`,
        );
      }

      // Snapshot the parent menu's items with the saved item substituted in — the
      // structured payload reflects the edit whether or not the local commit lands
      // (the store still holds the pre-edit item until commitMenuItem runs).
      const items = ctx.state.items.store.getByMenuUid(parent.uid).map((it) => (it.uid === saved.uid ? saved : it));
      const structured = menuToStructured(parent, items, ctx.deps["meal-type"].getAll());
      const commitErr = commitFailure("menu", await ctx.writes.commitMenuItem(saved), {
        structuredContent: structured,
      });
      if (commitErr) return commitErr;

      return toolResult(`Menu item "${saved.name}" updated.`, structured);
    };
  },
);
