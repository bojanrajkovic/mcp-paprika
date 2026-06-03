// pattern: Imperative Shell
import { DateTime } from "luxon";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import type { MealUid } from "../ids.js";
import type { MealType } from "../meal-type/types.js";
import type { Meal } from "../meal/types.js";
import type { ServerContext } from "../types/server-context.js";

import { MealTypeUidSchema } from "../ids.js";
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

/**
 * Structured result of resolving a `mealTypeSpecSchema` union variant against
 * `mealTypeStore`. The resolver never formats user-facing text — it returns the
 * resolved `MealType` on a hit, or one of three error reasons callers map to
 * their own message style (terse for `update_meal`, per-index-prefixed for
 * `plan_meals`, single-filter for `list_meal_history`). `unknown_name` carries
 * `knownNames` so callers can list the available types as a remediation hint.
 */
export type MealTypeResolveResult =
  | { readonly ok: true; readonly resolved: MealType }
  | { readonly ok: false; readonly reason: "unknown_uid"; readonly uid: string }
  | {
      readonly ok: false;
      readonly reason: "unknown_name";
      readonly name: string;
      readonly knownNames: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly reason: "unknown_builtin"; readonly index: number };

/**
 * Resolve a meal-type spec (`{name} | {uid} | {builtin}`) against `mealTypeStore`.
 * Shared by the read side (`meal-history.ts`) and the write side (`meal-writes.ts`)
 * so the dispatch logic lives in exactly one place. Built-in meal types carry
 * `originalType: 0..3` (Breakfast/Lunch/Dinner/Snacks); user-created custom types
 * carry `originalType: null`. Callers derive their own projection from the resolved
 * `MealType`: the read side reads `originalType` to surface legacy (null-`typeUid`)
 * meals, the write side sends `originalType ?? 0` as the vestigial wire integer.
 */
export function resolveMealTypeSpec(
  ctx: ServerContext,
  spec: z.infer<typeof mealTypeSpecSchema>,
): MealTypeResolveResult {
  if ("uid" in spec) {
    const resolved = ctx.mealTypeStore.getAll().find((mt) => mt.uid === spec.uid);
    if (resolved === undefined) {
      return { ok: false, reason: "unknown_uid", uid: spec.uid };
    }
    return { ok: true, resolved };
  }
  if ("name" in spec) {
    const resolved = ctx.mealTypeStore.resolveByName(spec.name);
    if (resolved === undefined) {
      return {
        ok: false,
        reason: "unknown_name",
        name: spec.name,
        knownNames: ctx.mealTypeStore.getAll().map((mt) => mt.name),
      };
    }
    return { ok: true, resolved };
  }
  const builtinInt = spec.builtin;
  const resolved = ctx.mealTypeStore.getAll().find((mt) => mt.originalType === builtinInt);
  if (resolved === undefined) {
    return { ok: false, reason: "unknown_builtin", index: builtinInt };
  }
  return { ok: true, resolved };
}

/**
 * Builds a stateful, per-date `order_flag` assigner for a batch of new meals.
 *
 * `order_flag` sequences PER CALENDAR DATE — all meal types on a given day share
 * one sequence, NOT a separate sequence per (date, type). The wire capture is
 * decisive: two same-date meals of different types post as `order_flag` 0 and 1,
 * while two same-type meals on different dates both post as 0
 * (`docs/wire-captures/meals.har.json`). `MealStore.getMaxOrderFlagOn(date)`
 * seeds each date from the persisted store state; the returned closure then
 * hands out an increasing counter per date so multiple meals in ONE batch that
 * share a date get sequential flags. A per-batch counter is required because the
 * built meals are not yet in the store — without it, two same-date items in one
 * batch would both read the same seed and collide.
 *
 * Shared by `plan_meals` (Stage 2) and `schedule_menu` so the per-date
 * sequencing lives in exactly one tested place.
 */
export function makeMealOrderFlagAssigner(ctx: ServerContext): (date: string) => number {
  const next = new Map<string, number>();
  return (date) => {
    const flag = next.get(date) ?? (ctx.mealStore.getMaxOrderFlagOn(date) ?? -1) + 1;
    next.set(date, flag + 1);
    return flag;
  };
}

