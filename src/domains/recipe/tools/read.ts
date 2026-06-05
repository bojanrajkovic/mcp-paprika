import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeSelf } from "../module.js";

import { RecipeUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { formatLookupOutcome, resolveLookup, uidOrTextLookupSchema } from "../../../shared/tools.js";
import { recipeToMarkdown } from "../recipe-markdown.js";
import { recipeColdStartGuard } from "./guards.js";

/**
 * Registers `read_recipe`, kernel-shaped — reads this module's own recipe + category
 * stores via `ctx.self`. The `lastCookedAt` argument to `recipeToMarkdown` is DROPPED
 * (recipe is `dependsOn []`, no meal dependency); "last cooked" stays meal-side,
 * surfaced by the meal domain's `read_recipe_history` tool.
 */
export const readRecipeTool = defineTool(
  {
    name: "read_recipe",
    title: "Read a recipe by UID or title",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "Read a recipe by UID or title. Title lookup is fuzzy (exact → starts-with → contains) " +
      "and returns a disambiguation list when multiple recipes match the same tier. " +
      'Pass exactly one shape: {"uid": "..."} or {"title": "..."}.',
    inputSchema: {
      lookup: uidOrTextLookupSchema({
        uidSchema: RecipeUidSchema,
        textKey: "title",
        entityLabel: "recipe",
        textExample: "Chocolate Cake",
      }),
    },
  },
  (ctx: DomainCtx<RecipeSelf, never>) => {
    const log = ctx.infra.log.child({ component: "read_recipe" });
    return async (args) => {
      log.info({ tool: "read_recipe", ...args.lookup }, "tool invoked");
      return recipeColdStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          const query = "uid" in args.lookup ? { uid: args.lookup.uid } : { text: args.lookup.title };
          const outcome = resolveLookup(query, {
            get: (uid) => ctx.self.recipe.store.get(uid),
            findByText: (text) => ctx.self.recipe.store.findByName(text),
          });
          return formatLookupOutcome(outcome, {
            entityNoun: "recipe",
            renderOne: (recipe) => recipeToMarkdown(recipe, ctx.self.category.store.resolveNames(recipe.categories)),
            disambiguationLine: (recipe) => `- ${recipe.name} (UID: ${recipe.uid})`,
          });
        },
        (guard) => guard,
      );
    };
  },
);
