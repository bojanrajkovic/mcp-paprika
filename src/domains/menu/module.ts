import { join } from "node:path";

import { okAsync, ResultAsync } from "neverthrow";
import type { Logger } from "pino";

import type { CacheError, DiskCache } from "../../cache/disk-cache.js";
import type { PaprikaClient } from "../../paprika/client.js";
import type { Notifier } from "../../server/notifier.js";
import type { MenuApi } from "./api.js";
import type { MenuItem } from "./menu-item/types.js";
import type { Menu } from "./types.js";

import { DiskCache as DiskCacheImpl } from "../../cache/disk-cache.js";
import { hydrateStore } from "../../cache/hydrate.js";
import { defineModule, register } from "../../kernel/registry.js";
import { notifySyncBestEffort } from "../../paprika/client.js";
import { resolvePendingWriteTtl } from "../../utils/config.js";
import { unwrapAtBoot } from "../../utils/errors.js";
import { MenuItemStore } from "./menu-item/store.js";
import { menuItemDiskDescriptor } from "./menu-item/types.js";
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
import { menuDiskDescriptor } from "./types.js";

declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    menu: MenuApi;
  }
}

/** One store + cache pair for one of menu's two owned entities — both plain `DiskCache`. */
interface MenuEntitySlice<Store, Cache> {
  readonly store: Store;
  readonly cache: Cache;
}

/**
 * The menu module's state — TWO store/cache pairs (menus + menu-items), because the
 * menu and its inlined items are one Content domain: a child-item change invalidates
 * the parent `paprika://menu/{uid}` resource, so both fire `resourceListChanged()`.
 */
export interface MenuState {
  readonly menus: MenuEntitySlice<MenuStore, DiskCache<Menu>>;
  readonly items: MenuEntitySlice<MenuItemStore, DiskCache<MenuItem>>;
}

/**
 * Menu's write chokepoints (`ctx.writes`), invoked by its own menu/menu-item tools.
 * Menus AND menu-items both fire `resourceListChanged()` — menus have an MCP resource
 * surface and menu-items are inlined in it.
 */
export interface MenuWrites {
  /** Persist a saved menu locally, then nudge cloud sync. Content → fires resourceListChanged. */
  commitMenu(saved: Readonly<Menu>): ResultAsync<void, CacheError>;
  /** Persist a saved menuitem locally. Inlined in the menu resource → fires resourceListChanged. */
  commitMenuItem(saved: Readonly<MenuItem>): ResultAsync<void, CacheError>;
  /** Batch variant of commitMenuItem: one flush, one resourceListChanged, one notifySync. */
  commitMenuItemsBatch(items: ReadonlyArray<Readonly<MenuItem>>): ResultAsync<void, CacheError>;
}

