import { join } from "node:path";

import { Mutex } from "async-mutex";

import type { AisleApi } from "./api.js";
import type { Aisle } from "./types.js";

import { DiskCache } from "../../cache/disk-cache.js";
import { hydrateStore } from "../../cache/hydrate.js";
import { AisleUidSchema, NO_AISLE_UID } from "../../ids.js";
import { defineModule, register } from "../../kernel/registry.js";
import { resolvePendingWriteTtl } from "../../utils/config.js";
import { AisleStore } from "./store.js";
import { aisleSync } from "./syncs/aisle-sync.js";
import { listAislesTool } from "./tools/list-aisles.js";
import { aisleDiskDescriptor } from "./types.js";

declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    aisle: AisleApi;
  }
}

/** The aisle module's state — the aisle catalog's store and disk cache. */
export interface AisleState {
  readonly store: AisleStore;
  readonly cache: DiskCache<Aisle>;
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
      return { store, cache };
    })
    .build((state, infra) => {
      // ensureAisle is the auto-create write path (resolve-or-create + persist). It
      // closes over `infra.client`, so it is assembled here in `.build` (which has
      // infra) rather than `.state`, keeping AisleState pure (ADR-0012). It is a
      // CONTRACT write — grocery and pantry reach it via `ctx.deps.aisle` — so it
      // lands in `api`, not `ctx.writes`.
      const ensureAisleMutex = new Mutex();
      const commitAisle = async (aisle: Aisle): Promise<void> => {
        state.store.markPendingUpsert(aisle.uid);
        try {
          await state.cache.put(aisle);
          await state.cache.flush();
        } catch (e) {
          state.store.clearPending(aisle.uid);
          throw e;
        }
        state.store.set(aisle);
        await infra.client.notifySync();
      };
      const ensureAisle: AisleApi["ensureAisle"] = async (name) => {
        const trimmedName = name.trim();
        if (trimmedName === "") return { aisle: "", aisleUid: NO_AISLE_UID };

        const match = state.store.resolveByName(trimmedName);
        if (match !== undefined) return { aisle: match.name, aisleUid: match.uid };

        // Can't distinguish "doesn't exist" from "not loaded yet" before sync.
        if (!state.store.hasSynced) {
          throw new Error("Aisle list is not yet synced. Try again in a few seconds.");
        }

        // Serialize the create path so concurrent writes for the same new name
        // don't both miss resolveByName and create duplicate aisles.
        return ensureAisleMutex.runExclusive(async () => {
          const recheck = state.store.resolveByName(trimmedName);
          if (recheck !== undefined) return { aisle: recheck.name, aisleUid: recheck.uid };

          const existing = state.store.getAll();
          const maxOrder = existing.length === 0 ? 0 : Math.max(...existing.map((a) => a.orderFlag)) + 1;
          const uid = AisleUidSchema.parse(crypto.randomUUID().toUpperCase());
          const newAisle: Aisle = { uid, name: trimmedName, orderFlag: maxOrder, deleted: false };

          const saved = await infra.client.saveAisle(newAisle);
          await commitAisle(saved);
          return { aisle: saved.name, aisleUid: saved.uid };
        });
      };

      return {
        api: {
          ensureAisle,
          resolveByName: (name) => state.store.resolveByName(name),
          get: (uid) => state.store.get(uid),
        },
        tools: [listAislesTool],
        syncs: [aisleSync(state)],
        flush: () => state.cache.flush(),
      };
    }),
);
