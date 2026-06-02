// pattern: Imperative Shell
import { toMessage } from "../utils/log.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MealUidSchema, RecipeUidSchema } from "../ids.js";
import type { Meal } from "../meal/types.js";
import { textResult } from "./helpers.js";
import {
  commitMeal,
  commitMealsBatch,
  makeMealOrderFlagAssigner,
  mealStartGuard,
  mealTypeSpecSchema,
  renderMealCard,
  resolveMealTypeSpec,
} from "./meal-helpers.js";
import { parseCalendarDayWire } from "../utils/dates.js";
import type { ServerContext } from "../types/server-context.js";

// Each meal item is structurally either recipe-linked OR freeform — never both.
// Custom `name` on a recipe-linked meal is dead data: Paprika.app dispatches the
// display name off `recipe_uid` and never renders the stored `name`. Verified via
// direct API experiment + UI eyeball, 2026-05-29. Property-presence dispatch via
// z.union of `.strict()` objects mirrors `mealTypeSpecSchema`.
const recipeMealItemSchema = z
  .object({
    recipe_uid: RecipeUidSchema.describe(
      "Recipe UID to link this meal to. Display name auto-resolves from the recipe.",
    ),
    date: z
      .string()
      .min(1)
      .describe(
        "Meal date. Accepts ISO 8601 date or datetime; the meal planner is day-granular, " +
          "so any time-of-day component is dropped — stored as `yyyy-MM-dd 00:00:00` (UTC).",
      ),
    type: mealTypeSpecSchema.describe(
      'Meal type. Pick exactly one shape: {"name": "Dinner"} | {"uid": "<MealType UID>"} | {"builtin": 2}.',
    ),
    scale: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe("Optional recipe scale (e.g., '2' for double). Pass null to omit."),
  })
  .strict();

const freeformMealItemSchema = z
  .object({
    name: z.string().min(1).describe("Display name for a freeform (non-recipe) meal."),
    date: z
      .string()
      .min(1)
      .describe(
        "Meal date. Accepts ISO 8601 date or datetime; the meal planner is day-granular, " +
          "so any time-of-day component is dropped — stored as `yyyy-MM-dd 00:00:00` (UTC).",
      ),
    type: mealTypeSpecSchema.describe(
      'Meal type. Pick exactly one shape: {"name": "Dinner"} | {"uid": "<MealType UID>"} | {"builtin": 2}.',
    ),
    scale: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe("Optional recipe scale (e.g., '2' for double). Pass null to omit."),
  })
  .strict();

const mealItemInputSchema = z.union([recipeMealItemSchema, freeformMealItemSchema]);

// Exported for direct Zod-validation tests (see meal-writes.test.ts AC2.3 and AC2.5).
export const addMealsInputSchema = z.object({
  items: z
    .array(mealItemInputSchema)
    .min(1, "At least one meal item is required.")
    .describe("Array of meals to add (1 or more)."),
});

