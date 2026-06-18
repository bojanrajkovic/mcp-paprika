import type { MealType } from "../meal-type/types.js";
import type { MenuItem } from "./menu-item/types.js";
import type { Menu } from "./types.js";

/**
 * Pure renderer for a single menu and its items. Iterates the menu's full
 * `days` span (Day 1..menu.days); a day with no items renders
 * `_(no meals planned)_`. Within a day, items sort by their meal-type's
 * `orderFlag` (an unknown `typeUid` sorts last), then by item `orderFlag`.
 *
 * Each item line shows the resolved meal-type name and the recipe display name
 * (already denormalized on `item.name`). When `opts.includeItemUids` is set,
 * the line appends `` · item `<uid>` · recipe `<recipeUid>` `` so an agent can
 * drive `update_menu_item` / `delete_menu_item`; the recipe clause is omitted
 * when `recipeUid` is null. `read_menu` passes `includeItemUids: true`; the
 * resource passes `false` for clean recipe-name lines (the same model-facing /
 * human-facing split `groceryListToMarkdown` carries on its `includeItemUids`).
 *
 * Pure like `mealToMarkdown` — takes the `mealTypes` catalog array for
 * `typeUid`→name/order resolution. Both callers pass `ctx.mealTypeStore.getAll()`.
 */
export function menuToMarkdown(
  menu: Readonly<Menu>,
  items: ReadonlyArray<Readonly<MenuItem>>,
  mealTypes: ReadonlyArray<Readonly<MealType>>,
  opts?: { readonly includeItemUids?: boolean },
): string {
  const includeItemUids = opts?.includeItemUids ?? false;

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
      // deleted — ADR-0017): render the item with no type prefix rather than
      // leaking the raw UID into the line.
      const typeName = nameByTypeUid.get(item.typeUid);
      let line = typeName !== undefined ? `- **${typeName}:** ${item.name}` : `- ${item.name}`;
      if (includeItemUids) {
        line += ` · item \`${item.uid}\``;
        if (item.recipeUid !== null) {
          line += ` · recipe \`${item.recipeUid}\``;
        }
      }
      lines.push(line);
    }
  }

  return lines.join("\n");
}
