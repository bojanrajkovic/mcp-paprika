import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { MealTypeUid, RecipeUid } from "../ids.js";
import type { MenuItem } from "../menu-item/types.js";
import type { Menu } from "../menu/types.js";
import type { ServerContext } from "../types/server-context.js";

import { MenuItemUidSchema, MenuUidSchema, RecipeUidSchema } from "../ids.js";
// pattern: Imperative Shell
import { toMessage } from "../utils/log.js";
import { resolveLookup, textResult, uidOrTextLookupSchema } from "./helpers.js";
import { mealTypeSpecSchema, resolveMealTypeSpec } from "./meal-helpers.js";
import { commitMenu, commitMenuItem, commitMenuItemsBatch, menuStartGuard, menuToMarkdown } from "./menu-helpers.js";

// One menuitem to add. Structurally EITHER recipe-linked (recipe_uid; display
// name auto-resolves from the recipe) OR freeform (name; no recipe), mirroring
// plan_meals — Paprika.app dispatches a menuitem's display off recipe_uid, so a
// stored custom name on a recipe-linked item would never render. The z.union of
// two `.strict()` objects rejects extra keys (including supplying BOTH recipe_uid
// and name) at the Zod boundary, surfacing the constraint structurally.
const menuItemDay = z
  .number()
  .int()
  .positive()
  .describe("1-indexed day within the menu. Days beyond the menu's current span auto-extend the menu.");
const menuItemType = mealTypeSpecSchema.describe(
  'Meal type. Pick exactly one shape: {"name": "Dinner"} | {"uid": "<MealType UID>"} | {"builtin": 2}.',
);

const recipeMenuItemSchema = z
  .object({
    recipe_uid: RecipeUidSchema.describe(
      "Recipe UID to place on the menu. Display name auto-resolves from the recipe.",
    ),
    day: menuItemDay,
    type: menuItemType,
  })
  .strict();

const freeformMenuItemSchema = z
  .object({
    name: z.string().min(1).describe("Display name for a freeform (non-recipe) menuitem."),
    day: menuItemDay,
    type: menuItemType,
  })
  .strict();

const addMenuItemSchema = z.union([recipeMenuItemSchema, freeformMenuItemSchema]);

export const addMenuItemsInputSchema = z.object({
  menu: uidOrTextLookupSchema({
    uidSchema: MenuUidSchema,
    textKey: "name",
    entityLabel: "menu",
    textExample: "Thanksgiving Dinner",
  }),
  items: z
    .array(addMenuItemSchema)
    .min(1, "At least one menu item is required.")
    .describe("Array of menuitems to add (1 or more); each is recipe-linked OR freeform."),
});

