import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PantryItemUid } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";
import { pantryItemToMarkdown } from "../tools/pantry-helpers.js";

export function registerPantryResources(server: McpServer, ctx: ServerContext): void {
  const template = new ResourceTemplate("paprika://pantry/{uid}", {
    list: async () => {
      const items = ctx.pantryStore.getAll();
      return {
        resources: items.map((item) => ({
          uri: `paprika://pantry/${item.uid}`,
          name: item.ingredient,
          mimeType: "text/markdown",
        })),
      };
    },
  });

  server.registerResource(
    "pantry",
    template,
    { description: "Paprika pantry items accessible by UID" },
    async (uri, variables) => {
      const uid = variables["uid"] as PantryItemUid;
      const item = ctx.pantryStore.get(uid);
      if (!item) {
        throw new Error(`Pantry item not found: ${uid}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: pantryItemToMarkdown(item),
          },
        ],
      };
    },
  );
}
