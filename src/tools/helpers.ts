import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import type { Category, CategoryUid, Recipe } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";

export function textResult(text: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text" as const, text }] } as const satisfies CallToolResult;
}

export function coldStartGuard(ctx: ServerContext): Result<void, ReturnType<typeof textResult>> {
  if (!ctx.store.hasSynced) {
    return err(textResult("Recipe store is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

/**
 * Builds the "look up an entity by exact UID OR by a fuzzy text field" input
 * schema shared by read_recipe, read_grocery_list, and get_pantry_item. A
 * `z.union` of two `.strict()` objects dispatched by property presence — the
 * same shape (and the same rationale) as `mealTypeSpecSchema` in meal-helpers.
 *
 * The UID member is branded (e.g. `RecipeUidSchema`), so `args.lookup.uid` is
 * already brand-typed after parse — no cast at the store lookup. The text key
 * stays per-entity (`title` / `ingredient` / `name`) because each is the
 * accurate label for its entity. The text-member description defaults to a
 * template built from `entityLabel`/`textKey`/`textExample`; pass `textDescribe`
 * to override it verbatim when the template reads awkwardly (e.g. pantry, whose
 * natural phrasing is "Ingredient name fuzzy match", not "Pantry item ingredient
 * fuzzy match").
 */
export function uidOrTextLookupSchema<UidSchema extends z.ZodTypeAny, TextKey extends string>(config: {
  readonly uidSchema: UidSchema;
  readonly textKey: TextKey;
  readonly entityLabel: string;
  readonly textExample?: string;
  readonly textDescribe?: string;
}) {
  const { uidSchema, textKey, entityLabel, textExample, textDescribe } = config;
  const capitalized = entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);
  const uidMember = z.object({ uid: uidSchema }).strict().describe(`Exact ${entityLabel} UID, e.g. {"uid": "..."}.`);
  const textMember = z
    .object({ [textKey]: z.string().min(1) } as { [P in TextKey]: z.ZodString })
    .strict()
    .describe(textDescribe ?? `${capitalized} ${textKey} fuzzy match, e.g. {"${textKey}": "${textExample}"}.`);
  return z.union([uidMember, textMember]).describe(`Pick exactly one shape: {"uid": "..."} or {"${textKey}": "..."}.`);
}

/**
 * Normalized lookup query a caller derives from a `uidOrTextLookupSchema`
 * value: it does the type-safe `"uid" in lookup` narrowing against its own
 * concrete text key, then hands `resolveLookup` a uniform `{uid}|{text}` so
 * the resolver never needs to know the per-entity key name.
 */
export type LookupQuery<U extends string> = { readonly uid: U } | { readonly text: string };

/**
 * Structured outcome of a uid-or-text lookup. Mirrors `MealTypeResolveResult`:
 * the resolver classifies, callers format. `text_many` carries the matches so
 * the caller can render its own disambiguation lines.
 */
export type LookupOutcome<T> =
  | { readonly kind: "uid_hit"; readonly entity: T }
  | { readonly kind: "uid_miss"; readonly uid: string }
  | { readonly kind: "text_none"; readonly text: string }
  | { readonly kind: "text_one"; readonly entity: T }
  | { readonly kind: "text_many"; readonly text: string; readonly matches: ReadonlyArray<T> };

/**
 * Resolves a normalized lookup query against an entity store's `get` (exact,
 * branded UID) and `findByText` (fuzzy, 0/1/many) operations. Never formats
 * user-facing text — see `formatLookupOutcome`.
 */
export function resolveLookup<T, U extends string>(
  query: LookupQuery<U>,
  ops: { get(uid: U): T | undefined; findByText(text: string): ReadonlyArray<T> },
): LookupOutcome<T> {
  if ("uid" in query) {
    const entity = ops.get(query.uid);
    return entity === undefined ? { kind: "uid_miss", uid: query.uid } : { kind: "uid_hit", entity };
  }
  const matches = ops.findByText(query.text);
  if (matches.length === 0) return { kind: "text_none", text: query.text };
  if (matches.length === 1) return { kind: "text_one", entity: matches[0]! };
  return { kind: "text_many", text: query.text, matches };
}

/**
 * Renders a `LookupOutcome` to a `CallToolResult` with wording consistent
 * across the three lookup tools. `renderOne` produces the full single-entity
 * markdown; `disambiguationLine` produces one bullet of the multi-match list
 * (kept per-entity so each tool's existing line format is preserved).
 * `entityNoun` is the singular noun; the plural is `entityNoun + "s"`.
 */
export function formatLookupOutcome<T>(
  outcome: LookupOutcome<T>,
  config: { entityNoun: string; renderOne(entity: T): string; disambiguationLine(entity: T): string },
): CallToolResult {
  if (outcome.kind === "uid_hit" || outcome.kind === "text_one") {
    return textResult(config.renderOne(outcome.entity));
  }
  if (outcome.kind === "uid_miss") {
    return textResult(`No ${config.entityNoun} found with UID "${outcome.uid}".`);
  }
  if (outcome.kind === "text_none") {
    return textResult(`No ${config.entityNoun}s found matching "${outcome.text}".`);
  }
  const list = outcome.matches.map(config.disambiguationLine).join("\n");
  return textResult(
    `Multiple ${config.entityNoun}s match "${outcome.text}":\n${list}\n\nPlease re-invoke with a specific uid.`,
  );
}

export function recipeToMarkdown(recipe: Recipe, categoryNames: Array<string>, lastCookedAt?: string | null): string {
  const lines: Array<string> = [];

  lines.push(`# ${recipe.name}`);

  if (categoryNames.length > 0) {
    lines.push("");
    lines.push(`**Categories:** ${categoryNames.join(", ")}`);
  }

  lines.push("");
  lines.push(`**Created:** ${recipe.created}`);

  if (lastCookedAt) {
    lines.push(`**Last Cooked:** ${lastCookedAt.slice(0, 10)}`);
  }

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

export function recipeMetadataLines(recipe: Recipe, lastCookedAt?: string | null): Array<string> {
  const lines: Array<string> = [];
  const timeParts: Array<string> = [];
  if (recipe.prepTime) timeParts.push(`Prep: ${recipe.prepTime}`);
  if (recipe.cookTime) timeParts.push(`Cook: ${recipe.cookTime}`);
  if (recipe.totalTime) timeParts.push(`Total: ${recipe.totalTime}`);
  if (timeParts.length > 0) {
    lines.push(timeParts.join(" · "));
  }
  if (recipe.rating > 0) {
    lines.push(`**Rating:** ${recipe.rating.toString()}/5`);
  }
  if (lastCookedAt) {
    lines.push(`**Last Cooked:** ${lastCookedAt.slice(0, 10)}`);
  }
  if (recipe.isPinned) {
    lines.push(`**Pinned:** Yes`);
  }
  if (recipe.onGroceryList) {
    lines.push(`**On Grocery List:** Yes`);
  }
  return lines;
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
    await ctx.cache.recipes.put(saved); // async — buffers to memory with mutex
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
