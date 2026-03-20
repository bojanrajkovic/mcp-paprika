/**
 * End-to-end integration tests for EmbeddingClient + VectorStore using a real
 * Ollama instance with nomic-embed-text.
 *
 * These tests require a running Ollama server at http://localhost:11434 with
 * the nomic-embed-text model pulled. They are automatically skipped when Ollama
 * is not available, so CI is unaffected.
 *
 * Run specifically with: pnpm test src/features/embeddings-vector-store.test.integration.ts
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EmbeddingClient } from "./embeddings.js";
import { VectorStore } from "./vector-store.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import type { EmbeddingConfig } from "../utils/config.js";
import type { RecipeUid, CategoryUid } from "../paprika/types.js";

const OLLAMA_BASE_URL = "http://localhost:11434/v1";
const OLLAMA_MODEL = "nomic-embed-text";

function makeOllamaConfig(): EmbeddingConfig {
  return { apiKey: "ollama", baseUrl: OLLAMA_BASE_URL, model: OLLAMA_MODEL };
}

const noCats = (_uids: ReadonlyArray<CategoryUid>): ReadonlyArray<string> => [];

async function isOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { models: Array<{ name: string }> };
    return body.models.some((m) => m.name.startsWith("nomic-embed-text"));
  } catch {
    return false;
  }
}

// Top-level await: resolved before any describe block registers
const ollamaAvailable = await isOllamaAvailable();

// Suppress stderr output from VectorStore logging during tests
const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

describe.skipIf(!ollamaAvailable)("EmbeddingClient + VectorStore (Ollama)", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    stderrSpy.mockClear();
  });

  async function setup(): Promise<{ embedder: EmbeddingClient; store: VectorStore }> {
    tempDir = await mkdtemp(join(tmpdir(), "paprika-e2e-ollama-"));
    const embedder = new EmbeddingClient(makeOllamaConfig());
    const store = new VectorStore(tempDir, embedder);
    await store.init();
    return { embedder, store };
  }

  it("embeds a single text and returns a 768-dimensional vector", async () => {
    const embedder = new EmbeddingClient(makeOllamaConfig());

    const vector = await embedder.embed("chicken parmesan with marinara sauce");

    expect(vector).toHaveLength(768);
    expect(embedder.dimensions).toBe(768);
    // Vectors should be normalized (unit length) — nomic-embed-text returns normalized vectors
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1.0, 1);
  });

  it("embeds a batch of texts and returns one vector per input", async () => {
    const embedder = new EmbeddingClient(makeOllamaConfig());

    const vectors = await embedder.embedBatch(["pasta recipe", "chocolate cake", "grilled salmon"]);

    expect(vectors).toHaveLength(3);
    for (const vec of vectors) {
      expect(vec).toHaveLength(768);
    }
  });

  it("indexes recipes and finds them via semantic search", async () => {
    const { store } = await setup();

    const recipes = [
      makeRecipe({
        uid: "pasta-1" as RecipeUid,
        name: "Chicken Parmesan Pasta",
        ingredients: "chicken breast, pasta, marinara sauce, mozzarella, parmesan, basil",
        description: "Classic Italian-American chicken parmesan served over spaghetti",
      }),
      makeRecipe({
        uid: "cake-1" as RecipeUid,
        name: "Triple Chocolate Cake",
        ingredients: "cocoa powder, dark chocolate, flour, sugar, eggs, butter, vanilla extract",
        description: "Rich and decadent three-layer chocolate cake with ganache frosting",
      }),
      makeRecipe({
        uid: "salad-1" as RecipeUid,
        name: "Mediterranean Quinoa Salad",
        ingredients: "quinoa, cucumber, tomatoes, kalamata olives, feta cheese, lemon, olive oil",
        description: "Light and refreshing grain salad with Mediterranean flavors",
      }),
    ];

    const result = await store.indexRecipes(recipes, noCats);

    expect(result).toEqual({ indexed: 3, skipped: 0, total: 3 });
    expect(store.size).toBe(3);

    // Search for something semantically close to the pasta recipe
    const results = await store.search("Italian noodle dish with cheese");

    expect(results.length).toBeGreaterThan(0);
    // The pasta recipe should be the top result — it's the most semantically similar
    expect(results[0]!.uid).toBe("pasta-1");
    expect(results[0]!.recipeName).toBe("Chicken Parmesan Pasta");
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it("returns chocolate cake first when searching for dessert", async () => {
    const { store } = await setup();

    const recipes = [
      makeRecipe({
        uid: "steak-1" as RecipeUid,
        name: "Grilled Ribeye Steak",
        ingredients: "ribeye steak, salt, pepper, garlic butter, rosemary",
        description: "Perfect medium-rare grilled ribeye with herb butter",
      }),
      makeRecipe({
        uid: "brownie-1" as RecipeUid,
        name: "Fudgy Brownies",
        ingredients: "chocolate, butter, sugar, eggs, flour, vanilla, cocoa powder",
        description: "Dense and fudgy chocolate brownies with a crackly top",
      }),
      makeRecipe({
        uid: "soup-1" as RecipeUid,
        name: "Chicken Noodle Soup",
        ingredients: "chicken, egg noodles, carrots, celery, onion, chicken broth",
        description: "Comforting homestyle chicken noodle soup",
      }),
    ];

    await store.indexRecipes(recipes, noCats);

    const results = await store.search("sweet chocolate dessert");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.uid).toBe("brownie-1");
  });

  it("skips unchanged recipes on re-index (hash dedup with real embeddings)", async () => {
    const { store, embedder } = await setup();

    const recipe = makeRecipe({
      uid: "curry-1" as RecipeUid,
      name: "Thai Green Curry",
      ingredients: "green curry paste, coconut milk, chicken, bamboo shoots, thai basil",
      description: "Aromatic Thai green curry with tender chicken",
    });

    const first = await store.indexRecipes([recipe], noCats);
    expect(first).toEqual({ indexed: 1, skipped: 0, total: 1 });

    // Spy on embedBatch to verify it's NOT called on re-index
    const embedBatchSpy = vi.spyOn(embedder, "embedBatch");

    const second = await store.indexRecipes([recipe], noCats);
    expect(second).toEqual({ indexed: 0, skipped: 1, total: 1 });
    expect(embedBatchSpy).not.toHaveBeenCalled();

    embedBatchSpy.mockRestore();
  });

  it("re-indexes a recipe when its ingredients change", async () => {
    const { store } = await setup();

    const original = makeRecipe({
      uid: "stir-fry-1" as RecipeUid,
      name: "Vegetable Stir Fry",
      ingredients: "broccoli, bell pepper, soy sauce, garlic, ginger, sesame oil",
      description: "Quick and easy vegetable stir fry",
    });

    await store.indexRecipes([original], noCats);

    // Change ingredients — should trigger re-embedding
    const modified = makeRecipe({
      uid: "stir-fry-1" as RecipeUid,
      name: "Vegetable Stir Fry",
      ingredients: "tofu, mushrooms, bok choy, oyster sauce, garlic, ginger, peanut oil",
      description: "Quick and easy vegetable stir fry",
    });

    const result = await store.indexRecipes([modified], noCats);
    expect(result).toEqual({ indexed: 1, skipped: 0, total: 1 });
  });

  it("removes a recipe so it no longer appears in search results", async () => {
    const { store } = await setup();

    const recipes = [
      makeRecipe({
        uid: "fish-1" as RecipeUid,
        name: "Pan-Seared Salmon",
        ingredients: "salmon fillet, lemon, dill, butter, capers",
        description: "Crispy-skinned pan-seared salmon with lemon dill butter",
      }),
      makeRecipe({
        uid: "fish-2" as RecipeUid,
        name: "Fish Tacos",
        ingredients: "white fish, corn tortillas, cabbage slaw, lime crema, cilantro",
        description: "Baja-style fish tacos with crunchy slaw",
      }),
    ];

    await store.indexRecipes(recipes, noCats);

    // Both should appear in a fish-related search
    const before = await store.search("seafood fish dish");
    const uidsBefore = before.map((r) => r.uid);
    expect(uidsBefore).toContain("fish-1");
    expect(uidsBefore).toContain("fish-2");

    // Remove one
    await store.removeRecipe("fish-1");
    expect(store.size).toBe(1);

    // Only fish-2 should remain
    const after = await store.search("seafood fish dish");
    const uidsAfter = after.map((r) => r.uid);
    expect(uidsAfter).not.toContain("fish-1");
    expect(uidsAfter).toContain("fish-2");
  });

  it("persists state across VectorStore restarts with real embeddings", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "paprika-e2e-ollama-"));
    const embedder1 = new EmbeddingClient(makeOllamaConfig());
    const store1 = new VectorStore(tempDir, embedder1);
    await store1.init();

    const recipe = makeRecipe({
      uid: "pie-1" as RecipeUid,
      name: "Classic Apple Pie",
      ingredients: "apples, flour, butter, sugar, cinnamon, lemon juice, pie crust",
      description: "Traditional double-crust apple pie with warm spices",
    });

    await store1.indexRecipes([recipe], noCats);
    expect(store1.size).toBe(1);

    // Create a new VectorStore on the same directory — simulates server restart
    const embedder2 = new EmbeddingClient(makeOllamaConfig());
    const store2 = new VectorStore(tempDir, embedder2);
    await store2.init();

    expect(store2.size).toBe(1);

    // Should skip — hash persisted from first run
    const embedBatchSpy = vi.spyOn(embedder2, "embedBatch");
    const result = await store2.indexRecipes([recipe], noCats);
    expect(result).toEqual({ indexed: 0, skipped: 1, total: 1 });
    expect(embedBatchSpy).not.toHaveBeenCalled();

    // Search should still work with the persisted Vectra index
    const results = await store2.search("apple dessert baking");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.uid).toBe("pie-1");

    embedBatchSpy.mockRestore();
  });
});
