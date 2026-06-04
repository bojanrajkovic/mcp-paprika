import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { MealTypeUid, RecipeUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuItem } from "../menu-item/types.js";
import type { MenuSelf } from "../module.js";
import type { Menu } from "../types.js";

import { MenuItemUidSchema, MenuUidSchema, RecipeUidSchema } from "../../../ids.js";
import { resolveLookup, textResult, uidOrTextLookupSchema } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { mealTypeSpecSchema } from "../../meal-type/meal-type-helpers.js";
import { menuToMarkdown } from "../menu-helpers.js";
import { menuStartGuard } from "./guards.js";

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

/**
 * Registers `add_menu_items`, kernel-shaped — reads/writes this module's own menu +
 * menu-item stores via `ctx.self`, denormalizes the recipe display name via
 * `ctx.deps.recipe.get`, resolves the meal type via `ctx.deps["meal-type"].resolveSpec`,
 * and commits through `ctx.self.commitMenu` / `ctx.self.commitMenuItemsBatch`.
 */
export function addMenuItemsTool(ctx: DomainCtx<MenuSelf, "recipe" | "meal-type">): void {
  const log = ctx.infra.log.child({ component: "add_menu_items" });
  ctx.server.registerTool(
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
            get: (uid) => ctx.self.menus.store.get(uid),
            findByText: (text) => ctx.self.menus.store.findByName(text),
          });

          if (outcome.kind === "uid_miss") {
            return textResult(`No menu found with UID "${outcome.uid}" (it may not exist or was already deleted).`);
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
              const recipe = ctx.deps.recipe.get(item.recipe_uid);
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

            // Meal type resolution via the shared meal-type contract (same DU as plan_meals).
            const typeResult = ctx.deps["meal-type"].resolveSpec(item.type);
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
              const saved = await ctx.infra.client.saveMenus([extended]);
              const persisted = saved[0] ?? extended;
              await ctx.self.commitMenu(persisted);
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
          const liveItems = ctx.self.items.store.getByMenuUid(menu.uid);
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
            savedItems = await ctx.infra.client.saveMenuItems(builtItems);
            await ctx.self.commitMenuItemsBatch(savedItems);
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
            ctx.self.items.store.getByMenuUid(menu.uid),
            ctx.deps["meal-type"].getAll(),
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
