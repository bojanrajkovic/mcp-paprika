import { err, ok, type Result } from "neverthrow";
import type { MenuItemUid, MenuUid } from "../ids.js";
import type { MealType } from "../meal-type/types.js";
import type { MenuItem } from "../menu-item/types.js";
import type { Menu } from "../menu/types.js";
import type { ServerContext } from "../types/server-context.js";
import { textResult } from "./helpers.js";

/**
 * Returns Ok when the menu, menu-item, AND meal-type stores are all synced,
 * Err<CallToolResult> otherwise. `menuStore`/`menuItemStore` back a menu and its
 * inlined items; `mealTypeStore` is required because `read_menu`, the menu write
 * tools, and the `paprika://menu/{uid}` resource render each item's meal-type
 * name and sort within a day by the type's order. Meal-type sync is best-effort
 * and can fail/lag independently of menu sync (see the try/catch blocks in
 * `sync.ts`); without this check a cold `mealTypeStore` renders every item with
 * an opaque `typeUid` sorted as unknown. Gating here yields a clear "still
 * syncing" message instead — mirroring `mealStartGuard`, which likewise gates on
 * `mealTypeStore`.
 */
export function menuStartGuard(ctx: ServerContext): Result<void, ReturnType<typeof textResult>> {
  if (!ctx.menuStore.hasSynced || !ctx.menuItemStore.hasSynced || !ctx.mealTypeStore.hasSynced) {
    return err(textResult("Menu data is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

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
 * resource passes `false` for clean recipe-name lines (matching
 * `groceryListToMarkdown`'s no-child-UID convention).
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
      const typeName = nameByTypeUid.get(item.typeUid) ?? item.typeUid;
      let line = `- **${typeName}:** ${item.name}`;
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

/**
 * Persists a saved menu to the local cache and store, then triggers cloud sync.
 * Clone of `commitGroceryList` — calls `ctx.notifier.resourceListChanged()` in
 * both branches because menus have an MCP resource surface (`paprika://menu/{uid}`).
 *
 * Branches on `saved.deleted`:
 * - Upsert: markPendingUpsert → put → flush → set → resourceListChanged → notifySync
 * - Delete: markPendingDelete → remove → flush → delete → resourceListChanged → notifySync
 *
 * If cache I/O throws, clears the pending mark before re-throwing.
 */
export async function commitMenu(ctx: ServerContext, saved: Readonly<Menu>): Promise<void> {
  if (saved.deleted) {
    const uid: MenuUid = saved.uid;
    ctx.menuStore.markPendingDelete(uid);
    try {
      await ctx.cache.menus.remove(uid);
      await ctx.cache.flush();
    } catch (e) {
      ctx.menuStore.clearPending(uid);
      throw e;
    }
    ctx.menuStore.delete(uid);
  } else {
    ctx.menuStore.markPendingUpsert(saved.uid);
    try {
      await ctx.cache.menus.put(saved);
      await ctx.cache.flush();
    } catch (e) {
      ctx.menuStore.clearPending(saved.uid);
      throw e;
    }
    ctx.menuStore.set(saved);
  }
  ctx.notifier.resourceListChanged();
  await ctx.client.notifySync();
}

/**
 * Persists a saved menuitem to the local cache and store, then triggers cloud sync.
 * Clone of `commitGroceryItem` — calls `ctx.notifier.resourceListChanged()` because
 * menuitems are inlined in the `paprika://menu/{uid}` resource.
 */
export async function commitMenuItem(ctx: ServerContext, saved: Readonly<MenuItem>): Promise<void> {
  if (saved.deleted) {
    const uid: MenuItemUid = saved.uid;
    ctx.menuItemStore.markPendingDelete(uid);
    try {
      await ctx.cache.menuItems.remove(uid);
      await ctx.cache.flush();
    } catch (e) {
      ctx.menuItemStore.clearPending(uid);
      throw e;
    }
    ctx.menuItemStore.delete(uid);
  } else {
    ctx.menuItemStore.markPendingUpsert(saved.uid);
    try {
      await ctx.cache.menuItems.put(saved);
      await ctx.cache.flush();
    } catch (e) {
      ctx.menuItemStore.clearPending(saved.uid);
      throw e;
    }
    ctx.menuItemStore.set(saved);
  }
  ctx.notifier.resourceListChanged();
  await ctx.client.notifySync();
}

/**
 * Batch variant of `commitMenuItem`. Commits N menuitems with a single cache
 * flush, a single `resourceListChanged`, and a single `notifySync`.
 *
 * Marks all pending writes before any cache I/O. On cache failure, clears all
 * pending marks before re-throwing so no UID is left shielded until TTL.
 */
export async function commitMenuItemsBatch(
  ctx: ServerContext,
  items: ReadonlyArray<Readonly<MenuItem>>,
): Promise<void> {
  if (items.length === 0) return;
  const markedUids: Array<MenuItemUid> = [];
  for (const item of items) {
    if (item.deleted) {
      ctx.menuItemStore.markPendingDelete(item.uid);
    } else {
      ctx.menuItemStore.markPendingUpsert(item.uid);
    }
    markedUids.push(item.uid);
  }
  const clearPending = () => {
    for (const uid of markedUids) ctx.menuItemStore.clearPending(uid);
  };
  // allSettled (not Promise.all): fail-fast would let in-flight ops race the
  // clearPending call in the catch block. We wait for every op to settle first.
  const opsResults = await Promise.allSettled(
    items.map((item) => (item.deleted ? ctx.cache.menuItems.remove(item.uid) : ctx.cache.menuItems.put(item))),
  );
  const opsFailure = opsResults.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (opsFailure !== undefined) {
    clearPending();
    throw opsFailure.reason;
  }
  try {
    await ctx.cache.flush();
  } catch (e) {
    clearPending();
    throw e;
  }
  for (const item of items) {
    if (item.deleted) {
      ctx.menuItemStore.delete(item.uid);
    } else {
      ctx.menuItemStore.set(item);
    }
  }
  ctx.notifier.resourceListChanged();
  await ctx.client.notifySync();
}
