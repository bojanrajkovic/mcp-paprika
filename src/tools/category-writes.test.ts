import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";

import type { CategoryUid, RecipeUid } from "../ids.js";
import type { ServerContext } from "../types/server-context.js";

import { makeCategory, makeRecipe } from "../cache/__fixtures__/recipes.js";
import { RecipeStore } from "../recipe/store.js";
import {
  registerCreateCategoryTool,
  registerDeleteCategoryTool,
  registerUpdateCategoryTool,
} from "./category-writes.js";
import { getText, makeCtx, makeTestServer, seed } from "./tool-test-utils.js";

/** A ctx wired with synced recipe + category stores and mock client/cache for write tools. */
function makeWriteCtx(opts?: {
  recipes?: Parameters<RecipeStore["load"]>[0];
  categories?: ReturnType<typeof makeCategory>[];
  saveCategory?: ReturnType<typeof vi.fn>;
  deleteCategory?: ReturnType<typeof vi.fn>;
  vectorStore?: { indexRecipes?: ReturnType<typeof vi.fn> };
}): {
  ctx: ServerContext;
  server: ReturnType<typeof makeTestServer>["server"];
  callTool: ReturnType<typeof makeTestServer>["callTool"];
  saveCategory: ReturnType<typeof vi.fn>;
  deleteCategory: ReturnType<typeof vi.fn>;
  notifySync: ReturnType<typeof vi.fn>;
} {
  const saveCategory = opts?.saveCategory ?? vi.fn().mockImplementation((c: unknown) => Promise.resolve(c));
  const deleteCategory = opts?.deleteCategory ?? vi.fn().mockResolvedValue(undefined);
  const notifySync = vi.fn().mockResolvedValue(undefined);

  const { server, callTool } = makeTestServer();
  const ctx = seed(
    makeCtx(new RecipeStore(), server, {
      client: fromAny({ saveCategory, deleteCategory, notifySync }),
      cache: fromAny({
        categories: { put: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
        flush: vi.fn().mockResolvedValue(undefined),
      }),
      vectorStore: opts?.vectorStore ? fromAny(opts.vectorStore) : null,
    }),
    {
      recipes: opts?.recipes ?? [makeRecipe()],
      categories: opts?.categories ?? [],
    },
  );

  return { ctx, server, callTool, saveCategory, deleteCategory, notifySync };
}

describe("category-writes", () => {
  describe("create_category", () => {
    it("creates a top-level category and posts it", async () => {
      const { ctx, server, callTool, saveCategory } = makeWriteCtx();
      registerCreateCategoryTool(server, ctx);

      const result = await callTool("create_category", { name: "Thai" });

      expect(saveCategory).toHaveBeenCalledTimes(1);
      const posted = saveCategory.mock.calls[0]?.[0];
      expect(posted.name).toBe("Thai");
      expect(posted.parentUid).toBeNull();
      expect(getText(result)).toContain("Created category");
      // Now present in the store.
      expect(ctx.categoryStore.resolveByName("Thai")).toBeDefined();
    });

    it("nests under an existing parent and assigns orderFlag = max+1", async () => {
      const parent = makeCategory({ uid: "p" as CategoryUid, name: "Cuisines", orderFlag: 4 });
      const { ctx, server, callTool, saveCategory } = makeWriteCtx({ categories: [parent] });
      registerCreateCategoryTool(server, ctx);

      await callTool("create_category", { name: "Thai", parentUid: "p" });

      const posted = saveCategory.mock.calls[0]?.[0];
      expect(posted.parentUid).toBe("p");
      expect(posted.orderFlag).toBe(5);
      void ctx;
    });

    it("refuses an unknown parentUid", async () => {
      const { ctx, server, callTool, saveCategory } = makeWriteCtx();
      registerCreateCategoryTool(server, ctx);

      const result = await callTool("create_category", { name: "Thai", parentUid: "nope" });

      expect(saveCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain('No category found with UID "nope"');
    });

    it("returns the cold-start message before sync", async () => {
      const store = new RecipeStore(); // not synced
      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server);
      registerCreateCategoryTool(server, ctx);

      const result = await callTool("create_category", { name: "Thai" });
      expect(getText(result).toLowerCase()).toContain("try again");
    });
  });

  describe("update_category", () => {
    it("renames a category", async () => {
      const cat = makeCategory({ uid: "c" as CategoryUid, name: "Old" });
      const { server, callTool, saveCategory, ctx } = makeWriteCtx({ categories: [cat] });
      registerUpdateCategoryTool(server, ctx);

      const result = await callTool("update_category", { uid: "c", name: "New" });

      const posted = saveCategory.mock.calls[0]?.[0];
      expect(posted.name).toBe("New");
      expect(posted.uid).toBe("c");
      expect(getText(result)).toContain("Updated category");
    });

    it("re-parents to root when parentUid is null", async () => {
      const parent = makeCategory({ uid: "p" as CategoryUid, name: "Parent" });
      const child = makeCategory({ uid: "c" as CategoryUid, name: "Child", parentUid: "p" });
      const { server, callTool, saveCategory, ctx } = makeWriteCtx({ categories: [parent, child] });
      registerUpdateCategoryTool(server, ctx);

      await callTool("update_category", { uid: "c", parentUid: null });

      expect(saveCategory.mock.calls[0]?.[0].parentUid).toBeNull();
      void ctx;
    });

    it("rejects making a category its own parent", async () => {
      const cat = makeCategory({ uid: "c" as CategoryUid });
      const { server, callTool, saveCategory, ctx } = makeWriteCtx({ categories: [cat] });
      registerUpdateCategoryTool(server, ctx);

      const result = await callTool("update_category", { uid: "c", parentUid: "c" });

      expect(saveCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain("cannot be its own parent");
      void ctx;
    });

    it("rejects a re-parent that would create a cycle", async () => {
      // a -> b -> c ; moving a under c would form a loop
      const a = makeCategory({ uid: "a" as CategoryUid, name: "A", parentUid: null });
      const b = makeCategory({ uid: "b" as CategoryUid, name: "B", parentUid: "a" });
      const c = makeCategory({ uid: "c" as CategoryUid, name: "C", parentUid: "b" });
      const { server, callTool, saveCategory, ctx } = makeWriteCtx({ categories: [a, b, c] });
      registerUpdateCategoryTool(server, ctx);

      const result = await callTool("update_category", { uid: "a", parentUid: "c" });

      expect(saveCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain("cycle");
      void ctx;
    });

    it("rejects an empty update", async () => {
      const cat = makeCategory({ uid: "c" as CategoryUid });
      const { server, callTool, saveCategory, ctx } = makeWriteCtx({ categories: [cat] });
      registerUpdateCategoryTool(server, ctx);

      const result = await callTool("update_category", { uid: "c" });

      expect(saveCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain("Nothing to update");
      void ctx;
    });

    it("reports an unknown category UID", async () => {
      const { server, callTool, saveCategory, ctx } = makeWriteCtx({ categories: [] });
      registerUpdateCategoryTool(server, ctx);

      const result = await callTool("update_category", { uid: "missing", name: "X" });

      expect(saveCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain('No category found with UID "missing"');
      void ctx;
    });
  });

  describe("update_category vector re-index on rename (#177)", () => {
    it("re-indexes recipes assigned to the category when it is renamed", async () => {
      const indexRecipes = vi.fn().mockResolvedValue(undefined);
      const { server, callTool, ctx } = makeWriteCtx({
        categories: [makeCategory({ uid: "c" as CategoryUid, name: "Old" })],
        recipes: [
          makeRecipe({ uid: "r1" as RecipeUid, categories: ["c" as CategoryUid] }),
          makeRecipe({ uid: "r2" as RecipeUid, categories: [] }),
        ],
        vectorStore: { indexRecipes },
      });
      registerUpdateCategoryTool(server, ctx);

      await callTool("update_category", { uid: "c", name: "New Name" });

      expect(indexRecipes).toHaveBeenCalledTimes(1);
      const indexed = indexRecipes.mock.calls[0]?.[0] as ReadonlyArray<{ uid: string }>;
      expect(indexed.map((r) => r.uid)).toEqual(["r1"]);
    });

    it("does not embed when the category has no assigned recipes (create/re-parent no-op)", async () => {
      const indexRecipes = vi.fn().mockResolvedValue(undefined);
      const { server, callTool, ctx } = makeWriteCtx({
        categories: [
          makeCategory({ uid: "c" as CategoryUid, name: "Old" }),
          makeCategory({ uid: "p" as CategoryUid, name: "Parent" }),
        ],
        recipes: [makeRecipe({ uid: "r1" as RecipeUid, categories: [] })], // none reference "c"
        vectorStore: { indexRecipes },
      });
      registerUpdateCategoryTool(server, ctx);

      // Re-parent under "p". No recipe references "c", so the chokepoint
      // re-index helper early-returns before any embedding work. (A re-parent of
      // a category WITH recipes would call indexRecipes, but the real store skips
      // them by content hash since the display name is unchanged.)
      await callTool("update_category", { uid: "c", parentUid: "p" });

      expect(indexRecipes).not.toHaveBeenCalled();
    });

    it("succeeds without a vector store (semantic search disabled)", async () => {
      const { server, callTool, ctx } = makeWriteCtx({
        categories: [makeCategory({ uid: "c" as CategoryUid, name: "Old" })],
        recipes: [makeRecipe({ uid: "r1" as RecipeUid, categories: ["c" as CategoryUid] })],
        // no vectorStore → defaults to null
      });
      registerUpdateCategoryTool(server, ctx);

      const result = await callTool("update_category", { uid: "c", name: "New Name" });

      expect(getText(result)).toContain("Updated category");
    });
  });

  describe("delete_category", () => {
    it("deletes a leaf category with no recipe references", async () => {
      const cat = makeCategory({ uid: "c" as CategoryUid, name: "Stale" });
      const { server, callTool, deleteCategory, ctx } = makeWriteCtx({
        recipes: [makeRecipe({ categories: [] as Array<CategoryUid> })],
        categories: [cat],
      });
      registerDeleteCategoryTool(server, ctx);

      const result = await callTool("delete_category", { uid: "c" });

      expect(deleteCategory).toHaveBeenCalledTimes(1);
      expect(getText(result)).toContain('Deleted category "Stale"');
      expect(ctx.categoryStore.get("c" as CategoryUid)).toBeUndefined();
    });

    it("refuses to delete a category that has child categories", async () => {
      const parent = makeCategory({ uid: "p" as CategoryUid, name: "Parent" });
      const child = makeCategory({ uid: "ch" as CategoryUid, name: "Child", parentUid: "p" });
      const { server, callTool, deleteCategory, ctx } = makeWriteCtx({ categories: [parent, child] });
      registerDeleteCategoryTool(server, ctx);

      const result = await callTool("delete_category", { uid: "p" });

      expect(deleteCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain("child categor");
      expect(getText(result)).toContain('"Child"');
      void ctx;
    });

    it("refuses to delete a category still assigned to recipes", async () => {
      const cat = makeCategory({ uid: "c" as CategoryUid, name: "Used" });
      const { server, callTool, deleteCategory, ctx } = makeWriteCtx({
        recipes: [makeRecipe({ categories: ["c" as CategoryUid] })],
        categories: [cat],
      });
      registerDeleteCategoryTool(server, ctx);

      const result = await callTool("delete_category", { uid: "c" });

      expect(deleteCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain("still assigned");
      void ctx;
    });

    it("refuses to delete a category referenced only by a TRASHED recipe", async () => {
      const cat = makeCategory({ uid: "c" as CategoryUid, name: "Used" });
      const { server, callTool, deleteCategory, ctx } = makeWriteCtx({
        recipes: [makeRecipe({ categories: ["c" as CategoryUid], inTrash: true })],
        categories: [cat],
      });
      registerDeleteCategoryTool(server, ctx);

      const result = await callTool("delete_category", { uid: "c" });

      expect(deleteCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain("still assigned");
      void ctx;
    });

    it("reports an unknown / already-deleted category", async () => {
      const { server, callTool, deleteCategory, ctx } = makeWriteCtx({ categories: [] });
      registerDeleteCategoryTool(server, ctx);

      const result = await callTool("delete_category", { uid: "gone" });

      expect(deleteCategory).not.toHaveBeenCalled();
      expect(getText(result)).toContain("already deleted");
      void ctx;
    });
  });
});
