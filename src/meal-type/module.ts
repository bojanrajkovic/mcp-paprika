import { join } from "node:path";

import type { MealTypeApi } from "./api.js";
import type { MealType } from "./types.js";

import { DiskCache } from "../cache/disk-cache.js";
import { defineModule, register } from "../kernel/registry.js";
import { resolvePendingWriteTtl } from "../utils/config.js";
import { mealTypeDiskDescriptor } from "./disk.js";
import { MealTypeStore } from "./store.js";
import { mealTypeSync } from "./syncs/meal-type-sync.js";
import { listMealTypesTool } from "./tools/list-meal-types.js";

declare module "../kernel/registry.js" {
  interface DomainRegistry {
    "meal-type": MealTypeApi;
  }
}

/**
 * The meal-type module's internals. Every contract method is READ-ONLY (no
 * `infra.client` — meal types are never written via MCP, only synced and read),
 * so the whole `api` is assembled from `store` in `.build`; `self` is just the
 * store + cache, exactly like the aisle module's read-only members.
 */
export interface MealTypeSelf {
  readonly store: MealTypeStore;
  readonly cache: DiskCache<MealType>;
}

register(
  defineModule("meal-type", [])
    .self<MealTypeSelf>(async (infra) => {
      const store = new MealTypeStore({ pendingWriteTtlMs: resolvePendingWriteTtl(infra.config) });
      // Reuse-in-place: point at the SAME flat path the legacy DiskCacheRoot uses
      // (`<cacheDir>/mealtypes`). The `<domain>/<entity>` disk reshape + move-migration
      // is deferred to the flip (ADR-0009).
      const cache = new DiskCache<MealType>({
        ...mealTypeDiskDescriptor,
        subdir: join(infra.cacheDir, mealTypeDiskDescriptor.subdir),
        log: infra.log,
      });
      await cache.init();
      // Warm the store from cache (legacy hydrate) so tools work on a warm restart
      // before the first sync; drop tombstones, like legacy's `!deleted` filter.
      const cachedMealTypes = (await cache.getAll()).filter((mt) => !mt.deleted);
      if (cachedMealTypes.length > 0) store.load(cachedMealTypes);

      return { store, cache };
    })
    .build((self) => ({
      api: {
        // Build the uid→name map from the catalog and resolve in order, skipping
        // unknown/dangling UIDs (the same projection the meal/menu renderers build
        // inline today). `MealTypeStore` has no `resolveNames` of its own.
        resolveNames: (uids) => {
          const nameByUid = new Map<string, string>();
          for (const mt of self.store.getAll()) nameByUid.set(mt.uid, mt.name);
          const names: Array<string> = [];
          for (const uid of uids) {
            const name = nameByUid.get(uid);
            if (name !== undefined) names.push(name);
          }
          return names;
        },
        // Reimplements `resolveMealTypeSpec` (src/tools/meal-helpers.ts) against
        // this module's own store — the live free function takes a whole
        // ServerContext, which the kernel does not have. The MealTypeResolveResult
        // shape and the dispatch order are preserved verbatim.
        resolveSpec: (spec) => {
          if ("uid" in spec) {
            const resolved = self.store.getAll().find((mt) => mt.uid === spec.uid);
            if (resolved === undefined) {
              return { ok: false, reason: "unknown_uid", uid: spec.uid };
            }
            return { ok: true, resolved };
          }
          if ("name" in spec) {
            const resolved = self.store.resolveByName(spec.name);
            if (resolved === undefined) {
              return {
                ok: false,
                reason: "unknown_name",
                name: spec.name,
                knownNames: self.store.getAll().map((mt) => mt.name),
              };
            }
            return { ok: true, resolved };
          }
          const builtinInt = spec.builtin;
          const resolved = self.store.getAll().find((mt) => mt.originalType === builtinInt);
          if (resolved === undefined) {
            return { ok: false, reason: "unknown_builtin", index: builtinInt };
          }
          return { ok: true, resolved };
        },
        getAll: () => self.store.getAll(),
        hasSynced: () => self.store.hasSynced,
      },
      tools: [listMealTypesTool],
      syncs: [mealTypeSync(self)],
      flush: () => self.cache.flush(),
    })),
);
