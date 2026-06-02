import { ok, err, type Result } from "neverthrow";
import type { Category } from "../category/types.js";
import type { CategoryUid } from "../ids.js";
import type { Recipe } from "../recipe/types.js";
import type { ServerContext } from "../types/server-context.js";
import { coldStartGuard, textResult } from "./helpers.js";
import { reindexRecipesForCategoryChange } from "../features/discover-feature.js";

/**
 * Readiness gate for every category tool. Composes `coldStartGuard` (recipe
 * store synced — `list_categories` counts recipes per category, and
 * `delete_category` scans recipes for references) with the category catalog's
 * own `hasSynced`. Mirrors the exported `aisleStartGuard`/`mealStartGuard`
 * pattern: returns a `Result<void, CallToolResult>` consumed via `.match()`.
 */
export function categoryStartGuard(ctx: ServerContext): Result<void, ReturnType<typeof textResult>> {
  return coldStartGuard(ctx).andThen(() =>
    ctx.categoryStore.hasSynced
      ? ok(undefined)
      : err(textResult("The category catalog is still syncing; try again in a moment.")),
  );
}

/**
 * Persists a category create/rename/re-parent locally after the client POST.
 * Mark-pending-upsert-first ordering mirrors `commitRecipe`/`commitPantryItem`
 * so an in-flight sync that observes the cache mid-commit skips reconciling our
 * UID against a stale snapshot. No `resourceListChanged()` — categories have no
 * MCP resource surface, and recipe rendering resolves category names through
 * `categoryStore` on read, so a rename is reflected on the next recipe read.
 *
 * Re-embeds recipes assigned to the category (a category's display name is part
 * of their embedding text) at the chokepoint, BEFORE notifySync — mirroring
 * `commitRecipe`'s `maintainRecipeIndex`. A notifySync rejection must not skip
 * the re-index and leave a rename matching on the old name with no recovery (a
 * repeat rename would no-op once the store already holds the new name).
 */
export async function commitCategoryUpsert(ctx: ServerContext, category: Category): Promise<void> {
  ctx.categoryStore.markPendingUpsert(category.uid);
  try {
    await ctx.cache.categories.put(category);
    await ctx.cache.flush();
  } catch (e) {
    ctx.categoryStore.clearPending(category.uid);
    throw e;
  }
  ctx.categoryStore.set(category);
  await maintainCategoryRecipeIndex(ctx, category.uid);
  await ctx.client.notifySync();
}

/**
 * Keep the semantic-search index in step with a category write. No-op when
 * semantic search is disabled. Re-embeds every live recipe assigned to the
 * category via {@link reindexRecipesForCategoryChange}: a create has no
 * referencing recipes (early no-op), a re-parent leaves the display name
 * unchanged so `indexRecipes` skips by content hash, and only a true rename
 * re-embeds. Best-effort — a re-index failure must not fail a write already
 * committed to Paprika, so it's logged, not thrown.
 */
async function maintainCategoryRecipeIndex(ctx: ServerContext, uid: CategoryUid): Promise<void> {
  if (ctx.vectorStore === null) return;
  try {
    await reindexRecipesForCategoryChange(ctx.vectorStore, ctx.store, ctx.categoryStore, [uid]);
  } catch (err) {
    ctx.log.warn(
      { err, uid },
      "category re-index failed after write; embeddings may be stale until the next reconcile",
    );
  }
}

/**
 * Persists a category soft-delete locally after the client's tombstone POST.
 * Mark-pending-delete-first, single flush, then store delete + notifySync (same
 * shape as {@link commitCategoryUpsert}). The pending-delete mark shields the
 * UID from resurrection by a sync snapshot taken before the delete propagated.
 */
export async function commitCategoryDelete(ctx: ServerContext, category: Category): Promise<void> {
  ctx.categoryStore.markPendingDelete(category.uid);
  try {
    await ctx.cache.categories.remove(category.uid);
    await ctx.cache.flush();
  } catch (e) {
    ctx.categoryStore.clearPending(category.uid);
    throw e;
  }
  ctx.categoryStore.delete(category.uid);
  await ctx.client.notifySync();
}

/**
 * Recipes that reference the given category UID — INCLUDING trashed ones. The
 * `delete_category` guard blocks on these so deleting a category can't leave a
 * dangling UID on a recipe the user later restores from the trash.
 */
export function recipesReferencing(ctx: ServerContext, uid: CategoryUid): Array<Recipe> {
  return ctx.store.getAllIncludingTrashed().filter((recipe) => recipe.categories.includes(uid));
}

/**
 * True if re-parenting `categoryUid` under `newParentUid` would create a cycle —
 * i.e. `newParentUid` is the category itself or one of its descendants. Walks
 * up the parent chain from `newParentUid`; if it reaches `categoryUid`, the new
 * parent sits below the category, so the link would close a loop. The `seen`
 * set guards against an already-corrupt chain looping forever.
 */
export function wouldCreateCycle(ctx: ServerContext, categoryUid: CategoryUid, newParentUid: string): boolean {
  let cursor: string | null = newParentUid;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (cursor === categoryUid) return true;
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const parent = ctx.categoryStore.get(cursor as CategoryUid);
    cursor = parent ? parent.parentUid : null;
  }
  return false;
}

/** Highest `orderFlag` across all known categories, or -1 when none exist. */
export function maxCategoryOrderFlag(ctx: ServerContext): number {
  let max = -1;
  for (const category of ctx.categoryStore.getAll()) {
    if (category.orderFlag > max) max = category.orderFlag;
  }
  return max;
}
