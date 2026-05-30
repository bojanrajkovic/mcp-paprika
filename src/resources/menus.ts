import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MenuUid } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";
import { menuToMarkdown } from "../tools/menu-helpers.js";

export function registerMenuResources(server: McpServer, ctx: ServerContext): void {
  const template = new ResourceTemplate("paprika://menu/{uid}", {
    list: async () => {
      const menus = ctx.menuStore.getAll();
      return {
        resources: menus.map((menu) => ({
          uri: `paprika://menu/${menu.uid}`,
          name: menu.name,
          mimeType: "text/markdown",
        })),
      };
    },
  });

  server.registerResource(
    "menus",
    template,
    { description: "Paprika menus accessible by UID" },
    async (uri, variables) => {
      const uid = variables["uid"] as MenuUid;
      const menu = ctx.menuStore.get(uid);
      if (!menu) {
        throw new Error(`Menu not found: ${uid}`);
      }

      const items = ctx.menuItemStore.getByMenuUid(uid);

      const headerLines = [`**UID:** \`${uid}\``, `**URI:** \`paprika://menu/${uid}\``];

      const lastSynced = ctx.menuStore.lastSyncedAt;
      if (lastSynced) {
        headerLines.push(`**Last synced:** ${lastSynced.toISOString()}`);
      }

      const body = menuToMarkdown(menu, items, ctx.mealTypeStore.getAll(), { includeItemUids: false });
      const content = `${headerLines.join("\n")}\n\n${body}`;
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
