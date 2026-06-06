import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { MealTypeUid, RecipeUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealType } from "../../meal-type/types.js";
import type { MealState, MealWrites } from "../module.js";
import type { Meal } from "../types.js";

import { MealUidSchema, RecipeUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, textResult } from "../../../shared/tools.js";
import { parseCalendarDayWire } from "../../../utils/dates.js";
import { toMessage } from "../../../utils/log.js";
import { mealTypeSpecSchema, resolveOrCreateMealType } from "../../meal-type/meal-type-helpers.js";
import { mealStartGuard } from "./guards.js";
import { makeMealOrderFlagAssigner, renderMealCard } from "./helpers.js";

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

/**
 * `plan_meals` — schedule meals (recipe-linked or freeform) onto dates. Resolves
 * recipe links via `ctx.deps.recipe.get` and meal types via
 * `ctx.deps["meal-type"].resolveSpec`.
 */
export const planMealsTool = defineTool(
  {
    name: "plan_meals",
    title: "Add meals to the planner",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
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
  (ctx: DomainCtx<MealState, "recipe" | "meal-type", MealWrites>) => {
    const log = ctx.infra.log.child({ component: "plan_meals" });
    return async (args) => {
      log.info({ tool: "plan_meals", count: args.items.length }, "tool invoked");
      return mealStartGuard(ctx.state, ctx.deps["meal-type"]).match(
        async (): Promise<CallToolResult> => {
          // ----- Stage 1: per-index validation pass (collect ALL errors, not first-only) -----
          type ResolvedItem = {
            readonly index: number;
            readonly normalizedDate: string;
            // Exactly one of these is set: the type resolved during validation, or a
            // {name} to auto-create in the build pass below (deferred so a batch rejected
            // in validation creates no orphan type — pantry-style).
            readonly resolvedType: MealType | null;
            readonly pendingTypeName: string | null;
            readonly resolvedName: string;
            readonly recipeUid: RecipeUid | null;
            readonly scale: string | null;
          };

          const errors: Array<string> = [];
          const resolved: Array<ResolvedItem> = [];

          for (let i = 0; i < args.items.length; i++) {
            const item = args.items[i]!;

            // Date. The meal planner is day-granular (Paprika.app stores meals at
            // midnight per docs/wire-captures/meals.har.json, and read_meal_plan
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

            // Meal type resolution via the meal-type dep contract. An unknown {name} is
            // NOT an error — it's deferred and auto-created in the build pass below, so a
            // batch rejected during validation never creates an orphan type (pantry-style).
            const typeResult = ctx.deps["meal-type"].resolveSpec(item.type);
            let resolvedType: MealType | null = null;
            let pendingTypeName: string | null = null;
            if (typeResult.ok) {
              resolvedType = typeResult.resolved;
            } else if (typeResult.reason === "unknown_name") {
              pendingTypeName = typeResult.name;
            } else if (typeResult.reason === "unknown_uid") {
              errors.push(`Item ${i.toString()}: unknown meal type UID "${typeResult.uid}".`);
              continue;
            } else {
              errors.push(
                `Item ${i.toString()}: no built-in meal type found with index ${typeResult.index.toString()} ` +
                  `(expected 0=Breakfast, 1=Lunch, 2=Dinner, 3=Snacks).`,
              );
              continue;
            }

            // Structural union guarantees exactly one of {recipe_uid, name} is set.
            // Recipe-linked: name always auto-resolves from the recipe store (Paprika.app
            // dispatches display off recipe_uid; a stored custom name would be
            // invisible). Freeform: caller-provided name is used verbatim.
            let resolvedName: string;
            let recipeUid: RecipeUid | null;
            if ("recipe_uid" in item) {
              const recipe = ctx.deps.recipe.get(item.recipe_uid);
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
              resolvedType,
              pendingTypeName,
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

          // ----- Stage 2: auto-create any deferred {name} meal types (pantry-style) -----
          // Validation passed, so creating now leaves no orphan type on a rejected batch.
          // Cache by lowercase name so a name repeated across items is created once.
          const createdTypesByName = new Map<string, MealType>();
          for (const r of resolved) {
            if (r.pendingTypeName === null) continue;
            const key = r.pendingTypeName.toLowerCase();
            if (createdTypesByName.has(key)) continue;
            try {
              createdTypesByName.set(key, await ctx.deps["meal-type"].ensureMealType(r.pendingTypeName));
            } catch (error) {
              const message = toMessage(error);
              log.error({ err: error, name: r.pendingTypeName }, "ensureMealType failed");
              return textResult(`Failed to create meal type "${r.pendingTypeName}": ${message}`);
            }
          }

          // ----- Stage 3: assign order_flag per calendar DATE -----
          // order_flag sequences per date across ALL meal types, not per
          // (date, type) — see makeMealOrderFlagAssigner for the wire-capture
          // rationale. The assigner seeds each date from the store and increments
          // within the batch so same-date items get sequential flags.
          const assignFlag = makeMealOrderFlagAssigner(ctx.state);

          const builtItems: Array<Meal> = resolved.map((r) => {
            // Either the type resolved during validation, or the one just auto-created.
            const mealType = r.resolvedType ?? createdTypesByName.get(r.pendingTypeName!.toLowerCase())!;
            return {
              uid: MealUidSchema.parse(crypto.randomUUID().toUpperCase()),
              recipeUid: r.recipeUid,
              name: r.resolvedName,
              date: r.normalizedDate,
              // Custom (user-created) meal types carry `originalType: null`. When `typeUid` is
              // set, `Meal.type` is vestigial — Paprika.app dispatches off `type_uid` and the
              // server preserves the integer we POST verbatim, so `0` round-trips through
              // `mealsEqual` cleanly. (Verified via direct API experiment + UI eyeball, 2026-05-29.)
              type: mealType.originalType ?? 0,
              typeUid: mealType.uid,
              orderFlag: assignFlag(r.normalizedDate),
              isIngredient: false,
              scale: r.scale,
              deleted: false,
            };
          });

          // ----- Stage 4: single batch POST -----
          let savedItems: ReadonlyArray<Meal>;
          try {
            savedItems = await ctx.infra.client.saveMeals(builtItems);
            const commitErr = commitFailure("meal plan", await ctx.writes.commitMealsBatch(savedItems));
            if (commitErr) return commitErr;
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, count: builtItems.length }, "saveMeals failed");
            return textResult(`Failed to add meals: ${message}`);
          }

          // ----- Stage 5: render response -----
          const cards = savedItems.map((meal) => renderMealCard(meal, ctx.deps.recipe, ctx.deps["meal-type"]));

          const header = `Added ${savedItems.length.toString()} meal(s) to the planner.`;
          return textResult(`${header}\n\n${cards.join("\n\n---\n\n")}`);
        },
        (guard) => guard,
      );
    };
  },
);

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
// `date` is intentionally absent — rescheduling a meal is its own act
// (reschedule_meal), because moving a meal's date re-sequences the destination
// day's order_flag. update_meal changes the recipe link, freeform name, type, or scale.
const updateMealCommonFields = {
  type: mealTypeSpecSchema.optional().describe("Update meal type (same DU as plan_meals)."),
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
      "Update payload. Pick exactly one shape: {recipe_uid?, type?, scale?} | {name, type?, scale?} | {recipe_uid: null, name?, type?, scale?}. Supplying both recipe_uid (a UID) and name is rejected — Paprika.app dispatches display off recipe_uid, so a stored custom name on a recipe-linked meal would never render. Use a freeform meal if you need a custom label. To change a meal's date, use reschedule_meal.",
    ),
});

