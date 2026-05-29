// pattern: Imperative Shell
import { toMessage } from "../utils/log.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MealUidSchema, RecipeUidSchema } from "../paprika/types.js";
import type { Meal, MealType, RecipeUid } from "../paprika/types.js";
import { textResult } from "./helpers.js";
import { commitMeal, commitMealsBatch, mealStartGuard, mealToMarkdown, mealTypeSpecSchema } from "./meal-helpers.js";
import { parseInputDate, toWireDateFormat } from "../utils/dates.js";
import type { ServerContext } from "../types/server-context.js";

// File-private helper used by registerAddMealsTool and registerUpdateMealTool.
// Returns a typed result so callers can compose user-facing prefixes (e.g.,
// "Item N (type {name: \"...\"}):" for add_meals, "" for update_meal) without
// the helper baking format strings.
type MealTypeResolveResult =
  | { readonly ok: true; readonly resolved: MealType }
  | { readonly ok: false; readonly reason: "unknown_uid"; readonly uid: string }
  | {
      readonly ok: false;
      readonly reason: "unknown_name";
      readonly name: string;
      readonly knownNames: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly reason: "unknown_builtin"; readonly index: number };

function resolveMealTypeSpec(ctx: ServerContext, spec: z.infer<typeof mealTypeSpecSchema>): MealTypeResolveResult {
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

const mealItemInputSchema = z
  .object({
    recipe_uid: RecipeUidSchema.optional().describe(
      "Recipe UID to link this meal to. When omitted, supply name to create a freeform meal.",
    ),
    name: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Display name for the meal. Auto-resolved from recipe when recipe_uid is provided and name is omitted; " +
          "supplying both uses the caller-provided name.",
      ),
    date: z
      .string()
      .min(1)
      .describe("Meal date or datetime. Accepts ISO 8601 or yyyy-MM-dd. Normalized to Paprika wire format (UTC)."),
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
  .refine((v) => v.recipe_uid !== undefined || (v.name !== undefined && v.name.length > 0), {
    message: "Either recipe_uid or name must be provided.",
  });

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
        "Add one or more meals to the meal planner. Each item can link to a recipe (recipe_uid + " +
        "optional name override) or stand alone as a freeform meal (name only). Date is normalized " +
        "to Paprika's wire format. Meal type accepts name, UID, or built-in index (0=Breakfast, " +
        "1=Lunch, 2=Dinner, 3=Snacks). All items validate up-front; if ANY item is invalid the " +
        "entire batch is rejected with a per-index error enumeration so callers can fix all problems " +
        "in one pass.",
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

            // Date
            const parsedDate = parseInputDate(item.date);
            if (parsedDate === null) {
              errors.push(
                `Item ${i.toString()}: could not parse date "${item.date}". ` +
                  `Use ISO 8601 (e.g., "2026-06-15" or "2026-06-15T18:30:00Z") or "yyyy-MM-dd HH:mm:ss".`,
              );
              continue;
            }
            const normalizedDate = toWireDateFormat(parsedDate);

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

            // Cross-field: recipe_uid OR name (the Zod .refine() already enforced this;
            // here we resolve the display name when only recipe_uid was supplied).
            let resolvedName: string;
            if (item.name !== undefined) {
              resolvedName = item.name;
            } else if (item.recipe_uid !== undefined) {
              // item.recipe_uid is already RecipeUid-branded (input schema uses RecipeUidSchema.optional())
              const recipe = ctx.store.get(item.recipe_uid);
              if (recipe === undefined) {
                errors.push(
                  `Item ${i.toString()}: recipe_uid "${item.recipe_uid}" is not known to the local recipe store; ` +
                    `either supply name explicitly or wait for the next sync and retry.`,
                );
                continue;
              }
              resolvedName = recipe.name;
            } else {
              // Belt and suspenders: the Zod .refine() at the schema level already
              // guarantees one of recipe_uid or name is supplied, so this branch is
              // unreachable in practice. Kept as a structural safeguard against
              // schema drift; if the refine is removed or weakened in the future,
              // this prevents a silently malformed meal record.
              errors.push(`Item ${i.toString()}: either recipe_uid or name must be provided.`);
              continue;
            }

            resolved.push({
              index: i,
              normalizedDate,
              typeName: resolvedType.name,
              typeUid: resolvedType.uid,
              typeInteger: resolvedType.originalType ?? 0,
              resolvedName,
              recipeUid: item.recipe_uid ?? null,
              scale: item.scale ?? null,
            });
          }

          if (errors.length > 0) {
            const header =
              errors.length === 1 ? "Could not add meal:" : `Could not add ${errors.length.toString()} meals:`;
            return textResult(`${header}\n\n${errors.join("\n")}`);
          }

          // ----- Stage 2: assign order_flag per (date, typeUid) bucket -----
          // The Map caches the next free flag per bucket so multiple items in the same
          // batch sharing a bucket get sequential flags (the bucket state in MealStore
          // does not change between iterations — none have been saved yet).
          const nextFlag = new Map<string, number>();
          const bucketKey = (date: string, typeUid: string | null): string => `${date}|${typeUid ?? "null"}`;

          const builtItems: Array<Meal> = resolved.map((r) => {
            const key = bucketKey(r.normalizedDate, r.typeUid);
            let flag = nextFlag.get(key);
            if (flag === undefined) {
              flag = (ctx.mealStore.getMaxOrderFlagOn(r.normalizedDate, r.typeUid) ?? -1) + 1;
            }
            nextFlag.set(key, flag + 1);

            return {
              uid: MealUidSchema.parse(crypto.randomUUID().toUpperCase()),
              recipeUid: r.recipeUid,
              name: r.resolvedName,
              date: r.normalizedDate,
              type: r.typeInteger,
              typeUid: r.typeUid,
              orderFlag: flag,
              isIngredient: false,
              scale: r.scale,
              deleted: false,
            };
          });

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
          const typeNameByUid = new Map<string, string>();
          for (const mt of ctx.mealTypeStore.getAll()) typeNameByUid.set(mt.uid, mt.name);

          const cards = savedItems.map((meal) => {
            const typeName =
              meal.typeUid !== null
                ? (typeNameByUid.get(meal.typeUid) ?? `Type ${meal.type.toString()}`)
                : `Type ${meal.type.toString()}`;
            // meal.recipeUid is `string | null` per MealStoredSchema (types.ts:374) — the field is intentionally
            // unbranded at the schema level. Cast to RecipeUid for the store lookup, matching the convention
            // in src/tools/discover.ts:40 (`ctx.store.get(result.uid as RecipeUid)`).
            const recipeName =
              meal.recipeUid !== null ? (ctx.store.get(meal.recipeUid as RecipeUid)?.name ?? null) : null;
            return mealToMarkdown(meal, typeName, recipeName);
          });

          const header = `Added ${savedItems.length.toString()} meal(s) to the planner.`;
          return textResult(`${header}\n\n${cards.join("\n\n---\n\n")}`);
        },
        (guard) => guard,
      );
    },
  );
}

