import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Infra } from "../../kernel/registry.js";
import type { MealTypeApi } from "./api.js";
import type { MealTypeState } from "./module.js";
import type { MealType } from "./types.js";

import { makeMealType } from "../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { useTempDir } from "../../../test/support/disk-caches.js";
import { makeKernelInfra } from "../../../test/support/kernel-harness.js";
import { type MealTypeUid } from "../../ids.js";
import { registeredModules } from "../../kernel/registry.js";
// Side-effect: populate the module registry so the meal-type module is resolvable.
import "../../kernel/modules.generated.js";
import { mealTypeSync } from "./sync.js";

/**
 * Drives the meal-type write path against the real module: `ensureMealType`
 * (auto-create mirroring aisle's ensureAisle) and the pending-write-aware reconcile.
 * Builds the real module (real DiskCache + MealTypeStore) on a temp cache dir with a
 * mock client, mirroring recipe-sync.test.ts.
 */
const builtins = (): MealType[] => [
  makeMealType({ uid: "breakfast-uid" as MealTypeUid, name: "Breakfast", originalType: 0, orderFlag: 0 }),
  makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", originalType: 2, orderFlag: 3 }),
];

describe("meal-type ensureMealType + pending-write reconcile", () => {
  const tmp = useTempDir("paprika-mealtype-");
  let infra: Infra;
  let state: MealTypeState;
  let api: MealTypeApi;
  const listMealTypes = vi.fn();
  const saveMealType = vi.fn();
  const notifySync = vi.fn();

  beforeEach(async () => {
    await tmp.setup();
    listMealTypes.mockReset().mockReturnValue(okAsync([]));
    saveMealType.mockReset().mockImplementation((mt: MealType) => okAsync(mt));
    notifySync.mockReset().mockReturnValue(okAsync(undefined));
    infra = makeKernelInfra({ cacheDir: tmp.dir(), client: { listMealTypes, saveMealType, notifySync } });
    const mod = registeredModules().find((m) => m.id === "meal-type");
    if (mod === undefined) throw new Error("meal-type module not registered");
    const built = await mod.build(infra);
    state = built.state as MealTypeState;
    api = built.api as MealTypeApi;
  });

  afterEach(async () => {
    await tmp.teardown();
  });

  it("creates a custom type on a name miss (order_flag = max+1, originalType null), marks it pending", async () => {
    state.store.load(builtins()); // marks the store synced

    const created = (await api.ensureMealType("Brunch"))._unsafeUnwrap();

    expect(created.name).toBe("Brunch");
    expect(created.originalType).toBeNull();
    expect(created.color).toBe("#000000");
    expect(created.orderFlag).toBe(4); // max(0, 3) + 1
    expect(saveMealType).toHaveBeenCalledOnce();
    expect(notifySync).toHaveBeenCalledOnce();
    // Committed to the store and shielded as pending-upsert until a sync confirms it.
    expect(state.store.resolveByName("Brunch")?.uid).toBe(created.uid);
    expect(state.store.isPendingUpsert(created.uid)).toBe(true);
  });

  it("returns the existing type on a case-insensitive name hit, without a POST", async () => {
    state.store.load(builtins());

    const got = (await api.ensureMealType("dinner"))._unsafeUnwrap();

    expect(got.uid).toBe("dinner-uid");
    expect(saveMealType).not.toHaveBeenCalled();
  });

  it("errs before the catalog has synced (cannot distinguish missing from not-loaded)", async () => {
    expect((await api.ensureMealType("Brunch"))._unsafeUnwrapErr()).toMatch(/not yet synced/);
    expect(saveMealType).not.toHaveBeenCalled();
  });

  it("rejects an empty/whitespace name", async () => {
    state.store.load(builtins());
    expect((await api.ensureMealType("   "))._unsafeUnwrapErr()).toMatch(/cannot be empty/);
    expect(saveMealType).not.toHaveBeenCalled();
  });

  it("absorbs a local commit failure after a successful create (sync heals; no duplicate-inviting err)", async () => {
    state.store.load(builtins());
    vi.spyOn(state.cache, "flush").mockReturnValue(
      errAsync({ context: "flush", message: "disk full", cause: undefined }),
    );

    const created = (await api.ensureMealType("Brunch"))._unsafeUnwrap();

    expect(created.name).toBe("Brunch");
    expect(saveMealType).toHaveBeenCalledOnce();
    // The in-memory catalog is authoritative and re-shielded as pending.
    expect(state.store.resolveByName("Brunch")?.uid).toBe(created.uid);
    expect(state.store.isPendingUpsert(created.uid)).toBe(true);
  });

  it("reconcile keeps a pending-upsert type absent from a stale list, then observation-clears", async () => {
    state.store.load(builtins());
    const created = (await api.ensureMealType("Brunch"))._unsafeUnwrap();
    expect(state.store.isPendingUpsert(created.uid)).toBe(true);

    // A sync whose canonical list predates the create (Brunch absent) must NOT drop it.
    listMealTypes.mockReturnValue(okAsync(builtins()));
    await mealTypeSync(state).reconcile({ state, deps: {}, infra });
    expect(state.store.resolveByName("Brunch")?.uid).toBe(created.uid); // merged back from cache
    expect(state.store.isPendingUpsert(created.uid)).toBe(true); // not yet observed → still shielded

    // Once the canonical list includes it, the pending mark clears on observation.
    listMealTypes.mockReturnValue(okAsync([...builtins(), created]));
    await mealTypeSync(state).reconcile({ state, deps: {}, infra });
    expect(state.store.resolveByName("Brunch")?.uid).toBe(created.uid);
    expect(state.store.isPendingUpsert(created.uid)).toBe(false); // cleared
  });
});
