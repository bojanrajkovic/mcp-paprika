// pattern: Imperative Shell
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import type { Meal, MealUid } from "../paprika/types.js";
import { MealTypeUidSchema } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";
import { textResult } from "./helpers.js";

/**
 * Union for selecting a meal type by name, UID, or built-in index. Three
 * strict-object variants; consumers dispatch via property-presence checks
 * (`"uid" in spec`, `"name" in spec`, else `builtin`). This shape matches
 * the original inline schema in meal-history.ts byte-for-byte after
 * hoisting — meal-history.ts's resolver is unchanged by the swap.
 *
 *   {name: string}    → display name; resolution is case-insensitive; whitespace trimmed via transform.
 *   {uid: MealTypeUid}→ branded MealType UID, direct lookup.
 *   {builtin: int}    → integer 0=Breakfast 1=Lunch 2=Dinner 3=Snacks.
 *
 * Exported for use by both meal-history.ts (read side) and meal-writes.ts
 * (write side). Write tools produce richer error messages naming the known
 * meal types and the {uid}/{builtin} discriminators when resolution fails.
 */
export const mealTypeSpecSchema = z.union([
  z
    .object({
      name: z
        .string()
        .min(1)
        .transform((s) => s.trim()),
    })
    .strict(),
  z.object({ uid: MealTypeUidSchema }).strict(),
  z.object({ builtin: z.number().int().min(0).max(3) }).strict(),
]);

export function mealStartGuard(ctx: ServerContext): Result<void, ReturnType<typeof textResult>> {
  if (!ctx.mealStore.hasSynced) {
    return err(textResult("Meal history is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

/**
 * Persists a saved meal to the local cache and store, then triggers cloud sync.
 * Branches on `saved.deleted`:
 *   upsert: markPendingUpsert(uid) → cache.meals.put → cache.flush → store.set → notifySync
 *   delete: markPendingDelete(uid) → cache.meals.remove → cache.flush → store.delete → notifySync
 *
 * No `ctx.notifier.resourceListChanged()` — meals have no resource surface.
 * Do NOT call `ctx.client.notifySync()` separately in the tool handler.
 */
export async function commitMeal(ctx: ServerContext, saved: Readonly<Meal>): Promise<void> {
  if (saved.deleted) {
    const uid: MealUid = saved.uid;
    ctx.mealStore.markPendingDelete(uid);
    try {
      await ctx.cache.meals.remove(uid);
      await ctx.cache.flush();
    } catch (e) {
      ctx.mealStore.clearPending(uid);
      throw e;
    }
    ctx.mealStore.delete(uid);
    await ctx.client.notifySync();
  } else {
    ctx.mealStore.markPendingUpsert(saved.uid);
    try {
      await ctx.cache.meals.put(saved);
      await ctx.cache.flush();
    } catch (e) {
      ctx.mealStore.clearPending(saved.uid);
      throw e;
    }
    ctx.mealStore.set(saved);
    await ctx.client.notifySync();
  }
}

/**
 * Batch variant of `commitMeal`. Commits N meals with a single cache.flush()
 * and a single notifySync(). Marks all pending writes before any cache I/O;
 * on cache failure, clears ALL marked UIDs before re-throwing so no UID is
 * left shielded until TTL. No resourceListChanged().
 */
export async function commitMealsBatch(ctx: ServerContext, items: ReadonlyArray<Readonly<Meal>>): Promise<void> {
  if (items.length === 0) return;
  const markedUids: Array<MealUid> = [];
  for (const item of items) {
    if (item.deleted) {
      ctx.mealStore.markPendingDelete(item.uid);
    } else {
      ctx.mealStore.markPendingUpsert(item.uid);
    }
    markedUids.push(item.uid);
  }
  const clearPending = () => {
    for (const uid of markedUids) ctx.mealStore.clearPending(uid);
  };
  // allSettled (not Promise.all): fail-fast would let in-flight ops race the
  // clearPending call in the catch block. We wait for every op to settle first.
  const opsResults = await Promise.allSettled(
    items.map((item) => (item.deleted ? ctx.cache.meals.remove(item.uid) : ctx.cache.meals.put(item))),
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
      ctx.mealStore.delete(item.uid);
    } else {
      ctx.mealStore.set(item);
    }
  }
  await ctx.client.notifySync();
}

/**
 * Renders a single meal as a markdown card suitable for inclusion in tool
 * responses. Callers are responsible for resolving `typeName` and `recipeName`
 * from the contexts they hold.
 */
export function mealToMarkdown(meal: Readonly<Meal>, typeName: string, recipeName: string | null): string {
  const lines: Array<string> = [];
  lines.push(`# ${meal.name}`);
  lines.push("");
  lines.push(`**UID:** \`${meal.uid}\``);
  lines.push(`**Date:** ${meal.date}`);
  lines.push(`**Type:** ${typeName}`);
  if (meal.recipeUid !== null && recipeName !== null) {
    lines.push(`**Recipe:** ${recipeName} (\`${meal.recipeUid}\`)`);
  } else if (meal.recipeUid === null) {
    lines.push(`**Recipe:** _(freeform)_`);
  }
  if (meal.scale !== null && meal.scale !== "") {
    lines.push(`**Scale:** ${meal.scale}`);
  }
  return lines.join("\n");
}