export function registerAddMenuItemsTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "add_menu_items" });
  server.registerTool(
    "add_menu_items",
    {
      title: "Add items to a menu",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      description:
        "Add one or more menuitems to a menu (saved meal plan). Look the menu up by UID or name (tiered " +
        "fuzzy match). Each item is EITHER recipe-linked (supply recipe_uid; display name auto-resolves " +
        "from the recipe) OR freeform (supply name; no recipe) — the two are mutually exclusive, matching " +
        "plan_meals. Each item also carries a 1-indexed day and a meal type (name, UID, or built-in index " +
        "0=Breakfast, 1=Lunch, 2=Dinner, 3=Snacks). If any day falls beyond the menu's current span the " +
        "menu is automatically extended to fit before the items are added. All items validate up-front; " +
        "if ANY item is invalid the entire batch is rejected with a per-index error enumeration so callers " +
        "can fix every problem in one pass.",
      inputSchema: addMenuItemsInputSchema.shape,
    },
    async (args) => {
      log.info({ tool: "add_menu_items", ...args.menu, count: args.items.length }, "tool invoked");
      return menuStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Resolve the parent menu (single). Misses and ambiguity short-circuit
          // with the standard lookup wording, no network touched.
          const query = "uid" in args.menu ? { uid: args.menu.uid } : { text: args.menu.name };
          const outcome = resolveLookup(query, {
            get: (uid) => ctx.menuStore.get(uid),
            findByText: (text) => ctx.menuStore.findByName(text),
          });

          if (outcome.kind === "uid_miss") {
            return textResult(`No menu found with UID "${outcome.uid}".`);
          }
          if (outcome.kind === "text_none") {
            return textResult(`No menus found matching "${outcome.text}".`);
          }
          if (outcome.kind === "text_many") {
            const list = outcome.matches.map((menu) => `- **${menu.name}** (uid: \`${menu.uid}\`)`).join("\n");
            return textResult(
              `Multiple menus match "${outcome.text}":\n${list}\n\nPlease re-invoke with a specific uid.`,
            );
          }

          const menu = outcome.entity;

          // ----- Stage 1: per-index validation (collect ALL errors, not first-only) -----
          type ResolvedItem = {
            readonly day: number;
            readonly typeUid: MealTypeUid;
            readonly resolvedName: string;
            readonly recipeUid: RecipeUid | null;
          };

          const errors: Array<string> = [];
          const resolved: Array<ResolvedItem> = [];

          for (let i = 0; i < args.items.length; i++) {
            const item = args.items[i]!;

            // Recipe-linked XOR freeform — the structural union guarantees exactly
            // one shape. Recipe items denormalize the display name from the local
            // store (matching plan_meals' recipe-link contract); freeform items keep
            // the supplied name and store recipeUid: null.
            let recipeUid: RecipeUid | null;
            let resolvedName: string;
            if ("recipe_uid" in item) {
              const recipe = ctx.store.get(item.recipe_uid);
              if (recipe === undefined) {
                errors.push(
                  `Item ${i.toString()}: recipe_uid "${item.recipe_uid}" is not known to the local recipe store; ` +
                    `wait for the next sync and retry, or supply a freeform item (omit recipe_uid, supply name).`,
                );
                continue;
              }
              recipeUid = item.recipe_uid;
              resolvedName = recipe.name;
            } else {
              recipeUid = null;
              resolvedName = item.name;
            }

            // Meal type resolution via the shared helper (same DU as plan_meals).
            const typeResult = resolveMealTypeSpec(ctx, item.type);
            if (!typeResult.ok) {
              if (typeResult.reason === "unknown_uid") {
                errors.push(`Item ${i.toString()}: unknown meal type UID "${typeResult.uid}".`);
              } else if (typeResult.reason === "unknown_name") {
                const knownList = typeResult.knownNames.join(", ");
                errors.push(
                  `Item ${i.toString()} (type {name: "${typeResult.name}"}): unknown meal type "${typeResult.name}". ` +
                    `Known types: ${knownList}. Use the {uid} or {builtin} discriminator to reference a custom meal type.`,
                );
              } else {
                errors.push(
                  `Item ${i.toString()}: no built-in meal type found with index ${typeResult.index.toString()} ` +
                    `(expected 0=Breakfast, 1=Lunch, 2=Dinner, 3=Snacks).`,
                );
              }
              continue;
            }

            resolved.push({
              day: item.day,
              typeUid: typeResult.resolved.uid,
              resolvedName,
              recipeUid,
            });
          }

          if (errors.length > 0) {
            const header =
              errors.length === 1
                ? "Could not add menu item:"
                : `Could not add ${errors.length.toString()} menu items:`;
            return textResult(`${header}\n\n${errors.join("\n")}`);
          }

          // ----- Stage 2: auto-expand the menu span when an item overflows it -----
          // Compute the batch's highest day; if it exceeds the menu's current span,
          // grow the menu (days = maxDay) and persist that FIRST so the new items
          // never reference days outside a saved menu.
          const maxDay = resolved.reduce((max, r) => Math.max(max, r.day), 0);
          let menuForRender: Menu = menu;
          let extendedTo: number | null = null;
          if (maxDay > menu.days) {
            const extended: Menu = { ...menu, days: maxDay };
            try {
              const saved = await ctx.client.saveMenus([extended]);
              const persisted = saved[0] ?? extended;
              await commitMenu(ctx, persisted);
              menuForRender = persisted;
              extendedTo = maxDay;
            } catch (error) {
              const message = toMessage(error);
              log.error({ err: error, uid: menu.uid }, "saveMenus (add_menu_items auto-expand) failed");
              return textResult(
                `Failed to extend menu "${menu.name}" to ${maxDay.toString()} day(s): ${message}. ` +
                  `No items were added.`,
              );
            }
          }

          // ----- Stage 3: assign menu-wide sequential orderFlag -----
          // Paprika numbers menuitem order_flag across the WHOLE menu, not per day:
          // the wire capture shows a multi-day menu's day-1 item at order_flag 0 and
          // its day-3 item at order_flag 1 (docs/wire-captures/menus.har.json). Seed
          // from the current menu-wide max and hand out a single increasing counter
          // across the batch in submission order, regardless of day.
          const liveItems = ctx.menuItemStore.getByMenuUid(menu.uid);
          const seedFlag = liveItems.reduce((max, item) => Math.max(max, item.orderFlag), -1) + 1;

          const builtItems: Array<MenuItem> = resolved.map((r, idx) => ({
            uid: MenuItemUidSchema.parse(crypto.randomUUID().toUpperCase()),
            menuUid: menu.uid,
            recipeUid: r.recipeUid,
            name: r.resolvedName,
            day: r.day,
            typeUid: r.typeUid,
            orderFlag: seedFlag + idx,
            deleted: false,
          }));

          // ----- Stage 4: single batch POST + commit -----
          let savedItems: ReadonlyArray<MenuItem>;
          try {
            savedItems = await ctx.client.saveMenuItems(builtItems);
            await commitMenuItemsBatch(ctx, savedItems);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: menu.uid, count: builtItems.length }, "saveMenuItems failed");
            return textResult(`Failed to add menu items: ${message}`);
          }

          const extendNote =
            extendedTo !== null ? `Extended menu "${menu.name}" to ${extendedTo.toString()} day(s). ` : "";
          const header = `${extendNote}Added ${savedItems.length.toString()} item(s) to menu "${menu.name}".`;
          const card = menuToMarkdown(
            menuForRender,
            ctx.menuItemStore.getByMenuUid(menu.uid),
            ctx.mealTypeStore.getAll(),
            {
              includeItemUids: true,
            },
          );
          return textResult(`${header}\n\n${card}`);
        },
        (guard) => guard,
      );
    },
  );
}

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

