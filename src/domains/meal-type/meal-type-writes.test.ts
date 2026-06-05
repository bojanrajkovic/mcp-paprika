import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Infra } from "../../kernel/registry.js";
import type { MealTypeApi } from "./api.js";
import type { MealTypeState } from "./module.js";
import type { MealType } from "./types.js";

import { makeMealType } from "../../../test/domains/meal-type/__fixtures__/meal-types.js";
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
  let tempDir: string;
  let infra: Infra;
  let state: MealTypeState;
  let api: MealTypeApi;
  const listMealTypes = vi.fn();
  const saveMealType = vi.fn();
  const notifySync = vi.fn();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "paprika-mealtype-"));
    listMealTypes.mockReset().mockResolvedValue([]);
    saveMealType.mockReset().mockImplementation(async (mt: MealType) => mt);
    notifySync.mockReset().mockResolvedValue(undefined);
    infra = makeKernelInfra({ cacheDir: tempDir, client: { listMealTypes, saveMealType, notifySync } });
    const mod = registeredModules().find((m) => m.id === "meal-type");
    if (mod === undefined) throw new Error("meal-type module not registered");
    const built = await mod.build(infra);
    state = built.state as MealTypeState;
    api = built.api as MealTypeApi;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates a custom type on a name miss (order_flag = max+1, originalType null), marks it pending", async () => {
    state.store.load(builtins()); // marks the store synced

    const created = await api.ensureMealType("Brunch");

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

    const got = await api.ensureMealType("dinner");

    expect(got.uid).toBe("dinner-uid");
    expect(saveMealType).not.toHaveBeenCalled();
  });

  it("throws before the catalog has synced (can't distinguish missing from not-loaded)", async () => {
    await expect(api.ensureMealType("Brunch")).rejects.toThrow(/not yet synced/);
    expect(saveMealType).not.toHaveBeenCalled();
  });

  it("rejects an empty/whitespace name", async () => {
    state.store.load(builtins());
    await expect(api.ensureMealType("   ")).rejects.toThrow(/cannot be empty/);
    expect(saveMealType).not.toHaveBeenCalled();
  });

  it("reconcile keeps a pending-upsert type absent from a stale list, then observation-clears", async () => {
    state.store.load(builtins());
    const created = await api.ensureMealType("Brunch");
    expect(state.store.isPendingUpsert(created.uid)).toBe(true);

    // A sync whose canonical list predates the create (Brunch absent) must NOT drop it.
    listMealTypes.mockResolvedValue(builtins());
    await mealTypeSync(state).reconcile({ state, deps: {}, infra });
    expect(state.store.resolveByName("Brunch")?.uid).toBe(created.uid); // merged back from cache
    expect(state.store.isPendingUpsert(created.uid)).toBe(true); // not yet observed → still shielded

    // Once the canonical list includes it, the pending mark clears on observation.
    listMealTypes.mockResolvedValue([...builtins(), created]);
    await mealTypeSync(state).reconcile({ state, deps: {}, infra });
    expect(state.store.resolveByName("Brunch")?.uid).toBe(created.uid);
    expect(state.store.isPendingUpsert(created.uid)).toBe(false); // cleared
  });
});
