import { err, ok, type Result } from "neverthrow";
import type { PantryItem, PantryItemUid } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";
import { textResult } from "./helpers.js";

export function pantryStartGuard(ctx: ServerContext): Result<void, ReturnType<typeof textResult>> {
  if (!ctx.pantryStore.hasSynced) {
    return err(textResult("Pantry is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

export function pantryItemToMarkdown(item: PantryItem): string {
  const lines: Array<string> = [];

  lines.push(`# ${item.ingredient}`);
  lines.push("");
  lines.push(`**UID:** \`${item.uid}\``);

  if (item.quantity !== "") {
    lines.push(`**Quantity:** ${item.quantity}`);
  }
  if (item.aisle !== "") {
    lines.push(`**Aisle:** ${item.aisle}`);
  }
  lines.push(`**In stock:** ${item.inStock ? "Yes" : "No"}`);
  if (item.expirationDate !== null) {
    lines.push(`**Expires:** ${item.expirationDate}`);
  }
  if (item.purchaseDate !== null) {
    lines.push(`**Purchased:** ${item.purchaseDate}`);
  }
  if (item.notes !== null) {
    lines.push("");
    lines.push(`**Notes:** ${item.notes}`);
  }

  return lines.join("\n");
}

/**
 * Persists a saved pantry item to the local cache and store, then triggers cloud sync.
 * Called by all pantry write tools after `ctx.client.savePantryItem()` returns.
 *
 * Branches on `saved.deleted`:
 * - Upsert (deleted: false): putPantryItem (sync) → flush (async) → set (sync) →
 *   sendResourceListChanged (sync) → notifySync (async)
 * - Delete (deleted: true):  removePantryItem (async) → flush (async) → delete (sync) →
 *   sendResourceListChanged (sync) → notifySync (async)
 *
 * Do NOT call `ctx.client.notifySync()` separately in the tool handler —
 * commitPantryItem already calls it.
 */
export async function commitPantryItem(ctx: ServerContext, saved: Readonly<PantryItem>): Promise<void> {
  if (saved.deleted) {
    const uid: PantryItemUid = saved.uid;
    await ctx.cache.removePantryItem(uid);
    await ctx.cache.flush();
    ctx.pantryStore.delete(uid);
    ctx.server.sendResourceListChanged();
    await ctx.client.notifySync();
  } else {
    ctx.cache.putPantryItem(saved);
    await ctx.cache.flush();
    ctx.pantryStore.set(saved);
    ctx.server.sendResourceListChanged();
    await ctx.client.notifySync();
  }
}