/**
 * `update_meal` — edit a scheduled meal's free-form fields. Re-resolves recipe links
 * via `ctx.deps.recipe.get` and meal types via `ctx.deps["meal-type"].resolveSpec`.
 */
export const updateMealTool = defineTool(
  {
    name: "update_meal",
    title: "Edit a planned meal",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description:
      "Update an existing meal by UID. The `update` payload is a discriminated union: pick exactly one " +
      "of {recipe_uid?, ...other} | {name, ...other} | {recipe_uid: null, name?, ...other}. Recipe link " +
      "and display name are structurally exclusive: name auto-resolves from the recipe for linked meals, " +
      "and Paprika.app would never render a stored custom name on a recipe-linked meal. To set a custom " +
      "label, use a freeform meal (no recipe_uid) or demote first via recipe_uid: null + name. Partial " +
      "merge: omitted fields are preserved. To clear scale, pass scale: null. To change the meal's date, " +
      "use reschedule_meal. The is_ingredient and deleted fields are not updatable via this tool.",
    inputSchema: updateMealInputSchema.shape,
  },
  (ctx: DomainCtx<MealState, "recipe" | "meal-type", MealWrites>) => {
    const log = ctx.infra.log.child({ component: "update_meal" });
    return async (args) => {
      log.info({ tool: "update_meal", uid: args.uid }, "tool invoked");
      return mealStartGuard(ctx.state, ctx.deps["meal-type"]).match(
        async (): Promise<CallToolResult> => {
          const uid = args.uid;
          const op = args.update;
          const existing = ctx.state.store.get(uid);

          if (existing === undefined) {
            return textResult(`No meal found with UID "${uid}" (it may not exist or was already deleted).`);
          }
          // Resolve recipe_uid and name interaction. The structural union ensures we
          // never see (recipe_uid: <UID>, name: <X>) together — that combination
          // matches no variant and is rejected at parse time.
          let newRecipeUid: RecipeUid | null = existing.recipeUid;
          let newName: string = existing.name;

          if ("recipe_uid" in op) {
            if (op.recipe_uid === null) {
              // demoteVariant: { recipe_uid: null, name?: string, ...common }
              const demoteOp = op as z.infer<typeof demoteVariant>;
              if (
                existing.recipeUid === null &&
                demoteOp.name === undefined &&
                demoteOp.type === undefined &&
                demoteOp.scale === undefined
              ) {
                // AC3.9: idempotent no-op — meal already freeform, nothing else changing
                return textResult(renderMealCard(existing, ctx.deps.recipe, ctx.deps["meal-type"]));
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
                const recipe = ctx.deps.recipe.get(newLink);
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

          // Resolve the meal type LAST — after the recipe/name validation above. An unknown
          // {name} auto-creates a type, so creating only once the rest of the update is
          // known-good avoids leaving an orphan type behind on a rejected call. All three
          // variants of `op` carry `type` as an optional shared field.
          let typeInteger: number | undefined;
          let typeUid: MealTypeUid | null | undefined;
          if (op.type !== undefined) {
            const result = await resolveOrCreateMealType(ctx.deps["meal-type"], op.type);
            if (!result.ok) {
              return textResult(result.message);
            }
            // Custom mealtypes carry `originalType: null`; `Meal.type` is vestigial when
            // `type_uid` is set (see plan_meals comment for the full rationale).
            typeInteger = result.resolved.originalType ?? 0;
            typeUid = result.resolved.uid;
          }

          // Spread-merge. update_meal never changes the date (that's reschedule_meal),
          // so order_flag — which sequences per calendar date — is preserved as-is.
          const updated: Meal = {
            ...existing,
            recipeUid: newRecipeUid,
            name: newName,
            ...(typeInteger !== undefined && { type: typeInteger }),
            ...(typeUid !== undefined && { typeUid }),
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
            updated.type === existing.type &&
            updated.typeUid === existing.typeUid &&
            updated.scale === existing.scale
          ) {
            return textResult(renderMealCard(existing, ctx.deps.recipe, ctx.deps["meal-type"]));
          }

          let saved: Meal;
          try {
            saved = (await ctx.infra.client.saveMeals([updated]))[0]!;
            const commitErr = commitFailure("meal plan", await ctx.writes.commitMeal(saved));
            if (commitErr) return commitErr;
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid }, "saveMeals failed");
            return textResult(`Failed to update meal: ${message}`);
          }

          return textResult(renderMealCard(saved, ctx.deps.recipe, ctx.deps["meal-type"]));
        },
        (guard) => guard,
      );
    };
  },
);

const deleteMealInputSchema = z.object({
  uid: MealUidSchema,
});

/**
 * `delete_meal` — remove a scheduled meal (soft-delete).
 */
export const deleteMealTool = defineTool(
  {
    name: "delete_meal",
    title: "Delete a planned meal",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description:
      "Soft-delete a meal from the planner by UID. Idempotent: a second delete on the same UID " +
      "returns a friendly 'already deleted' message without re-POSTing. Requires an exact UID.",
    inputSchema: deleteMealInputSchema.shape,
  },
  (ctx: DomainCtx<MealState, "recipe" | "meal-type", MealWrites>) => {
    const log = ctx.infra.log.child({ component: "delete_meal" });
    return async (args) => {
      log.info({ tool: "delete_meal", uid: args.uid }, "tool invoked");
      return mealStartGuard(ctx.state, ctx.deps["meal-type"]).match(
        async (): Promise<CallToolResult> => {
          const uid = args.uid;
          const existing = ctx.state.store.get(uid);

          if (existing === undefined) {
            return textResult(`No meal found with UID "${uid}" (it may not exist or was already deleted).`);
          }
          const trashed: Meal = { ...existing, deleted: true };
          try {
            const saved = (await ctx.infra.client.saveMeals([trashed]))[0]!;
            const commitErr = commitFailure("meal plan", await ctx.writes.commitMeal(saved));
            if (commitErr) return commitErr;
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid }, "saveMeals failed");
            return textResult(`Failed to delete meal: ${message}`);
          }

          return textResult(`Meal "${existing.name}" on ${existing.date} deleted.`);
        },
        (guard) => guard,
      );
    };
  },
);
