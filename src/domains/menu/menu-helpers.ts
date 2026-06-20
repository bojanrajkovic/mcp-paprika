import { z } from "zod";

import type { MealType } from "../meal-type/types.js";
import type { MenuItem } from "./menu-item/types.js";
import type { Menu } from "./types.js";

import { MealTypeUidSchema } from "../meal-type/ids.js";
import { RecipeUidSchema } from "../recipe/ids.js";
import { MenuItemUidSchema, MenuUidSchema } from "./ids.js";

/**
 * The structured-output row for one menu item (ADR-0019, R1, B1/#321) — the
 * machine-readable counterpart to the day-by-day text, and the C3 meal-plan board
 * feed (#335). `uid` drives `update_menu_item` / `delete_menu_item`; `recipeUid` chains
 * to `read_recipe` (null for a freeform item); `typeUid` is the raw FK and `typeName`
 * its resolved label (null when the type is dangling — the raw+resolved split A3 uses).
 */
export const menuItemRowSchema = z.object({
  uid: MenuItemUidSchema,
  day: z.number().int(),
  name: z.string(),
  typeUid: MealTypeUidSchema,
  typeName: z.string().nullable().describe("Resolved meal-type name, or null when the type is dangling/unknown."),
  recipeUid: RecipeUidSchema.nullable(),
});

export type MenuItemRow = z.infer<typeof menuItemRowSchema>;

/** The structured-output payload for `read_menu` / `create_menu` (one shape per entity). */
export const menuReadOutputSchema = z.object({
  uid: MenuUidSchema,
  name: z.string(),
  days: z.number().int(),
  notes: z.string(),
  items: z.array(menuItemRowSchema),
});

export type MenuReadStructured = z.infer<typeof menuReadOutputSchema>;

/**
 * Map menu items into {@link MenuItemRow}s, resolving each type's name through the
 * meal-type catalog (the same resolution {@link menuToMarkdown} uses, so the text and
 * the rows agree by construction). A dangling `typeUid` resolves to `typeName: null`.
 */
export function menuItemsToRows(
  items: ReadonlyArray<Readonly<MenuItem>>,
  mealTypes: ReadonlyArray<Readonly<MealType>>,
): Array<MenuItemRow> {
  const UNKNOWN_ORDER = Number.MAX_SAFE_INTEGER;
  const nameByTypeUid = new Map<string, string>();
  const orderByTypeUid = new Map<string, number>();
  for (const mt of mealTypes) {
    nameByTypeUid.set(mt.uid, mt.name);
    orderByTypeUid.set(mt.uid, mt.orderFlag);
  }
  // Emit rows in the SAME display order menuToMarkdown renders — day ascending, then
  // within a day by meal-type orderFlag (unknown/dangling types last), then item
  // orderFlag — so a widget rendering from structuredContent.items matches the text
  // (the store can hand us items in insertion/sync order, not display order).
  const ordered = [...items].sort((a, b) => {
    if (a.day !== b.day) return a.day - b.day;
    const orderA = orderByTypeUid.get(a.typeUid) ?? UNKNOWN_ORDER;
    const orderB = orderByTypeUid.get(b.typeUid) ?? UNKNOWN_ORDER;
    if (orderA !== orderB) return orderA - orderB;
    return a.orderFlag - b.orderFlag;
  });
  return ordered.map((item) => ({
    uid: item.uid,
    day: item.day,
    name: item.name,
    typeUid: item.typeUid,
    typeName: nameByTypeUid.get(item.typeUid) ?? null,
    recipeUid: item.recipeUid,
  }));
}

/** Map a `Menu` plus its items into the structured read payload. */
export function menuToStructured(
  menu: Readonly<Menu>,
  items: ReadonlyArray<Readonly<MenuItem>>,
  mealTypes: ReadonlyArray<Readonly<MealType>>,
): MenuReadStructured {
  return {
    uid: menu.uid,
    name: menu.name,
    days: menu.days,
    notes: menu.notes,
    items: menuItemsToRows(items, mealTypes),
  };
}

/**
 * Pure renderer for a single menu and its items. Iterates the menu's full
 * `days` span (Day 1..menu.days); a day with no items renders
 * `_(no meals planned)_`. Within a day, items sort by their meal-type's
 * `orderFlag` (an unknown `typeUid` sorts last), then by item `orderFlag`.
 *
 * Each item line shows the resolved meal-type name and the recipe display name
 * (already denormalized on `item.name`). The per-item menuitem/recipe UIDs travel on
 * the structured channel ({@link menuToStructured}, ADR-0019 R1) — the human lines stay
 * clean. The `includeItemUids` per-renderer flag was retired in B1 (#321, #353); the
 * top-level menu `**UID:**` line is kept as a text fallback pending the reliable-channel
 * decision (#367/#368).
 *
 * Pure — takes the `mealTypes` catalog array for `typeUid`→name/order resolution.
 * Both callers pass `ctx.deps["meal-type"].getAll()`.
 */
export function menuToMarkdown(
  menu: Readonly<Menu>,
  items: ReadonlyArray<Readonly<MenuItem>>,
  mealTypes: ReadonlyArray<Readonly<MealType>>,
): string {
  // Resolve meal-type name and order once. `UNKNOWN_ORDER` sorts unknown types
  // last within a day (a menuitem may reference a type that's been deleted from
  // the catalog, or a custom type not yet synced).
  const UNKNOWN_ORDER = Number.MAX_SAFE_INTEGER;
  const nameByTypeUid = new Map<string, string>();
  const orderByTypeUid = new Map<string, number>();
  for (const mt of mealTypes) {
    nameByTypeUid.set(mt.uid, mt.name);
    orderByTypeUid.set(mt.uid, mt.orderFlag);
  }

  const lines: Array<string> = [];
  lines.push(`# ${menu.name}`);
  lines.push("");
  lines.push(`**UID:** \`${menu.uid}\``);
  lines.push(`**Days:** ${menu.days.toString()}`);
  if (menu.notes !== "") {
    lines.push(`**Notes:** ${menu.notes}`);
  }

  // Bucket items by day for the full-span render.
  const itemsByDay = new Map<number, Array<Readonly<MenuItem>>>();
  for (const item of items) {
    const bucket = itemsByDay.get(item.day);
    if (bucket === undefined) {
      itemsByDay.set(item.day, [item]);
    } else {
      bucket.push(item);
    }
  }

  for (let day = 1; day <= menu.days; day += 1) {
    lines.push("");
    lines.push(`## Day ${day.toString()}`);
    const dayItems = itemsByDay.get(day);
    if (dayItems === undefined || dayItems.length === 0) {
      lines.push("");
      lines.push("_(no meals planned)_");
      continue;
    }
    const sorted = [...dayItems].sort((a, b) => {
      const orderA = orderByTypeUid.get(a.typeUid) ?? UNKNOWN_ORDER;
      const orderB = orderByTypeUid.get(b.typeUid) ?? UNKNOWN_ORDER;
      if (orderA !== orderB) return orderA - orderB;
      return a.orderFlag - b.orderFlag;
    });
    lines.push("");
    for (const item of sorted) {
      // A typeUid that misses the catalog is a DANGLING reference (its type was
      // deleted): render the item with no type prefix rather than
      // leaking the raw UID into the line.
      const typeName = nameByTypeUid.get(item.typeUid);
      const line = typeName !== undefined ? `- **${typeName}:** ${item.name}` : `- ${item.name}`;
      lines.push(line);
    }
  }

  return lines.join("\n");
}
