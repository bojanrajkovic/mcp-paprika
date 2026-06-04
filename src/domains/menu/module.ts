import { join } from "node:path";

import type { Logger } from "pino";

import type { DiskCache } from "../../cache/disk-cache.js";
import type { PaprikaClient } from "../../paprika/client.js";
import type { Notifier } from "../../server/notifier.js";
import type { MenuApi } from "./api.js";
import type { MenuItem } from "./menu-item/types.js";
import type { Menu } from "./types.js";

import { DiskCache as DiskCacheImpl } from "../../cache/disk-cache.js";
import { hydrateStore } from "../../cache/hydrate.js";
import { defineModule, register } from "../../kernel/registry.js";
import { resolvePendingWriteTtl } from "../../utils/config.js";
import { menuDiskDescriptor } from "./disk.js";
import { menuItemDiskDescriptor } from "./menu-item/disk.js";
import { MenuItemStore } from "./menu-item/store.js";
import { menuResource } from "./resources/menu-resource.js";
import { MenuStore } from "./store.js";
import { menuItemsSync } from "./syncs/menu-item-sync.js";
import { menusSync } from "./syncs/menu-sync.js";
import { createMenuTool } from "./tools/create.js";
import { deleteMenuTool } from "./tools/delete.js";
import { listMenusTool } from "./tools/list.js";
import { deleteMenuItemTool } from "./tools/menu-item-delete.js";
import { moveMenuItemTool } from "./tools/menu-item-move.js";
import { updateMenuItemTool } from "./tools/menu-item-update.js";
import { addMenuItemsTool } from "./tools/menu-item-write.js";
import { readMenuTool } from "./tools/read.js";
import { updateMenuTool } from "./tools/update.js";

declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    menu: MenuApi;
  }
}

/** One store + cache pair for one of menu's two owned entities — both plain `DiskCache`. */
export interface MenuEntitySlice<Store, Cache> {
  readonly store: Store;
  readonly cache: Cache;
}

/**
 * The menu module's internals. It carries TWO store/cache pairs (menus + menu-items),
 * because the menu and its inlined items are one Content domain: a child-item change
 * invalidates the parent `paprika://menu/{uid}` resource, so both fire
 * `resourceListChanged()`.
 *
 * The write-capable commit chokepoints (`commitMenu`, `commitMenuItem`,
 * `commitMenuItemsBatch`) are bound HERE in `.self`, not in `.build`, because they
 * WRITE — they close over `infra.client` and `infra.notifier`, which the factory has
 * and `.build` does not (mirrors aisle's `ensureAisle` and recipe's `commitRecipe`).
 * The read-only contract methods are assembled from the stores in `.build`.
 */
export interface MenuSelf {
  readonly menus: MenuEntitySlice<MenuStore, DiskCache<Menu>>;
  readonly items: MenuEntitySlice<MenuItemStore, DiskCache<MenuItem>>;

  /** Persist a saved menu locally, then nudge cloud sync. Content → fires resourceListChanged. */
  commitMenu(saved: Readonly<Menu>): Promise<void>;
  /** Persist a saved menuitem locally. Inlined in the menu resource → fires resourceListChanged. */
  commitMenuItem(saved: Readonly<MenuItem>): Promise<void>;
  /** Batch variant of commitMenuItem: one flush, one resourceListChanged, one notifySync. */
  commitMenuItemsBatch(items: ReadonlyArray<Readonly<MenuItem>>): Promise<void>;
}

