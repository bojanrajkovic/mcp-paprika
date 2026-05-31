import { ok, err, type Result } from "neverthrow";
import type { Category, CategoryUid, Recipe } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";
import { coldStartGuard, textResult } from "./helpers.js";

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
  await ctx.client.notifySync();
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

/** Non-trashed recipes that reference the given category UID. */
export function recipesReferencing(ctx: ServerContext, uid: CategoryUid): Array<Recipe> {
  return ctx.store.getAll().filter((recipe) => recipe.categories.includes(uid));
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
