import { join } from "node:path";

import { okAsync, ResultAsync } from "neverthrow";
import type { Logger } from "pino";

import type { CacheError, DiskCache } from "../../cache/disk-cache.js";
import type { GroceryItemUid, GroceryListUid } from "../../ids.js";
import type { PaprikaClient } from "../../paprika/client.js";
import type { Notifier } from "../../server/notifier.js";
import type { GroceryApi } from "./api.js";
import type { GroceryIngredient } from "./grocery-ingredient/types.js";
import type { GroceryItem } from "./grocery-item/types.js";
import type { GroceryList } from "./grocery-list/types.js";

import { DiskCache as DiskCacheImpl } from "../../cache/disk-cache.js";
import { hydrateStore } from "../../cache/hydrate.js";
import { defineModule, register } from "../../kernel/registry.js";
import { notifySyncBestEffort } from "../../paprika/client.js";
import { resolvePendingWriteTtl } from "../../utils/config.js";
import { unwrapAtBoot } from "../../utils/errors.js";
import { GroceryIngredientStore } from "./grocery-ingredient/store.js";
import { groceryIngredientDiskDescriptor } from "./grocery-ingredient/types.js";
import { GroceryItemStore } from "./grocery-item/store.js";
import { groceryItemDiskDescriptor } from "./grocery-item/types.js";
import { GroceryListStore } from "./grocery-list/store.js";
import { groceryListDiskDescriptor } from "./grocery-list/types.js";
import { groceryListResource } from "./resources/grocery-list-resource.js";
import { groceryIngredientsSync } from "./syncs/ingredient-sync.js";
import { groceryItemsSync } from "./syncs/item-sync.js";
import { groceryListsSync } from "./syncs/list-sync.js";
import { clearGroceryListTool, clearPurchasedTool } from "./tools/grocery-clear.js";
import { markGroceryItemPurchasedTool } from "./tools/grocery-item-purchase.js";
import { addGroceryItemsTool, deleteGroceryItemTool, updateGroceryItemTool } from "./tools/grocery-item.js";
import {
  createGroceryListTool,
  deleteGroceryListTool,
  listGroceryListsTool,
  readGroceryListTool,
  renameGroceryListTool,
} from "./tools/grocery-list.js";
import { moveToPantryTool } from "./tools/grocery-move.js";

declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    grocery: GroceryApi;
  }
}

/** One store + cache pair for one of grocery's three owned entities. */
interface GroceryEntitySlice<Store, Cache> {
  readonly store: Store;
  readonly cache: Cache;
}

/**
 * The grocery module's state — the three-entity domain (like recipe and menu):
 * THREE store/cache pairs. Grocery lists and items are `EntityStore`s (replace-all
 * sync via `syncReplaceAllEntity`); the ingredient catalog is a plain name-keyed
 * store (a direct bespoke reconcile, no pending-write sweep). Foreign keys point OUT
 * to declared deps: items + ingredients file into aisles (`dependsOn: aisle`), and
 * `move_grocery_items_to_pantry` writes THROUGH the pantry contract (`dependsOn: pantry`).
 */
export interface GroceryState {
  readonly lists: GroceryEntitySlice<GroceryListStore, DiskCache<GroceryList>>;
  readonly items: GroceryEntitySlice<GroceryItemStore, DiskCache<GroceryItem>>;
  readonly ingredients: GroceryEntitySlice<GroceryIngredientStore, DiskCache<GroceryIngredient>>;
}

/**
 * Grocery's write chokepoints (`ctx.writes`), invoked by its own list/item tools.
 * Grocery lists AND items both fire `resourceListChanged()` — lists have an MCP
 * resource surface and items are inlined in it. (The ingredient catalog write, in
 * `add_grocery_items`, is silent and stays inline in the tool.)
 */
export interface GroceryWrites {
  /** Persist a saved grocery list locally, then nudge cloud sync. Content → fires resourceListChanged. */
  commitGroceryList(saved: Readonly<GroceryList>): ResultAsync<void, CacheError>;
  /** Persist a saved grocery item locally. Inlined in the list resource → fires resourceListChanged. */
  commitGroceryItem(saved: Readonly<GroceryItem>): ResultAsync<void, CacheError>;
  /** Batch variant of commitGroceryItem: one flush, one resourceListChanged, one notifySync. */
  commitGroceryItemsBatch(items: ReadonlyArray<Readonly<GroceryItem>>): ResultAsync<void, CacheError>;
}

