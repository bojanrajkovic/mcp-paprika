import { err, ok, type Result } from "neverthrow";
import type { PantryItemUid } from "../ids.js";
import type { PantryItem } from "../pantry/types.js";
import type { ServerContext } from "../types/server-context.js";
import { textResult } from "./helpers.js";

export function pantryStartGuard(ctx: ServerContext): Result<void, ReturnType<typeof textResult>> {
  if (!ctx.pantryStore.hasSynced) {
    return err(textResult("Pantry is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

// notes is on PantryItem (the GET wire includes it) but no Paprika client
// exposes a UI for pantry notes and no captured item has a non-null value.
// Omitted from display and from POST payloads; retained in the schema so
// the parser doesn't reject the field if the server starts populating it.
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
  return lines.join("\n");
}

/**
 * Batch variant of `commitPantryItem`. Commits multiple pantry items with a single
 * cache flush and a single `notifySync`. No `resourceListChanged` — pantry has no
 * MCP resource surface.
 *
 * Marks all pending writes before any cache I/O. On cache failure, clears all
 * pending marks before re-throwing so no UID is left shielded until TTL.
 */
export async function commitPantryItemsBatch(
  ctx: ServerContext,
  items: ReadonlyArray<Readonly<PantryItem>>,
): Promise<void> {
  if (items.length === 0) return;
  const markedUids: Array<PantryItemUid> = [];
  for (const item of items) {
    if (item.deleted) {
      ctx.pantryStore.markPendingDelete(item.uid);
    } else {
      ctx.pantryStore.markPendingUpsert(item.uid);
    }
    markedUids.push(item.uid);
  }
  const clearPending = () => {
    for (const uid of markedUids) ctx.pantryStore.clearPending(uid);
  };
  // allSettled (not Promise.all): fail-fast would let in-flight ops race the
  // clearPending call in the catch block. We wait for every op to settle first.
  //
  // All-or-nothing store semantics on failure is intentional: savePantryItems()
  // already succeeded, so any local cache/store divergence is temporary and
  // reconciled by the next sync. Clearing all pending marks on failure avoids
  // suppressing sync reconciliation until TTL.
  const opsResults = await Promise.allSettled(
    items.map((item) => (item.deleted ? ctx.cache.pantry.remove(item.uid) : ctx.cache.pantry.put(item))),
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
      ctx.pantryStore.delete(item.uid);
    } else {
      ctx.pantryStore.set(item);
    }
  }
  await ctx.client.notifySync();
}

/**
 * Persists a saved pantry item to the local cache and store, then triggers cloud sync.
 * Called by all pantry write tools after `ctx.client.savePantryItems()` returns.
 *
 * Branches on `saved.deleted`:
 * - Upsert (deleted: false): putPantryItem (sync) → flush (async) → set (sync) → notifySync (async)
 * - Delete (deleted: true):  removePantryItem (async) → flush (async) → delete (sync) → notifySync (async)
 *
 * Do NOT call `ctx.client.notifySync()` separately in the tool handler —
 * commitPantryItem already calls it.
 */
export async function commitPantryItem(ctx: ServerContext, saved: Readonly<PantryItem>): Promise<void> {
  // Mark the pending write BEFORE any cache I/O so an in-flight sync cycle
  // that observes the cache mid-commit (between put/remove and flush, or
  // between flush and pantryStore.set/delete) sees the pending-write flag
  // and skips reconciling our UID. See commitRecipe for the same rationale.
  // If cache I/O throws, clear the pending mark before re-throwing — failed
  // local commits shouldn't suppress canonical reconciliation until TTL.
  if (saved.deleted) {
    const uid: PantryItemUid = saved.uid;
    ctx.pantryStore.markPendingDelete(uid);
    try {
      await ctx.cache.pantry.remove(uid);
      await ctx.cache.flush();
    } catch (e) {
      ctx.pantryStore.clearPending(uid);
      throw e;
    }
    ctx.pantryStore.delete(uid);
    await ctx.client.notifySync();
  } else {
    ctx.pantryStore.markPendingUpsert(saved.uid);
    try {
      await ctx.cache.pantry.put(saved);
      await ctx.cache.flush();
    } catch (e) {
      ctx.pantryStore.clearPending(saved.uid);
      throw e;
    }
    ctx.pantryStore.set(saved);
    await ctx.client.notifySync();
  }
}