export function registerAddMealsTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "add_meals" });
  server.registerTool(
    "add_meals",
    {
      description:
        "Add one or more meals to the meal planner. Each item is EITHER recipe-linked (supply " +
        "recipe_uid; display name auto-resolves from the recipe) OR freeform (supply name; no " +
        "recipe). The two shapes are mutually exclusive — Paprika.app's UI dispatches display " +
        "off recipe_uid for linked meals, so a stored custom name on a recipe-linked meal would " +
        "never render. Use a freeform meal (no recipe_uid) when you want a custom label. Date is " +
        "normalized to Paprika's wire format. Meal type accepts name, UID, or built-in index " +
        "(0=Breakfast, 1=Lunch, 2=Dinner, 3=Snacks). All items validate up-front; if ANY item " +
        "is invalid the entire batch is rejected with a per-index error enumeration so callers " +
        "can fix all problems in one pass.",
      inputSchema: addMealsInputSchema.shape,
    },
    async (args) => {
      log.info({ tool: "add_meals", count: args.items.length }, "tool invoked");
      return mealStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // ----- Stage 1: per-index validation pass (collect ALL errors, not first-only) -----
          type ResolvedItem = {
            readonly index: number;
            readonly normalizedDate: string;
            readonly typeName: string;
            readonly typeUid: string | null;
            readonly typeInteger: number;
            readonly resolvedName: string;
            readonly recipeUid: string | null;
            readonly scale: string | null;
          };

          const errors: Array<string> = [];
          const resolved: Array<ResolvedItem> = [];

          for (let i = 0; i < args.items.length; i++) {
            const item = args.items[i]!;

            // Date. The meal planner is day-granular (Paprika.app stores meals at
            // midnight per docs/wire-captures/meals.har.json, and list_meal_history
            // groups by date.slice(0, 10)); `parseCalendarDayWire` extracts the user's
            // intended calendar day in the input's own zone — so "2026-06-15T22:00:00-08:00"
            // stays on June 15 rather than UTC-shifting to June 16.
            const normalizedDate = parseCalendarDayWire(item.date);
            if (normalizedDate === null) {
              errors.push(
                `Item ${i.toString()}: could not parse date "${item.date}". ` +
                  `Use ISO 8601 (e.g., "2026-06-15" or "2026-06-15T18:30:00Z") or "yyyy-MM-dd HH:mm:ss".`,
              );
              continue;
            }

            // Meal type resolution via shared helper (file-private)
            const typeResult = resolveMealTypeSpec(ctx, item.type);
            if (!typeResult.ok) {
              if (typeResult.reason === "unknown_uid") {
                errors.push(`Item ${i.toString()}: unknown meal type UID "${typeResult.uid}".`);
              } else if (typeResult.reason === "unknown_name") {
                const knownList = typeResult.knownNames.join(", ");
                errors.push(
                  `Item ${i.toString()} (type {name: "${typeResult.name}"}): unknown meal type "${typeResult.name}". ` +
                    `Known types: ${knownList}. Use the {uid} or {builtin} discriminator to reference a custom meal type.`,
                );
              } else {
                errors.push(
                  `Item ${i.toString()}: no built-in meal type found with index ${typeResult.index.toString()} ` +
                    `(expected 0=Breakfast, 1=Lunch, 2=Dinner, 3=Snacks).`,
                );
              }
              continue;
            }
            const resolvedType = typeResult.resolved;

            // Structural union guarantees exactly one of {recipe_uid, name} is set.
            // Recipe-linked: name always auto-resolves from RecipeStore (Paprika.app
            // dispatches display off recipe_uid; a stored custom name would be
            // invisible). Freeform: caller-provided name is used verbatim.
            let resolvedName: string;
            let recipeUid: string | null;
            if ("recipe_uid" in item) {
              const recipe = ctx.store.get(item.recipe_uid);
              if (recipe === undefined) {
                errors.push(
                  `Item ${i.toString()}: recipe_uid "${item.recipe_uid}" is not known to the local recipe store; ` +
                    `wait for the next sync and retry, or supply a freeform meal (omit recipe_uid, supply name).`,
                );
                continue;
              }
              resolvedName = recipe.name;
              recipeUid = item.recipe_uid;
            } else {
              resolvedName = item.name;
              recipeUid = null;
            }

            resolved.push({
              index: i,
              normalizedDate,
              typeName: resolvedType.name,
              typeUid: resolvedType.uid,
              // Custom (user-created) meal types carry `originalType: null`. When `typeUid` is
              // set, `Meal.type` is vestigial — Paprika.app's UI dispatches off `type_uid`, and
              // the server preserves whatever integer we POST verbatim, so `0` round-trips
              // through `mealsEqual` cleanly. (Verified via direct API experiment + UI eyeball,
              // 2026-05-29.)
              typeInteger: resolvedType.originalType ?? 0,
              resolvedName,
              recipeUid,
              scale: item.scale ?? null,
            });
          }

          if (errors.length > 0) {
            const header =
              errors.length === 1 ? "Could not add meal:" : `Could not add ${errors.length.toString()} meals:`;
            return textResult(`${header}\n\n${errors.join("\n")}`);
          }

          // ----- Stage 2: assign order_flag per calendar DATE -----
          // order_flag sequences per date across ALL meal types, not per
          // (date, type) — see makeMealOrderFlagAssigner for the wire-capture
          // rationale. The assigner seeds each date from the store and increments
          // within the batch so same-date items get sequential flags.
          const assignFlag = makeMealOrderFlagAssigner(ctx);

          const builtItems: Array<Meal> = resolved.map((r) => ({
            uid: MealUidSchema.parse(crypto.randomUUID().toUpperCase()),
            recipeUid: r.recipeUid,
            name: r.resolvedName,
            date: r.normalizedDate,
            type: r.typeInteger,
            typeUid: r.typeUid,
            orderFlag: assignFlag(r.normalizedDate),
            isIngredient: false,
            scale: r.scale,
            deleted: false,
          }));

          // ----- Stage 3: single batch POST -----
          let savedItems: ReadonlyArray<Meal>;
          try {
            savedItems = await ctx.client.saveMeals(builtItems);
            await commitMealsBatch(ctx, savedItems);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, count: builtItems.length }, "saveMeals failed");
            return textResult(`Failed to add meals: ${message}`);
          }

          // ----- Stage 4: render response -----
          const cards = savedItems.map((meal) => renderMealCard(ctx, meal));

          const header = `Added ${savedItems.length.toString()} meal(s) to the planner.`;
          return textResult(`${header}\n\n${cards.join("\n\n---\n\n")}`);
        },
        (guard) => guard,
      );
    },
  );
}