register(
  defineModule("grocery", ["aisle", "pantry"])
    .state<GroceryState>(async (infra) => {
      const log: Logger = infra.log;

      // Three stores + three plain caches. Disk is flat: each cache's subdir is the
      // original `<cacheDir>/grocerylists` | `/groceryitems` | `/groceryingredients`
      // (reuse-in-place — ADR-0009 keeps the cache un-namespaced, so there is no
      // migration).
      const pendingWriteTtlMs = resolvePendingWriteTtl(infra.config);
      const listStore = new GroceryListStore({ pendingWriteTtlMs });
      const listCache = new DiskCacheImpl<GroceryList>({
        ...groceryListDiskDescriptor,
        subdir: join(infra.cacheDir, groceryListDiskDescriptor.subdir),
        log,
      });
      unwrapAtBoot(await listCache.init(), "grocery list cache init");
      // Warm each store from cache so tools work on a warm restart before the first
      // sync completes.
      unwrapAtBoot(await hydrateStore(listCache, listStore), "grocery list cache hydrate");

      const itemStore = new GroceryItemStore({ pendingWriteTtlMs });
      const itemCache = new DiskCacheImpl<GroceryItem>({
        ...groceryItemDiskDescriptor,
        subdir: join(infra.cacheDir, groceryItemDiskDescriptor.subdir),
        log,
      });
      unwrapAtBoot(await itemCache.init(), "grocery item cache init");
      unwrapAtBoot(await hydrateStore(itemCache, itemStore), "grocery item cache hydrate");

      // The ingredient catalog is a plain name-keyed store (no pending-write TTL).
      const ingredientStore = new GroceryIngredientStore();
      const ingredientCache = new DiskCacheImpl<GroceryIngredient>({
        ...groceryIngredientDiskDescriptor,
        subdir: join(infra.cacheDir, groceryIngredientDiskDescriptor.subdir),
        log,
      });
      unwrapAtBoot(await ingredientCache.init(), "grocery ingredient cache init");
      unwrapAtBoot(await hydrateStore(ingredientCache, ingredientStore), "grocery ingredient cache hydrate");

      return {
        lists: { store: listStore, cache: listCache },
        items: { store: itemStore, cache: itemCache },
        ingredients: { store: ingredientStore, cache: ingredientCache },
      };
    })
    .build((state, infra) => {
      const client: PaprikaClient = infra.client;
      const notifier: Notifier = infra.notifier;

      // ---- Grocery write chokepoints ----
      // Assembled here (not in `.state`) because they close over `infra.client` and
      // `infra.notifier`, keeping GroceryState pure (ADR-0012). All three are internal —
      // grocery's own tools reach them via `ctx.writes`; the empty `api` exposes none
      // (no live sibling reads grocery — see api.ts).
      //
      // Order: markPending* (FIRST, before any cache I/O) → cache put/remove → flush →
      // store set/delete → resourceListChanged → notifySync. The pending mark shields
      // this UID from sync-cycle reconciliation during the propagation race.

      const commitGroceryList: GroceryWrites["commitGroceryList"] = (saved) => {
        if (saved.deleted) {
          const uid: GroceryListUid = saved.uid;
          state.lists.store.markPendingDelete(uid);
          return state.lists.cache
            .remove(uid)
            .andThen(() => state.lists.cache.flush())
            .mapErr((e) => {
              state.lists.store.clearPending(uid);
              return e;
            })
            .andThen(() => {
              state.lists.store.delete(uid);
              notifier.resourceListChanged();
              return notifySyncBestEffort(client, infra.log);
            });
        }
        state.lists.store.markPendingUpsert(saved.uid);
        return state.lists.cache
          .put(saved)
          .andThen(() => state.lists.cache.flush())
          .mapErr((e) => {
            state.lists.store.clearPending(saved.uid);
            return e;
          })
          .andThen(() => {
            state.lists.store.set(saved);
            notifier.resourceListChanged();
            return notifySyncBestEffort(client, infra.log);
          });
      };

      const commitGroceryItem: GroceryWrites["commitGroceryItem"] = (saved) => {
        if (saved.deleted) {
          const uid: GroceryItemUid = saved.uid;
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

      const commitGroceryItemsBatch: GroceryWrites["commitGroceryItemsBatch"] = (items) => {
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
        //
        // All-or-nothing store semantics on failure is intentional: saveGroceryItems()
        // already succeeded, so any local cache/store divergence is temporary and
        // reconciled by the next sync. Clearing all pending marks on failure is
        // strictly better than leaving some marked — a marked UID suppresses sync
        // reconciliation until TTL, which would keep stale local state around longer.
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
        // Empty contract — no live sibling reads grocery state (see api.ts).
        api: {},
        writes: { commitGroceryList, commitGroceryItem, commitGroceryItemsBatch },
        // ctx is INFERRED — DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>.
        // Reaching any other dep, or `ctx.deps.aisle.store` / `ctx.deps.pantry.store`,
        // would not compile.
        tools: [
          listGroceryListsTool,
          readGroceryListTool,
          createGroceryListTool,
          renameGroceryListTool,
          deleteGroceryListTool,
          addGroceryItemsTool,
          updateGroceryItemTool,
          deleteGroceryItemTool,
          markGroceryItemPurchasedTool,
          clearPurchasedTool,
          clearGroceryListTool,
          moveToPantryTool,
        ],
        resources: [groceryListResource],
        // Order matters: lists before items (children reference parent), then the
        // ingredient catalog. All three are core — inside the outer try that aborts the
        // sync cycle on failure.
        syncs: [groceryListsSync(state), groceryItemsSync(state), groceryIngredientsSync()],
        flush: () =>
          ResultAsync.combine([
            state.lists.cache.flush(),
            state.items.cache.flush(),
            state.ingredients.cache.flush(),
          ]).map(() => undefined),
      };
    }),
);
