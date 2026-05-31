import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { registerCategoryTools } from "./categories.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import type { CategoryUid } from "../paprika/types.js";

describe("p2-discovery-tools: list_categories tool", () => {
  describe("p2-discovery-tools.AC4: list_categories", () => {
    it("p2-discovery-tools.AC4.1: returns all categories with non-trashed recipe counts", async () => {
      const catA = makeCategory({ name: "Desserts" });
      const catB = makeCategory({ name: "Mains" });
      const store = new RecipeStore();
      store.load([
        makeRecipe({ categories: [catA.uid] }),
        makeRecipe({ categories: [catA.uid] }),
        makeRecipe({ categories: [catB.uid] }),
        // Trashed recipe — should NOT count
        makeRecipe({ categories: [catA.uid], inTrash: true }),
      ]);
      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server);
      ctx.categoryStore.load([catA, catB]);
      registerCategoryTools(server, ctx);

      const result = await callTool("list_categories", {});
      const text = getText(result);

      // Desserts has 2 non-trashed recipes (trashed one excluded)
      expect(text).toContain("Desserts");
      expect(text).toContain("2 recipes");
      // Mains has 1 recipe
      expect(text).toContain("Mains");
      expect(text).toContain("1 recipe");
    });

    it("p2-discovery-tools.AC4.2: categories sorted alphabetically by name", async () => {
      const catZ = makeCategory({ name: "Zucchini Dishes" });
      const catA = makeCategory({ name: "Appetizers" });
      const catM = makeCategory({ name: "Main Courses" });
      const store = new RecipeStore();
      // Need at least one recipe so store.size > 0 (cold-start guard)
      store.load([makeRecipe({ categories: [] as Array<CategoryUid> })]);
      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server);
      ctx.categoryStore.load([catZ, catA, catM]);
      registerCategoryTools(server, ctx);

      const result = await callTool("list_categories", {});
      const text = getText(result);

      const posA = text.indexOf("Appetizers");
      const posM = text.indexOf("Main Courses");
      const posZ = text.indexOf("Zucchini Dishes");

      expect(posA).toBeLessThan(posM);
      expect(posM).toBeLessThan(posZ);
    });

    it("p2-discovery-tools.AC4.3: category with zero non-trashed recipes appears with count 0", async () => {
      const catEmpty = makeCategory({ name: "Empty Category" });
      const catFull = makeCategory({ name: "Full Category" });
      const store = new RecipeStore();
      store.load([makeRecipe({ categories: [catFull.uid] })]);
      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server);
      ctx.categoryStore.load([catEmpty, catFull]);
      registerCategoryTools(server, ctx);

      const result = await callTool("list_categories", {});
      const text = getText(result);

      expect(text).toContain("Empty Category");
      expect(text).toContain("0 recipes");
      expect(text).toContain("Full Category");
      expect(text).toContain("1 recipe");
    });

    it("p2-discovery-tools.AC4.4: empty store returns cold-start Err payload", async () => {
      const store = new RecipeStore(); // not loaded — size === 0
      const { server, callTool } = makeTestServer();
      registerCategoryTools(server, makeCtx(store, server));

      const result = await callTool("list_categories", {});

      expect(getText(result).toLowerCase()).toContain("try again");
    });

    it("includes UIDs in output", async () => {
      const cat = makeCategory({ uid: "cat-uid-1" as CategoryUid, name: "Desserts" });
      const store = new RecipeStore();
      store.load([makeRecipe({ categories: [cat.uid] })]);
      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server);
      ctx.categoryStore.load([cat]);
      registerCategoryTools(server, ctx);

      const result = await callTool("list_categories", {});
      expect(getText(result)).toContain("uid: `cat-uid-1`");
    });

    it("renders child categories indented under parents", async () => {
      const parent = makeCategory({ uid: "parent-1" as CategoryUid, name: "Baking", parentUid: null });
      const child = makeCategory({ uid: "child-1" as CategoryUid, name: "Cakes", parentUid: "parent-1" });
      const store = new RecipeStore();
      store.load([makeRecipe({ categories: [parent.uid, child.uid] })]);
      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server);
      ctx.categoryStore.load([parent, child]);
      registerCategoryTools(server, ctx);

      const result = await callTool("list_categories", {});
      const text = getText(result);

      expect(text).toContain("- **Baking**");
      expect(text).toContain("  - **Cakes**");
    });

    it("p2-discovery-tools.AC4.5: store with recipes but no categories returns empty message", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ categories: [] as Array<CategoryUid> })]);
      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server);
      ctx.categoryStore.load([]); // synced, but empty catalog
      registerCategoryTools(server, ctx);

      const result = await callTool("list_categories", {});
      const text = getText(result);

      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("no categories");
    });

    it("p2-discovery-tools.AC4.6: recipe store synced but category catalog not yet synced returns a wait hint", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ categories: [] as Array<CategoryUid> })]);
      const { server, callTool } = makeTestServer();
      // categoryStore intentionally NOT loaded → hasSynced === false
      registerCategoryTools(server, makeCtx(store, server));

      const result = await callTool("list_categories", {});

      expect(getText(result).toLowerCase()).toContain("still syncing");
    });
  });
});
