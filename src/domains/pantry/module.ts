import { join } from "node:path";

import { okAsync, ResultAsync } from "neverthrow";

import type { CacheError } from "../../cache/disk-cache.js";
import type { PantryItemUid } from "../../ids.js";
import type { PantryApi, PantryCreateError } from "./api.js";
import type { PantryItem } from "./types.js";

import { DiskCache } from "../../cache/disk-cache.js";
import { hydrateStore } from "../../cache/hydrate.js";
import { defineModule, register } from "../../kernel/registry.js";
import { notifySyncBestEffort } from "../../paprika/client.js";
import { resolvePendingWriteTtl } from "../../utils/config.js";
import { unwrapAtBoot } from "../../utils/errors.js";
import { PantryStore } from "./store.js";
import { pantrySync } from "./sync.js";
import { addPantryItemsTool } from "./tools/batch-add.js";
import { deletePantryItemTool } from "./tools/delete.js";
import { getPantryItemTool } from "./tools/get.js";
import { listPantryItemsTool } from "./tools/list.js";
import { pantryStockTools } from "./tools/stock.js";
import { updatePantryItemTool } from "./tools/update.js";
import { pantryDiskDescriptor } from "./types.js";

declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    pantry: PantryApi;
  }
}

/** The pantry module's state — a single store + cache pair (single-entity Data domain). */
export interface PantryState {
  readonly store: PantryStore;
  readonly cache: DiskCache<PantryItem>;
}

/**
 * Pantry's write chokepoints (`ctx.writes`), invoked by its own update / stock /
 * delete / batch-add tools. No `resourceListChanged()` — pantry is a Data entity
 * with no MCP resource surface.
 */
export interface PantryWrites {
  /**
   * Persist a saved pantry item to cache + store, then nudge cloud sync. Branches
   * on `saved.deleted` (upsert vs remove). Used by the update/stock/delete tools.
   */
  commitPantryItem(saved: Readonly<PantryItem>): ResultAsync<void, CacheError>;
  /**
   * Batch variant of `commitPantryItem`: one cache flush, one `notifySync`. Marks
   * all pending writes before any cache I/O; clears them on cache failure. Used by
   * the batch-add tool AND, via the api's `createItems`, by grocery's move tool.
   */
  commitPantryItemsBatch(items: ReadonlyArray<Readonly<PantryItem>>): ResultAsync<void, CacheError>;
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
      unwrapAtBoot(await cache.init(), "pantry cache init");
      // Warm the store from cache so tools work on a warm restart before the first sync.
      unwrapAtBoot(await hydrateStore(cache, store), "pantry cache hydrate");
      return { store, cache };
    })
    .build((state, infra) => {
      // ---- Pantry write chokepoints ----
      // Assembled here (not in `.state`) because they close over `infra.client`,
      // keeping PantryState pure (ADR-0012). The commit chokepoints are internal —
      // pantry's own tools reach them via `ctx.writes` — while `createItems` is the
      // sibling-facing contract write grocery's move consumes via `ctx.deps.pantry`.
      //
      // Order: markPending* (FIRST, before any cache I/O) → cache put/remove → flush
      // → store set/delete → notifySync. The pending mark shields this UID from a
      // sync cycle that observes the cache mid-commit; cache I/O is wrapped so a
      // failure clears the mark instead of shielding the UID until TTL. No
      // resourceListChanged() — pantry has no MCP resource surface.
      const commitPantryItem: PantryWrites["commitPantryItem"] = (saved) => {
        if (saved.deleted) {
          const uid: PantryItemUid = saved.uid;
          state.store.markPendingDelete(uid);
          return state.cache
            .remove(uid)
            .andThen(() => state.cache.flush())
            .mapErr((e) => {
              state.store.clearPending(uid);
              return e;
            })
            .andThen(() => {
              state.store.delete(uid);
              return notifySyncBestEffort(infra.client, infra.log);
            });
        }
        state.store.markPendingUpsert(saved.uid);
        return state.cache
          .put(saved)
          .andThen(() => state.cache.flush())
          .mapErr((e) => {
            state.store.clearPending(saved.uid);
            return e;
          })
          .andThen(() => {
            state.store.set(saved);
            return notifySyncBestEffort(infra.client, infra.log);
          });
      };

      const commitPantryItemsBatch: PantryWrites["commitPantryItemsBatch"] = (items) => {
        if (items.length === 0) return okAsync(undefined);
        for (const item of items) {
          if (item.deleted) {
            state.store.markPendingDelete(item.uid);
          } else {
            state.store.markPendingUpsert(item.uid);
          }
        }
        const clearPending = (): void => {
          for (const item of items) state.store.clearPending(item.uid);
        };
        // `ResultAsync.combine` awaits every op (the underlying promises never
        // reject), so a failure cannot race `clearPending` — the allSettled dance
        // the throwing version needed is inherent here.
        //
        // All-or-nothing store semantics on failure is intentional: savePantryItems()
        // already succeeded, so any local cache/store divergence is temporary and
        // reconciled by the next sync. Clearing all pending marks on failure avoids
        // suppressing sync reconciliation until TTL.
        return ResultAsync.combine(
          items.map((item) => (item.deleted ? state.cache.remove(item.uid) : state.cache.put(item))),
        )
          .andThen(() => state.cache.flush())
          .mapErr((e) => {
            clearPending();
            return e;
          })
          .andThen(() => {
            for (const item of items) {
              if (item.deleted) {
                state.store.delete(item.uid);
              } else {
                state.store.set(item);
              }
            }
            return notifySyncBestEffort(infra.client, infra.log);
          });
      };

      // The public write grocery's move consumes. POST first, then local commit,
      // so the two failure modes stay distinguishable (the live move tool reports
      // them differently): a `save` failure means nothing was created server-side;
      // a `commit` failure means the items exist server-side and surface next sync.
      const createItems: PantryApi["createItems"] = (items) =>
        infra.client
          .savePantryItems(items)
          .mapErr((e): PantryCreateError => ({ phase: "save", message: e.message, saved: [] }))
          .andThen((saved) =>
            commitPantryItemsBatch(saved)
              .map(() => saved)
              .mapErr((e): PantryCreateError => ({ phase: "commit", message: e.message, saved })),
          );

      return {
        api: {
          hasSynced: () => state.store.hasSynced,
          createItems,
        },
        writes: { commitPantryItem, commitPantryItemsBatch },
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
      };
    }),
);
