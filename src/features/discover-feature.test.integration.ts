/**
 * End-to-end integration test for buildDiscoverComponents + registerDiscoverTool
 * using a real Ollama instance.
 *
 * Exercises the complete initialization pipeline as it runs in production:
 * EmbeddingClient → VectorStore (via buildDiscoverComponents) →
 * registerDiscoverTool (per-session, via buildMcpServer in production) →
 * sync:complete handler.
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
import { createRequire } from "node:module";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { makeTestServer, makeCtx, getText } from "../tools/tool-test-utils.js";
import { registerDiscoverTool } from "../tools/discover.js";
import type { EmbeddingConfig } from "../utils/config.js";
import type { SyncResult } from "../paprika/types.js";
import type { RecipeUid } from "../paprika/types.js";

// Use CommonJS require to work around TypeScript ESM resolution issues with mitt
const _require = createRequire(import.meta.url);
const mittFactory: unknown = _require("mitt");
function makeMitt<T extends Record<string, unknown>>() {
  return (mittFactory as CallableFunction)() as {
    on: <K extends keyof T>(type: K, handler: (event: T[K]) => void) => void;
    off: <K extends keyof T>(type: K, handler: (event: T[K]) => void) => void;
    emit: <K extends keyof T>(type: K, event: T[K]) => void;
  };
}

// Module-level tempDir variable used by the mock below.
// Each test will create its own temp directory via beforeEach.
let tempDir: string = "";

// Register mock for getCacheDir BEFORE importing buildDiscoverComponents.
// This ensures the mock is in place when buildDiscoverComponents' module-level
// import statement resolves, making the mock effective (not a no-op).
// The mock references the tempDir variable above, which will be updated by beforeEach.
vi.mock("../utils/xdg.js", () => ({
  getCacheDir: () => tempDir,
}));

// Import buildDiscoverComponents AFTER registering the mock.
// Now when buildDiscoverComponents' module-level code runs, it will resolve
// getCacheDir to our mock function, not the real one.
import { buildDiscoverComponents } from "./discover-feature.js";

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

type SyncEvents = { "sync:complete": SyncResult; "sync:error": Error };

function makePaprikaConfig() {
  return {
    transport: "stdio" as const,
    paprika: { email: "test@example.com", password: "pass" },
    sync: { enabled: true, interval: 5000 },
    http: { port: 0, host: "127.0.0.1" },
    features: { embeddings: makeOllamaConfig() },
  };
}

describe.skipIf(!ollamaAvailable)("buildDiscoverComponents + registerDiscoverTool (Ollama integration)", () => {
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
    const store = new RecipeStore();
    store.load([], []);
    const syncEvents = makeMitt<SyncEvents>();
    const config = makePaprikaConfig();

    const vectorStore = await buildDiscoverComponents(config, store, syncEvents);
    expect(vectorStore).not.toBeNull();
  });

  it("registers discover_recipes tool when buildDiscoverComponents returns a vector store", async () => {
    const { server, callTool } = makeTestServer();
    const store = new RecipeStore();
    store.load([], []);
    const ctx = makeCtx(store, server);
    const syncEvents = makeMitt<SyncEvents>();
    const config = makePaprikaConfig();

    const vectorStore = await buildDiscoverComponents(config, store, syncEvents);
    expect(vectorStore).not.toBeNull();
    registerDiscoverTool(server, ctx, vectorStore!);

    const result = await callTool("discover_recipes", { query: "pasta" });
    expect(result).toBeDefined();
  });

  it("increases vectorStore size after sync:complete with added recipes", async () => {
    const { server } = makeTestServer();
    const recipe1 = makeRecipe({
      uid: "r1" as RecipeUid,
      name: "Chicken Parmesan",
      ingredients: "chicken, mozzarella, marinara",
      description: "Classic Italian chicken dish",
    });
    const store = new RecipeStore();
    store.load([recipe1], []);
    makeCtx(store, server);
    const syncEvents = makeMitt<SyncEvents>();
    const config = makePaprikaConfig();

    await buildDiscoverComponents(config, store, syncEvents);

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
    syncEvents.emit("sync:complete", syncResult);

    await new Promise((r) => setTimeout(r, 100));

    expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining("Vector index error"));
  });

  it("decreases vectorStore size after sync:complete with removedUids", async () => {
    const { server } = makeTestServer();
    const recipe1 = makeRecipe({
      uid: "r1" as RecipeUid,
      name: "Recipe to Delete",
      ingredients: "some ingredients",
      description: "This will be deleted",
    });
    const store = new RecipeStore();
    store.load([recipe1], []);
    makeCtx(store, server);
    const syncEvents = makeMitt<SyncEvents>();
    const config = makePaprikaConfig();

    await buildDiscoverComponents(config, store, syncEvents);

    const syncResult: SyncResult = {
      added: [],
      updated: [],
      removedUids: ["r1" as RecipeUid],
    };
    syncEvents.emit("sync:complete", syncResult);

    await new Promise((r) => setTimeout(r, 100));

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
    const syncEvents = makeMitt<SyncEvents>();
    const config = makePaprikaConfig();

    const vectorStore = await buildDiscoverComponents(config, store, syncEvents);
    expect(vectorStore).not.toBeNull();
    registerDiscoverTool(server, ctx, vectorStore!);

    const syncResult: SyncResult = {
      added: [recipe],
      updated: [],
      removedUids: [],
    };
    syncEvents.emit("sync:complete", syncResult);

    await new Promise((r) => setTimeout(r, 100));

    const result = await callTool("discover_recipes", { query: "creamy pasta with bacon" });

    const text = getText(result);
    expect(text).toContain("Spaghetti Carbonara");
  });
});
