import { join } from "node:path";

import { Mutex } from "async-mutex";
import { err, ok, okAsync, ResultAsync } from "neverthrow";

import type { CacheError } from "../../cache/disk-cache.js";
import type { MealTypeApi } from "./api.js";
import type { MealType } from "./types.js";

import { DiskCache } from "../../cache/disk-cache.js";
import { hydrateStore } from "../../cache/hydrate.js";
import { MealTypeUidSchema } from "../../ids.js";
import { defineModule, register } from "../../kernel/registry.js";
import { notifySyncBestEffort } from "../../paprika/client.js";
import { resolvePendingWriteTtl } from "../../utils/config.js";
import { unwrapAtBoot } from "../../utils/errors.js";
import { MealTypeStore } from "./store.js";
import { mealTypeSync } from "./sync.js";
import { listMealTypesTool } from "./tools/list-meal-types.js";
import { mealTypeDiskDescriptor } from "./types.js";

declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    "meal-type": MealTypeApi;
  }
}

/** The meal-type module's state — the meal-type catalog's store and disk cache. */
export interface MealTypeState {
  readonly store: MealTypeStore;
  readonly cache: DiskCache<MealType>;
}

register(
  defineModule("meal-type", [])
    .state<MealTypeState>(async (infra) => {
      const store = new MealTypeStore({ pendingWriteTtlMs: resolvePendingWriteTtl(infra.config) });
      // Disk is flat: the cache's subdir is the original `<cacheDir>/mealtypes`
      // (reuse-in-place — ADR-0009 keeps the cache un-namespaced, so there is no migration).
      const cache = new DiskCache<MealType>({
        ...mealTypeDiskDescriptor,
        subdir: join(infra.cacheDir, mealTypeDiskDescriptor.subdir),
        log: infra.log,
      });
      unwrapAtBoot(await cache.init(), "meal-type cache init");
      // Warm the store from cache so tools work on a warm restart before the first sync.
      unwrapAtBoot(await hydrateStore(cache, store), "meal-type cache hydrate");
      return { store, cache };
    })
    .build((state, infra) => {
      // ensureMealType is the auto-create write path (resolve-or-create + persist),
      // mirroring aisle's ensureAisle. It closes over `infra.client`, so it is
      // assembled here in `.build` rather than `.state`, keeping MealTypeState pure
      // (ADR-0012). It is a CONTRACT write — meal and menu reach it via
      // `ctx.deps["meal-type"]` — so it goes in `api`, not `ctx.writes`.
      const ensureMealTypeMutex = new Mutex();
      const commitMealType = (mealType: MealType): ResultAsync<void, CacheError> => {
        state.store.markPendingUpsert(mealType.uid);
        return state.cache
          .put(mealType)
          .andThen(() => state.cache.flush())
          .mapErr((e) => {
            state.store.clearPending(mealType.uid);
            return e;
          })
          .andThen(() => {
            state.store.set(mealType);
            return notifySyncBestEffort(infra.client, infra.log);
          });
      };
      const ensureMealType: MealTypeApi["ensureMealType"] = async (name) => {
        const trimmedName = name.trim();
        if (trimmedName === "") {
          return err("Meal type name cannot be empty.");
        }

        const match = state.store.resolveByName(trimmedName);
        if (match !== undefined) return ok(match);

        // Can't distinguish "doesn't exist" from "not loaded yet" before sync.
        if (!state.store.hasSynced) {
          return err("Meal type list is not yet synced. Try again in a few seconds.");
        }

        // Serialize the create path so concurrent writes for the same new name
        // don't both miss resolveByName and create duplicate meal types.
        return ensureMealTypeMutex.runExclusive(async () => {
          const recheck = state.store.resolveByName(trimmedName);
          if (recheck !== undefined) return ok(recheck);

          const existing = state.store.getAll();
          const maxOrder = existing.length === 0 ? 0 : Math.max(...existing.map((mt) => mt.orderFlag)) + 1;
          const uid = MealTypeUidSchema.parse(crypto.randomUUID().toUpperCase());
          // A user-authored type is custom (originalType null) with default color/export
          // settings; shape verified in docs/wire-captures/mealtypes.har.json.
          const newMealType: MealType = {
            uid,
            name: trimmedName,
            color: "#000000",
            orderFlag: maxOrder,
            originalType: null,
            exportAllDay: false,
            exportTime: 0,
            deleted: false,
          };

          return await infra.client
            .saveMealType(newMealType)
            .mapErr((e) => `Failed to create meal type "${trimmedName}": ${e.message}`)
            .andThen((saved) =>
              commitMealType(saved)
                .map(() => saved)
                .orElse((e) => {
                  // The create landed server-side; only the local commit failed. Erring
                  // here would invite a retry that mints a DUPLICATE type (the recheck
                  // misses until the store knows it). Keep the in-memory catalog
                  // authoritative — re-shielded as pending so the next replace-all sync
                  // can't drop it before the canonical list catches up — and let that
                  // sync heal the disk copy.
                  state.store.markPendingUpsert(saved.uid);
                  state.store.set(saved);
                  infra.log.warn(
                    { err: e, name: saved.name },
                    "meal type local commit failed after create; sync will heal",
                  );
                  return okAsync(saved);
                }),
            );
        });
      };

      return {
        api: {
          // Build the uid→name map from the catalog and resolve in order, skipping
          // unknown/dangling UIDs (the same projection the meal/menu renderers build
          // inline today). `MealTypeStore` has no `resolveNames` of its own.
          resolveNames: (uids) => {
            const nameByUid = new Map<string, string>();
            for (const mt of state.store.getAll()) nameByUid.set(mt.uid, mt.name);
            const names: Array<string> = [];
            for (const uid of uids) {
              const name = nameByUid.get(uid);
              if (name !== undefined) names.push(name);
            }
            return names;
          },
          // Resolves a `{name}|{uid}|{builtin}` spec against this module's own
          // store, returning a structured `MealTypeResolveResult`.
          resolveSpec: (spec) => {
            if ("uid" in spec) {
              const resolved = state.store.getAll().find((mt) => mt.uid === spec.uid);
              if (resolved === undefined) {
                return { ok: false, reason: "unknown_uid", uid: spec.uid };
              }
              return { ok: true, resolved };
            }
            if ("name" in spec) {
              const resolved = state.store.resolveByName(spec.name);
              if (resolved === undefined) {
                return {
                  ok: false,
                  reason: "unknown_name",
                  name: spec.name,
                  knownNames: state.store.getAll().map((mt) => mt.name),
                };
              }
              return { ok: true, resolved };
            }
            const builtinInt = spec.builtin;
            const resolved = state.store.getAll().find((mt) => mt.originalType === builtinInt);
            if (resolved === undefined) {
              return { ok: false, reason: "unknown_builtin", index: builtinInt };
            }
            return { ok: true, resolved };
          },
          getAll: () => state.store.getAll(),
          hasSynced: () => state.store.hasSynced,
          ensureMealType,
        },
        tools: [listMealTypesTool],
        syncs: [mealTypeSync(state)],
        flush: () => state.cache.flush(),
      };
    }),
);
