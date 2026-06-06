import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CategoryUid, RecipeUid } from "../../ids.js";

import { makeCategory, makeRecipe } from "../../../test/domains/recipe/__fixtures__/recipes.js";
import { makeCache, makeRecipeCache, useTempDir } from "../../../test/support/disk-caches.js";
import { makeKernelInfra } from "../../../test/support/kernel-harness.js";
import { getText, makeTestServer } from "../../../test/support/tool-test-utils.js";
import { registeredModules } from "../../kernel/registry.js";
import { categoryDiskDescriptor } from "./category/types.js";
import { RecipeStore } from "./store.js";
// Side-effect: populate the kernel module registry so `registeredModules()` finds recipe.
import "../../kernel/modules.generated.js";

/**
 * Build the recipe module against a (pre-seeded) cache dir WITHOUT running a sync
 * cycle — the recipe `.state` factory hydrates its store from `<cacheDir>/recipes` at
 * construction, exactly as on a warm restart — then register its tools on a stub
 * server. Recipe is dependency-free (`defineModule("recipe", [])`), so its closure is
 * just itself. Returns `callTool` so a cold-started `search_recipes` can be exercised
 * end-to-end.
 */
async function coldStartRecipeTools(
  cacheDir: string,
): Promise<(name: string, args: Record<string, unknown>) => Promise<CallToolResult>> {
  const infra = makeKernelInfra({ cacheDir });
  const recipeModule = registeredModules().find((m) => m.id === "recipe");
  if (recipeModule === undefined) throw new Error("recipe module not registered");
  const built = await recipeModule.build(infra);
  const { server, callTool } = makeTestServer();
  const ctx = { state: built.state, writes: built.writes ?? {}, deps: {}, infra, server };
  for (const tool of built.tools) tool.register(ctx);
  return callTool;
}

const tmp = useTempDir("mcp-paprika-cold-start-integration-");
beforeEach(async () => {
  await tmp.setup();
});
afterEach(async () => {
  await tmp.teardown();
});

