import { join } from "node:path";

import { Mutex } from "async-mutex";

import type { AisleApi } from "./api.js";
import type { Aisle } from "./types.js";

import { DiskCache } from "../../cache/disk-cache.js";
import { hydrateStore } from "../../cache/hydrate.js";
import { AisleUidSchema, NO_AISLE_UID } from "../../ids.js";
import { defineModule, register } from "../../kernel/registry.js";
import { resolvePendingWriteTtl } from "../../utils/config.js";
import { aisleDiskDescriptor } from "./disk.js";
import { AisleStore } from "./store.js";
import { aisleSync } from "./syncs/aisle-sync.js";
import { listAislesTool } from "./tools/list-aisles.js";

declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    aisle: AisleApi;
  }
}

/**
 * The aisle module's internals. `ensureAisle` is bound here (not in `.build`)
 * because it WRITES — it needs `infra.client`, which the factory has and `.build`
 * does not; the read-only contract methods are assembled from `store` in `.build`.
 */
export interface AisleState {
  readonly store: AisleStore;
  readonly cache: DiskCache<Aisle>;
  readonly ensureAisle: AisleApi["ensureAisle"];
}

register(
  defineModule("aisle", [])
    .state<AisleState>(async (infra) => {
      const store = new AisleStore({ pendingWriteTtlMs: resolvePendingWriteTtl(infra.config) });
      // Disk is flat: the cache's subdir is the original `<cacheDir>/aisles`
      // (reuse-in-place — ADR-0009 keeps the cache un-namespaced, so there is no migration).
      const cache = new DiskCache<Aisle>({
        ...aisleDiskDescriptor,
        subdir: join(infra.cacheDir, aisleDiskDescriptor.subdir),
        log: infra.log,
      });
      await cache.init();
      // Warm the store from cache so tools work on a warm restart before the first sync.
      await hydrateStore(cache, store);

      // ensureAisle is the write path (auto-create + persist), so it closes over
      // infra.client and reaches this module's own store/cache.
      const ensureAisleMutex = new Mutex();
      const commitAisle = async (aisle: Aisle): Promise<void> => {
        store.markPendingUpsert(aisle.uid);
        try {
          await cache.put(aisle);
          await cache.flush();
        } catch (e) {
          store.clearPending(aisle.uid);
          throw e;
        }
        store.set(aisle);
        await infra.client.notifySync();
      };
      const ensureAisle: AisleApi["ensureAisle"] = async (name) => {
        const trimmedName = name.trim();
        if (trimmedName === "") return { aisle: "", aisleUid: NO_AISLE_UID };

        const match = store.resolveByName(trimmedName);
        if (match !== undefined) return { aisle: match.name, aisleUid: match.uid };

        // Can't distinguish "doesn't exist" from "not loaded yet" before sync.
        if (!store.hasSynced) {
          throw new Error("Aisle list is not yet synced. Try again in a few seconds.");
        }

        // Serialize the create path so concurrent writes for the same new name
        // don't both miss resolveByName and create duplicate aisles.
        return ensureAisleMutex.runExclusive(async () => {
          const recheck = store.resolveByName(trimmedName);
          if (recheck !== undefined) return { aisle: recheck.name, aisleUid: recheck.uid };

          const existing = store.getAll();
          const maxOrder = existing.length === 0 ? 0 : Math.max(...existing.map((a) => a.orderFlag)) + 1;
          const uid = AisleUidSchema.parse(crypto.randomUUID().toUpperCase());
          const newAisle: Aisle = { uid, name: trimmedName, orderFlag: maxOrder, deleted: false };

          const saved = await infra.client.saveAisle(newAisle);
          await commitAisle(saved);
          return { aisle: saved.name, aisleUid: saved.uid };
        });
      };

      return { store, cache, ensureAisle };
    })
    .build((state) => ({
      api: {
        ensureAisle: state.ensureAisle,
        resolveByName: (name) => state.store.resolveByName(name),
        get: (uid) => state.store.get(uid),
      },
      tools: [listAislesTool],
      syncs: [aisleSync(state)],
      flush: () => state.cache.flush(),
    })),
);
