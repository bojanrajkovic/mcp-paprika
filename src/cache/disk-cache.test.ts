import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, readdir, stat, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecipeUid } from "../paprika/types.js";
import { DiskCache } from "./disk-cache.js";
import { makeRecipe, makeCategory } from "./__fixtures__/recipes.js";

describe("DiskCache", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tempDir = await mkdtemp(join(tmpdir(), "paprika-disk-cache-"));
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("AC1: Directory initialization and index loading", () => {
    it("AC1.1: creates recipes/ and categories/ subdirectories under cacheDir", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const recipesDir = join(tempDir, "recipes");
      const categoriesDir = join(tempDir, "categories");

      const recipesStat = await stat(recipesDir);
      const categoriesStat = await stat(categoriesDir);

      expect(recipesStat.isDirectory()).toBe(true);
      expect(categoriesStat.isDirectory()).toBe(true);
    });

    it("AC1.2: loads a valid index.json into _index when it exists", async () => {
      // Write a valid index.json before creating the cache
      const indexPath = join(tempDir, "index.json");
      const validIndex = {
        recipes: { "uid-1": "hash-1", "uid-2": "hash-2" },
        categories: { "c-1": "hash-c", "c-2": "hash-c2" },
      };
      await writeFile(indexPath, JSON.stringify(validIndex, null, 2));

      const cache = new DiskCache(tempDir);
      await cache.init();
      await cache.flush();

      // Read the flushed index and verify it contains the same entries
      const flushedContent = await readFile(indexPath, "utf-8");
      const flushedIndex = JSON.parse(flushedContent);

      expect(flushedIndex.recipes).toEqual(validIndex.recipes);
      expect(flushedIndex.categories).toEqual(validIndex.categories);
    });

    it("AC1.3: creates an empty index when index.json does not exist (ENOENT = first run)", async () => {
      // Verify no index.json exists initially
      const indexPath = join(tempDir, "index.json");
      await expect(stat(indexPath)).rejects.toThrow();

      const cache = new DiskCache(tempDir);
      await cache.init();
      await cache.flush();

      // Verify index.json was created with empty structure
      const content = await readFile(indexPath, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed).toEqual({ recipes: {}, categories: {} });
    });

    it("AC1.4: resets to empty index and calls log when index.json is present but fails schema validation", async () => {
      // Write an invalid index.json (just a string, not an object)
      const indexPath = join(tempDir, "index.json");
      await writeFile(indexPath, JSON.stringify("just a string"));

      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      const cache = new DiskCache(tempDir);
      await cache.init();

      // Verify log was called with a message containing 'corrupt'
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("corrupt"));

      // Verify that flush() writes an empty index
      await cache.flush();
      const content = await readFile(indexPath, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed).toEqual({ recipes: {}, categories: {} });
      stderrSpy.mockRestore();
    });

    it("AC1.5: rethrows non-ENOENT I/O errors (e.g. permission denied)", async () => {
      // Create a directory at the index.json path to cause EISDIR error
      const indexPath = join(tempDir, "index.json");
      await mkdir(indexPath);

      const cache = new DiskCache(tempDir);

      // init() should rethrow the EISDIR error
      await expect(cache.init()).rejects.toThrow();
    });
  });

  describe("AC2: Atomic fsynced flush", () => {
    it("AC2.1: After flush(), index.json exists in cacheDir and contains valid JSON", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();
      await cache.flush();

      const indexPath = join(tempDir, "index.json");
      const content = await readFile(indexPath, "utf-8");

      // Verify it's valid JSON and parses successfully
      const parsed = JSON.parse(content);
      expect(parsed).toBeDefined();
      expect(typeof parsed).toBe("object");
    });

    it("AC2.3: No .tmp file remains in cacheDir after successful flush()", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();
      await cache.flush();

      // List all files in tempDir
      const entries = await readdir(tempDir);

      // Verify no .tmp files exist
      const tmpFiles = entries.filter((entry) => entry.endsWith(".tmp"));
      expect(tmpFiles).toHaveLength(0);
    });

    it("AC2.4: flush() throws if called before init()", async () => {
      const cache = new DiskCache(tempDir);

      // Call flush() without init()
      await expect(cache.flush()).rejects.toThrow();
    });
  });

  describe("AC3: Recipe CRUD", () => {
    it("AC3.1: putRecipe(recipe, hash) does not write any file until flush()", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const recipe = makeRecipe();
      const hash = "test-hash";

      await cache.putRecipe(recipe, hash);

      // Assert the recipe file does not exist yet
      const filePath = join(tempDir, "recipes", `${recipe.uid}.json`);
      await expect(stat(filePath)).rejects.toThrow();
    });

    it("AC3.2: getRecipe(uid) returns the buffered recipe immediately after putRecipe() without flush()", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const recipe = makeRecipe();
      const hash = "test-hash";

      await cache.putRecipe(recipe, hash);
      const retrieved = await cache.getRecipe(recipe.uid);

      expect(retrieved).toEqual(recipe);
    });

    it("AC3.3: After putRecipe() + flush(), getRecipe(uid) returns the same recipe (round-trip)", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const recipe = makeRecipe();
      const hash = "test-hash";

      await cache.putRecipe(recipe, hash);
      await cache.flush();

      const retrieved = await cache.getRecipe(recipe.uid);
      expect(retrieved).toEqual(recipe);
    });

    it("AC3.4: getRecipe(uid) returns null for a UID that was never put", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const retrieved = await cache.getRecipe("nonexistent-uid");
      expect(retrieved).toBeNull();
    });

    it("AC3.5: removeRecipe(uid) deletes the file and removes from index and pending", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const recipe = makeRecipe();
      const hash = "test-hash";

      await cache.putRecipe(recipe, hash);
      await cache.flush();

      // File should exist after flush
      const filePath = join(tempDir, "recipes", `${recipe.uid}.json`);
      await expect(stat(filePath)).resolves.toBeDefined();

      // Remove the recipe
      await cache.removeRecipe(recipe.uid);

      // File should be deleted
      await expect(stat(filePath)).rejects.toThrow();

      // getRecipe should return null
      const retrieved = await cache.getRecipe(recipe.uid);
      expect(retrieved).toBeNull();
    });

    it("AC3.6: removeRecipe(uid) does not throw if the file does not exist (idempotent)", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      // Remove a recipe that was never put
      await expect(cache.removeRecipe("uid-that-was-never-put")).resolves.toBeUndefined();
    });

    it("getAllRecipes() throws if called before init()", async () => {
      const cache = new DiskCache(tempDir);
      await expect(cache.getAllRecipes()).rejects.toThrow("before init");
    });

    it("AC3.7: getAllRecipes() includes pending (not-yet-flushed) recipes", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const recipe = makeRecipe();
      const hash = "test-hash";

      await cache.putRecipe(recipe, hash);

      // Don't call flush() — the recipe is pending
      const allRecipes = await cache.getAllRecipes();

      expect(allRecipes).toHaveLength(1);
      expect(allRecipes[0]).toEqual(recipe);
    });

    it("AC3.8: getAllRecipes() returns all flushed .json files from recipesDir as validated Recipe objects", async () => {
      const cache1 = new DiskCache(tempDir);
      await cache1.init();

      // Create and flush 3 recipes
      const recipe1 = makeRecipe();
      const recipe2 = makeRecipe();
      const recipe3 = makeRecipe();

      await cache1.putRecipe(recipe1, "hash-1");
      await cache1.putRecipe(recipe2, "hash-2");
      await cache1.putRecipe(recipe3, "hash-3");
      await cache1.flush();

      // Create a new cache instance and load from disk
      const cache2 = new DiskCache(tempDir);
      await cache2.init();

      const allRecipes = await cache2.getAllRecipes();

      expect(allRecipes).toHaveLength(3);
      expect(allRecipes).toContainEqual(recipe1);
      expect(allRecipes).toContainEqual(recipe2);
      expect(allRecipes).toContainEqual(recipe3);
    });

    it("AC3.9: getAllRecipes() returns [] when recipesDir is empty or does not exist", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      // No recipes have been put
      let allRecipes = await cache.getAllRecipes();
      expect(allRecipes).toEqual([]);

      // Test the ENOENT case: manually delete the recipes/ subdirectory
      await rm(join(tempDir, "recipes"), { recursive: true });

      allRecipes = await cache.getAllRecipes();
      expect(allRecipes).toEqual([]);
    });
  });

  describe("AC4: Category CRUD", () => {
    it("AC4.1: putCategory(category, hash) does not write any file until flush() is called", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const category = makeCategory();
      const hash = "cat-hash";

      await cache.putCategory(category, hash);

      // Assert the category file does not exist yet
      const filePath = join(tempDir, "categories", `${category.uid}.json`);
      await expect(stat(filePath)).rejects.toThrow();
    });

    it("AC4.2: getCategory(uid) returns the buffered category before flush()", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const category = makeCategory();
      const hash = "cat-hash";

      await cache.putCategory(category, hash);
      const retrieved = await cache.getCategory(category.uid);

      expect(retrieved).toEqual(category);
    });

    it("AC4.3: After putCategory() + flush(), getCategory(uid) returns the same category (round-trip)", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const category = makeCategory();
      const hash = "cat-hash";

      await cache.putCategory(category, hash);
      await cache.flush();

      const retrieved = await cache.getCategory(category.uid);
      expect(retrieved).toEqual(category);
    });

    it("AC4.4: getCategory(uid) returns null for a UID that was never put", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const retrieved = await cache.getCategory("nonexistent-uid");
      expect(retrieved).toBeNull();
    });
  });

  describe("AC6: Index consistency", () => {
    it("AC6.2: After putRecipe(recipe, hash) + flush(), index.json contains recipes[uid] = hash", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const recipe = makeRecipe();
      const hash = "my-hash";

      await cache.putRecipe(recipe, hash);
      await cache.flush();

      // Read index.json from disk
      const indexPath = join(tempDir, "index.json");
      const indexContent = await readFile(indexPath, "utf-8");
      const parsedIndex = JSON.parse(indexContent);

      expect(parsedIndex.recipes[recipe.uid]).toBe(hash);
    });

    it("AC6.3: After removeRecipe(uid) + flush(), index.json does not contain the removed UID", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const recipe = makeRecipe();
      const hash = "my-hash";

      await cache.putRecipe(recipe, hash);
      await cache.flush();

      await cache.removeRecipe(recipe.uid);
      await cache.flush();

      // Read index.json from disk
      const indexPath = join(tempDir, "index.json");
      const indexContent = await readFile(indexPath, "utf-8");
      const parsedIndex = JSON.parse(indexContent);

      expect(parsedIndex.recipes).not.toHaveProperty(recipe.uid);
    });

    it("AC6.4: putRecipe() called without flush() leaves index.json absent", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const recipe = makeRecipe();
      const hash = "my-hash";

      await cache.putRecipe(recipe, hash);

      // Do NOT call flush()

      // Assert index.json does not exist
      const indexPath = join(tempDir, "index.json");
      await expect(stat(indexPath)).rejects.toThrow();
    });
  });

  describe("AC2.2: Flush completion for all types", () => {
    it("AC2.2: After putRecipe + putCategory + flush(), both files exist in their directories", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const recipe = makeRecipe();
      const recipeHash = "recipe-hash";
      const category = makeCategory();
      const categoryHash = "category-hash";

      await cache.putRecipe(recipe, recipeHash);
      await cache.putCategory(category, categoryHash);
      await cache.flush();

      // Assert recipe file exists
      const recipePath = join(tempDir, "recipes", `${recipe.uid}.json`);
      const recipeStat = await stat(recipePath);
      expect(recipeStat.isFile()).toBe(true);

      // Assert category file exists
      const categoryPath = join(tempDir, "categories", `${category.uid}.json`);
      const categoryStat = await stat(categoryPath);
      expect(categoryStat.isFile()).toBe(true);
    });
  });

  describe("diffRecipes", () => {
    // AC5.1: added
    it("AC5.1: diffRecipes() returns UIDs present in remote but not local index as added", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const recipe = makeRecipe({ uid: "uid-1" as RecipeUid });
      const result = cache.diffRecipes([{ uid: recipe.uid, hash: "h1" }]);

      expect(result.added).toContain(recipe.uid);
      expect(result.changed).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });

    // AC5.2: changed
    it("AC5.2: diffRecipes() returns UIDs where remote hash differs from local index as changed", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const recipe = makeRecipe({ uid: "uid-1" as RecipeUid });
      await cache.putRecipe(recipe, "hash-v1");

      const result = cache.diffRecipes([{ uid: recipe.uid, hash: "hash-v2" }]);

      expect(result.changed).toContain(recipe.uid);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });

    // AC5.3: removed
    it("AC5.3: diffRecipes() returns UIDs in local index but not in remote as removed", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const recipe = makeRecipe({ uid: "uid-1" as RecipeUid });
      await cache.putRecipe(recipe, "hash-v1");

      const result = cache.diffRecipes([]);

      expect(result.removed).toContain(recipe.uid);
      expect(result.added).toHaveLength(0);
      expect(result.changed).toHaveLength(0);
    });

    // AC5.4: empty remote, populated index
    it("AC5.4: diffRecipes() with empty remote and populated index returns all local UIDs as removed", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const r1 = makeRecipe({ uid: "uid-1" as RecipeUid });
      const r2 = makeRecipe({ uid: "uid-2" as RecipeUid });
      const r3 = makeRecipe({ uid: "uid-3" as RecipeUid });

      await cache.putRecipe(r1, "hash-a");
      await cache.putRecipe(r2, "hash-b");
      await cache.putRecipe(r3, "hash-c");

      const result = cache.diffRecipes([]);

      expect(result.removed).toHaveLength(3);
      expect(result.removed).toContain(r1.uid);
      expect(result.removed).toContain(r2.uid);
      expect(result.removed).toContain(r3.uid);
    });

    // AC5.5: empty remote and empty index
    it("AC5.5: diffRecipes() with empty remote and empty index returns empty diff", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const result = cache.diffRecipes([]);

      expect(result).toEqual({ added: [], changed: [], removed: [] });
    });

    // AC5.7: throws before init — recipes
    it("AC5.7: diffRecipes() throws if called before init()", async () => {
      const cache = new DiskCache(tempDir);

      expect(() => cache.diffRecipes([])).toThrow();
    });

    // AC6.1: index consistency
    it("AC6.1: putRecipe() updates _index immediately — diffRecipes() reflects new hash without flush()", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const recipe = makeRecipe({ uid: "uid-1" as RecipeUid });

      // Put with hash-v1
      await cache.putRecipe(recipe, "hash-v1");
      let result = cache.diffRecipes([{ uid: recipe.uid, hash: "hash-v1" }]);
      expect(result.added).toHaveLength(0);
      expect(result.changed).toHaveLength(0);
      expect(result.removed).toHaveLength(0);

      // Put same recipe with hash-v2
      await cache.putRecipe(recipe, "hash-v2");
      result = cache.diffRecipes([{ uid: recipe.uid, hash: "hash-v1" }]);
      expect(result.changed).toContain(recipe.uid);
    });

    // Mixed scenario: added + changed + removed in one call
    it("mixed: diffRecipes() handles added, changed, and removed in one call", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const r1 = makeRecipe({ uid: "uid-1" as RecipeUid });
      const r2 = makeRecipe({ uid: "uid-2" as RecipeUid });
      const r3 = makeRecipe({ uid: "uid-3" as RecipeUid });

      await cache.putRecipe(r1, "hash-a");
      await cache.putRecipe(r2, "hash-b");
      await cache.putRecipe(r3, "hash-c");

      const result = cache.diffRecipes([
        { uid: r1.uid, hash: "hash-a" }, // same
        { uid: r2.uid, hash: "hash-CHANGED" }, // changed
        { uid: "uid-4" as RecipeUid, hash: "hash-new" }, // added
      ]);

      expect(result.added).toContain("uid-4");
      expect(result.changed).toContain(r2.uid);
      expect(result.removed).toContain(r3.uid);
      expect(result.added).toHaveLength(1);
      expect(result.changed).toHaveLength(1);
      expect(result.removed).toHaveLength(1);
    });
  });
});
