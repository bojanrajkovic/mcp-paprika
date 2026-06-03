import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerContext } from "../types/server-context.js";

import { coldStartGuard, textResult } from "./helpers.js";

export function registerListTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "list_recipes" });
  server.registerTool(
    "list_recipes",
    {
      description:
        "List all recipes with pagination. Returns recipe summaries sorted alphabetically. Use offset/limit to paginate through the full library. Response includes total recipe count.",
      inputSchema: {
        offset: z.number().int().nonnegative().optional().default(0).describe("Number of recipes to skip (default: 0)"),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .default(25)
          .describe("Maximum number of recipes to return (default: 25, max: 50)"),
      },
    },
    async (args) => {
      log.info({ tool: "list_recipes", ...args }, "tool invoked");
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const all = ctx.store.getAll().sort((a, b) => a.name.localeCompare(b.name));
          const total = all.length;
          const page = all.slice(args.offset, args.offset + args.limit);

          if (page.length === 0) {
            return textResult(`No recipes found (total: ${total.toString()}, offset: ${args.offset.toString()}).`);
          }

          const header = `Showing ${page.length.toString()} of ${total.toString()} recipes (offset: ${args.offset.toString()}):\n`;
          const lines = page.map((recipe) => {
            const categoryNames = ctx.categoryStore.resolveNames(recipe.categories);
            const cats = categoryNames.length > 0 ? ` [${categoryNames.join(", ")}]` : "";
            const meta: Array<string> = [];
            const dateOnly = recipe.created.slice(0, 10);
            meta.push(`created: ${dateOnly}`);
            if (recipe.rating > 0) meta.push(`rating: ${recipe.rating.toString()}/5`);
            const lastCooked = ctx.mealStore.lastCookedAt(recipe.uid);
            if (lastCooked) meta.push(`last cooked: ${lastCooked.slice(0, 10)}`);
            if (recipe.isPinned) meta.push("pinned");
            if (recipe.onGroceryList) meta.push("on grocery list");
            const metaSuffix = ` · ${meta.join(" · ")}`;
            return `- **${recipe.name}**${cats} (uid: ${recipe.uid})${metaSuffix}`;
          });

          return textResult(header + "\n" + lines.join("\n"));
        },
        (guard) => guard,
      );
    },
  );
}
