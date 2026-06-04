import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CategoryUid, RecipeUid } from "../../ids.js";
import type { RecipeSelf } from "./module.js";

import { makeCategory, makeRecipe } from "../../../test/cache/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../test/support/kernel-harness.js";

/**
 * The recipe domain's write chokepoints (`commitRecipe` / `commitCategoryUpsert`),
 * tested ONCE here rather than per-tool — the behaviors elided from the per-tool
 * ports: the cache-flush-failure path (clear the pending mark, don't mutate the
 * store, propagate the error) and the re-index seam emits (#177) that drive discover.
 */
describe("recipe commit chokepoints", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  describe("cache-flush failure", () => {
    it("clears the pending mark, leaves the store untouched, and propagates the error", async () => {
      kh.seed({ recipes: [] });
      const self = kh.self() as RecipeSelf;
      const saved = makeRecipe({ uid: "r-fail" as RecipeUid, name: "Doomed", hash: "h" });
      vi.spyOn(self.recipe.cache, "flush").mockRejectedValue(new Error("disk full"));

      await expect(self.commitRecipe(saved)).rejects.toThrow("disk full");

      // The catch clears the pending mark (so sync isn't shielded for the full TTL)
      // and never reaches `store.set` — the failed local commit leaves no trace.
      expect(self.recipe.store.isPendingUpsert(saved.uid)).toBe(false);
      expect(self.recipe.store.get(saved.uid)).toBeUndefined();
    });
  });

  describe("re-index seam emits (#177)", () => {
    it("commitRecipe emits recipe-changed for a live recipe", async () => {
      kh.seed({ recipes: [] });
      const self = kh.self() as RecipeSelf;
      const emit = vi.spyOn(kh.infra().indexEvents, "emit");
      const saved = makeRecipe({ uid: "r-live" as RecipeUid, name: "Live", hash: "h" });

      await self.commitRecipe(saved);

      expect(emit).toHaveBeenCalledWith({ type: "recipe-changed", recipes: [saved] });
    });

    it("commitRecipe emits recipe-removed for a trashed recipe", async () => {
      kh.seed({ recipes: [] });
      const self = kh.self() as RecipeSelf;
      const emit = vi.spyOn(kh.infra().indexEvents, "emit");
      const trashed = makeRecipe({ uid: "r-trash" as RecipeUid, name: "Trashed", hash: "h", inTrash: true });

      await self.commitRecipe(trashed);

      expect(emit).toHaveBeenCalledWith({ type: "recipe-removed", uids: [trashed.uid] });
    });

    it("commitCategoryUpsert emits category-changed (the rename re-embed path)", async () => {
      kh.seed({ categories: [] });
      const self = kh.self() as RecipeSelf;
      const emit = vi.spyOn(kh.infra().indexEvents, "emit");
      const category = makeCategory({ uid: "c-rename" as CategoryUid, name: "Renamed" });

      await self.commitCategoryUpsert(category);

      expect(emit).toHaveBeenCalledWith({ type: "category-changed", uids: [category.uid] });
    });
  });
});
