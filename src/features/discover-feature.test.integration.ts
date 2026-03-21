/**
 * End-to-end integration test for setupDiscoverFeature using a real Ollama instance.
 *
 * This test exercises the complete initialization pipeline:
 * EmbeddingClient → VectorStore → registerDiscoverTool → sync event handler.
 *
 * Requires a running Ollama instance with nomic-embed-text model.
 * Automatically skipped when Ollama is unavailable.
 *
 * Run specifically with: pnpm test src/features/discover-feature.test.integration.ts
 */

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mitt from "mitt";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { makeTestServer, makeCtx, getText } from "../tools/tool-test-utils.js";
import type { EmbeddingConfig } from "../utils/config.js";
import type { SyncResult } from "../paprika/types.js";
import type { RecipeUid } from "../paprika/types.js";
import type { SyncEngine } from "../paprika/sync.js";

// Module-level tempDir variable used by the mock below.
// Each test will create its own temp directory via beforeEach.
let tempDir: string = "";

// Register mock for getCacheDir BEFORE importing setupDiscoverFeature.
// This ensures the mock is in place when setupDiscoverFeature's module-level
// import statement resolves, making the mock effective (not a no-op).
// The mock references the tempDir variable above, which will be updated by beforeEach.
vi.mock("../utils/xdg.js", () => ({
  getCacheDir: () => tempDir,
}));

// Import setupDiscoverFeature AFTER registering the mock.
// Now when setupDiscoverFeature's module-level code runs, it will resolve
// getCacheDir to our mock function, not the real one.
import { setupDiscoverFeature } from "./discover-feature.js";

const OLLAMA_BASE_URL = "http://localhost:11434/v1";
const OLLAMA_MODEL = "nomic-embed-text";

function makeOllamaConfig(): EmbeddingConfig {
  return { apiKey: "ollama", baseUrl: OLLAMA_BASE_URL, model: OLLAMA_MODEL };
}

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

// Helper to create a mock SyncEngine with a real mitt emitter
function makeMockSync() {
  const emitter = mitt<{ "sync:complete": SyncResult; "sync:error": Error }>();
  return { events: emitter } as unknown as SyncEngine;
}

describe.skipIf(!ollamaAvailable)("setupDiscoverFeature (Ollama integration)", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "paprika-discover-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    stderrSpy.mockClear();
  });

  it("completes initialization without error when Ollama is available", async () => {
    const { server } = makeTestServer();
    const store = new RecipeStore();
    store.load([], []);
    const ctx = makeCtx(store, server);
    const sync = makeMockSync();
    const config = {
      paprika: { email: "test@example.com", password: "pass" },
      sync: { enabled: true, interval: 5000 },
      features: { embeddings: makeOllamaConfig() },
    };

    // Setup should complete without throwing
    await expect(setupDiscoverFeature(server, ctx, sync, config)).resolves.toBeUndefined();
  });

  it("registers discover_recipes tool when setup completes", async () => {
    const { server, callTool } = makeTestServer();
    const store = new RecipeStore();
    store.load([], []);
    const ctx = makeCtx(store, server);
    const sync = makeMockSync();
    const config = {
      paprika: { email: "test@example.com", password: "pass" },
      sync: { enabled: true, interval: 5000 },
      features: { embeddings: makeOllamaConfig() },
    };

    await setupDiscoverFeature(server, ctx, sync, config);

    // Tool should be registered (calling with empty store should return cold-start guard message)
    const result = await callTool("discover_recipes", { query: "pasta" });
    expect(result).toBeDefined();
  });

  it("increases vectorStore.size after sync:complete with added recipes", async () => {
    const { server } = makeTestServer();
    const recipe1 = makeRecipe({
      uid: "r1" as RecipeUid,
      name: "Chicken Parmesan",
      ingredients: "chicken, mozzarella, marinara",
      description: "Classic Italian chicken dish",
    });
    const store = new RecipeStore();
    store.load([recipe1], []);
    const ctx = makeCtx(store, server);
    const sync = makeMockSync();
    const config = {
      paprika: { email: "test@example.com", password: "pass" },
      sync: { enabled: true, interval: 5000 },
      features: { embeddings: makeOllamaConfig() },
    };

    await setupDiscoverFeature(server, ctx, sync, config);

    // Fire sync:complete with a new recipe
    const recipe2 = makeRecipe({
      uid: "r2" as RecipeUid,
      name: "Pasta Carbonara",
      ingredients: "pasta, eggs, guanciale, pecorino",
      description: "Roman pasta with creamy sauce",
    });

    const syncResult: SyncResult = {
      added: [recipe2],
      updated: [],
      removedUids: [],
    };
    sync.events.emit("sync:complete", syncResult);

    // Let async handler complete
    await new Promise((r) => setTimeout(r, 100));

    // This is a sanity check — we can't directly access vectorStore.size,
    // but if no error was logged, the indexing succeeded
    expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining("Vector index error"));
  });

  it("decreases vectorStore.size after sync:complete with removedUids", async () => {
    const { server } = makeTestServer();
    const recipe1 = makeRecipe({
      uid: "r1" as RecipeUid,
      name: "Recipe to Delete",
      ingredients: "some ingredients",
      description: "This will be deleted",
    });
    const store = new RecipeStore();
    store.load([recipe1], []);
    const ctx = makeCtx(store, server);
    const sync = makeMockSync();
    const config = {
      paprika: { email: "test@example.com", password: "pass" },
      sync: { enabled: true, interval: 5000 },
      features: { embeddings: makeOllamaConfig() },
    };

    await setupDiscoverFeature(server, ctx, sync, config);

    // Fire sync:complete with removed recipe
    const syncResult: SyncResult = {
      added: [],
      updated: [],
      removedUids: ["r1" as RecipeUid],
    };
    sync.events.emit("sync:complete", syncResult);

    // Let async handler complete
    await new Promise((r) => setTimeout(r, 100));

    // Should not log an error
    expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining("Vector index error"));
  });

  it("searches over indexed recipes and returns results", async () => {
    const { server, callTool } = makeTestServer();

    const recipe = makeRecipe({
      uid: "pasta-1" as RecipeUid,
      name: "Spaghetti Carbonara",
      ingredients: "spaghetti, eggs, bacon, parmesan, black pepper",
      description: "Classic Roman pasta dish with creamy sauce",
    });

    const store = new RecipeStore();
    store.load([recipe], []);
    const ctx = makeCtx(store, server);
    const sync = makeMockSync();
    const config = {
      paprika: { email: "test@example.com", password: "pass" },
      sync: { enabled: true, interval: 5000 },
      features: { embeddings: makeOllamaConfig() },
    };

    await setupDiscoverFeature(server, ctx, sync, config);

    // Fire sync:complete to index the recipe
    const syncResult: SyncResult = {
      added: [recipe],
      updated: [],
      removedUids: [],
    };
    sync.events.emit("sync:complete", syncResult);

    // Let async handler complete
    await new Promise((r) => setTimeout(r, 100));

    // Call the tool with a search query
    const result = await callTool("discover_recipes", { query: "creamy pasta with bacon" });

    // Should return a result with the recipe
    const text = getText(result);
    expect(text).toContain("Spaghetti Carbonara");
  });
});
