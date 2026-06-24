import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { ToolDef } from "../../../kernel/tool.js";
import type { RecipeState, RecipeWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, errorResult, structuredResult } from "../../../shared/tools.js";
import { RecipeUidSchema } from "../ids.js";
import { recipeReadOutputSchema, recipeToReadStructured } from "../recipe-markdown.js";
import { recipeColdStartGuard } from "./guards.js";

/** The strict `{ uid }` input every recipe flag verb takes — one schema, shared by all four verbs. */
export const recipeFlagInputSchema = z.object({ uid: RecipeUidSchema.describe("Recipe UID") }).strict();

/**
 * Build one half of a recipe boolean-flag verb pair (`favorite_recipe` /
 * `unfavorite_recipe`, `pin_recipe` / `unpin_recipe`): look up by UID, save the
 * recipe with `flag` set to `value`, commit through the recipe chokepoint, and
 * render the result. The four verbs are configs over this one handler — a new
 * promoted flag transition is one `makeRecipeFlagTool` call per
 * direction.
 */
export function makeRecipeFlagTool(spec: {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly flag: "onFavorites" | "isPinned";
  readonly value: boolean;
  /** The verb for the failure message, e.g. "favorite", "unpin". */
  readonly failVerb: string;
}): ToolDef<RecipeState, never, RecipeWrites> {
  return defineTool(
    {
      name: spec.name,
      title: spec.title,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      description: spec.description,
      inputSchema: recipeFlagInputSchema,
      outputSchema: recipeReadOutputSchema,
    },
    [recipeColdStartGuard],
    (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
      const log = ctx.infra.log.child({ component: spec.name });
      return async (args) => {
        const existing = ctx.state.recipe.store.get(args.uid);

        if (!existing) {
          return errorResult(
            `No recipe found with UID "${args.uid}" (it may not exist or was already deleted). Use \`search_recipes\` to find it.`,
          );
        }

        const updated = { ...existing, [spec.flag]: spec.value };

        const saved = (await ctx.infra.client.saveRecipe(updated)).match(
          (v) => v,
          (e) => {
            log.error({ err: e, uid: args.uid }, "saveRecipe failed");
            return errorResult(`Failed to ${spec.failVerb} recipe: ${e.message}`);
          },
        );
        if ("content" in saved) return saved;
        const categoryNames = ctx.state.category.store.resolveNames(saved.categories);
        const structured = recipeToReadStructured(saved, categoryNames);
        const commitErr = commitFailure("recipe", await ctx.writes.commitRecipe(saved), {
          structuredContent: structured,
          selfHealing: false,
        });
        if (commitErr) return commitErr;

        return structuredResult(structured);
      };
    },
  );
}
