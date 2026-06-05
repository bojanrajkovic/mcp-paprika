import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeUid } from "../../../ids.js";
import type { Infra } from "../../../kernel/registry.js";
import type { RecipeSyncResult } from "../../../paprika/sync-types.js";
import type { RecipeState } from "../module.js";

import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useTempDir } from "../../../../test/support/disk-caches.js";
import { makeKernelInfra } from "../../../../test/support/kernel-harness.js";
import { registeredModules } from "../../../kernel/registry.js";
import { recipesSync } from "./recipe-sync.js";
// Side-effect: populate the module registry so the recipe module is resolvable.
import "../../../kernel/modules.generated.js";

/**
 * Drives the recipe domain's bespoke diff-and-fetch reconcile directly — the live
 * home of the #57 pending-write race + the #92 observation-clearing-by-hash. Builds
 * the real recipe module (real `RecipeDiskCache` + `RecipeStore`) against a temp cache dir and
 * a mock client, seeds the store/cache, then runs `recipesSync(state).reconcile(ctx)`.
 */
describe("recipe diff-and-fetch reconcile", () => {
  const tmp = useTempDir("paprika-recipe-sync-");
  let infra: Infra;
  let state: RecipeState;
  const listRecipes = vi.fn();
  const getRecipes = vi.fn();

  beforeEach(async () => {
    await tmp.setup();
    listRecipes.mockReset();
    getRecipes.mockReset().mockResolvedValue([]);
    infra = makeKernelInfra({ cacheDir: tmp.dir(), client: { listRecipes, getRecipes } });
    const recipeModule = registeredModules().find((m) => m.id === "recipe");
    if (recipeModule === undefined) throw new Error("recipe module not registered");
    state = (await recipeModule.build(infra)).state as RecipeState;
  });

  afterEach(async () => {
    await tmp.teardown();
  });

  // recipesSync's reconcile always returns a RecipeSyncResult; the SyncContribution
  // boundary widens it to `AnySyncResult | void`, so narrow it back for the assertions.
  const reconcile = async (): Promise<RecipeSyncResult> =>
    (await recipesSync(state).reconcile({ state, deps: {}, infra })) as RecipeSyncResult;

  /** Seed a recipe into both the cache (so its hash enters the diff index) and the store. */
  async function seed(recipe: ReturnType<typeof makeRecipe>): Promise<void> {
    await state.recipe.cache.put(recipe);
    state.recipe.store.set(recipe);
  }

  describe("diff-and-fetch happy path", () => {
    it("adds a recipe present in the list but not the cache", async () => {
      const r = makeRecipe({ uid: "r-add" as RecipeUid, name: "Added", hash: "h1" });
      listRecipes.mockResolvedValue([{ uid: r.uid, hash: r.hash }]);
      getRecipes.mockResolvedValue([r]);

      const result = await reconcile();

      expect(getRecipes).toHaveBeenCalledWith([r.uid]);
      expect(state.recipe.store.get(r.uid)?.name).toBe("Added");
      expect(result.changes.added.map((x) => x.uid)).toEqual([r.uid]);
    });

    it("re-fetches a recipe whose hash changed", async () => {
      await seed(makeRecipe({ uid: "r-chg" as RecipeUid, name: "Old", hash: "old" }));
      const updated = makeRecipe({ uid: "r-chg" as RecipeUid, name: "New", hash: "new" });
      listRecipes.mockResolvedValue([{ uid: updated.uid, hash: "new" }]);
      getRecipes.mockResolvedValue([updated]);

      const result = await reconcile();

      expect(state.recipe.store.get(updated.uid)?.name).toBe("New");
      expect(result.changes.updated.map((x) => x.uid)).toEqual([updated.uid]);
    });

    it("drops a recipe the server no longer lists", async () => {
      await seed(makeRecipe({ uid: "r-del" as RecipeUid, name: "Gone", hash: "h" }));
      listRecipes.mockResolvedValue([]);

      const result = await reconcile();

      expect(state.recipe.store.get("r-del" as RecipeUid)).toBeUndefined();
      expect(getRecipes).not.toHaveBeenCalled();
      expect(result.changes.removedUids).toEqual(["r-del"]);
    });

    it("skips a recipe whose hash is unchanged (no fetch)", async () => {
      await seed(makeRecipe({ uid: "r-same" as RecipeUid, name: "Same", hash: "h" }));
      listRecipes.mockResolvedValue([{ uid: "r-same", hash: "h" }]);

      await reconcile();

      expect(getRecipes).not.toHaveBeenCalled();
      expect(state.recipe.store.get("r-same" as RecipeUid)?.name).toBe("Same");
    });
  });

  describe("#57 pending-write race", () => {
    it("does NOT remove a pending-upsert when the canonical list is stale (missing it)", async () => {
      const r = makeRecipe({ uid: "r-pend" as RecipeUid, name: "Just Written", hash: "new" });
      await seed(r);
      state.recipe.store.markPendingUpsert(r.uid);
      // Stale list: Paprika hasn't propagated our write, so the UID is absent.
      listRecipes.mockResolvedValue([]);

      await reconcile();

      // The pending-upsert guard keeps our local copy instead of treating it as an orphan.
      expect(state.recipe.store.get(r.uid)?.name).toBe("Just Written");
    });

    it("does NOT resurrect a pending-delete (trashed) recipe the stale list still carries", async () => {
      const trashed = makeRecipe({ uid: "r-trash" as RecipeUid, name: "Trashed", hash: "post", inTrash: true });
      await seed(trashed);
      state.recipe.store.markPendingDelete(trashed.uid);
      // Stale list still has it with the pre-trash hash → would otherwise diff.changed + re-fetch.
      listRecipes.mockResolvedValue([{ uid: trashed.uid, hash: "pre" }]);
      getRecipes.mockResolvedValue([makeRecipe({ uid: trashed.uid, name: "Trashed", hash: "pre", inTrash: false })]);

      await reconcile();

      expect(getRecipes).not.toHaveBeenCalled();
      expect(state.recipe.store.get(trashed.uid)?.inTrash).toBe(true);
    });

    it("clears a pending-upsert only once the canonical hash matches (#92 observation-clearing)", async () => {
      const r = makeRecipe({ uid: "r-clear" as RecipeUid, name: "Edited", hash: "new" });
      await seed(r);
      state.recipe.store.markPendingUpsert(r.uid);

      // Cycle 1: canonical entry still carries the pre-write hash → NOT cleared.
      listRecipes.mockResolvedValue([{ uid: r.uid, hash: "old" }]);
      await reconcile();
      expect(state.recipe.store.isPendingUpsert(r.uid)).toBe(true);
      expect(state.recipe.store.get(r.uid)?.name).toBe("Edited");

      // Cycle 2: canonical hash now matches our local content → cleared.
      listRecipes.mockResolvedValue([{ uid: r.uid, hash: "new" }]);
      await reconcile();
      expect(state.recipe.store.isPendingUpsert(r.uid)).toBe(false);
      expect(state.recipe.store.get(r.uid)?.name).toBe("Edited");
    });
  });

  it("marks the store synced after a cycle", async () => {
    listRecipes.mockResolvedValue([]);
    expect(state.recipe.store.hasSynced).toBe(false);
    await reconcile();
    expect(state.recipe.store.hasSynced).toBe(true);
  });
});
