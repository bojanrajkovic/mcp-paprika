import { join } from "node:path";

import type { Logger } from "pino";

import type { DiskCache } from "../cache/disk-cache.js";
import type { GroceryIngredient } from "../grocery-ingredient/types.js";
import type { GroceryItem } from "../grocery-item/types.js";
import type { GroceryList } from "../grocery-list/types.js";
import type { GroceryItemUid, GroceryListUid } from "../ids.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { Notifier } from "../server/notifier.js";
import type { GroceryApi } from "./api.js";

import { DiskCache as DiskCacheImpl } from "../cache/disk-cache.js";
import { groceryIngredientDiskDescriptor } from "../grocery-ingredient/disk.js";
import { GroceryIngredientStore } from "../grocery-ingredient/store.js";
import { groceryItemDiskDescriptor } from "../grocery-item/disk.js";
import { GroceryItemStore } from "../grocery-item/store.js";
import { groceryListDiskDescriptor } from "../grocery-list/disk.js";
import { GroceryListStore } from "../grocery-list/store.js";
import { defineModule, register } from "../kernel/registry.js";
import { groceryListResource } from "./resources/grocery-list-resource.js";
import { groceryIngredientsSync } from "./syncs/ingredient-sync.js";
import { groceryItemsSync } from "./syncs/item-sync.js";
import { groceryListsSync } from "./syncs/list-sync.js";
import { clearAllTool, clearPurchasedTool } from "./tools/grocery-clear.js";
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