describe("RecipeDiskCache cold-start persistence integration", () => {
  describe("Write-Flush-Restart-Hydrate round-trip", () => {
    it("persists recipes to disk and reloads them from a cold-start cache instance", async () => {
      const cache1 = makeRecipeCache(tmp.dir());
      await cache1.init();

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

      await cache1.put(recipe1);
      await cache1.put(recipe2);
      await cache1.flush();

      expect((await cache1.get(recipe1.uid))._unsafeUnwrap()).toEqual(recipe1);
      expect((await cache1.get(recipe2.uid))._unsafeUnwrap()).toEqual(recipe2);

      // Simulate restart
      const cache2 = makeRecipeCache(tmp.dir());
      await cache2.init();

      expect((await cache2.get(recipe1.uid))._unsafeUnwrap()).toEqual(recipe1);
      expect((await cache2.get(recipe2.uid))._unsafeUnwrap()).toEqual(recipe2);

      const allRecipes = (await cache2.getAll())._unsafeUnwrap();
      expect(allRecipes).toHaveLength(2);
      expect(allRecipes).toContainEqual(recipe1);
      expect(allRecipes).toContainEqual(recipe2);
    });

    it("hydrates a RecipeStore from the cold-start cache using the production pattern", async () => {
      const cache1 = makeRecipeCache(tmp.dir());
      await cache1.init();

      const recipe1 = makeRecipe({ uid: "recipe-soup-1" as RecipeUid, name: "Tomato Soup" });
      const recipe2 = makeRecipe({ uid: "recipe-salad-2" as RecipeUid, name: "Caesar Salad" });

      await cache1.put(recipe1);
      await cache1.put(recipe2);
      await cache1.flush();

      const cache2 = makeRecipeCache(tmp.dir());
      await cache2.init();

      const store = new RecipeStore();
      const cachedRecipes = (await cache2.getAll())._unsafeUnwrap();
      for (const recipe of cachedRecipes) {
        store.set(recipe);
      }

      expect(store.size).toBe(2);
      expect(store.get(recipe1.uid)).toEqual(recipe1);
      expect(store.get(recipe2.uid)).toEqual(recipe2);
      expect(store.getAll()).toHaveLength(2);
    });
  });

  describe("Category persistence", () => {
    it("persists category files to disk and reloads across cache instances", async () => {
      const cache1 = makeCache(tmp.dir(), categoryDiskDescriptor);
      await cache1.init();

      const category1 = makeCategory({
        uid: "cat-breakfast-1" as CategoryUid,
        name: "Breakfast",
        orderFlag: 1,
      });
      const category2 = makeCategory({ uid: "cat-desserts-2" as CategoryUid, name: "Desserts", orderFlag: 2 });

      await cache1.put(category1);
      await cache1.put(category2);
      await cache1.flush();

      const cache2 = makeCache(tmp.dir(), categoryDiskDescriptor);
      await cache2.init();

      expect((await cache2.get(category1.uid))._unsafeUnwrap()).toEqual(category1);
      expect((await cache2.get(category2.uid))._unsafeUnwrap()).toEqual(category2);
    });
  });

  describe("Diff detection after cold start", () => {
    it("reports no changes when data is unchanged after cold start", async () => {
      const cache1 = makeRecipeCache(tmp.dir());
      await cache1.init();
      const recipe1 = makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Recipe 1" });
      await cache1.put(recipe1);
      await cache1.flush();

      const cache2 = makeRecipeCache(tmp.dir());
      await cache2.init();

      const diff = cache2.diff([{ uid: recipe1.uid, hash: recipe1.hash }])._unsafeUnwrap();
      expect(diff.added).toEqual([]);
      expect(diff.changed).toEqual([]);
      expect(diff.removed).toEqual([]);
    });

    it("detects changed recipes after cold start", async () => {
      const cache1 = makeRecipeCache(tmp.dir());
      await cache1.init();
      // Hash gets captured from recipe.hash at put time
      const recipe1 = makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Recipe 1", hash: "hash-old" });
      await cache1.put(recipe1);
      await cache1.flush();

      const cache2 = makeRecipeCache(tmp.dir());
      await cache2.init();

      const diff = cache2.diff([{ uid: recipe1.uid, hash: "hash-new" }])._unsafeUnwrap();
      expect(diff.added).toEqual([]);
      expect(diff.changed).toContain(recipe1.uid);
      expect(diff.removed).toEqual([]);
    });

    it("detects removed recipes after cold start", async () => {
      const cache1 = makeRecipeCache(tmp.dir());
      await cache1.init();
      const recipe1 = makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Recipe 1" });
      await cache1.put(recipe1);
      await cache1.flush();

      const cache2 = makeRecipeCache(tmp.dir());
      await cache2.init();

      const diff = cache2.diff([])._unsafeUnwrap();
      expect(diff.added).toEqual([]);
      expect(diff.changed).toEqual([]);
      expect(diff.removed).toContain(recipe1.uid);
    });
  });

  describe("Tools work against hydrated store", () => {
    it("search_recipes works after cold-start hydration through the kernel recipe module", async () => {
      const cache1 = makeRecipeCache(tmp.dir());
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

      await cache1.put(recipe1);
      await cache1.put(recipe2);
      await cache1.flush();

      // Rebuild the recipe module against the persisted cache dir: its `.state` hydrates
      // the store from disk, exactly as on a warm restart, before any sync runs.
      const callTool = await coldStartRecipeTools(tmp.dir());

      const result = await callTool("search_recipes", { query: "carbonara", limit: 10 });
      const text = getText(result);
      expect(text).toContain("Pasta Carbonara");
      expect(text).not.toContain("Alfredo");
    });

    it("search_recipes finds recipes by ingredient after cold start", async () => {
      const cache1 = makeRecipeCache(tmp.dir());
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

      await cache1.put(recipe1);
      await cache1.put(recipe2);
      await cache1.flush();

      const callTool = await coldStartRecipeTools(tmp.dir());

      const result = await callTool("search_recipes", { query: "mozzarella", limit: 10 });
      const text = getText(result);
      expect(text).toContain("Margherita Pizza");
      expect(text).not.toContain("Garlic Bread");
    });
  });

  describe("Corruption recovery", () => {
    it("recovers gracefully when the recipes index is corrupted", async () => {
      // Initialize once so the recipes/ subdir exists, then corrupt its index.
      const seed = makeRecipeCache(tmp.dir());
      await seed.init();
      await writeFile(join(tmp.dir(), "recipes", "index.json"), "this is not valid json {[}");

      const cache = makeRecipeCache(tmp.dir());
      await cache.init();

      const recipe = makeRecipe({ uid: "recipe-test" as RecipeUid, name: "Test Recipe" });
      await cache.put(recipe);
      await cache.flush();

      expect((await cache.get(recipe.uid))._unsafeUnwrap()).toEqual(recipe);
    });

    it("handles a missing recipes index gracefully (first run)", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();

      const recipe = makeRecipe({ uid: "recipe-first-run" as RecipeUid, name: "First Run Recipe" });
      await cache.put(recipe);
      await cache.flush();

      expect((await cache.get(recipe.uid))._unsafeUnwrap()).toEqual(recipe);
    });
  });

  describe("Full end-to-end persistence scenario", () => {
    it("handles a complete write-flush-restart-modify cycle", async () => {
      const cache1 = makeRecipeCache(tmp.dir());
      await cache1.init();
      const recipe1 = makeRecipe({
        uid: "recipe-evolving" as RecipeUid,
        name: "Evolving Recipe V1",
        ingredients: "original ingredients",
      });
      await cache1.put(recipe1);
      await cache1.flush();

      const cache2 = makeRecipeCache(tmp.dir());
      await cache2.init();
      const recipe1Updated = makeRecipe({
        uid: "recipe-evolving" as RecipeUid,
        name: "Evolving Recipe V2",
        ingredients: "updated ingredients",
      });
      await cache2.put(recipe1Updated);
      await cache2.flush();

      const cache3 = makeRecipeCache(tmp.dir());
      await cache3.init();
      const final = (await cache3.get(recipe1.uid))._unsafeUnwrap();
      expect(final).toEqual(recipe1Updated);
      expect(final?.name).toBe("Evolving Recipe V2");
      expect(final?.ingredients).toBe("updated ingredients");
    });

    it("preserves all recipe data fields after round-trip", async () => {
      const cache1 = makeRecipeCache(tmp.dir());
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
      await cache1.put(originalRecipe);
      await cache1.flush();

      const cache2 = makeRecipeCache(tmp.dir());
      await cache2.init();
      const retrieved = (await cache2.get(originalRecipe.uid))._unsafeUnwrap();

      expect(retrieved).toEqual(originalRecipe);
    });
  });

  describe("Legacy-index migration", () => {
    it("upgrades a legacy unified index.json to recipes/index.json on first init", async () => {
      const legacyHashes = {
        "recipe-a": "hash-a",
        "recipe-b": "hash-b",
      };
      const legacyIndex = {
        recipes: legacyHashes,
        categories: { "cat-1": "" },
        pantry: { "pantry-1": "" },
        oauthClients: {},
        oauthTokens: {},
      };
      await writeFile(join(tmp.dir(), "index.json"), JSON.stringify(legacyIndex, null, 2));

      const cache = makeRecipeCache(tmp.dir());
      await cache.init();

      // Legacy file is gone; new file is in place with just the recipes map.
      await expect(readFile(join(tmp.dir(), "index.json"), "utf-8")).rejects.toThrow();
      const migrated = JSON.parse(await readFile(join(tmp.dir(), "recipes", "index.json"), "utf-8")) as Record<
        string,
        string
      >;
      expect(migrated).toEqual(legacyHashes);
    });

    it("discards a legacy index holding JSON null instead of crashing init", async () => {
      await writeFile(join(tmp.dir(), "index.json"), "null");

      const cache = makeRecipeCache(tmp.dir());
      (await cache.init())._unsafeUnwrap();

      // The null legacy file is treated as malformed: discarded, no migrated index.
      await expect(readFile(join(tmp.dir(), "index.json"), "utf-8")).rejects.toThrow();
      await expect(readFile(join(tmp.dir(), "recipes", "index.json"), "utf-8")).rejects.toThrow();
    });

    it("deletes the legacy file when recipes namespace is empty (placeholder-only legacy)", async () => {
      const legacyIndex = {
        recipes: {},
        categories: { "cat-1": "" },
        pantry: { "pantry-1": "" },
        oauthClients: {},
        oauthTokens: {},
      };
      await writeFile(join(tmp.dir(), "index.json"), JSON.stringify(legacyIndex, null, 2));

      const cache = makeRecipeCache(tmp.dir());
      await cache.init();

      await expect(readFile(join(tmp.dir(), "index.json"), "utf-8")).rejects.toThrow();
      await expect(readFile(join(tmp.dir(), "recipes", "index.json"), "utf-8")).rejects.toThrow();
    });

    it("is idempotent across reruns (legacy + already-migrated both present)", async () => {
      const legacyHashes = { "recipe-c": "hash-c" };
      await writeFile(join(tmp.dir(), "index.json"), JSON.stringify({ recipes: legacyHashes }));

      // First init: migrates. Second init: legacy file is gone, so no-op.
      const c1 = makeRecipeCache(tmp.dir());
      await c1.init();
      const c2 = makeRecipeCache(tmp.dir());
      await c2.init();

      // Simulate a crash mid-migration: legacy file present AND recipes/index.json
      // present from a prior partial run. Migration should overwrite + delete.
      await writeFile(join(tmp.dir(), "index.json"), JSON.stringify({ recipes: legacyHashes }));
      const c3 = makeRecipeCache(tmp.dir());
      await c3.init();

      await expect(readFile(join(tmp.dir(), "index.json"), "utf-8")).rejects.toThrow();
      const migrated = JSON.parse(await readFile(join(tmp.dir(), "recipes", "index.json"), "utf-8")) as Record<
        string,
        string
      >;
      expect(migrated).toEqual(legacyHashes);
    });

    it("recovers from a corrupt legacy index.json by discarding it and continuing fresh", async () => {
      await writeFile(join(tmp.dir(), "index.json"), "{ broken json");

      const cache = makeRecipeCache(tmp.dir());
      await cache.init();

      await expect(readFile(join(tmp.dir(), "index.json"), "utf-8")).rejects.toThrow();

      // Cache is usable and starts with an empty recipes set.
      const recipe = makeRecipe({ uid: "recipe-after-corrupt" as RecipeUid, name: "Recovered" });
      await cache.put(recipe);
      await cache.flush();
      expect((await cache.get(recipe.uid))._unsafeUnwrap()).toEqual(recipe);
    });
  });
});
