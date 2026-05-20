import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, readdir, stat, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { RecipeUid, PantryItemUid } from "../paprika/types.js";
import { DiskCache } from "./disk-cache.js";
import { makeRecipe, makeCategory } from "./__fixtures__/recipes.js";
import { makePantryItem } from "./__fixtures__/pantry.js";
import { makeOAuthClient, makeOAuthToken } from "./__fixtures__/oauth.js";

// Mock fs/promises to allow injecting failures into rename.
// The factory function imports the real module and overrides only rename with a spy.
vi.mock("node:fs/promises", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs/promises")>();
  return { ...orig, rename: vi.fn(orig.rename) };
});

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

      expect(parsed).toEqual({ recipes: {}, categories: {}, pantry: {}, oauthClients: {}, oauthTokens: {} });
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

      expect(parsed).toEqual({ recipes: {}, categories: {}, pantry: {}, oauthClients: {}, oauthTokens: {} });
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

  describe("pantry-read.AC3: DiskCache pantry methods", () => {
    it("AC3.1: init() creates pantry/ subdirectory", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const pantryDir = join(tempDir, "pantry");
      const pantryDirStat = await stat(pantryDir);

      expect(pantryDirStat.isDirectory()).toBe(true);
    });

    it("AC3.2: putPantryItem() + flush() writes JSON file to pantry/ directory and updates index", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const item = makePantryItem();
      await cache.putPantryItem(item);
      await cache.flush();

      // Verify file exists and contains correct data
      const filePath = join(tempDir, "pantry", `${item.uid}.json`);
      const raw = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw);

      expect(parsed.uid).toBe(item.uid);
      expect(parsed.ingredient).toBe(item.ingredient);
      expect(parsed.quantity).toBe(item.quantity);

      // Verify index contains empty-string placeholder
      const indexPath = join(tempDir, "index.json");
      const indexContent = await readFile(indexPath, "utf-8");
      const parsedIndex = JSON.parse(indexContent);

      expect(parsedIndex.pantry[item.uid]).toBe("");
    });

    it("AC3.3: getAllPantryItems() returns items from pending buffer and disk, pending shadows disk", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      // Write one item to disk manually
      const diskItem = makePantryItem({ uid: "uid-disk" as PantryItemUid });
      const diskItemPath = join(tempDir, "pantry", "uid-disk.json");
      await writeFile(diskItemPath, JSON.stringify(diskItem, null, 2));

      // Put a pending item (not flushed)
      const pendingItem = makePantryItem({ uid: "uid-pending" as PantryItemUid });
      await cache.putPantryItem(pendingItem);

      // Get all items (should include both)
      const allItems = await cache.getAllPantryItems();

      expect(allItems).toHaveLength(2);
      expect(allItems.map((i) => i.uid).sort()).toEqual(["uid-disk", "uid-pending"]);

      // Test shadowing: put item with same UID as disk but different data
      const sharedItem = makePantryItem({
        uid: "uid-shared" as PantryItemUid,
        ingredient: "Pending Version",
      });
      await writeFile(
        join(tempDir, "pantry", "uid-shared.json"),
        JSON.stringify({ ...sharedItem, ingredient: "Disk Version" }, null, 2),
      );

      await cache.putPantryItem(sharedItem);

      // Get all items again
      const allItems2 = await cache.getAllPantryItems();
      const sharedFromCache = allItems2.find((i) => i.uid === "uid-shared");

      expect(sharedFromCache?.ingredient).toBe("Pending Version");
    });

    it("AC3.4: removePantryItem() deletes file and removes from index and pending", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const item = makePantryItem();
      await cache.putPantryItem(item);
      await cache.flush();

      // Verify file exists
      const filePath = join(tempDir, "pantry", `${item.uid}.json`);
      await expect(stat(filePath)).resolves.toBeDefined();

      // Remove the item
      await cache.removePantryItem(item.uid);

      // Verify file is deleted
      await expect(stat(filePath)).rejects.toThrow();

      // Verify item is not returned by getAllPantryItems
      const allItems = await cache.getAllPantryItems();
      expect(allItems).toHaveLength(0);

      // Verify the pantry index entry is removed from disk
      await cache.flush();
      const indexContent = await readFile(join(tempDir, "index.json"), "utf-8");
      const parsedIndex: { pantry?: Record<string, string> } = JSON.parse(indexContent);
      expect(parsedIndex.pantry).not.toHaveProperty(item.uid);

      // Test removing from pending (not flushed): put then remove without flush
      const pendingItem = makePantryItem();
      await cache.putPantryItem(pendingItem);
      await cache.removePantryItem(pendingItem.uid);

      const allItems2 = await cache.getAllPantryItems();
      expect(allItems2).toHaveLength(0);
    });

    it("AC3.5: removePantryItem() is idempotent on missing file", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      // Remove a pantry item that was never created
      await expect(cache.removePantryItem("never-existed-uid")).resolves.toBeUndefined();
    });

    it("AC3.6: Existing index.json without pantry key loads cleanly via .default({})", async () => {
      // Write a legacy index.json with only recipes and categories (no pantry)
      const legacyIndex = JSON.stringify({ recipes: {}, categories: {} });
      const indexPath = join(tempDir, "index.json");
      await writeFile(indexPath, legacyIndex);

      // Create and init a fresh cache
      const cache = new DiskCache(tempDir);
      await cache.init();

      // Verify no error and getAllPantryItems returns empty
      const allItems = await cache.getAllPantryItems();
      expect(allItems).toHaveLength(0);
    });
  });

  describe("DiskCache: OAuth client CRUD", () => {
    it("put then get round-trips through pending map", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();
      const clientId = randomUUID();
      const client = makeOAuthClient({ clientId });
      await cache.putOAuthClient(client);
      expect(await cache.getOAuthClient(clientId)).toEqual(client);
    });

    it("put → flush → get reads from disk", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();
      const clientId = randomUUID();
      const client = makeOAuthClient({ clientId });
      await cache.putOAuthClient(client);
      await cache.flush();
      expect(await cache.getOAuthClient(clientId)).toEqual(client);
    });

    it("put → flush → remove deletes file and index entry", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();
      const clientId = randomUUID();
      const client = makeOAuthClient({ clientId });
      await cache.putOAuthClient(client);
      await cache.flush();

      // Verify file exists
      const filePath = join(tempDir, "oauthClients", `${clientId}.json`);
      await expect(stat(filePath)).resolves.toBeDefined();

      // Remove the client
      await cache.removeOAuthClient(clientId);

      // Verify file is deleted
      await expect(stat(filePath)).rejects.toThrow();

      // Verify client is not returned by getAllOAuthClients
      const allClients = await cache.getAllOAuthClients();
      expect(allClients).toHaveLength(0);

      // Verify the index entry is removed from disk
      await cache.flush();
      const indexContent = await readFile(join(tempDir, "index.json"), "utf-8");
      const parsedIndex: { oauthClients?: Record<string, string> } = JSON.parse(indexContent);
      expect(parsedIndex.oauthClients).not.toHaveProperty(clientId);
    });

    it("getAllOAuthClients merges pending and disk; pending shadows disk", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      const diskClientId = randomUUID();
      const diskClient = makeOAuthClient({ clientId: diskClientId });
      const diskClientPath = join(tempDir, "oauthClients", `${diskClientId}.json`);
      await writeFile(diskClientPath, JSON.stringify(diskClient, null, 2));

      const pendingClientId = randomUUID();
      const pendingClient = makeOAuthClient({ clientId: pendingClientId });
      await cache.putOAuthClient(pendingClient);

      const allClients = await cache.getAllOAuthClients();

      expect(allClients).toHaveLength(2);
      expect(allClients.map((c) => c.clientId).sort()).toEqual([diskClientId, pendingClientId].sort());

      // Test shadowing: put client with same ID as disk but different data
      const sharedClientId = randomUUID();
      const sharedClient = makeOAuthClient({
        clientId: sharedClientId,
        clientName: "Pending Version",
      });
      await writeFile(
        join(tempDir, "oauthClients", `${sharedClientId}.json`),
        JSON.stringify({ ...sharedClient, clientName: "Disk Version" }, null, 2),
      );

      await cache.putOAuthClient(sharedClient);

      const allClients2 = await cache.getAllOAuthClients();
      const sharedFromCache = allClients2.find((c) => c.clientId === sharedClientId);

      expect(sharedFromCache?.clientName).toBe("Pending Version");
    });

    it("AC4.5: on-disk JSON contains registrationAccessTokenHash as 64-char hex; no plaintext", async () => {
      // PLAN says (phase_03.md:271-282): on-disk JSON for OAuth client shows
      // registrationAccessTokenHash as 64-char hex; no plaintext fields exist
      // (client_secret, clientSecret, registrationAccessToken).
      const cache = new DiskCache(tempDir);
      await cache.init();
      const clientId = randomUUID();
      await cache.putOAuthClient(makeOAuthClient({ clientId, registrationAccessTokenHash: "a".repeat(64) }));
      await cache.flush();
      const raw = await readFile(join(tempDir, "oauthClients", `${clientId}.json`), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.registrationAccessTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(parsed).not.toHaveProperty("client_secret");
      expect(parsed).not.toHaveProperty("clientSecret");
      expect(parsed).not.toHaveProperty("registrationAccessToken");
    });
  });

  describe("DiskCache: OAuth token CRUD", () => {
    it("put then get round-trips through pending map", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();
      const token = makeOAuthToken();
      await cache.putOAuthToken(token);
      expect(await cache.getOAuthToken(token.tokenHash)).toEqual(token);
    });

    it("put → flush → get reads from disk", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();
      const token = makeOAuthToken();
      await cache.putOAuthToken(token);
      await cache.flush();
      expect(await cache.getOAuthToken(token.tokenHash)).toEqual(token);
    });

    it("put → flush → remove deletes file and index entry", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();
      const token = makeOAuthToken();
      await cache.putOAuthToken(token);
      await cache.flush();

      // Verify file exists
      const filePath = join(tempDir, "oauthTokens", `${token.tokenHash}.json`);
      await expect(stat(filePath)).resolves.toBeDefined();

      // Remove the token
      await cache.removeOAuthToken(token.tokenHash);

      // Verify file is deleted
      await expect(stat(filePath)).rejects.toThrow();

      // Verify token is not returned by getAllOAuthTokens
      const allTokens = await cache.getAllOAuthTokens();
      expect(allTokens).toHaveLength(0);

      // Verify the index entry is removed from disk
      await cache.flush();
      const indexContent = await readFile(join(tempDir, "index.json"), "utf-8");
      const parsedIndex: { oauthTokens?: Record<string, string> } = JSON.parse(indexContent);
      expect(parsedIndex.oauthTokens).not.toHaveProperty(token.tokenHash);
    });

    it("getAllOAuthTokens merges pending and disk; pending shadows disk", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      // Write one token to disk manually
      const diskToken = makeOAuthToken();
      const diskTokenPath = join(tempDir, "oauthTokens", `${diskToken.tokenHash}.json`);
      await writeFile(diskTokenPath, JSON.stringify(diskToken, null, 2));

      // Put a pending token (not flushed)
      const pendingToken = makeOAuthToken();
      await cache.putOAuthToken(pendingToken);

      // Get all tokens (should include both)
      const allTokens = await cache.getAllOAuthTokens();

      expect(allTokens).toHaveLength(2);
      expect(allTokens.map((t) => t.tokenHash).sort()).toEqual([diskToken.tokenHash, pendingToken.tokenHash].sort());

      // Test shadowing: put token with same hash as disk but different data
      const sharedToken = makeOAuthToken({
        kind: "access",
      });
      const sharedHash = sharedToken.tokenHash;
      await writeFile(
        join(tempDir, "oauthTokens", `${sharedHash}.json`),
        JSON.stringify({ ...sharedToken, kind: "refresh" }, null, 2),
      );

      await cache.putOAuthToken(sharedToken);

      // Get all tokens again
      const allTokens2 = await cache.getAllOAuthTokens();
      const sharedFromCache = allTokens2.find((t) => t.tokenHash === sharedHash);

      expect(sharedFromCache?.kind).toBe("access");
    });

    it("AC4.6: filename equals tokenHash; file's tokenHash field equals filename", async () => {
      // PLAN says (phase_03.md:292-303): filename = ${tokenHash}.json;
      // file's tokenHash field equals filename's hex.
      // Use makeOAuthToken without override to get valid 64-char hex hash
      const token = makeOAuthToken();
      const hash = token.tokenHash;
      const cache = new DiskCache(tempDir);
      await cache.init();
      await cache.putOAuthToken(token);
      await cache.flush();
      const entries = await readdir(join(tempDir, "oauthTokens"));
      expect(entries).toContain(`${hash}.json`);
      const raw = await readFile(join(tempDir, "oauthTokens", `${hash}.json`), "utf-8");
      expect(JSON.parse(raw).tokenHash).toBe(hash);
    });
  });

  describe("DiskCache: index.json migration", () => {
    it("pre-OAuth index.json (no oauthClients/oauthTokens keys) parses cleanly with empty defaults", async () => {
      // Write a legacy index.json containing only recipes + categories + pantry.
      await writeFile(join(tempDir, "index.json"), JSON.stringify({ recipes: {}, categories: {}, pantry: {} }));
      const cache = new DiskCache(tempDir);
      await cache.init();
      expect(await cache.getAllOAuthClients()).toEqual([]);
      expect(await cache.getAllOAuthTokens()).toEqual([]);
    });
  });

  describe("DiskCache: concurrent writes serialize via mutex", () => {
    it("interleaved puts + flush land atomically: every put either fully on disk or not at all", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();

      // Generate 50 puts across 3 namespaces + 5 interleaved flushes.
      const recipes = Array.from({ length: 20 }, (_, i) => makeRecipe({ uid: `r-${i}` as RecipeUid }));
      const clients = Array.from({ length: 20 }, () =>
        makeOAuthClient({ registrationAccessTokenHash: "a".repeat(64) }),
      );
      // Generate tokens with valid 64-char hex tokenHash (don't use padStart on short strings)
      const tokens = Array.from({ length: 10 }, () => makeOAuthToken());

      const operations: Array<Promise<unknown>> = [];
      for (let i = 0; i < 20; i++) {
        operations.push(cache.putRecipe(recipes[i]!, `hash-${i}`));
        operations.push(cache.putOAuthClient(clients[i]!));
        if (i % 4 === 3) operations.push(cache.flush()); // 5 interleaved flushes
      }
      for (const token of tokens) operations.push(cache.putOAuthToken(token));
      operations.push(cache.flush());

      await Promise.all(operations);

      // Invariant 1: every index entry has a corresponding file on disk.
      const recipeFiles = await readdir(join(tempDir, "recipes"));
      const clientFiles = await readdir(join(tempDir, "oauthClients"));
      const tokenFiles = await readdir(join(tempDir, "oauthTokens"));
      expect(recipeFiles.length).toBe(20);
      expect(clientFiles.length).toBe(20);
      expect(tokenFiles.length).toBe(10);

      // Invariant 2: no file-without-index (every file is reachable from getAll*).
      const allRecipes = await cache.getAllRecipes();
      const allClients = await cache.getAllOAuthClients();
      const allTokens = await cache.getAllOAuthTokens();
      expect(allRecipes).toHaveLength(20);
      expect(allClients).toHaveLength(20);
      expect(allTokens).toHaveLength(10);

      // Invariant 3: no .tmp leftovers from index renames.
      const cacheEntries = await readdir(tempDir);
      expect(cacheEntries.filter((e) => e.endsWith(".tmp"))).toHaveLength(0);
    });

    it("flush() that fires mid-put still captures all puts that started before it", async () => {
      const cache = new DiskCache(tempDir);
      await cache.init();
      // Two puts, then immediately a flush, all without await. Mutex orders them.
      const clientA = makeOAuthClient();
      const clientB = makeOAuthClient();
      const clientC = makeOAuthClient();
      const p1 = cache.putOAuthClient(clientA);
      const p2 = cache.putOAuthClient(clientB);
      const f = cache.flush();
      const p3 = cache.putOAuthClient(clientC);
      await Promise.all([p1, p2, f, p3]);

      // After the flush mid-sequence, a and b are on disk; c was queued after flush.
      const filesOnDiskAfter = await readdir(join(tempDir, "oauthClients"));
      expect(filesOnDiskAfter).toEqual(
        expect.arrayContaining([`${clientA.clientId}.json`, `${clientB.clientId}.json`]),
      );
      // c may or may not be on disk depending on whether p3 ran before resolution; either way no torn state.
      // Final flush guarantees everything lands:
      await cache.flush();
      const finalFiles = await readdir(join(tempDir, "oauthClients"));
      expect(finalFiles).toEqual(
        expect.arrayContaining([`${clientA.clientId}.json`, `${clientB.clientId}.json`, `${clientC.clientId}.json`]),
      );
    });

    it("AC4.6: OAuthTokenSchema rejects malformed tokenHash at parse time", async () => {
      // PLAN says (phase_03.md:217): OAuthTokenSchema enforces /^[0-9a-f]{64}$/ on parse.
      // This test exercises the fixture's schema check, not the cache's put-time behavior.
      // Note: DiskCache.putOAuthToken does not validate on write — it defers writes to flush(),
      // and the schema validation happens when reading from disk (getOAuthToken).
      const cache = new DiskCache(tempDir);
      await cache.init();

      // Attempting to create a token with invalid tokenHash should fail schema validation
      expect(() => {
        makeOAuthToken({ tokenHash: "not-hex-and-too-short" });
      }).toThrow();

      expect(() => {
        makeOAuthToken({ tokenHash: "G".repeat(64) }); // G is not valid hex
      }).toThrow();
    });

    it("AC4.7: flush() error doesn't poison subsequent operations (lock releases on exception)", async () => {
      // PLAN says (phase_03.md:396-401): use vi.spyOn(fs.rename) to reject once
      // and verify async-mutex's released-lock contract.
      // async-mutex's runExclusive contract: a rejected work() releases the lock
      // and the next queued caller runs normally.
      const cache = new DiskCache(tempDir);
      await cache.init();

      await cache.putOAuthClient(makeOAuthClient());

      // Get the mocked rename and inject a one-time rejection.
      // The vi.mock at module level intercepts all fs/promises imports,
      // so rename is our spy function.
      const { rename: renameMock } = await import("node:fs/promises");
      vi.mocked(renameMock).mockRejectedValueOnce(new Error("EACCES: simulated"));

      await expect(cache.flush()).rejects.toThrow("EACCES: simulated");

      // Subsequent operations must succeed (proves async-mutex released the lock).
      // Also race against a tight timeout (200ms) so a "lock held forever" regression
      // shows up as an assertion failure, not vitest's 5s default timeout.
      const recoveryOp = (async () => {
        await cache.putOAuthClient(makeOAuthClient());
        await cache.flush();
      })();
      const timeoutOp = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("recovery took >200ms — mutex may not have released")), 200),
      );
      await Promise.race([recoveryOp, timeoutOp]);

      // Verify both clients on disk
      const clients = await readdir(join(tempDir, "oauthClients"));
      expect(clients).toHaveLength(2);

      // Confirm the rename mock was called at least once
      expect(vi.mocked(renameMock).mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