export function registerUpdateMenuItemTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "update_menu_item" });
  server.registerTool(
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
          const existing = ctx.menuItemStore.get(uid);
          if (existing === undefined) {
            if (ctx.menuItemStore.isTombstone(uid)) {
              return textResult(`Menu item with UID "${uid}" is already deleted.`);
            }
            return textResult(`No menu item found with UID "${uid}".`);
          }
          if (existing.deleted) {
            // Defense-in-depth
            return textResult(`Menu item "${existing.name}" is already deleted.`);
          }

          // Resolve type if supplied via the shared helper.
          let newTypeUid: MealTypeUid | undefined;
          if (args.type !== undefined) {
            const result = resolveMealTypeSpec(ctx, args.type);
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
            const recipe = ctx.store.get(args.recipe_uid);
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
            saved = (await ctx.client.saveMenuItems([merged]))[0]!;
            await commitMenuItem(ctx, saved);
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

export const deleteMenuItemInputSchema = z.object({
  uid: MenuItemUidSchema.describe("Menu item UID to delete"),
});

export function registerDeleteMenuItemTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "delete_menu_item" });
  server.registerTool(
    "delete_menu_item",
    {
      title: "Delete a menu item",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      description:
        "Soft-delete a menuitem (a planned recipe) from a menu by UID. Idempotent: a second delete on the " +
        "same UID returns a friendly 'already deleted' message without re-POSTing. Requires an exact UID.",
      inputSchema: deleteMenuItemInputSchema.shape,
    },
    async (args) => {
      log.info({ tool: "delete_menu_item", uid: args.uid }, "tool invoked");
      return menuStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const uid = args.uid;
          const existing = ctx.menuItemStore.get(uid);

          if (existing === undefined) {
            // Tombstone vs never-existed (mirrors delete_grocery_item / delete_meal).
            if (ctx.menuItemStore.isTombstone(uid)) {
              return textResult(`Menu item with UID "${uid}" is already deleted.`);
            }
            return textResult(`No menu item found with UID "${uid}".`);
          }
          if (existing.deleted) {
            // Defense-in-depth
            return textResult(`Menu item "${existing.name}" is already deleted.`);
          }

          const trashed: MenuItem = { ...existing, deleted: true };
          try {
            const saved = (await ctx.client.saveMenuItems([trashed]))[0]!;
            await commitMenuItem(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid }, "saveMenuItems (delete_menu_item) failed");
            return textResult(`Failed to delete menu item: ${message}`);
          }

          return textResult(`Menu item "${existing.name}" has been deleted.`);
        },
        (guard) => guard,
      );
    },
  );
}