register(
  defineModule("menu", ["recipe", "meal-type"])
    .self<MenuSelf>(async (infra) => {
      const client: PaprikaClient = infra.client;
      const notifier: Notifier = infra.notifier;
      const log: Logger = infra.log;

      // Two stores + two plain caches. Disk is flat: each cache's subdir is the
      // original `<cacheDir>/menus` | `/menuitems` (reuse-in-place — ADR-0009 keeps
      // the cache un-namespaced, so there is no migration).
      const pendingWriteTtlMs = resolvePendingWriteTtl(infra.config);
      const menuStore = new MenuStore({ pendingWriteTtlMs });
      const menuCache = new DiskCacheImpl<Menu>({
        ...menuDiskDescriptor,
        subdir: join(infra.cacheDir, menuDiskDescriptor.subdir),
        log,
      });
      await menuCache.init();
      // Warm both stores from cache so tools work on a warm restart before the
      // first sync; drop tombstones on load (`!deleted` filter).
      await hydrateStore(menuCache, menuStore, (m) => !m.deleted);

      const menuItemStore = new MenuItemStore({ pendingWriteTtlMs });
      const menuItemCache = new DiskCacheImpl<MenuItem>({
        ...menuItemDiskDescriptor,
        subdir: join(infra.cacheDir, menuItemDiskDescriptor.subdir),
        log,
      });
      await menuItemCache.init();
      await hydrateStore(menuItemCache, menuItemStore, (mi) => !mi.deleted);

      // ---- Menu write chokepoints ----
      // Order: markPending* (FIRST, before any cache I/O) → cache put/remove → flush →
      // store set/delete → resourceListChanged → notifySync. The pending mark shields
      // this UID from sync-cycle reconciliation during the propagation race. Menus and
      // menuitems both fire resourceListChanged() — menus have an MCP resource surface
      // and menuitems are inlined in it.

      const commitMenu: MenuSelf["commitMenu"] = async (saved) => {
        if (saved.deleted) {
          const uid = saved.uid;
          menuStore.markPendingDelete(uid);
          try {
            await menuCache.remove(uid);
            await menuCache.flush();
          } catch (e) {
            menuStore.clearPending(uid);
            throw e;
          }
          menuStore.delete(uid);
        } else {
          menuStore.markPendingUpsert(saved.uid);
          try {
            await menuCache.put(saved);
            await menuCache.flush();
          } catch (e) {
            menuStore.clearPending(saved.uid);
            throw e;
          }
          menuStore.set(saved);
        }
        notifier.resourceListChanged();
        await client.notifySync();
      };

      const commitMenuItem: MenuSelf["commitMenuItem"] = async (saved) => {
        if (saved.deleted) {
          const uid = saved.uid;
          menuItemStore.markPendingDelete(uid);
          try {
            await menuItemCache.remove(uid);
            await menuItemCache.flush();
          } catch (e) {
            menuItemStore.clearPending(uid);
            throw e;
          }
          menuItemStore.delete(uid);
        } else {
          menuItemStore.markPendingUpsert(saved.uid);
          try {
            await menuItemCache.put(saved);
            await menuItemCache.flush();
          } catch (e) {
            menuItemStore.clearPending(saved.uid);
            throw e;
          }
          menuItemStore.set(saved);
        }
        notifier.resourceListChanged();
        await client.notifySync();
      };

      const commitMenuItemsBatch: MenuSelf["commitMenuItemsBatch"] = async (items) => {
        if (items.length === 0) return;
        const markedUids: Array<MenuItem["uid"]> = [];
        for (const item of items) {
          if (item.deleted) {
            menuItemStore.markPendingDelete(item.uid);
          } else {
            menuItemStore.markPendingUpsert(item.uid);
          }
          markedUids.push(item.uid);
        }
        const clearPending = (): void => {
          for (const uid of markedUids) menuItemStore.clearPending(uid);
        };
        // allSettled (not Promise.all): fail-fast would let in-flight ops race the
        // clearPending call in the catch block. We wait for every op to settle first.
        const opsResults = await Promise.allSettled(
          items.map((item) => (item.deleted ? menuItemCache.remove(item.uid) : menuItemCache.put(item))),
        );
        const opsFailure = opsResults.find((r): r is PromiseRejectedResult => r.status === "rejected");
        if (opsFailure !== undefined) {
          clearPending();
          throw opsFailure.reason;
        }
        try {
          await menuItemCache.flush();
        } catch (e) {
          clearPending();
          throw e;
        }
        for (const item of items) {
          if (item.deleted) {
            menuItemStore.delete(item.uid);
          } else {
            menuItemStore.set(item);
          }
        }
        notifier.resourceListChanged();
        await client.notifySync();
      };

      return {
        menus: { store: menuStore, cache: menuCache },
        items: { store: menuItemStore, cache: menuItemCache },
        commitMenu,
        commitMenuItem,
        commitMenuItemsBatch,
      };
    })
    .build((self) => ({
      api: {
        get: (uid) => self.menus.store.get(uid),
        findByName: (query) => self.menus.store.findByName(query),
        itemsOf: (menuUid) => self.items.store.getByMenuUid(menuUid),
        hasSynced: () => self.menus.store.hasSynced && self.items.store.hasSynced,
      },
      // ctx is INFERRED — DomainCtx<MenuSelf, "recipe" | "meal-type">. Reaching any
      // other dep, or `ctx.deps.recipe.store` / `.cache`, would not compile.
      tools: [
        listMenusTool,
        readMenuTool,
        createMenuTool,
        updateMenuTool,
        deleteMenuTool,
        addMenuItemsTool,
        updateMenuItemTool,
        deleteMenuItemTool,
        moveMenuItemTool,
      ],
      resources: [menuResource],
      // Order matters: menu before menu-item (children reference parent). Both
      // additive — a soft read surface must not abort core sync, so the kernel
      // runs each in its own best-effort try/catch.
      syncs: [menusSync(self), menuItemsSync(self)],
      flush: async () => {
        await self.menus.cache.flush();
        await self.items.cache.flush();
      },
    })),
);
