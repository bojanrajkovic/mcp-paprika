import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RecipeUidSchema } from "../paprika/types.js";
import {
  coldStartGuard,
  formatLookupOutcome,
  recipeToMarkdown,
  resolveLookup,
  uidOrTextLookupSchema,
} from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerReadTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "read_recipe" });
  server.registerTool(
    "read_recipe",
    {
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
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const query = "uid" in args.lookup ? { uid: args.lookup.uid } : { text: args.lookup.title };
          const outcome = resolveLookup(query, {
            get: (uid) => ctx.store.get(uid),
            findByText: (text) => ctx.store.findByName(text),
          });
          return formatLookupOutcome(outcome, {
            entityNoun: "recipe",
            renderOne: (recipe) =>
              recipeToMarkdown(
                recipe,
                ctx.categoryStore.resolveNames(recipe.categories),
                ctx.mealStore.lastCookedAt(recipe.uid),
              ),
            disambiguationLine: (recipe) => `- ${recipe.name} (UID: ${recipe.uid})`,
          });
        },
        (guard) => guard,
      );
    },
  );
}
