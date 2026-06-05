import { join } from "node:path";

import type { Logger } from "pino";

import type { DiskCache } from "../../cache/disk-cache.js";
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
import { resolvePendingWriteTtl } from "../../utils/config.js";
import { groceryIngredientDiskDescriptor } from "./grocery-ingredient/disk.js";
import { GroceryIngredientStore } from "./grocery-ingredient/store.js";
import { groceryItemDiskDescriptor } from "./grocery-item/disk.js";
import { GroceryItemStore } from "./grocery-item/store.js";
import { groceryListDiskDescriptor } from "./grocery-list/disk.js";
import { GroceryListStore } from "./grocery-list/store.js";
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
export interface GroceryEntitySlice<Store, Cache> {
  readonly store: Store;
  readonly cache: Cache;
}

/**
 * The grocery module's state — the three-entity domain (like recipe and menu):
 * THREE store/cache pairs. Grocery lists and items are `EntityStore`s (replace-all
 * sync via `syncReplaceAllEntity`); the ingredient catalog is a plain name-keyed
 * store (a direct bespoke reconcile, no pending-write sweep). Foreign keys point OUT
 * to declared deps: items + ingredients file into aisles (`dependsOn: aisle`), and
 * `move_grocery_items_to_pantry` writes THROUGH the pantry contract (`dependsOn:
 * pantry`); grocery never reaches a sibling's store.
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
  commitGroceryList(saved: Readonly<GroceryList>): Promise<void>;
  /** Persist a saved grocery item locally. Inlined in the list resource → fires resourceListChanged. */
  commitGroceryItem(saved: Readonly<GroceryItem>): Promise<void>;
  /** Batch variant of commitGroceryItem: one flush, one resourceListChanged, one notifySync. */
  commitGroceryItemsBatch(items: ReadonlyArray<Readonly<GroceryItem>>): Promise<void>;
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
      await listCache.init();
      // Warm each store from cache so tools work on a warm restart before the first
      // sync completes.
      await hydrateStore(listCache, listStore);

      const itemStore = new GroceryItemStore({ pendingWriteTtlMs });
      const itemCache = new DiskCacheImpl<GroceryItem>({
        ...groceryItemDiskDescriptor,
        subdir: join(infra.cacheDir, groceryItemDiskDescriptor.subdir),
        log,
      });
      await itemCache.init();
      await hydrateStore(itemCache, itemStore);

      // The ingredient catalog is a plain name-keyed store (no pending-write TTL).
      const ingredientStore = new GroceryIngredientStore();
      const ingredientCache = new DiskCacheImpl<GroceryIngredient>({
        ...groceryIngredientDiskDescriptor,
        subdir: join(infra.cacheDir, groceryIngredientDiskDescriptor.subdir),
        log,
      });
      await ingredientCache.init();
      await hydrateStore(ingredientCache, ingredientStore);

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

      const commitGroceryList: GroceryWrites["commitGroceryList"] = async (saved) => {
        if (saved.deleted) {
          const uid: GroceryListUid = saved.uid;
          state.lists.store.markPendingDelete(uid);
          try {
            await state.lists.cache.remove(uid);
            await state.lists.cache.flush();
          } catch (e) {
            state.lists.store.clearPending(uid);
            throw e;
          }
          state.lists.store.delete(uid);
        } else {
          state.lists.store.markPendingUpsert(saved.uid);
          try {
            await state.lists.cache.put(saved);
            await state.lists.cache.flush();
          } catch (e) {
            state.lists.store.clearPending(saved.uid);
            throw e;
          }
          state.lists.store.set(saved);
        }
        notifier.resourceListChanged();
        await client.notifySync();
      };

      const commitGroceryItem: GroceryWrites["commitGroceryItem"] = async (saved) => {
        if (saved.deleted) {
          const uid: GroceryItemUid = saved.uid;
          state.items.store.markPendingDelete(uid);
          try {
            await state.items.cache.remove(uid);
            await state.items.cache.flush();
          } catch (e) {
            state.items.store.clearPending(uid);
            throw e;
          }
          state.items.store.delete(uid);
        } else {
          state.items.store.markPendingUpsert(saved.uid);
          try {
            await state.items.cache.put(saved);
            await state.items.cache.flush();
          } catch (e) {
            state.items.store.clearPending(saved.uid);
            throw e;
          }
          state.items.store.set(saved);
        }
        notifier.resourceListChanged();
        await client.notifySync();
      };

      const commitGroceryItemsBatch: GroceryWrites["commitGroceryItemsBatch"] = async (items) => {
        if (items.length === 0) return;
        const markedUids: Array<GroceryItemUid> = [];
        for (const item of items) {
          if (item.deleted) {
            state.items.store.markPendingDelete(item.uid);
          } else {
            state.items.store.markPendingUpsert(item.uid);
          }
          markedUids.push(item.uid);
        }
        const clearPending = (): void => {
          for (const uid of markedUids) state.items.store.clearPending(uid);
        };
        // allSettled (not Promise.all): fail-fast would let in-flight ops race the
        // clearPending call in the catch block. We wait for every op to settle first.
        //
        // All-or-nothing store semantics on failure is intentional: saveGroceryItems()
        // already succeeded, so any local cache/store divergence is temporary and
        // reconciled by the next sync. Clearing all pending marks on failure is
        // strictly better than leaving some marked — a marked UID suppresses sync
        // reconciliation until TTL, which would keep stale local state around longer.
        const opsResults = await Promise.allSettled(
          items.map((item) => (item.deleted ? state.items.cache.remove(item.uid) : state.items.cache.put(item))),
        );
        const opsFailure = opsResults.find((r): r is PromiseRejectedResult => r.status === "rejected");
        if (opsFailure !== undefined) {
          clearPending();
          throw opsFailure.reason;
        }
        try {
          await state.items.cache.flush();
        } catch (e) {
          clearPending();
          throw e;
        }
        for (const item of items) {
          if (item.deleted) {
            state.items.store.delete(item.uid);
          } else {
            state.items.store.set(item);
          }
        }
        notifier.resourceListChanged();
        await client.notifySync();
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
        flush: async () => {
          await state.lists.cache.flush();
          await state.items.cache.flush();
          await state.ingredients.cache.flush();
        },
      };
    }),
);
