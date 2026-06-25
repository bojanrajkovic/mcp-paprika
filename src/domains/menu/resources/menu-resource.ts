import type { MenuUid } from "../ids.js";
import type { MenuState } from "../module.js";

import { defineResource } from "../../../kernel/resource.js";
import { resourceNotFound } from "../../../shared/resources.js";
import { menuToMarkdown } from "../menu-helpers.js";

/**
 * `paprika://menu/{uid}` — render a menu with its items inlined. Resolves the
 * meal-type catalog (for item name/order rendering) via `ctx.deps["meal-type"].getAll()`.
 * Menu is one of the three Content-class entities with a resource surface;
 * a child menu-item change fires `resourceListChanged()` because items are inlined here.
 *
 * Recipe references are NOT read — recipe linkage is denormalized onto `MenuItem.name`
 * at write time, so the resource needs only the meal-type dep of its two declared deps.
 */
export const menuResource = defineResource<MenuState, "recipe" | "meal-type">(
  {
    primary: {
      name: "menus",
      uriTemplate: "paprika://menu/{uid}",
      description: "Paprika menus accessible by UID",
    },
  },
  (ctx) => ({
    list: async () => {
      const menus = ctx.state.menus.store.getAll();
      return {
        resources: menus.map((menu) => ({
          uri: `paprika://menu/${menu.uid}`,
          name: menu.name,
          mimeType: "text/markdown",
        })),
      };
    },
    read: async (uri, variables) => {
      const uid = variables["uid"] as MenuUid;
      const menu = ctx.state.menus.store.get(uid);
      if (!menu) {
        resourceNotFound(`Menu not found: ${uid}`);
      }

      const items = ctx.state.items.store.getByMenuUid(uid);

      const headerLines = [`**UID:** \`${uid}\``, `**URI:** \`paprika://menu/${uid}\``];

      const lastSynced = ctx.state.menus.store.lastSyncedAt;
      if (lastSynced) {
        headerLines.push(`**Last synced:** ${lastSynced.toISOString()}`);
      }

      const body = menuToMarkdown(menu, items, ctx.deps["meal-type"].getAll());
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
  }),
);