// Structural union over the link/name decision lives one level deep so it can
// sit inside a flat ZodRawShape (MCP's top-level requirement). Same rationale
// as `mealItemInputSchema`: `name` on a recipe-linked meal is dead data because
// Paprika.app dispatches display off `recipe_uid`. Three `.strict()` variants
// dispatched by property presence:
//
//   recipeUpdateVariant — touch the recipe link (set/change) or change nothing
//                         link-side. No `name` allowed.
//   nameUpdateVariant   — set `name` on a freeform meal. No `recipe_uid` allowed.
//                         Handler rejects at runtime if the existing meal is
//                         recipe-linked.
//   demoteVariant       — recipe_uid: null (demotion). Optional name — required
//                         at runtime if the meal is currently recipe-linked,
//                         omitted is a no-op for already-freeform meals.
const updateMealCommonFields = {
  date: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Update date (ISO 8601 date or datetime). Time-of-day component is dropped — meals " +
        "are day-granular and store at midnight UTC.",
    ),
  type: mealTypeSpecSchema.optional().describe("Update meal type (same DU as add_meals)."),
  scale: z.string().min(1).nullable().optional().describe("Update scale. Pass null to clear."),
} as const;

const recipeUpdateVariant = z
  .object({
    recipe_uid: RecipeUidSchema.optional().describe(
      "Recipe UID. Omit to leave the link unchanged. Display name auto-resolves from the new recipe.",
    ),
    ...updateMealCommonFields,
  })
  .strict();

const nameUpdateVariant = z
  .object({
    name: z.string().min(1).describe("New display name. Only valid for freeform (no recipe_uid) meals."),
    ...updateMealCommonFields,
  })
  .strict();

const demoteVariant = z
  .object({
    recipe_uid: z.literal(null).describe("Pass null to demote a recipe meal to freeform."),
    name: z.string().min(1).optional().describe("New display name. Required when demoting from a recipe meal."),
    ...updateMealCommonFields,
  })
  .strict();

export const updateMealInputSchema = z.object({
  uid: MealUidSchema,
  update: z
    .union([recipeUpdateVariant, nameUpdateVariant, demoteVariant])
    .describe(
      "Update payload. Pick exactly one shape: {recipe_uid?, date?, type?, scale?} | {name, date?, type?, scale?} | {recipe_uid: null, name?, date?, type?, scale?}. Supplying both recipe_uid (a UID) and name is rejected — Paprika.app dispatches display off recipe_uid, so a stored custom name on a recipe-linked meal would never render. Use a freeform meal if you need a custom label.",
    ),
});

