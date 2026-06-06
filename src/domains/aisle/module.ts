import { join } from "node:path";

import { Mutex } from "async-mutex";
import { err, ok, okAsync, ResultAsync } from "neverthrow";

import type { CacheError } from "../../cache/disk-cache.js";
import type { AisleApi } from "./api.js";
import type { Aisle } from "./types.js";

import { DiskCache } from "../../cache/disk-cache.js";
import { hydrateStore } from "../../cache/hydrate.js";
import { commitEntities, upsertOp } from "../../entity/commit.js";
import { defineModule, register } from "../../kernel/registry.js";
import { notifySyncBestEffort } from "../../paprika/client.js";
import { resolvePendingWriteTtl } from "../../utils/config.js";
import { unwrapAtBoot } from "../../utils/errors.js";
import { AisleUidSchema, NO_AISLE_UID } from "./ids.js";
import { AisleStore } from "./store.js";
import { aisleSync } from "./sync.js";
import { listAislesTool } from "./tools/list-aisles.js";
import { updateAisleTool } from "./tools/update-aisle.js";
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

/** The aisle module's write chokepoints — `update_aisle` commits through these. */
export interface AisleWrites {
  /** Persist a batch of saved aisles locally (one flush, one notifySync) — reorder renumbers several at once. */
  commitAisles(saved: ReadonlyArray<Readonly<Aisle>>): ResultAsync<void, CacheError>;
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
      unwrapAtBoot(await cache.init(), "aisle cache init");
      // Warm the store from cache so tools work on a warm restart before the first sync.
      unwrapAtBoot(await hydrateStore(cache, store), "aisle cache hydrate");
      return { store, cache };
    })
    .build((state, infra) => {
      // ensureAisle is the auto-create write path (resolve-or-create + persist). It
      // closes over `infra.client`, so it is assembled here in `.build` (which has
      // infra) rather than `.state`, keeping AisleState pure (ADR-0012). It is a
      // CONTRACT write — grocery and pantry reach it via `ctx.deps.aisle` — so it
      // lands in `api`, not `ctx.writes`.
      const ensureAisleMutex = new Mutex();
      // The commit protocol lives in src/entity/commit.ts; this binds aisle's slice.
      const commitAisles = (aisles: ReadonlyArray<Readonly<Aisle>>): ResultAsync<void, CacheError> =>
        commitEntities(
          state,
          aisles.map((a) => upsertOp(a)),
          { finish: () => notifySyncBestEffort(infra.client, infra.log) },
        );
      const commitAisle = (aisle: Aisle): ResultAsync<void, CacheError> => commitAisles([aisle]);
      const ensureAisle: AisleApi["ensureAisle"] = async (name) => {
        const trimmedName = name.trim();
        if (trimmedName === "") return ok({ aisle: "", aisleUid: NO_AISLE_UID });

        const match = state.store.resolveByName(trimmedName);
        if (match !== undefined) return ok({ aisle: match.name, aisleUid: match.uid });

        // Can't distinguish "doesn't exist" from "not loaded yet" before sync.
        if (!state.store.hasSynced) {
          return err("Aisle list is not yet synced. Try again in a few seconds.");
        }

        // Serialize the create path so concurrent writes for the same new name
        // don't both miss resolveByName and create duplicate aisles.
        return ensureAisleMutex.runExclusive(async () => {
          const recheck = state.store.resolveByName(trimmedName);
          if (recheck !== undefined) return ok({ aisle: recheck.name, aisleUid: recheck.uid });

          const existing = state.store.getAll();
          const maxOrder = existing.length === 0 ? 0 : Math.max(...existing.map((a) => a.orderFlag)) + 1;
          const uid = AisleUidSchema.parse(crypto.randomUUID().toUpperCase());
          const newAisle: Aisle = { uid, name: trimmedName, orderFlag: maxOrder, deleted: false };

          return await infra.client
            .saveAisle(newAisle)
            .mapErr((e) => `Failed to create aisle "${trimmedName}": ${e.message}`)
            .andThen((saved) =>
              commitAisle(saved)
                .map(() => ({ aisle: saved.name, aisleUid: saved.uid }))
                .orElse((e) => {
                  // The create landed server-side; only the local commit failed. Erring
                  // here would invite a retry that mints a DUPLICATE aisle (the recheck
                  // misses until the store knows it). Keep the in-memory catalog
                  // authoritative — re-shielded as pending so the next replace-all sync
                  // can't drop it before the canonical list catches up — and let that
                  // sync heal the disk copy.
                  state.store.markPendingUpsert(saved.uid);
                  state.store.set(saved);
                  infra.log.warn(
                    { err: e, name: saved.name },
                    "aisle local commit failed after create; sync will heal",
                  );
                  return okAsync({ aisle: saved.name, aisleUid: saved.uid });
                }),
            );
        });
      };

      return {
        api: {
          ensureAisle,
          resolveByName: (name) => state.store.resolveByName(name),
          get: (uid) => state.store.get(uid),
        },
        writes: { commitAisles },
        tools: [listAislesTool, updateAisleTool],
        syncs: [aisleSync(state)],
        flush: () => state.cache.flush(),
      };
    }),
);
