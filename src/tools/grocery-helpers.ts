import { err, ok, type Result } from "neverthrow";
import type { GroceryItem, GroceryItemUid, GroceryList, GroceryListUid } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";
import { textResult } from "./helpers.js";

/**
 * Returns Ok when both grocery stores are synced, Err<CallToolResult> otherwise.
 * Both stores must be synced because `read_grocery_list` inlines items.
 */
export function groceryStartGuard(ctx: ServerContext): Result<void, ReturnType<typeof textResult>> {
  if (!ctx.groceryListStore.hasSynced || !ctx.groceryItemStore.hasSynced) {
    return err(textResult("Grocery data is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

/**
 * Persists a saved grocery list to the local cache and store, then triggers cloud sync.
 * Called by all grocery list write tools after `ctx.client.saveGroceryList()` returns.
 *
 * Unlike `commitPantryItem`, this also calls `ctx.notifier.resourceListChanged()` because
 * grocery lists have an MCP resource surface (pantry items do not).
 *
 * Branches on `saved.deleted`:
 * - Upsert (deleted: false): markPendingUpsert → put → flush → set → resourceListChanged → notifySync
 * - Delete (deleted: true):  markPendingDelete → remove → flush → delete → resourceListChanged → notifySync
 *
 * If cache I/O throws, clears the pending mark before re-throwing so failed local
 * commits don't suppress canonical reconciliation until TTL.
 */
export async function commitGroceryList(ctx: ServerContext, saved: Readonly<GroceryList>): Promise<void> {
  if (saved.deleted) {
    const uid: GroceryListUid = saved.uid;
    ctx.groceryListStore.markPendingDelete(uid);
    try {
      await ctx.cache.groceryLists.remove(uid);
      await ctx.cache.flush();
    } catch (e) {
      ctx.groceryListStore.clearPending(uid);
      throw e;
    }
    ctx.groceryListStore.delete(uid);
  } else {
    ctx.groceryListStore.markPendingUpsert(saved.uid);
    try {
      await ctx.cache.groceryLists.put(saved);
      await ctx.cache.flush();
    } catch (e) {
      ctx.groceryListStore.clearPending(saved.uid);
      throw e;
    }
    ctx.groceryListStore.set(saved);
  }
  ctx.notifier.resourceListChanged();
  await ctx.client.notifySync();
}

/**
 * Persists a saved grocery item to the local cache and store, then triggers cloud sync.
 * Called by grocery item write tools after `ctx.client.saveGroceryItems()` returns.
 *
 * Calls `ctx.notifier.resourceListChanged()` because items are inlined in the list resource.
 *
 * Branches on `saved.deleted`:
 * - Upsert (deleted: false): markPendingUpsert → put → flush → set → resourceListChanged → notifySync
 * - Delete (deleted: true):  markPendingDelete → remove → flush → delete → resourceListChanged → notifySync
 */
export async function commitGroceryItem(ctx: ServerContext, saved: Readonly<GroceryItem>): Promise<void> {
  if (saved.deleted) {
    const uid: GroceryItemUid = saved.uid;
    ctx.groceryItemStore.markPendingDelete(uid);
    try {
      await ctx.cache.groceryItems.remove(uid);
      await ctx.cache.flush();
    } catch (e) {
      ctx.groceryItemStore.clearPending(uid);
      throw e;
    }
    ctx.groceryItemStore.delete(uid);
  } else {
    ctx.groceryItemStore.markPendingUpsert(saved.uid);
    try {
      await ctx.cache.groceryItems.put(saved);
      await ctx.cache.flush();
    } catch (e) {
      ctx.groceryItemStore.clearPending(saved.uid);
      throw e;
    }
    ctx.groceryItemStore.set(saved);
  }
  ctx.notifier.resourceListChanged();
  await ctx.client.notifySync();
}

/**
 * Batch variant of `commitGroceryItem`. Commits multiple grocery items with a
 * single cache flush, a single `resourceListChanged`, and a single `notifySync`.
 *
 * Marks all pending writes before any cache I/O. On cache failure, clears all
 * pending marks before re-throwing so no UID is left shielded until TTL.
 */
export async function commitGroceryItemsBatch(
  ctx: ServerContext,
  items: ReadonlyArray<Readonly<GroceryItem>>,
): Promise<void> {
  if (items.length === 0) return;
  const markedUids: Array<GroceryItemUid> = [];
  for (const item of items) {
    if (item.deleted) {
      ctx.groceryItemStore.markPendingDelete(item.uid);
    } else {
      ctx.groceryItemStore.markPendingUpsert(item.uid);
    }
    markedUids.push(item.uid);
  }
  const clearPending = () => {
    for (const uid of markedUids) ctx.groceryItemStore.clearPending(uid);
  };
  // allSettled (not Promise.all): fail-fast would let in-flight ops race the
  // clearPending call in the catch block. We wait for every op to settle first.
  //
  // All-or-nothing store semantics on failure is intentional: saveGroceryItems()
  // already succeeded, so any local cache/store divergence is temporary and
  // reconciled by the next sync. Clearing all pending marks on failure is
  // strictly better than leaving some marked — a marked UID suppresses sync
  // reconciliation until TTL, which would keep stale local state around longer.
  const opsResults = await Promise.allSettled(
    items.map((item) => (item.deleted ? ctx.cache.groceryItems.remove(item.uid) : ctx.cache.groceryItems.put(item))),
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
      ctx.groceryItemStore.delete(item.uid);
    } else {
      ctx.groceryItemStore.set(item);
    }
  }
  ctx.notifier.resourceListChanged();
  await ctx.client.notifySync();
}

/**
 * Renders a grocery list as markdown with metadata and a table of items.
 */
export function groceryListToMarkdown(list: GroceryList, items: ReadonlyArray<GroceryItem>): string {
  const lines: Array<string> = [];
  lines.push(`# ${list.name}`);
  lines.push("");
  lines.push(`**UID:** \`${list.uid}\``);
  lines.push(`**Items:** ${items.length.toString()}`);

  if (items.length > 0) {
    lines.push("");
    lines.push("| Ingredient | Qty | Aisle | Purchased |");
    lines.push("|------------|-----|-------|-----------|");
    for (const item of items) {
      const qty = item.quantity !== "" ? item.quantity : "—";
      const aisle = item.aisle !== "" ? item.aisle : "—";
      const purchased = item.purchased ? "Yes" : "No";
      lines.push(`| ${item.ingredient} | ${qty} | ${aisle} | ${purchased} |`);
    }
  }

  return lines.join("\n");
}

/**
 * Renders a single grocery item as markdown with all available fields.
 */
export function groceryItemToMarkdown(item: GroceryItem): string {
  const lines: Array<string> = [];
  lines.push(`# ${item.ingredient}`);
  lines.push("");
  lines.push(`**UID:** \`${item.uid}\``);
  lines.push(`**List:** \`${item.listUid}\``);
  if (item.quantity !== "") {
    lines.push(`**Quantity:** ${item.quantity}`);
  }
  if (item.aisle !== "") {
    lines.push(`**Aisle:** ${item.aisle}`);
  }
  lines.push(`**Purchased:** ${item.purchased ? "Yes" : "No"}`);
  if (item.instruction !== "") {
    lines.push(`**Notes:** ${item.instruction}`);
  }
  return lines.join("\n");
}