export function registerUpdateMealTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "update_meal" });
  server.registerTool(
    "update_meal",
    {
      description:
        "Update an existing meal by UID. The `update` payload is a discriminated union: pick exactly one " +
        "of {recipe_uid?, ...other} | {name, ...other} | {recipe_uid: null, name?, ...other}. Recipe link " +
        "and display name are structurally exclusive: name auto-resolves from the recipe for linked meals, " +
        "and Paprika.app would never render a stored custom name on a recipe-linked meal. To set a custom " +
        "label, use a freeform meal (no recipe_uid) or demote first via recipe_uid: null + name. Partial " +
        "merge: omitted fields are preserved. To clear scale, pass scale: null. The is_ingredient and " +
        "deleted fields are not updatable via this tool.",
      inputSchema: updateMealInputSchema.shape,
    },
    async (args) => {
      log.info({ tool: "update_meal", uid: args.uid }, "tool invoked");
      return mealStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const uid = args.uid;
          const op = args.update;
          const existing = ctx.mealStore.get(uid);

          // Three-tier miss detection (mirrors pantry-delete.ts)
          if (existing === undefined) {
            if (ctx.mealStore.isTombstone(uid)) {
              return textResult(`Meal with UID "${uid}" is already deleted.`);
            }
            return textResult(`No meal found with UID "${uid}".`);
          }
          if (existing.deleted) {
            // Defense-in-depth
            return textResult(`Meal "${existing.name}" is already deleted.`);
          }

          // Resolve type if supplied via the file-private helper (introduced in Phase 2).
          // All three variants of `op` carry `type` as an optional shared field.
          let typeInteger: number | undefined;
          let typeUid: string | null | undefined;
          if (op.type !== undefined) {
            const result = resolveMealTypeSpec(ctx, op.type);
            if (!result.ok) {
              if (result.reason === "unknown_uid") {
                return textResult(`Unknown meal type UID "${result.uid}".`);
              }
              if (result.reason === "unknown_name") {
                const knownList = result.knownNames.join(", ");
                return textResult(
                  `Unknown meal type "${result.name}". Known types: ${knownList}. ` +
                    `Use the {uid} or {builtin} discriminator to reference a custom meal type.`,
                );
              }
              return textResult(
                `No built-in meal type found with index ${result.index.toString()} ` +
                  `(expected 0=Breakfast, 1=Lunch, 2=Dinner, 3=Snacks).`,
              );
            }
            // Custom mealtypes carry `originalType: null`; `Meal.type` is vestigial when
            // `type_uid` is set (see add_meals comment for the full rationale).
            typeInteger = result.resolved.originalType ?? 0;
            typeUid = result.resolved.uid;
          }

          // Resolve date if supplied. Same calendar-day normalization as add_meals —
          // see the comment there for why we extract the input's own-zone day.
          let normalizedDate: string | undefined;
          if (op.date !== undefined) {
            const parsed = parseCalendarDayWire(op.date);
            if (parsed === null) {
              return textResult(
                `Could not parse date "${op.date}". Use ISO 8601 (e.g., "2026-06-15") or "yyyy-MM-dd HH:mm:ss".`,
              );
            }
            normalizedDate = parsed;
          }

          // Resolve recipe_uid and name interaction. The structural union ensures we
          // never see (recipe_uid: <UID>, name: <X>) together — that combination
          // matches no variant and is rejected at parse time.
          let newRecipeUid: string | null = existing.recipeUid;
          let newName: string = existing.name;

          if ("recipe_uid" in op) {
            if (op.recipe_uid === null) {
              // demoteVariant: { recipe_uid: null, name?: string, ...common }
              const demoteOp = op as z.infer<typeof demoteVariant>;
              if (
                existing.recipeUid === null &&
                demoteOp.name === undefined &&
                demoteOp.date === undefined &&
                demoteOp.type === undefined &&
                demoteOp.scale === undefined
              ) {
                // AC3.9: idempotent no-op — meal already freeform, nothing else changing
                return textResult(renderMealCard(ctx, existing));
              }
              if (existing.recipeUid !== null && demoteOp.name === undefined) {
                // AC3.10: demotion requires explicit name when meal is currently recipe-linked
                return textResult(
                  `Demoting a recipe meal to freeform requires an explicit name. ` +
                    `Add 'name: "<your label>"' to the call.`,
                );
              }
              newRecipeUid = null;
              if (demoteOp.name !== undefined) {
                newName = demoteOp.name;
              }
              // else: existing.recipeUid was already null and no new name supplied —
              // preserve existing.name (no demotion occurring)
            } else if (op.recipe_uid !== undefined) {
              // recipeUpdateVariant with recipe_uid set. Structural union guarantees
              // no `name` here. Same-UID resubmit is a no-op on the name (partial-merge
              // contract); different UID triggers auto-resolve from the new recipe.
              const newLink = op.recipe_uid;
              newRecipeUid = newLink;
              if (newLink !== existing.recipeUid) {
                const recipe = ctx.store.get(newLink);
                if (recipe === undefined) {
                  return textResult(
                    `recipe_uid "${newLink}" is not known to the local recipe store; ` +
                      `wait for the next sync and retry.`,
                  );
                }
                newName = recipe.name;
              }
            }
            // Zod's `.optional()` strips absent keys from the parsed output, so
            // there is no third state for `op.recipe_uid` here (`null` and a
            // RecipeUid are the only reachable values inside this branch).
          } else if ("name" in op) {
            // nameUpdateVariant: { name: string, ...common }
            // Only valid for already-freeform meals — stored custom names on recipe-linked
            // meals would never render in Paprika.app.
            const nameOp = op as z.infer<typeof nameUpdateVariant>;
            if (existing.recipeUid !== null) {
              return textResult(
                `Cannot set name on the recipe-linked meal "${existing.name}". ` +
                  `Names auto-resolve from the recipe. To use a custom label, demote first via ` +
                  `update_meal({uid, update: {recipe_uid: null, name: "<your label>"}}).`,
              );
            }
            newName = nameOp.name;
          }

          // order_flag sequences per calendar DATE (all meal types on a day share
          // one sequence — see makeMealOrderFlagAssigner). When `date` changes, the
          // meal moves to the destination date's sequence; reassign to that date's
          // max+1 so it doesn't collide with a meal already holding the old flag
          // there. A type change WITHOUT a date change stays in the same date
          // sequence, so the flag is preserved — keep-the-position semantics.
          const destDate = normalizedDate ?? existing.date;
          const dateChanged = destDate !== existing.date;
          const newOrderFlag = dateChanged ? (ctx.mealStore.getMaxOrderFlagOn(destDate) ?? -1) + 1 : existing.orderFlag;

          // Spread-merge — mirrors pantry-update.ts lines 95-104
          const updated: Meal = {
            ...existing,
            recipeUid: newRecipeUid,
            name: newName,
            ...(normalizedDate !== undefined && { date: normalizedDate }),
            ...(typeInteger !== undefined && { type: typeInteger }),
            ...(typeUid !== undefined && { typeUid }),
            orderFlag: newOrderFlag,
            // scale: undefined keeps existing; explicit null clears.
            ...(op.scale !== undefined && { scale: op.scale }),
          };

          // No-op short-circuit: an LLM call like `update_meal({uid, update: {}})`
          // parses (recipeUpdateVariant has all-optional fields) and reaches here
          // with `updated` field-wise equal to `existing`. POSTing it would be a
          // wasted round-trip + a spurious notifySync. Return the existing meal
          // markdown so the caller sees the current state rather than a sham
          // success message.
          if (
            updated.recipeUid === existing.recipeUid &&
            updated.name === existing.name &&
            updated.date === existing.date &&
            updated.type === existing.type &&
            updated.typeUid === existing.typeUid &&
            updated.orderFlag === existing.orderFlag &&
            updated.scale === existing.scale
          ) {
            return textResult(renderMealCard(ctx, existing));
          }

          let saved: Meal;
          try {
            saved = (await ctx.client.saveMeals([updated]))[0]!;
            await commitMeal(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid }, "saveMeals failed");
            return textResult(`Failed to update meal: ${message}`);
          }

          return textResult(renderMealCard(ctx, saved));
        },
        (guard) => guard,
      );
    },
  );
}

