import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import type { Category } from "../category/types.js";
import type { CategoryUid, RecipeUid } from "../ids.js";
import type { Recipe } from "../recipe/types.js";
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
 * schema shared by read_recipe, read_grocery_list, and read_pantry_item. A
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

  lines.push("");
  lines.push(`**UID:** \`${recipe.uid}\``);

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

  // Maintain the semantic-search index locally. The sync re-index path can't
  // cover tool writes: the UID is pending here, so the recipe diff filters it
  // out (sync.ts) and never re-embeds it. A trashed recipe is removed from the
  // index (and re-added on restore — the upsert branch fires when inTrash flips
  // back to false). Best-effort: a re-index failure must not fail a write that
  // already succeeded against Paprika, so it's logged, not thrown.
  //
  // Runs BEFORE notifySync: the index tracks the local store, and a notifySync
  // rejection (a network blip) must not skip index upkeep and leave a
  // created/edited/trashed recipe missing or stale in discover_recipes while the
  // write is already visible locally.
  await maintainRecipeIndex(ctx, saved);

  await ctx.client.notifySync(); // async — signals Paprika cloud to propagate
}

/**
 * Keep the vector index in step with a local recipe write. No-op when semantic
 * search is disabled (`vectorStore === null`). Trashed recipes are removed so
 * they can't surface in `discover_recipes`; live recipes are (re-)embedded via
 * the vector store's content-hash change detection (a no-op when the embedding
 * text is unchanged). Never throws — failures are logged so the recipe write,
 * already committed and notified, still reports success.
 */
async function maintainRecipeIndex(ctx: ServerContext, saved: Recipe): Promise<void> {
  if (saved.inTrash) {
    await removeRecipeFromIndex(ctx, saved.uid);
    return;
  }
  if (ctx.vectorStore === null) return;
  try {
    await ctx.vectorStore.indexRecipe(saved, ctx.categoryStore.resolveNames(saved.categories));
  } catch (err) {
    ctx.log.warn(
      { err, uid: saved.uid },
      "vector index maintenance failed after recipe write; embedding may be stale until the next full re-index",
    );
  }
}

/**
 * Drop a recipe from the semantic-search index, best-effort. No-op when search is
 * disabled (`vectorStore === null`). Shared by the trash branch of
 * `maintainRecipeIndex`, by `commitRecipeHardDelete` via that branch, and by
 * `reconcileLocalRecipeAbsent` (which has only a UID, not a full `Recipe`). A failure
 * is logged, never thrown — the caller's Paprika write or local reconcile already
 * succeeded and must still report success.
 */
async function removeRecipeFromIndex(ctx: ServerContext, uid: RecipeUid): Promise<void> {
  if (ctx.vectorStore === null) return;
  try {
    await ctx.vectorStore.removeRecipe(uid);
  } catch (err) {
    ctx.log.warn({ err, uid }, "vector index removal failed; the embedding may linger until the next full re-index");
  }
}

// Hard-delete (empty-trash) commit: the recipe has been permanently removed
// server-side, so purge it locally too. Unlike commitRecipe — whose soft-delete
// branch still put+sets the recipe so it stays in the store (hidden, but
// recoverable) — this REMOVES it from cache and store. markPendingDelete shields
// the UID from sync resurrection until the canonical list drops it, mirroring the
// soft-delete branch's ordering: mark first (before any await) so an in-flight
// sync cycle observing the cache mid-commit still skips our UID (#125).
export async function commitRecipeHardDelete(ctx: ServerContext, saved: Recipe): Promise<void> {
  ctx.store.markPendingDelete(saved.uid);
  try {
    await ctx.cache.recipes.remove(saved.uid); // async — drops from memory buffer with mutex
    await ctx.cache.flush(); // async — persists the removal to disk
  } catch (e) {
    ctx.store.clearPending(saved.uid); // don't suppress canonical reconciliation on a failed commit
    throw e;
  }
  ctx.store.delete(saved.uid); // sync — removes from in-process store
  ctx.notifier.resourceListChanged(); // sync — notifies MCP clients

  // Purge from the semantic-search index too — a hard-deleted recipe must not
  // linger as a searchable vector. Best-effort (see `maintainRecipeIndex`); a
  // trashed recipe was already removed at soft-delete, so this is typically a
  // no-op, but purge_recipe can also run on app-trashed recipes never seen here.
  // Runs BEFORE notifySync so a notify failure can't skip the purge.
  await maintainRecipeIndex(ctx, saved);

  await ctx.client.notifySync(); // async — signals Paprika cloud to propagate
}

