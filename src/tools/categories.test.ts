import { describe, expect, it } from "vitest";

import type { CategoryUid } from "../ids.js";

import { makeCategory, makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import { registerCategoryTools } from "./categories.js";

describe("p2-discovery-tools: list_categories tool", () => {
  describe("p2-discovery-tools.AC4: list_categories", () => {
    it("p2-discovery-tools.AC4.1: returns all categories with non-trashed recipe counts", async () => {
      const catA = makeCategory({ name: "Desserts" });
      const catB = makeCategory({ name: "Mains" });
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [
          makeRecipe({ categories: [catA.uid] }),
          makeRecipe({ categories: [catA.uid] }),
          makeRecipe({ categories: [catB.uid] }),
          // Trashed recipe — should NOT count
          makeRecipe({ categories: [catA.uid], inTrash: true }),
        ],
        categories: [catA, catB],
      });
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
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        // Need at least one recipe so store.size > 0 (cold-start guard)
        recipes: [makeRecipe({ categories: [] as Array<CategoryUid> })],
        categories: [catZ, catA, catM],
      });
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
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ categories: [catFull.uid] })],
        categories: [catEmpty, catFull],
      });
      registerCategoryTools(server, ctx);

      const result = await callTool("list_categories", {});
      const text = getText(result);

      expect(text).toContain("Empty Category");
      expect(text).toContain("0 recipes");
      expect(text).toContain("Full Category");
      expect(text).toContain("1 recipe");
    });

    it("p2-discovery-tools.AC4.4: empty store returns cold-start Err payload", async () => {
      const { server, callTool } = makeTestServer();
      // Recipe store not seeded — size === 0
      registerCategoryTools(server, makeCtx(new RecipeStore(), server));

      const result = await callTool("list_categories", {});

      expect(getText(result).toLowerCase()).toContain("try again");
    });

    it("includes UIDs in output", async () => {
      const cat = makeCategory({ uid: "cat-uid-1" as CategoryUid, name: "Desserts" });
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ categories: [cat.uid] })],
        categories: [cat],
      });
      registerCategoryTools(server, ctx);

      const result = await callTool("list_categories", {});
      expect(getText(result)).toContain("uid: `cat-uid-1`");
    });

    it("renders child categories indented under parents", async () => {
      const parent = makeCategory({ uid: "parent-1" as CategoryUid, name: "Baking", parentUid: null });
      const child = makeCategory({ uid: "child-1" as CategoryUid, name: "Cakes", parentUid: "parent-1" });
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ categories: [parent.uid, child.uid] })],
        categories: [parent, child],
      });
      registerCategoryTools(server, ctx);

      const result = await callTool("list_categories", {});
      const text = getText(result);

      expect(text).toContain("- **Baking**");
      expect(text).toContain("  - **Cakes**");
    });

    it("renders an orphaned category (dangling parentUid) at top level with a ⚠️ disclosure (#178)", async () => {
      const orphan = makeCategory({ uid: "curries" as CategoryUid, name: "Curries", parentUid: "missing-parent" });
      const root = makeCategory({ uid: "beef" as CategoryUid, name: "Beef", parentUid: null });
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ categories: [orphan.uid] })],
        categories: [orphan, root],
      });
      registerCategoryTools(server, ctx);

      const text = getText(await callTool("list_categories", {}));

      // Orphan is NOT silently hidden, renders at top level (no indent), flagged.
      expect(text).toContain("- **Curries**");
      expect(text).toContain("⚠️");
      expect(text).toContain("missing-parent");
      // Sanity: a normal root still renders without the orphan marker.
      expect(text).toContain("- **Beef**");
      const beefLine = text.split("\n").find((l) => l.includes("**Beef**"));
      expect(beefLine).not.toContain("⚠️");
    });

    it("p2-discovery-tools.AC4.5: store with recipes but no categories returns empty message", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ categories: [] as Array<CategoryUid> })],
        categories: [], // synced, but empty catalog
      });
      registerCategoryTools(server, ctx);

      const result = await callTool("list_categories", {});
      const text = getText(result);

      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("no categories");
    });

    it("p2-discovery-tools.AC4.6: recipe store synced but category catalog not yet synced returns a wait hint", async () => {
      const { server, callTool } = makeTestServer();
      // categoryStore intentionally not seeded → hasSynced === false
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ categories: [] as Array<CategoryUid> })],
      });
      registerCategoryTools(server, ctx);

      const result = await callTool("list_categories", {});

      expect(getText(result).toLowerCase()).toContain("still syncing");
    });
  });
});
