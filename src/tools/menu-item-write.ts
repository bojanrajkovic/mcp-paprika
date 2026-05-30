// pattern: Imperative Shell
import { toMessage } from "../utils/log.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MenuItemUidSchema, MenuUidSchema, RecipeUidSchema } from "../paprika/types.js";
import type { Menu, MenuItem } from "../paprika/types.js";
import { resolveLookup, textResult, uidOrTextLookupSchema } from "./helpers.js";
import { mealTypeSpecSchema, resolveMealTypeSpec } from "./meal-helpers.js";
import { commitMenu, commitMenuItem, commitMenuItemsBatch, menuStartGuard, menuToMarkdown } from "./menu-helpers.js";
import type { ServerContext } from "../types/server-context.js";

// One menuitem to add: a recipe-linked entry placed on a specific day with a
// meal type. Display name auto-resolves from the recipe (like add_meals), so no
// `name` field is accepted. `.strict()` rejects extra keys at the Zod boundary.
const addMenuItemSchema = z
  .object({
    recipe_uid: RecipeUidSchema.describe(
      "Recipe UID to place on the menu. Display name auto-resolves from the recipe.",
    ),
    day: z
      .number()
      .int()
      .positive()
      .describe("1-indexed day within the menu. Days beyond the menu's current span auto-extend the menu."),
    type: mealTypeSpecSchema.describe(
      'Meal type. Pick exactly one shape: {"name": "Dinner"} | {"uid": "<MealType UID>"} | {"builtin": 2}.',
    ),
  })
  .strict();

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
    .describe("Array of recipe-linked menuitems to add (1 or more)."),
});

export function registerAddMenuItemsTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "add_menu_items" });
  server.registerTool(
    "add_menu_items",
    {
      description:
        "Add one or more recipe-linked menuitems to a menu (saved meal plan). Look the menu up by UID or " +
        "name (tiered fuzzy match). Each item carries a recipe_uid (display name auto-resolves from the " +
        "recipe), a 1-indexed day, and a meal type (name, UID, or built-in index 0=Breakfast, 1=Lunch, " +
        "2=Dinner, 3=Snacks). If any day falls beyond the menu's current span the menu is automatically " +
        "extended to fit before the items are added. All items validate up-front; if ANY item is invalid " +
        "the entire batch is rejected with a per-index error enumeration so callers can fix every problem " +
        "in one pass.",
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
            readonly typeUid: string;
            readonly resolvedName: string;
            readonly recipeUid: string;
          };

          const errors: Array<string> = [];
          const resolved: Array<ResolvedItem> = [];

          for (let i = 0; i < args.items.length; i++) {
            const item = args.items[i]!;

            // Recipe must be known to the local store so we can denormalize the
            // display name (matching add_meals' recipe-link contract).
            const recipe = ctx.store.get(item.recipe_uid);
            if (recipe === undefined) {
              errors.push(
                `Item ${i.toString()}: recipe_uid "${item.recipe_uid}" is not known to the local recipe store; ` +
                  `wait for the next sync and retry.`,
              );
              continue;
            }

            // Meal type resolution via the shared helper (same DU as add_meals).
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
              resolvedName: recipe.name,
              recipeUid: item.recipe_uid,
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

          // ----- Stage 3: assign orderFlag per (menuUid, day) bucket -----
          // Seed each bucket from the highest existing orderFlag among live items
          // on that day, then hand out sequential flags within the batch. The store
          // does not change between iterations (nothing is saved yet), so the cached
          // counter keeps same-bucket items in submission order.
          const liveItems = ctx.menuItemStore.getByMenuUid(menu.uid);
          const nextFlag = new Map<number, number>();
          const seedFlag = (day: number): number => {
            const onDay = liveItems.filter((item) => item.day === day);
            return onDay.reduce((max, item) => Math.max(max, item.orderFlag), -1) + 1;
          };

          const builtItems: Array<MenuItem> = resolved.map((r) => {
            let flag = nextFlag.get(r.day);
            if (flag === undefined) {
              flag = seedFlag(r.day);
            }
            nextFlag.set(r.day, flag + 1);

            return {
              uid: MenuItemUidSchema.parse(crypto.randomUUID().toUpperCase()),
              menuUid: menu.uid,
              recipeUid: r.recipeUid,
              name: r.resolvedName,
              day: r.day,
              typeUid: r.typeUid,
              orderFlag: flag,
              deleted: false,
            };
          });

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

export const updateMenuItemInputSchema = z.object({
  uid: MenuItemUidSchema.describe("UID of the menuitem to update"),
  day: z.number().int().positive().optional().describe("New 1-indexed day"),
  type: mealTypeSpecSchema.optional().describe("New meal type (same DU as add_menu_items)"),
  recipe_uid: RecipeUidSchema.optional().describe("New recipe UID. Display name re-resolves from the new recipe."),
});

export function registerUpdateMenuItemTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "update_menu_item" });
  server.registerTool(
    "update_menu_item",
    {
      description:
        "Update an existing menuitem by UID. Provide at least one of day, type, or recipe_uid; omitted " +
        "fields keep their current values. Changing recipe_uid re-resolves the display name from the new " +
        "recipe. The menu link (menu_uid) is not editable via this tool — delete and re-add to move an item " +
        "between menus.",
      inputSchema: updateMenuItemInputSchema.shape,
    },
    async (args) => {
      log.info({ tool: "update_menu_item", uid: args.uid }, "tool invoked");
      return menuStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          if (args.day === undefined && args.type === undefined && args.recipe_uid === undefined) {
            return textResult("Nothing to update. Provide at least one of day, type, or recipe_uid.");
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
          let newTypeUid: string | undefined;
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
          let newRecipeUid: string = existing.recipeUid ?? "";
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
            ...(args.day !== undefined && { day: args.day }),
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

          return textResult(`Menu item "${saved.name}" updated (day ${saved.day.toString()}).`);
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
