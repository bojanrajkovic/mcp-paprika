import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GroceryListUid } from "../ids.js";
import type { ServerContext } from "../types/server-context.js";
import { groceryListToMarkdown } from "../tools/grocery-helpers.js";

export function registerGroceryListResources(server: McpServer, ctx: ServerContext): void {
  const template = new ResourceTemplate("paprika://grocery-list/{uid}", {
    list: async () => {
      const lists = ctx.groceryListStore.getAll();
      return {
        resources: lists.map((list) => ({
          uri: `paprika://grocery-list/${list.uid}`,
          name: list.name,
          mimeType: "text/markdown",
        })),
      };
    },
  });

  server.registerResource(
    "grocery-lists",
    template,
    { description: "Paprika grocery lists accessible by UID" },
    async (uri, variables) => {
      const uid = variables["uid"] as GroceryListUid;
      const list = ctx.groceryListStore.get(uid);
      if (!list) {
        throw new Error(`Grocery list not found: ${uid}`);
      }

      const items = ctx.groceryItemStore.getByListUid(uid);

      const headerLines = [`**UID:** \`${uid}\``, `**URI:** \`paprika://grocery-list/${uid}\``];

      const lastSynced = ctx.groceryListStore.lastSyncedAt;
      if (lastSynced) {
        headerLines.push(`**Last synced:** ${lastSynced.toISOString()}`);
      }

      const content = `${headerLines.join("\n")}\n\n${groceryListToMarkdown(list, items)}`;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: content,
          },
        ],
      };
    },
  );
}
