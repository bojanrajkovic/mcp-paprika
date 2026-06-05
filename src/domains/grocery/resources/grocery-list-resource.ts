import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { GroceryListUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { GroceryState } from "../module.js";

import { groceryListToMarkdown } from "../grocery-helpers.js";

/**
 * Registers `paprika://grocery-list/{uid}`, kernel-shaped — reads this module's own
 * grocery-list + grocery-item stores via `ctx.state` (items are INLINED and co-owned
 * by grocery, so they resolve through `ctx.state.items.store`, not a dep). Grocery
 * list is one of the three Content-class entities with a resource surface (ADR-0004);
 * a child grocery-item change fires `resourceListChanged()` because items are inlined
 * here.
 *
 * Unlike the recipe resource, the header leads with `**UID:**` — `groceryListToMarkdown`
 * does not render the UID in its body, so there is no duplication.
 */
export function groceryListResource(ctx: DomainCtx<GroceryState, "aisle" | "pantry">): void {
  const template = new ResourceTemplate("paprika://grocery-list/{uid}", {
    list: async () => {
      const lists = ctx.state.lists.store.getAll();
      return {
        resources: lists.map((list) => ({
          uri: `paprika://grocery-list/${list.uid}`,
          name: list.name,
          mimeType: "text/markdown",
        })),
      };
    },
  });

  ctx.server.registerResource(
    "grocery-lists",
    template,
    { description: "Paprika grocery lists accessible by UID" },
    async (uri, variables) => {
      const uid = variables["uid"] as GroceryListUid;
      const list = ctx.state.lists.store.get(uid);
      if (!list) {
        throw new Error(`Grocery list not found: ${uid}`);
      }

      const items = ctx.state.items.store.getByListUid(uid);

      const headerLines = [`**UID:** \`${uid}\``, `**URI:** \`paprika://grocery-list/${uid}\``];

      const lastSynced = ctx.state.lists.store.lastSyncedAt;
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