const updateMealInputSchema = z.object({
  uid: MealUidSchema,
  recipe_uid: RecipeUidSchema.nullable()
    .optional()
    .describe("Update recipe link. Pass null to demote a recipe meal to freeform (requires name)."),
  name: z.string().min(1).optional().describe("Update display name. Required when demoting via recipe_uid: null."),
  date: z.string().min(1).optional().describe("Update date (ISO 8601 or yyyy-MM-dd)."),
  type: mealTypeSpecSchema.optional().describe("Update meal type (same DU as add_meals)."),
  scale: z.string().min(1).nullable().optional().describe("Update scale. Pass null to clear."),
});

export function registerUpdateMealTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "update_meal" });
  server.registerTool(
    "update_meal",
    {
      description:
        "Update an existing meal by UID. Partial merge: only provided fields change; omitted fields are " +
        "preserved. To clear scale, pass scale: null. To demote a recipe meal to freeform, pass recipe_uid: null " +
        "along with an explicit name. Updates with no effective change (e.g., recipe_uid: null on an already-" +
        "freeform meal with no other fields supplied) return the existing meal without re-POSTing. The " +
        "is_ingredient and deleted fields are not updatable via this tool.",
      inputSchema: updateMealInputSchema.shape,
    },
    async (args) => {
      log.info({ tool: "update_meal", uid: args.uid }, "tool invoked");
      return mealStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const uid = args.uid;
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

          // Resolve type if supplied via the file-private helper (introduced in Phase 2)
          let typeInteger: number | undefined;
          let typeUid: string | null | undefined;
          if (args.type !== undefined) {
            const result = resolveMealTypeSpec(ctx, args.type);
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
            typeInteger = result.resolved.originalType ?? 0;
            typeUid = result.resolved.uid;
          }

          // Resolve date if supplied
          let normalizedDate: string | undefined;
          if (args.date !== undefined) {
            const parsed = parseInputDate(args.date);
            if (parsed === null) {
              return textResult(
                `Could not parse date "${args.date}". Use ISO 8601 (e.g., "2026-06-15") or "yyyy-MM-dd HH:mm:ss".`,
              );
            }
            normalizedDate = toWireDateFormat(parsed);
          }

          // Resolve recipe_uid and name interaction
          let newRecipeUid: string | null = existing.recipeUid;
          let newName: string = existing.name;

          if (args.recipe_uid !== undefined) {
            if (args.recipe_uid === null) {
              // Demotion to freeform
              if (
                existing.recipeUid === null &&
                args.name === undefined &&
                args.date === undefined &&
                args.type === undefined &&
                args.scale === undefined
              ) {
                // AC3.9: idempotent no-op — meal already freeform, nothing else changing
                const typeNameByUid = new Map<string, string>();
                for (const mt of ctx.mealTypeStore.getAll()) typeNameByUid.set(mt.uid, mt.name);
                const typeName =
                  existing.typeUid !== null
                    ? (typeNameByUid.get(existing.typeUid) ?? `Type ${existing.type.toString()}`)
                    : `Type ${existing.type.toString()}`;
                return textResult(mealToMarkdown(existing, typeName, null));
              }
              if (existing.recipeUid !== null && args.name === undefined) {
                // AC3.10: demotion requires explicit name (only when the meal
                // is currently recipe-linked; already-freeform meals with
                // recipe_uid: null just proceed to the spread-merge below)
                return textResult(
                  `Demoting a recipe meal to freeform requires an explicit name. ` +
                    `Add 'name: "<your label>"' to the call.`,
                );
              }
              newRecipeUid = null;
              if (args.name !== undefined) {
                newName = args.name;
              }
              // else: existing.recipeUid was already null and no new name was
              // supplied — keep existing.name unchanged (no demotion occurring)
            } else {
              // Re-link / promote
              newRecipeUid = args.recipe_uid;
              if (args.name !== undefined) {
                newName = args.name;
              } else {
                // args.recipe_uid is already RecipeUid-branded (input schema uses RecipeUidSchema.nullable().optional())
                const recipe = ctx.store.get(args.recipe_uid);
                if (recipe === undefined) {
                  return textResult(
                    `recipe_uid "${args.recipe_uid}" is not known to the local recipe store; ` +
                      `either supply name explicitly or wait for the next sync and retry.`,
                  );
                }
                newName = recipe.name;
              }
            }
          } else if (args.name !== undefined) {
            // Name update without recipe_uid change
            newName = args.name;
          }

          // Spread-merge — mirrors pantry-update.ts lines 95-104
          const updated: Meal = {
            ...existing,
            recipeUid: newRecipeUid,
            name: newName,
            ...(normalizedDate !== undefined && { date: normalizedDate }),
            ...(typeInteger !== undefined && { type: typeInteger }),
            ...(typeUid !== undefined && { typeUid }),
            // scale: undefined keeps existing; explicit null clears.
            ...(args.scale !== undefined && { scale: args.scale }),
          };

          let saved: Meal;
          try {
            saved = (await ctx.client.saveMeals([updated]))[0]!;
            await commitMeal(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid }, "saveMeals failed");
            return textResult(`Failed to update meal: ${message}`);
          }

          const typeNameByUid = new Map<string, string>();
          for (const mt of ctx.mealTypeStore.getAll()) typeNameByUid.set(mt.uid, mt.name);
          const typeName =
            saved.typeUid !== null
              ? (typeNameByUid.get(saved.typeUid) ?? `Type ${saved.type.toString()}`)
              : `Type ${saved.type.toString()}`;
          // saved.recipeUid is `string | null` per MealStoredSchema (intentionally unbranded); cast follows the
          // src/tools/discover.ts:40 precedent (`ctx.store.get(result.uid as RecipeUid)`).
          const recipeName =
            saved.recipeUid !== null ? (ctx.store.get(saved.recipeUid as RecipeUid)?.name ?? null) : null;
          return textResult(mealToMarkdown(saved, typeName, recipeName));
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
