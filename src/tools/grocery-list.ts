import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GroceryListUidSchema } from "../paprika/types.js";
import { groceryStartGuard, groceryListToMarkdown } from "./grocery-helpers.js";
import { textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerListGroceryListsTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "list_grocery_lists" });
  server.registerTool(
    "list_grocery_lists",
    {
      description:
        "List all grocery lists sorted alphabetically by name. Returns the name, UID, and item count for each list. Use read_grocery_list with the UID for full details including items.",
      inputSchema: {},
    },
    async () => {
      log.info({ tool: "list_grocery_lists" }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const all = ctx.groceryListStore.getAll().sort((a, b) => a.name.localeCompare(b.name));
          const total = all.length;

          if (total === 0) {
            return textResult("No grocery lists found.");
          }

          const header = `You have ${total.toString()} grocery list(s):`;
          const lines = all.map((list) => {
            const itemCount = ctx.groceryItemStore.getByListUid(list.uid).length;
            return `- **${list.name}** — ${itemCount.toString()} item(s) (uid: \`${list.uid}\`)`;
          });

          return textResult(header + "\n\n" + lines.join("\n"));
        },
        (guard) => guard,
      );
    },
  );
}

export function registerReadGroceryListTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "read_grocery_list" });
  server.registerTool(
    "read_grocery_list",
    {
      description:
        "Get a grocery list by UID or name. When both are provided, UID takes precedence. " +
        "Name lookup is tiered (exact → starts-with → contains) and case-insensitive. Returns " +
        "a disambiguation list when multiple lists match the same tier.",
      inputSchema: {
        uid: z.string().optional().describe("Exact grocery list UID"),
        name: z.string().optional().describe("Grocery list name (tiered fuzzy match)"),
      },
    },
    async (args) => {
      log.info({ tool: "read_grocery_list", ...args }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          if (!args.uid && !args.name) {
            return textResult("Please provide either a uid or name to look up a grocery list.");
          }

          if (args.uid) {
            const list = ctx.groceryListStore.get(GroceryListUidSchema.parse(args.uid));
            if (!list) {
              return textResult(`No grocery list found with UID "${args.uid}".`);
            }
            const items = ctx.groceryItemStore.getByListUid(list.uid);
            return textResult(groceryListToMarkdown(list, items));
          }

          // name is truthy here (else branch of the uid check)
          const name = args.name!;
          const matches = ctx.groceryListStore.findByName(name);

          if (matches.length === 0) {
            return textResult(`No grocery list found matching "${name}".`);
          }

          if (matches.length === 1) {
            const list = matches[0]!;
            const items = ctx.groceryItemStore.getByListUid(list.uid);
            return textResult(groceryListToMarkdown(list, items));
          }

          const lines = matches.map((list) => `- **${list.name}** (uid: \`${list.uid}\`)`).join("\n");
          return textResult(
            `Multiple grocery lists match "${name}":\n${lines}\n\nPlease re-invoke with a specific uid.`,
          );
        },
        (guard) => guard,
      );
    },
  );
}
