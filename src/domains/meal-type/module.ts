import { join } from "node:path";

import { Mutex } from "async-mutex";

import type { MealTypeApi } from "./api.js";
import type { MealType } from "./types.js";

import { DiskCache } from "../../cache/disk-cache.js";
import { hydrateStore } from "../../cache/hydrate.js";
import { MealTypeUidSchema } from "../../ids.js";
import { defineModule, register } from "../../kernel/registry.js";
import { resolvePendingWriteTtl } from "../../utils/config.js";
import { mealTypeDiskDescriptor } from "./disk.js";
import { MealTypeStore } from "./store.js";
import { mealTypeSync } from "./syncs/meal-type-sync.js";
import { listMealTypesTool } from "./tools/list-meal-types.js";

declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    "meal-type": MealTypeApi;
  }
}

/**
 * The meal-type module's internals. `ensureMealType` is bound here (not in
 * `.build`) because it WRITES — it needs `infra.client`, which the factory has and
 * `.build` does not; the read-only contract methods are assembled from `store` in
 * `.build`. This mirrors the aisle module's `ensureAisle`.
 */
export interface MealTypeState {
  readonly store: MealTypeStore;
  readonly cache: DiskCache<MealType>;
  readonly ensureMealType: MealTypeApi["ensureMealType"];
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
      await cache.init();
      // Warm the store from cache so tools work on a warm restart before the first sync.
      await hydrateStore(cache, store);

      // ensureMealType is the write path (auto-create + persist), so it closes over
      // infra.client and reaches this module's own store/cache. Mirrors aisle's ensureAisle.
      const ensureMealTypeMutex = new Mutex();
      const commitMealType = async (mealType: MealType): Promise<void> => {
        store.markPendingUpsert(mealType.uid);
        try {
          await cache.put(mealType);
          await cache.flush();
        } catch (e) {
          store.clearPending(mealType.uid);
          throw e;
        }
        store.set(mealType);
        await infra.client.notifySync();
      };
      const ensureMealType: MealTypeApi["ensureMealType"] = async (name) => {
        const trimmedName = name.trim();
        if (trimmedName === "") {
          throw new Error("Meal type name cannot be empty.");
        }

        const match = store.resolveByName(trimmedName);
        if (match !== undefined) return match;

        // Can't distinguish "doesn't exist" from "not loaded yet" before sync.
        if (!store.hasSynced) {
          throw new Error("Meal type list is not yet synced. Try again in a few seconds.");
        }

        // Serialize the create path so concurrent writes for the same new name
        // don't both miss resolveByName and create duplicate meal types.
        return ensureMealTypeMutex.runExclusive(async () => {
          const recheck = store.resolveByName(trimmedName);
          if (recheck !== undefined) return recheck;

          const existing = store.getAll();
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

          const saved = await infra.client.saveMealType(newMealType);
          await commitMealType(saved);
          return saved;
        });
      };

      return { store, cache, ensureMealType };
    })
    .build((state) => ({
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
        ensureMealType: state.ensureMealType,
      },
      tools: [listMealTypesTool],
      syncs: [mealTypeSync(state)],
      flush: () => state.cache.flush(),
    })),
);
