import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CategoryUid } from "../../ids.js";
import type { RecipeSelf } from "../module.js";

import { makeCategory, makeRecipe } from "../../../test/cache/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../test/support/kernel-harness.js";
import { getText } from "../../../test/support/tool-test-utils.js";

describe("category write tools", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  describe("create_category", () => {
    it("creates a top-level category and posts it", async () => {
      kh.seed({ recipes: [makeRecipe()], categories: [] });
      vi.mocked(kh.client().saveCategory).mockImplementation((c) => Promise.resolve(c));

      const result = await kh.callTool("create_category", { name: "Thai" });

      expect(kh.client().saveCategory).toHaveBeenCalledTimes(1);
      const posted = vi.mocked(kh.client().saveCategory).mock.calls[0]?.[0];
      expect(posted?.name).toBe("Thai");
      expect(posted?.parentUid).toBeNull();
      expect(getText(result)).toContain("Created category");
      // Category is committed to the real store.
      expect((kh.self() as RecipeSelf).category.store.resolveByName("Thai")).toBeDefined();
    });

    it("nests under an existing parent and assigns orderFlag = max+1", async () => {
      const parent = makeCategory({ uid: "p" as CategoryUid, name: "Cuisines", orderFlag: 4 });
      kh.seed({ recipes: [makeRecipe()], categories: [parent] });
      vi.mocked(kh.client().saveCategory).mockImplementation((c) => Promise.resolve(c));

      await kh.callTool("create_category", { name: "Thai", parentUid: "p" });

      const posted = vi.mocked(kh.client().saveCategory).mock.calls[0]?.[0];
      expect(posted?.parentUid).toBe("p");
      expect(posted?.orderFlag).toBe(5);
    });

    it("refuses an unknown parentUid", async () => {
      kh.seed({ recipes: [makeRecipe()], categories: [] });

      const result = await kh.callTool("create_category", { name: "Thai", parentUid: "nope" });

      expect(kh.client().saveCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain('No category found with UID "nope"');
    });

    it("returns the cold-start message before sync", async () => {
      // store never seeded — recipe + category both unsynced
      const result = await kh.callTool("create_category", { name: "Thai" });
      expect(getText(result).toLowerCase()).toContain("try again");
    });
  });

  describe("update_category", () => {
    it("renames a category", async () => {
      const cat = makeCategory({ uid: "c" as CategoryUid, name: "Old" });
      kh.seed({ recipes: [makeRecipe()], categories: [cat] });
      vi.mocked(kh.client().saveCategory).mockImplementation((c) => Promise.resolve(c));

      const result = await kh.callTool("update_category", { uid: "c", name: "New" });

      const posted = vi.mocked(kh.client().saveCategory).mock.calls[0]?.[0];
      expect(posted?.name).toBe("New");
      expect(posted?.uid).toBe("c");
      expect(getText(result)).toContain("Updated category");
    });

    it("re-parents to root when parentUid is null", async () => {
      const parent = makeCategory({ uid: "p" as CategoryUid, name: "Parent" });
      const child = makeCategory({ uid: "c" as CategoryUid, name: "Child", parentUid: "p" as CategoryUid });
      kh.seed({ recipes: [makeRecipe()], categories: [parent, child] });
      vi.mocked(kh.client().saveCategory).mockImplementation((c) => Promise.resolve(c));

      await kh.callTool("update_category", { uid: "c", parentUid: null });

      expect(vi.mocked(kh.client().saveCategory).mock.calls[0]?.[0]?.parentUid).toBeNull();
    });

    it("rejects making a category its own parent", async () => {
      const cat = makeCategory({ uid: "c" as CategoryUid });
      kh.seed({ recipes: [makeRecipe()], categories: [cat] });

      const result = await kh.callTool("update_category", { uid: "c", parentUid: "c" });

      expect(kh.client().saveCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain("cannot be its own parent");
    });

    it("rejects a re-parent that would create a cycle", async () => {
      // a -> b -> c; moving a under c would form a loop
      const a = makeCategory({ uid: "a" as CategoryUid, name: "A", parentUid: null });
      const b = makeCategory({ uid: "b" as CategoryUid, name: "B", parentUid: "a" as CategoryUid });
      const c = makeCategory({ uid: "c" as CategoryUid, name: "C", parentUid: "b" as CategoryUid });
      kh.seed({ recipes: [makeRecipe()], categories: [a, b, c] });

      const result = await kh.callTool("update_category", { uid: "a", parentUid: "c" });

      expect(kh.client().saveCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain("cycle");
    });

    it("rejects an empty update", async () => {
      const cat = makeCategory({ uid: "c" as CategoryUid });
      kh.seed({ recipes: [makeRecipe()], categories: [cat] });

      const result = await kh.callTool("update_category", { uid: "c" });

      expect(kh.client().saveCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain("Nothing to update");
    });

    it("reports an unknown category UID", async () => {
      kh.seed({ recipes: [makeRecipe()], categories: [] });

      const result = await kh.callTool("update_category", { uid: "missing", name: "X" });

      expect(kh.client().saveCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain('No category found with UID "missing"');
    });
  });

  describe("delete_category", () => {
    it("deletes a leaf category with no recipe references", async () => {
      const cat = makeCategory({ uid: "c" as CategoryUid, name: "Stale" });
      kh.seed({
        recipes: [makeRecipe({ categories: [] as Array<CategoryUid> })],
        categories: [cat],
      });
      vi.mocked(kh.client().deleteCategory).mockResolvedValue(undefined);

      const result = await kh.callTool("delete_category", { uid: "c" });

      expect(kh.client().deleteCategory).toHaveBeenCalledTimes(1);
      expect(getText(result)).toContain('Deleted category "Stale"');
      expect((kh.self() as RecipeSelf).category.store.get("c" as CategoryUid)).toBeUndefined();
    });

    it("refuses to delete a category that has child categories", async () => {
      const parent = makeCategory({ uid: "p" as CategoryUid, name: "Parent" });
      const child = makeCategory({ uid: "ch" as CategoryUid, name: "Child", parentUid: "p" as CategoryUid });
      kh.seed({ recipes: [makeRecipe()], categories: [parent, child] });

      const result = await kh.callTool("delete_category", { uid: "p" });

      expect(kh.client().deleteCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain("child categor");
      expect(getText(result)).toContain('"Child"');
    });

    it("refuses to delete a category still assigned to recipes", async () => {
      const cat = makeCategory({ uid: "c" as CategoryUid, name: "Used" });
      kh.seed({
        recipes: [makeRecipe({ categories: ["c" as CategoryUid] })],
        categories: [cat],
      });

      const result = await kh.callTool("delete_category", { uid: "c" });

      expect(kh.client().deleteCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain("still assigned");
    });

    it("refuses to delete a category referenced only by a trashed recipe", async () => {
      const cat = makeCategory({ uid: "c" as CategoryUid, name: "Used" });
      kh.seed({
        recipes: [makeRecipe({ categories: ["c" as CategoryUid], inTrash: true })],
        categories: [cat],
      });

      const result = await kh.callTool("delete_category", { uid: "c" });

      expect(kh.client().deleteCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain("still assigned");
    });

    it("reports an unknown / already-deleted category", async () => {
      kh.seed({ recipes: [makeRecipe()], categories: [] });

      const result = await kh.callTool("delete_category", { uid: "gone" });

      expect(kh.client().deleteCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain("already deleted");
    });
  });
});
