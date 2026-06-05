import { join } from "node:path";

import { err, ok } from "neverthrow";

import type { PantryItemUid } from "../../ids.js";
import type { PantryApi } from "./api.js";
import type { PantryItem } from "./types.js";

import { DiskCache } from "../../cache/disk-cache.js";
import { hydrateStore } from "../../cache/hydrate.js";
import { defineModule, register } from "../../kernel/registry.js";
import { resolvePendingWriteTtl } from "../../utils/config.js";
import { toMessage } from "../../utils/log.js";
import { pantryDiskDescriptor } from "./disk.js";
import { PantryStore } from "./store.js";
import { pantrySync } from "./syncs/pantry-sync.js";
import { addPantryItemsTool } from "./tools/batch-add.js";
import { deletePantryItemTool } from "./tools/delete.js";
import { getPantryItemTool } from "./tools/get.js";
import { listPantryItemsTool } from "./tools/list.js";
import { pantryStockTools } from "./tools/stock.js";
import { updatePantryItemTool } from "./tools/update.js";

declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    pantry: PantryApi;
  }
}

/**
 * The pantry module's internals — a single store + cache pair (a single-entity Data
 * domain; nothing co-owned). `createItems` is bound HERE in `.state`, not in
 * `.build`, because it WRITES — it needs `infra.client`, which the factory has and
 * `.build` does not (mirrors aisle's `ensureAisle`). The read-only `hasSynced`
 * contract method is assembled from `store` in `.build`.
 *
 * `commitPantryItemsBatch` is exposed on `state` so the batch-add tool can write
 * through the same chokepoint; the single-item `commitPantryItem` is likewise bound
 * for the update/stock/delete tools. No `resourceListChanged()` — pantry is a Data
 * entity with no MCP resource.
 */
export interface PantryState {
  readonly store: PantryStore;
  readonly cache: DiskCache<PantryItem>;
  /**
   * Persist a saved pantry item to cache + store, then nudge cloud sync. Branches
   * on `saved.deleted` (upsert vs remove). Used by the update/stock/delete tools.
   */
  commitPantryItem(saved: Readonly<PantryItem>): Promise<void>;
  /**
   * Batch variant of `commitPantryItem`: one cache flush, one `notifySync`. Marks
   * all pending writes before any cache I/O; clears them on cache failure. Used by
   * the batch-add tool AND, via `createItems`, by grocery's move tool.
   */
  commitPantryItemsBatch(items: ReadonlyArray<Readonly<PantryItem>>): Promise<void>;
  /** The public write the grocery move consumes (binds `client.savePantryItems` + commit). */
  createItems: PantryApi["createItems"];
}

register(
  defineModule("pantry", ["aisle"])
    .state<PantryState>(async (infra) => {
      const store = new PantryStore({ pendingWriteTtlMs: resolvePendingWriteTtl(infra.config) });
      // Disk is flat: the cache's subdir is the original `<cacheDir>/pantry`
      // (reuse-in-place — ADR-0009 keeps the cache un-namespaced, so there is no migration).
      const cache = new DiskCache<PantryItem>({
        ...pantryDiskDescriptor,
        subdir: join(infra.cacheDir, pantryDiskDescriptor.subdir),
        log: infra.log,
      });
      await cache.init();
      // Warm the store from cache so tools work on a warm restart before the first sync.
      await hydrateStore(cache, store);

      // ---- Pantry write chokepoints ----

      // Order: markPending* (FIRST, before any cache I/O) → cache put/remove → flush
      // → store set/delete → notifySync. The pending mark shields this UID from a
      // sync cycle that observes the cache mid-commit; cache I/O is wrapped so a
      // failure clears the mark instead of shielding the UID until TTL. No
      // resourceListChanged() — pantry has no MCP resource surface.
      const commitPantryItem: PantryState["commitPantryItem"] = async (saved) => {
        if (saved.deleted) {
          const uid: PantryItemUid = saved.uid;
          store.markPendingDelete(uid);
          try {
            await cache.remove(uid);
            await cache.flush();
          } catch (e) {
            store.clearPending(uid);
            throw e;
          }
          store.delete(uid);
          await infra.client.notifySync();
        } else {
          store.markPendingUpsert(saved.uid);
          try {
            await cache.put(saved);
            await cache.flush();
          } catch (e) {
            store.clearPending(saved.uid);
            throw e;
          }
          store.set(saved);
          await infra.client.notifySync();
        }
      };

      const commitPantryItemsBatch: PantryState["commitPantryItemsBatch"] = async (items) => {
        if (items.length === 0) return;
        const markedUids: Array<PantryItemUid> = [];
        for (const item of items) {
          if (item.deleted) {
            store.markPendingDelete(item.uid);
          } else {
            store.markPendingUpsert(item.uid);
          }
          markedUids.push(item.uid);
        }
        const clearPending = (): void => {
          for (const uid of markedUids) store.clearPending(uid);
        };
        // allSettled (not Promise.all): fail-fast would let in-flight ops race the
        // clearPending call in the catch block. We wait for every op to settle first.
        //
        // All-or-nothing store semantics on failure is intentional: savePantryItems()
        // already succeeded, so any local cache/store divergence is temporary and
        // reconciled by the next sync. Clearing all pending marks on failure avoids
        // suppressing sync reconciliation until TTL.
        const opsResults = await Promise.allSettled(
          items.map((item) => (item.deleted ? cache.remove(item.uid) : cache.put(item))),
        );
        const opsFailure = opsResults.find((r): r is PromiseRejectedResult => r.status === "rejected");
        if (opsFailure !== undefined) {
          clearPending();
          throw opsFailure.reason;
        }
        try {
          await cache.flush();
        } catch (e) {
          clearPending();
          throw e;
        }
        for (const item of items) {
          if (item.deleted) {
            store.delete(item.uid);
          } else {
            store.set(item);
          }
        }
        await infra.client.notifySync();
      };

      // The public write grocery's move consumes. POST first, then local commit,
      // so the two failure modes stay distinguishable (the live move tool reports
      // them differently): a `save` failure means nothing was created server-side;
      // a `commit` failure means the items exist server-side and surface next sync.
      const createItems: PantryApi["createItems"] = async (items) => {
        let saved: ReadonlyArray<PantryItem>;
        try {
          saved = await infra.client.savePantryItems(items);
        } catch (error) {
          return err({ phase: "save", message: toMessage(error), saved: [] });
        }
        try {
          await commitPantryItemsBatch(saved);
        } catch (error) {
          return err({ phase: "commit", message: toMessage(error), saved });
        }
        return ok(saved);
      };

      return { store, cache, commitPantryItem, commitPantryItemsBatch, createItems };
    })
    .build((state) => ({
      api: {
        hasSynced: () => state.store.hasSynced,
        createItems: state.createItems,
      },
      tools: [
        listPantryItemsTool,
        getPantryItemTool,
        addPantryItemsTool,
        updatePantryItemTool,
        ...pantryStockTools,
        deletePantryItemTool,
      ],
      syncs: [pantrySync(state)],
      flush: () => state.cache.flush(),
    })),
);