const deleteMealInputSchema = z.object({
  uid: MealUidSchema,
});

export function registerDeleteMealTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "delete_meal" });
  server.registerTool(
    "delete_meal",
    {
      description:
        "Soft-delete a meal from the planner by UID. Idempotent: a second delete on the same UID " +
        "returns a friendly 'already deleted' message without re-POSTing. Requires an exact UID.",
      inputSchema: deleteMealInputSchema.shape,
    },
    async (args) => {
      log.info({ tool: "delete_meal", uid: args.uid }, "tool invoked");
      return mealStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const uid = args.uid;
          const existing = ctx.mealStore.get(uid);

          if (existing === undefined) {
            // Tombstone vs never-existed
            if (ctx.mealStore.isTombstone(uid)) {
              return textResult(`Meal with UID "${uid}" is already deleted.`);
            }
            return textResult(`No meal found with UID "${uid}".`);
          }
          if (existing.deleted) {
            // Defense-in-depth
            return textResult(`Meal "${existing.name}" is already deleted.`);
          }

          const trashed: Meal = { ...existing, deleted: true };
          try {
            const saved = (await ctx.client.saveMeals([trashed]))[0]!;
            await commitMeal(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid }, "saveMeals failed");
            return textResult(`Failed to delete meal: ${message}`);
          }

          return textResult(`Meal "${existing.name}" on ${existing.date} deleted.`);
        },
        (guard) => guard,
      );
    },
  );
}