declare module "../kernel/registry.js" {
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
 * The grocery module's internals — the three-entity domain-collapse (like recipe and
 * menu): THREE store/cache pairs in one `self`. Grocery lists and items are
 * `TombstoneEntityStore`s (replace-all sync via `syncReplaceAllEntity`); the
 * ingredient catalog is a plain name-keyed store (a direct bespoke reconcile, no
 * pending-write sweep). Foreign keys point OUT to declared deps: items + ingredients
 * file into aisles (`dependsOn: aisle`), and `move_grocery_items_to_pantry` writes
 * THROUGH the pantry contract (`dependsOn: pantry`); grocery never reaches a sibling's
 * store.
 *
 * The write-capable commit chokepoints (`commitGroceryList`, `commitGroceryItem`,
 * `commitGroceryItemsBatch`) are bound HERE in `.self`, not in `.build`, because they
 * WRITE — they close over `infra.client` and `infra.notifier`, which the factory has
 * and `.build` does not (mirrors aisle's `ensureAisle`, recipe's `commitRecipe`, and
 * menu's `commitMenu`). Lifted verbatim from `src/tools/grocery-helpers.ts`, reaching
 * this module's own stores/caches (`self.lists.*` / `self.items.*`) instead of the
 * god-object context. Grocery lists and items both fire `resourceListChanged()` —
 * lists have an MCP resource surface and items are inlined in it; the ingredient
 * catalog write (in `add_grocery_items`) is silent and stays inline in the tool. The
 * read-only `api` is empty (no live sibling reads grocery — see `api.ts`); it is
 * assembled in `.build`.
 */
export interface GrocerySelf {
  readonly lists: GroceryEntitySlice<GroceryListStore, DiskCache<GroceryList>>;
  readonly items: GroceryEntitySlice<GroceryItemStore, DiskCache<GroceryItem>>;
  readonly ingredients: GroceryEntitySlice<GroceryIngredientStore, DiskCache<GroceryIngredient>>;

  /** Persist a saved grocery list locally, then nudge cloud sync. Content → fires resourceListChanged. */
  commitGroceryList(saved: Readonly<GroceryList>): Promise<void>;
  /** Persist a saved grocery item locally. Inlined in the list resource → fires resourceListChanged. */
  commitGroceryItem(saved: Readonly<GroceryItem>): Promise<void>;
  /** Batch variant of commitGroceryItem: one flush, one resourceListChanged, one notifySync. */
  commitGroceryItemsBatch(items: ReadonlyArray<Readonly<GroceryItem>>): Promise<void>;
}

register(
  defineModule("grocery", ["aisle", "pantry"])
    .self<GrocerySelf>(async (infra) => {
      const client: PaprikaClient = infra.client;
      const notifier: Notifier = infra.notifier;
      const log: Logger = infra.log;

      // Three stores + three plain caches. Reuse-in-place: point each at the SAME
      // flat path the legacy DiskCacheRoot uses (`<cacheDir>/grocerylists` |
      // `/groceryitems` | `/groceryingredients`). The `<domain>/<entity>` disk
      // reshape + move-migration is deferred to the flip (ADR-0009).
      const listStore = new GroceryListStore();
      const listCache = new DiskCacheImpl<GroceryList>({
        ...groceryListDiskDescriptor,
        subdir: join(infra.cacheDir, groceryListDiskDescriptor.subdir),
        log,
      });
      await listCache.init();

      const itemStore = new GroceryItemStore();
      const itemCache = new DiskCacheImpl<GroceryItem>({
        ...groceryItemDiskDescriptor,
        subdir: join(infra.cacheDir, groceryItemDiskDescriptor.subdir),
        log,
      });
      await itemCache.init();

      const ingredientStore = new GroceryIngredientStore();
      const ingredientCache = new DiskCacheImpl<GroceryIngredient>({
        ...groceryIngredientDiskDescriptor,
        subdir: join(infra.cacheDir, groceryIngredientDiskDescriptor.subdir),
        log,
      });
      await ingredientCache.init();

      // ---- Grocery write chokepoints (lifted verbatim from src/tools/grocery-helpers.ts) ----
      // Order: markPending* (FIRST, before any cache I/O) → cache put/remove → flush →
      // store set/delete → resourceListChanged → notifySync. The pending mark shields
      // this UID from sync-cycle reconciliation during the propagation race. Grocery
      // lists AND items both fire resourceListChanged() — lists have an MCP resource
      // surface and items are inlined in it.

      const commitGroceryList: GrocerySelf["commitGroceryList"] = async (saved) => {
        if (saved.deleted) {
          const uid: GroceryListUid = saved.uid;
          listStore.markPendingDelete(uid);
          try {
            await listCache.remove(uid);
            await listCache.flush();
          } catch (e) {
            listStore.clearPending(uid);
            throw e;
          }
          listStore.delete(uid);
        } else {
          listStore.markPendingUpsert(saved.uid);
          try {
            await listCache.put(saved);
            await listCache.flush();
          } catch (e) {
            listStore.clearPending(saved.uid);
            throw e;
          }
          listStore.set(saved);
        }
        notifier.resourceListChanged();
        await client.notifySync();
      };

      const commitGroceryItem: GrocerySelf["commitGroceryItem"] = async (saved) => {
        if (saved.deleted) {
          const uid: GroceryItemUid = saved.uid;
          itemStore.markPendingDelete(uid);
          try {
            await itemCache.remove(uid);
            await itemCache.flush();
          } catch (e) {
            itemStore.clearPending(uid);
            throw e;
          }
          itemStore.delete(uid);
        } else {
          itemStore.markPendingUpsert(saved.uid);
          try {
            await itemCache.put(saved);
            await itemCache.flush();
          } catch (e) {
            itemStore.clearPending(saved.uid);
            throw e;
          }
          itemStore.set(saved);
        }
        notifier.resourceListChanged();
        await client.notifySync();
      };

      const commitGroceryItemsBatch: GrocerySelf["commitGroceryItemsBatch"] = async (items) => {
        if (items.length === 0) return;
        const markedUids: Array<GroceryItemUid> = [];
        for (const item of items) {
          if (item.deleted) {
            itemStore.markPendingDelete(item.uid);
          } else {
            itemStore.markPendingUpsert(item.uid);
          }
          markedUids.push(item.uid);
        }
        const clearPending = (): void => {
          for (const uid of markedUids) itemStore.clearPending(uid);
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
          items.map((item) => (item.deleted ? itemCache.remove(item.uid) : itemCache.put(item))),
        );
        const opsFailure = opsResults.find((r): r is PromiseRejectedResult => r.status === "rejected");
        if (opsFailure !== undefined) {
          clearPending();
          throw opsFailure.reason;
        }
        try {
          await itemCache.flush();
        } catch (e) {
          clearPending();
          throw e;
        }
        for (const item of items) {
          if (item.deleted) {
            itemStore.delete(item.uid);
          } else {
            itemStore.set(item);
          }
        }
        notifier.resourceListChanged();
        await client.notifySync();
      };

      return {
        lists: { store: listStore, cache: listCache },
        items: { store: itemStore, cache: itemCache },
        ingredients: { store: ingredientStore, cache: ingredientCache },
        commitGroceryList,
        commitGroceryItem,
        commitGroceryItemsBatch,
      };
    })
    .build((self) => ({
      // Empty contract — no live sibling reads grocery state (see api.ts).
      api: {},
      // ctx is INFERRED — DomainCtx<GrocerySelf, "aisle" | "pantry">. Reaching any
      // other dep, or `ctx.deps.aisle.store` / `ctx.deps.pantry.store`, would not compile.
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
        clearAllTool,
        moveToPantryTool,
      ],
      resources: [groceryListResource],
      // Order matters: lists before items (children reference parent), then the
      // ingredient catalog. All three are core (grocery is the legacy in-order core
      // sequence's step 4–6, inside the outer try that aborts the cycle on failure).
      syncs: [groceryListsSync(self), groceryItemsSync(self), groceryIngredientsSync()],
      flush: async () => {
        await self.lists.cache.flush();
        await self.items.cache.flush();
        await self.ingredients.cache.flush();
      },
    })),
);
