import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { coldStartGuard, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerListTool(server: McpServer, ctx: ServerContext): void {
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
            const categoryNames = ctx.store.resolveCategories(recipe.categories);
            const cats = categoryNames.length > 0 ? ` [${categoryNames.join(", ")}]` : "";
            return `- **${recipe.name}**${cats} (uid: ${recipe.uid})`;
          });

          return textResult(header + "\n" + lines.join("\n"));
        },
        (guard) => guard,
      );
    },
  );
}
