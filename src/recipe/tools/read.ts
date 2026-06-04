import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../kernel/registry.js";
import type { RecipeSelf } from "../module.js";

import { RecipeUidSchema } from "../../ids.js";
import { formatLookupOutcome, recipeToMarkdown, resolveLookup, uidOrTextLookupSchema } from "../../tools/helpers.js";
import { recipeColdStartGuard } from "./guards.js";

/**
 * Registers `read_recipe`, kernel-shaped — reads this module's own recipe + category
 * stores via `ctx.self`. The `lastCookedAt` argument to `recipeToMarkdown` is DROPPED
 * (recipe is `dependsOn []`, no meal dependency); "last cooked" stays meal-side.
 */
export function readRecipeTool(ctx: DomainCtx<RecipeSelf, never>): void {
  const log = ctx.infra.log.child({ component: "read_recipe" });
  ctx.server.registerTool(
    "read_recipe",
    {
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
    async (args) => {
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
    },
  );
}
