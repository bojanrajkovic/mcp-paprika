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
 * Order: putRecipe (sync) → flush (async) → store.set (sync) → sendResourceListChanged (sync) → notifySync (async)
 * Do NOT call ctx.client.notifySync() separately in the tool handler — commitRecipe
 * already calls it.
 */
export async function commitRecipe(ctx: ServerContext, saved: Recipe): Promise<void> {
  ctx.cache.putRecipe(saved, saved.hash); // sync — buffers to memory
  await ctx.cache.flush(); // async — writes pending entries to disk
  ctx.store.set(saved); // sync — updates in-process store
  ctx.server.sendResourceListChanged(); // sync — notifies MCP clients to re-list resources
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
