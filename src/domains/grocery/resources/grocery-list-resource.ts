import type { GroceryListUid } from "../ids.js";
import type { GroceryState } from "../module.js";

import { defineResource } from "../../../kernel/resource.js";
import { resourceNotFound } from "../../../shared/resources.js";
import { groceryListToMarkdown } from "../grocery-helpers.js";

/**
 * `paprika://grocery-list/{uid}` — render a grocery list with its items inlined.
 * Grocery list is one of the three Content-class entities with a resource surface;
 * items are INLINED and co-owned by grocery (resolved through
 * `ctx.state.items.store`, not a dep), so a child grocery-item change fires
 * `resourceListChanged()`.
 *
 * The header leads with `**UID:**` then `**URI:**` — the resource's stable
 * identifier, carried in the header by every Content resource (recipe, menu too).
 */
export const groceryListResource = defineResource<GroceryState, "aisle" | "pantry">(
  {
    primary: {
      name: "grocery-lists",
      uriTemplate: "paprika://grocery-list/{uid}",
      description: "Paprika grocery lists accessible by UID",
    },
  },
  (ctx) => ({
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
    read: async (uri, variables) => {
      const uid = variables["uid"] as GroceryListUid;
      const list = ctx.state.lists.store.get(uid);
      if (!list) {
        resourceNotFound(`Grocery list not found: ${uid}`);
      }

      const items = ctx.state.items.store.getByListUid(uid);

      const headerLines = [`**UID:** \`${uid}\``, `**URI:** \`paprika://grocery-list/${uid}\``];

      const lastSynced = ctx.state.lists.store.lastSyncedAt;
      if (lastSynced) {
        headerLines.push(`**Last synced:** ${lastSynced.toISOString()}`);
      }

      const content = `${headerLines.join("\n")}\n\n${groceryListToMarkdown(list, items, ctx.deps.aisle)}`;
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
  }),
);
