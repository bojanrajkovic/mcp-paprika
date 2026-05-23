import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";
import type { Category, CategoryUid, Recipe } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";

export function textResult(text: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text" as const, text }] } as const satisfies CallToolResult;
}

export function coldStartGuard(ctx: ServerContext): Result<void, ReturnType<typeof textResult>> {
  if (ctx.store.size === 0) {
    return err(textResult("Recipe store is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

export function recipeToMarkdown(recipe: Recipe, categoryNames: Array<string>): string {
  const lines: Array<string> = [];

  lines.push(`# ${recipe.name}`);

  if (categoryNames.length > 0) {
    lines.push("");
    lines.push(`**Categories:** ${categoryNames.join(", ")}`);
  }

  lines.push("");
  lines.push(`**Created:** ${recipe.created}`);

  if (recipe.rating > 0) {
    lines.push(`**Rating:** ${recipe.rating.toString()}/5`);
  }

  if (recipe.isPinned) {
    lines.push(`**Pinned:** Yes`);
  }

  if (recipe.onGroceryList) {
    lines.push(`**On Grocery List:** Yes`);
  }

  if (recipe.onFavorites) {
    lines.push(`**On Favorites:** Yes`);
  }

  if (recipe.description) {
    lines.push("");
    lines.push(recipe.description);
  }

  const timeParts: Array<string> = [];
  if (recipe.prepTime) timeParts.push(`Prep: ${recipe.prepTime}`);
  if (recipe.cookTime) timeParts.push(`Cook: ${recipe.cookTime}`);
  if (recipe.totalTime) timeParts.push(`Total: ${recipe.totalTime}`);
  if (timeParts.length > 0) {
    lines.push("");
    lines.push(timeParts.join(" · "));
  }

  if (recipe.servings) {
    lines.push("");
    lines.push(`**Servings:** ${recipe.servings}`);
  }

  if (recipe.difficulty) {
    lines.push("");
    lines.push(`**Difficulty:** ${recipe.difficulty}`);
  }

  lines.push("");
  lines.push("## Ingredients");
  lines.push("");
  lines.push(recipe.ingredients);

  lines.push("");
  lines.push("## Directions");
  lines.push("");
  lines.push(recipe.directions);

  if (recipe.notes) {
    lines.push("");
    lines.push("## Notes");
    lines.push("");
    lines.push(recipe.notes);
  }

  if (recipe.nutritionalInfo) {
    lines.push("");
    lines.push("## Nutritional Info");
    lines.push("");
    lines.push(recipe.nutritionalInfo);
  }

  if (recipe.source) {
    lines.push("");
    if (recipe.sourceUrl) {
      lines.push(`**Source:** [${recipe.source}](${recipe.sourceUrl})`);
    } else {
      lines.push(`**Source:** ${recipe.source}`);
    }
  } else if (recipe.sourceUrl) {
    lines.push("");
    lines.push(`**Source:** ${recipe.sourceUrl}`);
  }

  return lines.join("\n");
}

/**
 * Persists a saved recipe to the local cache and store, then triggers cloud sync.
 * Called by all write tools after ctx.client.saveRecipe() returns.
 *
 * Order: putRecipe (sync) → flush (async) → store.set (sync) → markPending* (sync) →
 * notifier.resourceListChanged (sync) → notifySync (async)
 *
 * The pending-write mark protects this UID from sync-cycle reconciliation
 * during the race window before Paprika's canonical list reflects the write.
 * `inTrash: true` is the recipe-side soft-delete, so we mark pending-delete
 * in that case; otherwise it's an upsert.
 *
 * Do NOT call ctx.client.notifySync() separately in the tool handler — commitRecipe
 * already calls it.
 */
export async function commitRecipe(ctx: ServerContext, saved: Recipe): Promise<void> {
  // Mark the pending write BEFORE any cache I/O. The await on putRecipe yields
  // to the event loop and lets an in-flight sync cycle observe the cache mid-
  // commit; if the mark isn't set yet, sync's pending-write filter sees nothing
  // and would still treat our UID as an orphan or stale entry. Setting the mark
  // first closes that window for both upserts and soft-deletes.
  if (saved.inTrash) {
    ctx.store.markPendingDelete(saved.uid);
  } else {
    ctx.store.markPendingUpsert(saved.uid);
  }
  try {
    await ctx.cache.putRecipe(saved, saved.hash); // async — buffers to memory with mutex
    await ctx.cache.flush(); // async — writes pending entries to disk
  } catch (e) {
    // Local commit failed before reaching the store/notifier. Clear the pending
    // mark so sync isn't permanently filtered for this UID until TTL expiry;
    // failed commits shouldn't suppress canonical reconciliation.
    ctx.store.clearPending(saved.uid);
    throw e;
  }
  ctx.store.set(saved); // sync — updates in-process store
  ctx.notifier.resourceListChanged(); // sync — notifies MCP clients (single server or broadcast)
  await ctx.client.notifySync(); // async — signals Paprika cloud to propagate
}

/**
 * Resolves human-readable category display names to CategoryUid values.
 * Case-insensitive linear scan of all known categories.
 *
 * @returns uids — matched UIDs in the same order as input names
 *          unknown — names that had no matching category (caller should warn)
 */
export function resolveCategoryNames(
  all: Array<Category>,
  names: Array<string>,
): { uids: Array<CategoryUid>; unknown: Array<string> } {
  const uids: Array<CategoryUid> = [];
  const unknown: Array<string> = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    const match = all.find((c) => c.name.toLowerCase() === lower);
    if (match) {
      uids.push(match.uid);
    } else {
      unknown.push(name);
    }
  }
  return { uids, unknown };
}
