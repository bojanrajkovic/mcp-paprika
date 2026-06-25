import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealType } from "../../meal-type/types.js";
import type { RecipeUid } from "../../recipe/ids.js";
import type { MenuItem } from "../menu-item/types.js";
import type { MenuState, MenuWrites } from "../module.js";
import type { Menu } from "../types.js";

import { defineTool } from "../../../kernel/tool.js";
import {
  commitFailure,
  errorResult,
  resolveLookup,
  resolveOrPick,
  structuredResult,
  uidOrTextLookupSchema,
} from "../../../shared/tools.js";
import { mealTypeSpecSchema } from "../../meal-type/meal-type-helpers.js";
import { RecipeUidSchema } from "../../recipe/ids.js";
import { MenuItemUidSchema, MenuUidSchema } from "../ids.js";
import { menuItemRowSchema, menuItemsToRows, resolveRecipeRows } from "../menu-helpers.js";
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
 * Structured-output payload for `add_menu_items` (ADR-0019 R1, B1/#321): the parent
 * menu UID plus a row per newly-added item (the new child UIDs the model chains on,
 * distinguished from the menu's pre-existing items). Shares {@link menuItemRowSchema}
 * with `read_menu`.
 */
export const addMenuItemsOutputSchema = z.object({
  menuUid: MenuUidSchema,
  items: z.array(menuItemRowSchema),
});

/**
 * `add_menu_items` — add items to a menu. Denormalizes the recipe display name via
 * `ctx.deps.recipe.get` and resolves the meal type via `ctx.deps["meal-type"]` (an
 * unknown `{name}` auto-creates a custom type).
 */
export const addMenuItemsTool = defineTool(
  {
    name: "add_menu_items",
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
    outputSchema: addMenuItemsOutputSchema,
  },
  [menuStartGuard],
  (ctx: DomainCtx<MenuState, "recipe" | "meal-type", MenuWrites>) => {
    const log = ctx.infra.log.child({ component: "add_menu_items" });
    return async (args) => {
      // Resolve the parent menu (single): a miss / no-match returns prose, and an
      // ambiguous name offers a disambiguation PICK, all before any network touch.
      const query = "uid" in args.menu ? { uid: args.menu.uid } : { text: args.menu.name };
      const outcome = resolveLookup(query, {
        get: (uid) => ctx.state.menus.store.get(uid),
        findByText: (text) => ctx.state.menus.store.findByName(text),
      });
      const resolvedMenu = await resolveOrPick(ctx.server.server, outcome, {
        entityNoun: "menu",
        describe: (m) => ({ uid: m.uid, label: m.name }),
        findWith: "list_menus",
        log,
      });
      if ("result" in resolvedMenu) return resolvedMenu.result;
      const menu = resolvedMenu.entity;

      // ----- Stage 1: per-index validation (collect ALL errors, not first-only) -----
      type ResolvedItem = {
        readonly day: number;
        // Exactly one is set: the type resolved in validation, or a {name} to
        // auto-create in the build pass (deferred so a rejected batch makes no orphan type).
        readonly resolvedType: MealType | null;
        readonly pendingTypeName: string | null;
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
        // An unknown {name} is deferred and auto-created in the build pass below.
        const typeResult = ctx.deps["meal-type"].resolveSpec(item.type);
        let resolvedType: MealType | null = null;
        let pendingTypeName: string | null = null;
        if (typeResult.ok) {
          resolvedType = typeResult.resolved;
        } else if (typeResult.reason === "unknown_name") {
          pendingTypeName = typeResult.name;
        } else if (typeResult.reason === "unknown_uid") {
          errors.push(`Item ${i.toString()}: unknown meal type UID "${typeResult.uid}".`);
          continue;
        } else {
          errors.push(
            `Item ${i.toString()}: no built-in meal type found with index ${typeResult.index.toString()} ` +
              `(expected 0=Breakfast, 1=Lunch, 2=Dinner, 3=Snacks).`,
          );
          continue;
        }

        resolved.push({
          day: item.day,
          resolvedType,
          pendingTypeName,
          resolvedName,
          recipeUid,
        });
      }

      if (errors.length > 0) {
        const header =
          errors.length === 1 ? "Could not add menu item:" : `Could not add ${errors.length.toString()} menu items:`;
        return errorResult(`${header}\n\n${errors.join("\n")}`);
      }

      // ----- Stage 2: auto-expand the menu span when an item overflows it -----
      // Compute the batch's highest day; if it exceeds the menu's current span,
      // grow the menu (days = maxDay) and persist that FIRST so the new items
      // never reference days outside a saved menu. This runs BEFORE meal-type
      // auto-create below, so a failed expand can't leave an orphan type behind.
      const maxDay = resolved.reduce((max, r) => Math.max(max, r.day), 0);
      if (maxDay > menu.days) {
        const extended: Menu = { ...menu, days: maxDay };
        const saved = (await ctx.infra.client.saveMenus([extended])).match(
          (v) => v,
          (e) => {
            log.error({ err: e, uid: menu.uid }, "saveMenus (add_menu_items auto-expand) failed");
            return errorResult(
              `Failed to extend menu "${menu.name}" to ${maxDay.toString()} day(s): ${e.message}. ` +
                `No items were added.`,
            );
          },
        );
        if ("content" in saved) return saved;
        const persisted = saved[0] ?? extended;
        // Unlike the final-batch commit (where the items already POSTed, so a local-cache
        // divergence is a genuine degraded success), this divergence aborts BEFORE any item
        // is added — the requested add did NOT happen. Signal an error, not a degraded
        // empty-items success the model could read as "added 0" and never retry; the
        // menu-extension write itself already landed on Paprika, so a retry completes the add.
        const expandErr = (await ctx.writes.commitMenu(persisted)).match(
          () => undefined,
          (e) =>
            errorResult(
              `Extended menu "${menu.name}" to ${maxDay.toString()} day(s) on Paprika, but the local cache update ` +
                `failed (${e.message}); the items were not added — retry add_menu_items once the menu syncs.`,
            ),
        );
        if (expandErr) return expandErr;
      }

      // ----- Stage 3: auto-create any deferred {name} meal types (pantry-style) -----
      // Everything above (validation + the menu expand) has succeeded, so creating now
      // leaves no orphan type on a rejected batch. Cache by lowercase name so a name
      // repeated across items is created once.
      const createdTypesByName = new Map<string, MealType>();
      for (const r of resolved) {
        if (r.pendingTypeName === null) continue;
        const key = r.pendingTypeName.toLowerCase();
        if (createdTypesByName.has(key)) continue;
        const created = (await ctx.deps["meal-type"].ensureMealType(r.pendingTypeName)).match(
          (mt) => mt,
          (message) => message,
        );
        if (typeof created === "string") {
          log.error({ name: r.pendingTypeName, message: created }, "ensureMealType failed");
          return errorResult(created);
        }
        createdTypesByName.set(key, created);
      }

      // ----- Stage 4: assign menu-wide sequential orderFlag -----
      // Paprika numbers menuitem order_flag across the WHOLE menu, not per day:
      // the wire capture shows a multi-day menu's day-1 item at order_flag 0 and
      // its day-3 item at order_flag 1 (docs/wire-captures/menus.har.json). Seed
      // from the current menu-wide max and hand out a single increasing counter
      // across the batch in submission order, regardless of day.
      const liveItems = ctx.state.items.store.getByMenuUid(menu.uid);
      const seedFlag = liveItems.reduce((max, item) => Math.max(max, item.orderFlag), -1) + 1;

      const builtItems: Array<MenuItem> = resolved.map((r, idx) => ({
        uid: MenuItemUidSchema.parse(crypto.randomUUID().toUpperCase()),
        menuUid: menu.uid,
        recipeUid: r.recipeUid,
        name: r.resolvedName,
        day: r.day,
        // Either the type resolved during validation, or the one just auto-created.
        typeUid: (r.resolvedType ?? createdTypesByName.get(r.pendingTypeName!.toLowerCase())!).uid,
        orderFlag: seedFlag + idx,
        deleted: false,
      }));

      // ----- Stage 5: single batch POST + commit -----
      const savedItems = (await ctx.infra.client.saveMenuItems(builtItems)).match(
        (items) => items,
        (e) => {
          log.error({ err: e, uid: menu.uid, count: builtItems.length }, "saveMenuItems failed");
          return errorResult(`Failed to add menu items: ${e.message}`);
        },
      );
      if ("content" in savedItems) return savedItems;

      const mealTypes = ctx.deps["meal-type"].getAll();
      // Structured carries ONLY the newly-added items (the new child UIDs the model chains
      // on), distinguished from the menu's pre-existing items the text card also shows.
      const structured = {
        menuUid: menu.uid,
        items: menuItemsToRows(savedItems, mealTypes, resolveRecipeRows(savedItems, ctx.deps.recipe)),
      };
      const commitErr = commitFailure("menu", await ctx.writes.commitMenuItemsBatch(savedItems), {
        structuredContent: structured,
      });
      if (commitErr) return commitErr;

      return structuredResult(structured);
    };
  },
);