// Reconcile the local cache + store to authoritative state that a READ-path
// `getRecipe` revealed, WITHOUT a Paprika write. restore_recipe and purge_recipe
// trust getRecipe over the local store for their *decision* (the store lags app-side
// trash actions by a sync cycle); when they then DECLINE to act — the recipe is
// already active, not in the trash, or gone — these leave the store agreeing with
// that same truth instead of serving a stale row (a wrong inTrash flag, or a phantom)
// until the next sync cycle heals it.
//
// This is a canonical PULL, not a local-origin write, so unlike commitRecipe it does
// NOT touch the pending-write marks — there is no in-flight POST of ours to protect
// from rollback; aligning toward canonical is exactly what sync itself does — and does
// NOT call notifySync (nothing changed server-side). Best-effort: a cache failure is
// logged and the decision still stands (sync remains the durable backstop), so a
// hiccup can't turn a correct "already active" into an error. resourceListChanged
// fires only when local state actually moved.

/**
 * Align the local copy of `authoritative` (a recipe `getRecipe` just returned) to it.
 * No-op when the store already holds the same content (`hash`) and trash state.
 *
 * @returns true if it mutated local state, false if the store already agreed (or the
 *   local write failed and was left for sync).
 */
export async function reconcileLocalRecipe(ctx: ServerContext, authoritative: Recipe): Promise<boolean> {
  const local = ctx.store.get(authoritative.uid);
  if (local !== undefined && local.hash === authoritative.hash && local.inTrash === authoritative.inTrash) {
    return false;
  }
  try {
    await ctx.cache.recipes.put(authoritative);
    await ctx.cache.flush();
  } catch (err) {
    ctx.log.warn({ err, uid: authoritative.uid }, "local recipe reconcile failed; sync will heal it next cycle");
    return false;
  }
  ctx.store.set(authoritative);
  ctx.notifier.resourceListChanged();
  await maintainRecipeIndex(ctx, authoritative);
  return true;
}

/**
 * Companion to {@link reconcileLocalRecipe} for a 404: Paprika no longer has the
 * recipe (never existed, or already purged — possibly by another client), so drop any
 * stale local copy a later read/search would otherwise serve as a phantom. No-op when
 * the store already lacks it.
 *
 * @returns true if it removed a local row, false if the store already lacked it (or
 *   the local removal failed and was left for sync).
 */
export async function reconcileLocalRecipeAbsent(ctx: ServerContext, uid: RecipeUid): Promise<boolean> {
  if (ctx.store.get(uid) === undefined) {
    return false;
  }
  try {
    await ctx.cache.recipes.remove(uid);
    await ctx.cache.flush();
  } catch (err) {
    ctx.log.warn({ err, uid }, "local recipe reconcile (removal) failed; sync will heal it next cycle");
    return false;
  }
  ctx.store.delete(uid);
  ctx.notifier.resourceListChanged();
  await removeRecipeFromIndex(ctx, uid);
  return true;
}

/**
 * Resolves category references to CategoryUid values. Each ref is matched
 * UID-first (exact match against a known category's uid), then by display name
 * (case-insensitive). A category UID and a display name are both unconstrained
 * strings — `CategoryUidSchema` carries no format — so they can't be told apart
 * by the schema; the union lives here. Lets callers pass either the UID returned
 * by `list_categories` or a human-readable name.
 *
 * @returns uids — matched UIDs in the same order as input refs
 *          unknown — refs that matched neither a UID nor a name (caller should warn)
 */
export function resolveCategoryRefs(
  all: Array<Category>,
  refs: Array<string>,
): { uids: Array<CategoryUid>; unknown: Array<string> } {
  const byUid = new Set<string>(all.map((c) => c.uid));
  const uids: Array<CategoryUid> = [];
  const unknown: Array<string> = [];
  for (const ref of refs) {
    if (byUid.has(ref)) {
      uids.push(ref as CategoryUid);
      continue;
    }
    const lower = ref.toLowerCase();
    const match = all.find((c) => c.name.toLowerCase() === lower);
    if (match) {
      uids.push(match.uid);
    } else {
      unknown.push(ref);
    }
  }
  return { uids, unknown };
}
