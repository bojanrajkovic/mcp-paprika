import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecipeUid, CategoryUid } from "../paprika/types.js";
import { DiskCache } from "./disk-cache.js";
import { RecipeStore } from "./recipe-store.js";
import { makeRecipe, makeCategory } from "./__fixtures__/recipes.js";
import { makeTestServer, makeCtx, getText } from "../tools/tool-test-utils.js";
import { registerSearchTool } from "../tools/search.js";

describe("DiskCache cold-start persistence integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tempDir = await mkdtemp(join(tmpdir(), "paprika-cold-start-integration-"));
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("AC1: Write-Flush-Restart-Hydrate round-trip", () => {
    it("AC1.1: should persist recipes to disk and reload them from a cold-start cache instance", async () => {
      // Create first cache instance and populate it
      const cache1 = new DiskCache(tempDir);
      await cache1.init();

      // Create test recipes with distinct data
      const recipe1 = makeRecipe({
        uid: "recipe-pasta-1" as RecipeUid,
        name: "Pasta Carbonara",
        ingredients: "pasta, eggs, bacon, cheese",
        directions: "Cook pasta. Make sauce. Combine.",
        prepTime: "10 min",
        cookTime: "20 min",
        totalTime: "30 min",
      });

      const recipe2 = makeRecipe({
        uid: "recipe-pizza-2" as RecipeUid,
        name: "Margherita Pizza",
        ingredients: "flour, tomato, mozzarella, basil",
        directions: "Make dough. Add toppings. Bake.",
        prepTime: "30 min",
        cookTime: "15 min",
        totalTime: "45 min",
      });

      // Write recipes to first cache instance
      await cache1.putRecipe(recipe1, "hash-recipe-1");
      await cache1.putRecipe(recipe2, "hash-recipe-2");
      await cache1.flush();

      // Verify first cache has both recipes
      const cached1 = await cache1.getRecipe(recipe1.uid);
      const cached2 = await cache1.getRecipe(recipe2.uid);
      expect(cached1).toEqual(recipe1);
      expect(cached2).toEqual(recipe2);

      // Create second cache instance pointing at the same temp directory (simulating restart)
      const cache2 = new DiskCache(tempDir);
      await cache2.init();

      // Verify second cache can read the persisted recipes
      const retrieved1 = await cache2.getRecipe(recipe1.uid);
      const retrieved2 = await cache2.getRecipe(recipe2.uid);
      expect(retrieved1).toEqual(recipe1);
      expect(retrieved2).toEqual(recipe2);

      // Verify getAllRecipes works after cold start
      const allRecipes = await cache2.getAllRecipes();
      expect(allRecipes).toHaveLength(2);
      expect(allRecipes).toContainEqual(recipe1);
      expect(allRecipes).toContainEqual(recipe2);
    });

    it("AC1.2: should hydrate a RecipeStore from the cold-start cache using the production pattern", async () => {
      // Setup: write recipes to cache
      const cache1 = new DiskCache(tempDir);
      await cache1.init();

      const recipe1 = makeRecipe({
        uid: "recipe-soup-1" as RecipeUid,
        name: "Tomato Soup",
      });
      const recipe2 = makeRecipe({
        uid: "recipe-salad-2" as RecipeUid,
        name: "Caesar Salad",
      });

      await cache1.putRecipe(recipe1, "hash-soup");
      await cache1.putRecipe(recipe2, "hash-salad");
      await cache1.flush();

      // Cold-start: Create second cache and hydrate store using the pattern from index.ts lines 48-52
      const cache2 = new DiskCache(tempDir);
      await cache2.init();

      const store = new RecipeStore();
      const cachedRecipes = await cache2.getAllRecipes();
      for (const recipe of cachedRecipes) {
        store.set(recipe);
      }

      // Verify store has all recipes
      expect(store.size).toBe(2);
      expect(store.get(recipe1.uid)).toEqual(recipe1);
      expect(store.get(recipe2.uid)).toEqual(recipe2);
      expect(store.getAll()).toHaveLength(2);
    });
  });

  describe("AC2: Category persistence in cache", () => {
    it("AC2.1: should persist category files to disk and reload across cache instances", async () => {
      const cache1 = new DiskCache(tempDir);
      await cache1.init();

      const category1 = makeCategory({
        uid: "cat-breakfast-1" as CategoryUid,
        name: "Breakfast",
        orderFlag: 1,
      });

      const category2 = makeCategory({
        uid: "cat-desserts-2" as CategoryUid,
        name: "Desserts",
        orderFlag: 2,
      });

      // Write categories to first cache
      await cache1.putCategory(category1, "hash-cat-1");
      await cache1.putCategory(category2, "hash-cat-2");
      await cache1.flush();

      // Create second cache and verify categories are persisted
      const cache2 = new DiskCache(tempDir);
      await cache2.init();

      const retrieved1 = await cache2.getCategory(category1.uid);
      const retrieved2 = await cache2.getCategory(category2.uid);
      expect(retrieved1).toEqual(category1);
      expect(retrieved2).toEqual(category2);
    });

    it("AC2.2: should have category hashes in index after cold start", async () => {
      // Setup cache with categories
      const cache1 = new DiskCache(tempDir);
      await cache1.init();

      const category1 = makeCategory({
        uid: "cat-main-1" as CategoryUid,
        name: "Main Courses",
      });
      const category2 = makeCategory({
        uid: "cat-sides-2" as CategoryUid,
        name: "Side Dishes",
      });

      await cache1.putCategory(category1, "hash-main");
      await cache1.putCategory(category2, "hash-sides");
      await cache1.flush();

      // Read index.json to verify category hashes were persisted
      const indexPath = join(tempDir, "index.json");
      const indexContent = await readFile(indexPath, "utf-8");
      const index = JSON.parse(indexContent);

      expect(index.categories[category1.uid]).toBe("hash-main");
      expect(index.categories[category2.uid]).toBe("hash-sides");

      // Cold-start: verify index is loaded
      const cache2 = new DiskCache(tempDir);
      await cache2.init();

      // Verify category files can still be read
      const retrieved1 = await cache2.getCategory(category1.uid);
      const retrieved2 = await cache2.getCategory(category2.uid);
      expect(retrieved1?.name).toBe("Main Courses");
      expect(retrieved2?.name).toBe("Side Dishes");
    });
  });

  describe("AC3: Diff detection after cold start", () => {
    it("AC3.1: should report no changes when data is unchanged after cold start", async () => {
      // Setup: write recipes and flush
      const cache1 = new DiskCache(tempDir);
      await cache1.init();

      const recipe1 = makeRecipe({
        uid: "recipe-1" as RecipeUid,
        name: "Recipe 1",
      });

      await cache1.putRecipe(recipe1, "hash-v1");
      await cache1.flush();

      // Cold-start: new cache instance
      const cache2 = new DiskCache(tempDir);
      await cache2.init();

      // diffRecipes with the exact same data should report no changes
      const diff = cache2.diffRecipes([{ uid: recipe1.uid, hash: "hash-v1" }]);

      expect(diff.added).toEqual([]);
      expect(diff.changed).toEqual([]);
      expect(diff.removed).toEqual([]);
    });

    it("AC3.2: should detect changed recipes after cold start", async () => {
      const cache1 = new DiskCache(tempDir);
      await cache1.init();

      const recipe1 = makeRecipe({
        uid: "recipe-1" as RecipeUid,
        name: "Recipe 1",
      });

      await cache1.putRecipe(recipe1, "hash-old");
      await cache1.flush();

      // Cold-start
      const cache2 = new DiskCache(tempDir);
      await cache2.init();

      // Remote has a newer hash
      const diff = cache2.diffRecipes([{ uid: recipe1.uid, hash: "hash-new" }]);

      expect(diff.added).toEqual([]);
      expect(diff.changed).toContain(recipe1.uid);
      expect(diff.removed).toEqual([]);
    });

    it("AC3.3: should detect removed recipes after cold start", async () => {
      const cache1 = new DiskCache(tempDir);
      await cache1.init();

      const recipe1 = makeRecipe({
        uid: "recipe-1" as RecipeUid,
        name: "Recipe 1",
      });

      await cache1.putRecipe(recipe1, "hash-v1");
      await cache1.flush();

      // Cold-start
      const cache2 = new DiskCache(tempDir);
      await cache2.init();

      // Remote has no recipes (recipe was deleted)
      const diff = cache2.diffRecipes([]);

      expect(diff.added).toEqual([]);
      expect(diff.changed).toEqual([]);
      expect(diff.removed).toContain(recipe1.uid);
    });
  });

  describe("AC4: Tools work against hydrated store", () => {
    it("AC4.1: search_recipes tool should work after cold-start hydration", async () => {
      // Setup: write recipes to cache
      const cache1 = new DiskCache(tempDir);
      await cache1.init();

      const recipe1 = makeRecipe({
        uid: "recipe-pasta-carbonara" as RecipeUid,
        name: "Pasta Carbonara",
        ingredients: "pasta, eggs, bacon, cheese",
      });

      const recipe2 = makeRecipe({
        uid: "recipe-alfredo" as RecipeUid,
        name: "Pasta Alfredo",
        ingredients: "pasta, cream, parmesan",
      });

      await cache1.putRecipe(recipe1, "hash-carbonara");
      await cache1.putRecipe(recipe2, "hash-alfredo");
      await cache1.flush();

      // Cold-start and hydrate
      const cache2 = new DiskCache(tempDir);
      await cache2.init();

      const store = new RecipeStore();
      const cachedRecipes = await cache2.getAllRecipes();
      for (const recipe of cachedRecipes) {
        store.set(recipe);
      }

      // Setup tool
      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server);
      registerSearchTool(server, ctx);

      // Call search tool
      const result = await callTool("search_recipes", {
        query: "carbonara",
        limit: 10,
      });

      const text = getText(result);
      expect(text).toContain("Pasta Carbonara");
      expect(text).not.toContain("Alfredo");
    });

    it("AC4.2: search_recipes should find recipes by ingredient after cold start", async () => {
      // Setup: write recipes
      const cache1 = new DiskCache(tempDir);
      await cache1.init();

      const recipe1 = makeRecipe({
        uid: "recipe-pizza" as RecipeUid,
        name: "Margherita Pizza",
        ingredients: "flour, tomato, mozzarella",
      });

      const recipe2 = makeRecipe({
        uid: "recipe-bread" as RecipeUid,
        name: "Garlic Bread",
        ingredients: "flour, garlic, butter",
      });

      await cache1.putRecipe(recipe1, "hash-pizza");
      await cache1.putRecipe(recipe2, "hash-bread");
      await cache1.flush();

      // Cold-start
      const cache2 = new DiskCache(tempDir);
      await cache2.init();

      const store = new RecipeStore();
      const cachedRecipes = await cache2.getAllRecipes();
      for (const recipe of cachedRecipes) {
        store.set(recipe);
      }

      // Register and call search tool
      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server);
      registerSearchTool(server, ctx);

      const result = await callTool("search_recipes", {
        query: "mozzarella",
        limit: 10,
      });

      const text = getText(result);
      expect(text).toContain("Margherita Pizza");
      expect(text).not.toContain("Garlic Bread");
    });
  });

  describe("AC5: Corruption recovery", () => {
    it("AC5.1: should recover gracefully when index.json is corrupted", async () => {
      const { writeFile } = await import("node:fs/promises");

      // Write corrupted index.json
      const indexPath = join(tempDir, "index.json");
      await writeFile(indexPath, "this is not valid json {[}");

      // Create cache and init — should recover
      const cache = new DiskCache(tempDir);
      await cache.init();

      // Should be able to use cache normally
      const recipe = makeRecipe({
        uid: "recipe-test" as RecipeUid,
        name: "Test Recipe",
      });
      await cache.putRecipe(recipe, "hash-test");
      await cache.flush();

      // Verify recovery worked
      const retrieved = await cache.getRecipe(recipe.uid);
      expect(retrieved).toEqual(recipe);
    });

    it("AC5.2: should handle missing index.json gracefully (first run)", async () => {
      // Don't create index.json — it's a first-run scenario
      const cache = new DiskCache(tempDir);
      await cache.init();

      // Should work normally
      const recipe = makeRecipe({
        uid: "recipe-first-run" as RecipeUid,
        name: "First Run Recipe",
      });
      await cache.putRecipe(recipe, "hash-first");
      await cache.flush();

      const retrieved = await cache.getRecipe(recipe.uid);
      expect(retrieved).toEqual(recipe);
    });
  });

  describe("AC6: Full end-to-end persistence scenario", () => {
    it("AC6.1: should handle a complete write-flush-restart-modify cycle", async () => {
      // Phase 1: Initial write
      const cache1 = new DiskCache(tempDir);
      await cache1.init();

      const recipe1 = makeRecipe({
        uid: "recipe-evolving" as RecipeUid,
        name: "Evolving Recipe V1",
        ingredients: "original ingredients",
      });

      await cache1.putRecipe(recipe1, "hash-v1");
      await cache1.flush();

      // Phase 2: Cold-start and modify
      const cache2 = new DiskCache(tempDir);
      await cache2.init();

      const recipe1Updated = makeRecipe({
        uid: "recipe-evolving" as RecipeUid,
        name: "Evolving Recipe V2",
        ingredients: "updated ingredients",
      });

      await cache2.putRecipe(recipe1Updated, "hash-v2");
      await cache2.flush();

      // Phase 3: Another cold-start
      const cache3 = new DiskCache(tempDir);
      await cache3.init();

      const final = await cache3.getRecipe(recipe1.uid);
      expect(final).toEqual(recipe1Updated);
      expect(final?.name).toBe("Evolving Recipe V2");
      expect(final?.ingredients).toBe("updated ingredients");
    });

    it("AC6.2: should preserve all recipe data fields after round-trip", async () => {
      const cache1 = new DiskCache(tempDir);
      await cache1.init();

      const originalRecipe = makeRecipe({
        uid: "recipe-full-data" as RecipeUid,
        name: "Fully Detailed Recipe",
        ingredients: "flour: 2 cups, sugar: 1 cup, butter: 1/2 cup",
        directions: "Step 1. Step 2. Step 3.",
        description: "A delicious recipe",
        notes: "Best served warm",
        prepTime: "15 min",
        cookTime: "45 min",
        totalTime: "60 min",
        servings: "4",
        difficulty: "Medium",
        rating: 4,
        source: "Example Cookbook",
      });

      await cache1.putRecipe(originalRecipe, "hash-full");
      await cache1.flush();

      // Cold-start and retrieve
      const cache2 = new DiskCache(tempDir);
      await cache2.init();

      const retrieved = await cache2.getRecipe(originalRecipe.uid);

      // Verify all fields are preserved
      expect(retrieved).toEqual(originalRecipe);
      expect(retrieved?.name).toBe(originalRecipe.name);
      expect(retrieved?.ingredients).toBe(originalRecipe.ingredients);
      expect(retrieved?.directions).toBe(originalRecipe.directions);
      expect(retrieved?.description).toBe(originalRecipe.description);
      expect(retrieved?.notes).toBe(originalRecipe.notes);
      expect(retrieved?.prepTime).toBe(originalRecipe.prepTime);
      expect(retrieved?.cookTime).toBe(originalRecipe.cookTime);
      expect(retrieved?.totalTime).toBe(originalRecipe.totalTime);
      expect(retrieved?.servings).toBe(originalRecipe.servings);
      expect(retrieved?.difficulty).toBe(originalRecipe.difficulty);
      expect(retrieved?.rating).toBe(originalRecipe.rating);
      expect(retrieved?.source).toBe(originalRecipe.source);
    });
  });
});