export function mealStartGuard(ctx: ServerContext): Result<void, ReturnType<typeof textResult>> {
  // Both stores must be synced. The mealtype store is required by the type DU
  // resolver (`resolveMealTypeSpec`, used by both `meal-writes.ts` and
  // `meal-history.ts`); without it, every "Dinner" / "Lunch" lookup returns
  // undefined and the user sees "Unknown meal type" errors that look like input
  // mistakes but are actually a cold-cache state. Guarding both up front turns
  // that into a clear "still syncing" message instead.
  if (!ctx.mealStore.hasSynced || !ctx.mealTypeStore.hasSynced) {
    return err(textResult("Meal data is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

/**
 * Sync guard for the read-only `list_meal_types` tool. Narrower than
 * `mealStartGuard`, which requires BOTH the meal and meal-type stores synced
 * (its callers resolve meal-type specs while reading meals). Listing the
 * meal-type catalog only touches `mealTypeStore`, so gating on the meal store
 * too would surface a misleading "not yet synced" when only meals are cold.
 * Mirrors `aisleStartGuard` (the other reference-catalog list guard).
 */
export function mealTypeStartGuard(ctx: ServerContext): Result<void, ReturnType<typeof textResult>> {
  if (!ctx.mealTypeStore.hasSynced) {
    return err(textResult("Meal types are not yet synced. Try again in a few seconds."));
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

/**
 * Resolve a meal's display names from context, then render its markdown card.
 * Wraps the pure `mealToMarkdown` with the ctx-dependent lookups every meal-write
 * response path repeats: typeName from `mealTypeStore` (with a `Type N` fallback
 * for unknown or legacy types), and recipeName from the recipe store. Meals with
 * `typeUid: null` (legacy, predating the mealtypes catalog) fall straight through
 * to the integer-labelled fallback; meals with `recipeUid: null` render as
 * freeform. Building the (tiny) type-name map per call keeps the signature to
 * `(ctx, meal)` — the catalog has only a handful of entries.
 */
export function renderMealCard(ctx: ServerContext, meal: Readonly<Meal>): string {
  const typeNameByUid = new Map<string, string>();
  for (const mt of ctx.mealTypeStore.getAll()) typeNameByUid.set(mt.uid, mt.name);
  const typeName =
    meal.typeUid !== null
      ? (typeNameByUid.get(meal.typeUid) ?? `Type ${meal.type.toString()}`)
      : `Type ${meal.type.toString()}`;
  const recipeName = meal.recipeUid !== null ? (ctx.store.get(meal.recipeUid)?.name ?? null) : null;
  return mealToMarkdown(meal, typeName, recipeName);
}

function formatMealLine(
  meal: Readonly<Meal>,
  typeNames: Map<string, string>,
  typeByOriginalType: Map<number, string>,
): { typeName: string; entry: string } {
  // typeUid is the primary lookup, but older meals (predating Paprika's
  // mealtypes catalog) carry typeUid: null and rely on the `type` integer
  // (which corresponds to MealType.originalType in the catalog).
  const lookup = meal.typeUid !== null ? typeNames.get(meal.typeUid) : typeByOriginalType.get(meal.type);
  const typeName = lookup ?? `Type ${meal.type.toString()}`;
  const isFreeform = meal.recipeUid === null || meal.recipeUid === "";
  const entry = isFreeform ? `${meal.name} *(freeform)*` : meal.name;
  return { typeName, entry };
}

/**
 * Render meals as a date-grouped calendar section: one `### EEE dd` heading per
 * calendar day — in the order the meals are supplied, so the CALLER controls
 * chronology (read_meal_plan sorts ascending; recall views may sort however) —
 * then one `- **Type** · entry, entry` bullet per meal type on that day, with
 * freeform (non-recipe) meals annotated. Returns just the grouped body; callers
 * prepend their own summary header. Shared by read_meal_plan and
 * search_meal_history (extracted from the former list_meal_history renderer).
 */
export function renderMealsGroupedByDate(ctx: ServerContext, meals: ReadonlyArray<Readonly<Meal>>): string {
  const typeNames = new Map<string, string>();
  const typeByOriginalType = new Map<number, string>();
  for (const mt of ctx.mealTypeStore.getAll()) {
    typeNames.set(mt.uid, mt.name);
    // Only built-in types have a non-null originalType; custom types are
    // looked up by typeUid alone.
    if (mt.originalType !== null) {
      typeByOriginalType.set(mt.originalType, mt.name);
    }
  }

  const grouped = new Map<string, Array<{ typeName: string; entry: string }>>();
  for (const meal of meals) {
    const dateKey = meal.date.slice(0, 10);
    let entries = grouped.get(dateKey);
    if (entries === undefined) {
      entries = [];
      grouped.set(dateKey, entries);
    }
    entries.push(formatMealLine(meal, typeNames, typeByOriginalType));
  }

  const lines: Array<string> = [];
  for (const [dateKey, entries] of grouped) {
    const dt = DateTime.fromISO(dateKey, { zone: "utc" });
    const dayLabel = dt.isValid ? dt.toFormat("EEE dd") : dateKey;
    lines.push("");
    lines.push(`### ${dayLabel}`);

    const byType = new Map<string, Array<string>>();
    for (const { typeName, entry } of entries) {
      let typeEntries = byType.get(typeName);
      if (typeEntries === undefined) {
        typeEntries = [];
        byType.set(typeName, typeEntries);
      }
      typeEntries.push(entry);
    }
    for (const [typeName, typeEntries] of byType) {
      lines.push(`- **${typeName}** · ${typeEntries.join(", ")}`);
    }
  }
  return lines.join("\n");
}