register(
  defineModule("menu", ["recipe", "meal-type"])
    .state<MenuState>(async (infra) => {
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
      unwrapAtBoot(await menuCache.init(), "menu cache init");
      // Warm both stores from cache so tools work on a warm restart before the first sync.
      unwrapAtBoot(await hydrateStore(menuCache, menuStore), "menu cache hydrate");

      const menuItemStore = new MenuItemStore({ pendingWriteTtlMs });
      const menuItemCache = new DiskCacheImpl<MenuItem>({
        ...menuItemDiskDescriptor,
        subdir: join(infra.cacheDir, menuItemDiskDescriptor.subdir),
        log,
      });
      unwrapAtBoot(await menuItemCache.init(), "menu item cache init");
      unwrapAtBoot(await hydrateStore(menuItemCache, menuItemStore), "menu item cache hydrate");

      return {
        menus: { store: menuStore, cache: menuCache },
        items: { store: menuItemStore, cache: menuItemCache },
      };
    })
    .build((state, infra) => {
      const client: PaprikaClient = infra.client;
      const notifier: Notifier = infra.notifier;

      // ---- Menu write chokepoints ----
      // Assembled here (not in `.state`) because they close over `infra.client` and
      // `infra.notifier`, keeping MenuState pure (ADR-0012). All three are internal —
      // menu's own tools reach them via `ctx.writes`; the read `api` is assembled below
      // from the stores.
      //
      // Order: markPending* (FIRST, before any cache I/O) → cache put/remove → flush →
      // store set/delete → resourceListChanged → notifySync. The pending mark shields
      // this UID from sync-cycle reconciliation during the propagation race.

      const commitMenu: MenuWrites["commitMenu"] = (saved) => {
        if (saved.deleted) {
          const uid = saved.uid;
          state.menus.store.markPendingDelete(uid);
          return state.menus.cache
            .remove(uid)
            .andThen(() => state.menus.cache.flush())
            .mapErr((e) => {
              state.menus.store.clearPending(uid);
              return e;
            })
            .andThen(() => {
              state.menus.store.delete(uid);
              notifier.resourceListChanged();
              return notifySyncBestEffort(client, infra.log);
            });
        }
        state.menus.store.markPendingUpsert(saved.uid);
        return state.menus.cache
          .put(saved)
          .andThen(() => state.menus.cache.flush())
          .mapErr((e) => {
            state.menus.store.clearPending(saved.uid);
            return e;
          })
          .andThen(() => {
            state.menus.store.set(saved);
            notifier.resourceListChanged();
            return notifySyncBestEffort(client, infra.log);
          });
      };

      const commitMenuItem: MenuWrites["commitMenuItem"] = (saved) => {
        if (saved.deleted) {
          const uid = saved.uid;
          state.items.store.markPendingDelete(uid);
          return state.items.cache
            .remove(uid)
            .andThen(() => state.items.cache.flush())
            .mapErr((e) => {
              state.items.store.clearPending(uid);
              return e;
            })
            .andThen(() => {
              state.items.store.delete(uid);
              notifier.resourceListChanged();
              return notifySyncBestEffort(client, infra.log);
            });
        }
        state.items.store.markPendingUpsert(saved.uid);
        return state.items.cache
          .put(saved)
          .andThen(() => state.items.cache.flush())
          .mapErr((e) => {
            state.items.store.clearPending(saved.uid);
            return e;
          })
          .andThen(() => {
            state.items.store.set(saved);
            notifier.resourceListChanged();
            return notifySyncBestEffort(client, infra.log);
          });
      };

      const commitMenuItemsBatch: MenuWrites["commitMenuItemsBatch"] = (items) => {
        if (items.length === 0) return okAsync(undefined);
        for (const item of items) {
          if (item.deleted) {
            state.items.store.markPendingDelete(item.uid);
          } else {
            state.items.store.markPendingUpsert(item.uid);
          }
        }
        const clearPending = (): void => {
          for (const item of items) state.items.store.clearPending(item.uid);
        };
        // `ResultAsync.combine` awaits every op (the underlying promises never
        // reject), so a failure cannot race `clearPending`.
        return ResultAsync.combine(
          items.map((item) => (item.deleted ? state.items.cache.remove(item.uid) : state.items.cache.put(item))),
        )
          .andThen(() => state.items.cache.flush())
          .mapErr((e) => {
            clearPending();
            return e;
          })
          .andThen(() => {
            for (const item of items) {
              if (item.deleted) {
                state.items.store.delete(item.uid);
              } else {
                state.items.store.set(item);
              }
            }
            notifier.resourceListChanged();
            return notifySyncBestEffort(client, infra.log);
          });
      };

      return {
        api: {
          get: (uid) => state.menus.store.get(uid),
          findByName: (query) => state.menus.store.findByName(query),
          itemsOf: (menuUid) => state.items.store.getByMenuUid(menuUid),
          hasSynced: () => state.menus.store.hasSynced && state.items.store.hasSynced,
        },
        writes: { commitMenu, commitMenuItem, commitMenuItemsBatch },
        // ctx is INFERRED — DomainCtx<MenuState, "recipe" | "meal-type", MenuWrites>.
        // Reaching any other dep, or `ctx.deps.recipe.store` / `.cache`, would not compile.
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
        syncs: [menusSync(state), menuItemsSync(state)],
        flush: () => ResultAsync.combine([state.menus.cache.flush(), state.items.cache.flush()]).map(() => undefined),
      };
    }),
);
