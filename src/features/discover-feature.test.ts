import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SyncResult } from "../paprika/types.js";
import type { RecipeUid } from "../paprika/types.js";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { makeTestServer, makeCtx } from "../tools/tool-test-utils.js";
import mitt from "mitt";
import type { SyncEngine } from "../paprika/sync.js";

// Mock all the feature dependencies
vi.mock("./embeddings.js", () => ({
  EmbeddingClient: vi.fn(),
}));

vi.mock("./vector-store.js", () => ({
  VectorStore: vi.fn(),
}));

vi.mock("../tools/discover.js", () => ({
  registerDiscoverTool: vi.fn(),
}));

vi.mock("../utils/xdg.js", () => ({
  getCacheDir: vi.fn(() => "/mock/cache"),
}));

function makeMockVectorStore() {
  return {
    init: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    indexRecipes: vi.fn<(recipes: any[], resolveFn: any) => Promise<void>>().mockResolvedValue(undefined),
    removeRecipe: vi.fn<(uid: string) => Promise<void>>().mockResolvedValue(undefined),
    clearHashes: vi.fn<() => void>(),
    size: 0,
  };
}

// Helper to create a mock SyncEngine with a real mitt emitter
function makeMockSync(): SyncEngine {
  const emitter = mitt<{ "sync:complete": SyncResult; "sync:error": Error }>();
  return { events: emitter } as unknown as SyncEngine;
}

function makeEnabledConfig(overrides: any = {}) {
  return {
    paprika: { email: "test@example.com", password: "pass" },
    sync: { enabled: true, interval: 5000 },
    features: {
      embeddings: {
        apiKey: "test-key",
        baseUrl: "http://localhost:11434/v1",
        model: "test-model",
      },
      ...overrides,
    },
  };
}

function makeDisabledConfig(withFeaturesEmpty = false) {
  if (withFeaturesEmpty) {
    return {
      paprika: { email: "test@example.com", password: "pass" },
      sync: { enabled: true, interval: 5000 },
      features: {},
    };
  }
  return {
    paprika: { email: "test@example.com", password: "pass" },
    sync: { enabled: true, interval: 5000 },
  };
}

describe("p3-u08-discover-wiring: setupDiscoverFeature", () => {
  let mockVectorStore: any;
  let mockRegisterDiscoverTool: any;
  let stderrSpy: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    if (stderrSpy) {
      stderrSpy.mockRestore();
    }

    // Get the mocked modules
    const { EmbeddingClient } = await import("./embeddings.js");
    const { VectorStore } = await import("./vector-store.js");
    const { registerDiscoverTool } = await import("../tools/discover.js");

    mockVectorStore = makeMockVectorStore();
    mockRegisterDiscoverTool = vi.fn();

    // Mock EmbeddingClient as a class constructor (must be callable with 'new')
    class MockEmbeddingClient {
      constructor() {}
    }
    vi.mocked(EmbeddingClient).mockImplementation(MockEmbeddingClient as any);

    // Mock VectorStore as a class constructor
    class MockVectorStore {
      constructor() {
        Object.assign(this, mockVectorStore);
      }
    }
    vi.mocked(VectorStore).mockImplementation(MockVectorStore as any);
    vi.mocked(registerDiscoverTool).mockImplementation(mockRegisterDiscoverTool);

    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    if (stderrSpy) {
      stderrSpy.mockRestore();
    }
    vi.clearAllMocks();
  });

  describe("p3-u08-discover-wiring.AC1: Feature gating", () => {
    it("AC1.1: registers discover_recipes tool when embeddings config is present", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const store = new RecipeStore();
      store.load([], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeEnabledConfig();

      await setupDiscoverFeature(server, ctx, sync, config);

      expect(mockRegisterDiscoverTool).toHaveBeenCalled();
    });

    it("AC1.2: does not register discover_recipes tool when embeddings config is absent", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const store = new RecipeStore();
      store.load([], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeDisabledConfig();

      await setupDiscoverFeature(server, ctx, sync, config);

      expect(mockRegisterDiscoverTool).not.toHaveBeenCalled();
    });

    it("AC1.3: logs 'Semantic search: enabled' to stderr when embeddings configured", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const store = new RecipeStore();
      store.load([], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeEnabledConfig();

      await setupDiscoverFeature(server, ctx, sync, config);

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Semantic search: enabled"));
    });

    it("AC1.4: logs 'Semantic search: disabled' to stderr when embeddings not configured", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const store = new RecipeStore();
      store.load([], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeDisabledConfig();

      await setupDiscoverFeature(server, ctx, sync, config);

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Semantic search: disabled"));
    });

    it("AC1.4 (alternative): logs 'Semantic search: disabled' when features.embeddings is undefined", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const store = new RecipeStore();
      store.load([], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeDisabledConfig(true);

      await setupDiscoverFeature(server, ctx, sync, config);

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Semantic search: disabled"));
    });
  });

  describe("p3-u08-discover-wiring.AC2: Component initialization", () => {
    it("AC2.1: creates EmbeddingClient with config.features.embeddings object", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const { EmbeddingClient } = await import("./embeddings.js");
      const store = new RecipeStore();
      store.load([], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const embeddingsConfig = {
        apiKey: "key123",
        baseUrl: "http://localhost:11434/v1",
        model: "embedder",
      };
      const config = {
        paprika: { email: "test@example.com", password: "pass" },
        sync: { enabled: true, interval: 5000 },
        features: {
          embeddings: embeddingsConfig,
        },
      };

      await setupDiscoverFeature(server, ctx, sync, config);

      expect(vi.mocked(EmbeddingClient)).toHaveBeenCalledWith(embeddingsConfig);
    });

    it("AC2.2: creates VectorStore with getCacheDir() and EmbeddingClient instance", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const { VectorStore } = await import("./vector-store.js");
      const store = new RecipeStore();
      store.load([], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeEnabledConfig();

      await setupDiscoverFeature(server, ctx, sync, config);

      // VectorStore constructor is mocked and should have been called with the right args
      const callArgs = vi.mocked(VectorStore).mock.calls[0];
      expect(callArgs[0]).toBe("/mock/cache");
      expect(typeof callArgs[1]).toBe("object"); // EmbeddingClient instance
    });

    it("AC2.3: calls vectorStore.init() before registerDiscoverTool", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const store = new RecipeStore();
      store.load([], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeEnabledConfig();

      const initCallOrder: string[] = [];
      mockVectorStore.init.mockImplementation(async () => {
        initCallOrder.push("init");
      });
      mockRegisterDiscoverTool.mockImplementation(() => {
        initCallOrder.push("registerDiscoverTool");
      });

      await setupDiscoverFeature(server, ctx, sync, config);

      expect(initCallOrder).toEqual(["init", "registerDiscoverTool"]);
    });

    it("AC2.4: calls registerDiscoverTool with (server, ctx, vectorStore)", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const store = new RecipeStore();
      store.load([], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeEnabledConfig();

      await setupDiscoverFeature(server, ctx, sync, config);

      expect(mockRegisterDiscoverTool).toHaveBeenCalledWith(server, ctx, mockVectorStore);
    });

    it("cold-start: calls indexRecipes when vectorStore.size === 0 and store has recipes", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });
      const store = new RecipeStore();
      store.load([recipe], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeEnabledConfig();

      mockVectorStore.size = 0; // Empty vector store

      await setupDiscoverFeature(server, ctx, sync, config);

      expect(mockVectorStore.clearHashes).toHaveBeenCalled();
      expect(mockVectorStore.indexRecipes).toHaveBeenCalled();
      const callArgs = mockVectorStore.indexRecipes.mock.calls[0];
      expect(callArgs[0]).toEqual([recipe]); // First arg is recipes
      expect(typeof callArgs[1]).toBe("function"); // Second arg is resolver function
    });

    it("cold-start: skips indexRecipes when vectorStore is sufficiently indexed", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const recipes = Array.from({ length: 10 }, (_, i) => makeRecipe({ uid: `recipe-${String(i)}` as RecipeUid }));
      const store = new RecipeStore();
      store.load(recipes, []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeEnabledConfig();

      mockVectorStore.size = 10; // Fully indexed (>= 90% of store)

      await setupDiscoverFeature(server, ctx, sync, config);

      expect(mockVectorStore.indexRecipes).not.toHaveBeenCalled();
    });

    it("cold-start: re-indexes when vectorStore has stale/orphaned entries below 90% of store", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const recipes = Array.from({ length: 100 }, (_, i) => makeRecipe({ uid: `recipe-${String(i)}` as RecipeUid }));
      const store = new RecipeStore();
      store.load(recipes, []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeEnabledConfig();

      mockVectorStore.size = 2; // Only 2 entries (stale test data) vs 100 recipes

      await setupDiscoverFeature(server, ctx, sync, config);

      expect(mockVectorStore.clearHashes).toHaveBeenCalled();
      expect(mockVectorStore.indexRecipes).toHaveBeenCalled();
    });

    it("cold-start: skips indexRecipes when store is empty", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const store = new RecipeStore();
      store.load([], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeEnabledConfig();

      mockVectorStore.size = 0;

      await setupDiscoverFeature(server, ctx, sync, config);

      expect(mockVectorStore.indexRecipes).not.toHaveBeenCalled();
    });
  });

  describe("p3-u08-discover-wiring.AC3: Sync event subscription", () => {
    it("AC3.2: calls vectorStore.indexRecipes when sync:complete fires with added/updated recipes", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const recipe1 = makeRecipe({ uid: "r1" as RecipeUid, name: "Recipe 1" });
      const recipe2 = makeRecipe({ uid: "r2" as RecipeUid, name: "Recipe 2" });
      const store = new RecipeStore();
      store.load([recipe1, recipe2], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeEnabledConfig();

      mockVectorStore.size = 10; // Skip cold-start indexing

      await setupDiscoverFeature(server, ctx, sync, config);

      const syncResult: SyncResult = {
        added: [recipe1],
        updated: [recipe2],
        removedUids: [],
      };
      sync.events.emit("sync:complete", syncResult);

      // Let async handler complete
      await new Promise((r) => setTimeout(r, 10));

      expect(mockVectorStore.indexRecipes).toHaveBeenCalled();
      const callArgs = mockVectorStore.indexRecipes.mock.calls[0];
      expect(callArgs[0]).toEqual([recipe1, recipe2]); // Both added and updated
      expect(typeof callArgs[1]).toBe("function"); // Category resolver
    });

    it("AC3.3: calls vectorStore.removeRecipe for each removedUid", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const store = new RecipeStore();
      store.load([], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeEnabledConfig();

      mockVectorStore.size = 10; // Skip cold-start

      await setupDiscoverFeature(server, ctx, sync, config);

      const syncResult: SyncResult = {
        added: [],
        updated: [],
        removedUids: ["uid1" as RecipeUid, "uid2" as RecipeUid],
      };
      sync.events.emit("sync:complete", syncResult);

      // Let async handler complete
      await new Promise((r) => setTimeout(r, 10));

      expect(mockVectorStore.removeRecipe).toHaveBeenCalledWith("uid1");
      expect(mockVectorStore.removeRecipe).toHaveBeenCalledWith("uid2");
      expect(mockVectorStore.removeRecipe).toHaveBeenCalledTimes(2);
    });

    it("AC3.4: skips indexing and removal when no changes", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const store = new RecipeStore();
      store.load([], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeEnabledConfig();

      mockVectorStore.size = 10;

      await setupDiscoverFeature(server, ctx, sync, config);

      const syncResult: SyncResult = {
        added: [],
        updated: [],
        removedUids: [],
      };
      sync.events.emit("sync:complete", syncResult);

      // Let async handler complete
      await new Promise((r) => setTimeout(r, 10));

      expect(mockVectorStore.indexRecipes).not.toHaveBeenCalled();
      expect(mockVectorStore.removeRecipe).not.toHaveBeenCalled();
    });
  });

  describe("p3-u08-discover-wiring.AC4: Error isolation", () => {
    it("AC4.1: catches and logs error from vectorStore.indexRecipes", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const recipe = makeRecipe({ uid: "r1" as RecipeUid });
      const store = new RecipeStore();
      store.load([recipe], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeEnabledConfig();

      mockVectorStore.size = 10;
      const testError = new Error("Embedding failed");
      mockVectorStore.indexRecipes.mockRejectedValueOnce(testError);

      await setupDiscoverFeature(server, ctx, sync, config);

      const syncResult: SyncResult = {
        added: [recipe],
        updated: [],
        removedUids: [],
      };
      sync.events.emit("sync:complete", syncResult);

      // Let async handler complete
      await new Promise((r) => setTimeout(r, 10));

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Vector index error"));
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Embedding failed"));
    });

    it("AC4.2: catches and logs error from vectorStore.removeRecipe", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const store = new RecipeStore();
      store.load([], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeEnabledConfig();

      mockVectorStore.size = 10;
      const testError = new Error("Remove failed");
      mockVectorStore.removeRecipe.mockRejectedValueOnce(testError);

      await setupDiscoverFeature(server, ctx, sync, config);

      const syncResult: SyncResult = {
        added: [],
        updated: [],
        removedUids: ["uid1" as RecipeUid],
      };
      sync.events.emit("sync:complete", syncResult);

      // Let async handler complete
      await new Promise((r) => setTimeout(r, 10));

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Vector index error"));
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Remove failed"));
    });

    it("AC4.3: subsequent sync events still work after an error", async () => {
      const { setupDiscoverFeature } = await import("./discover-feature.js");
      const recipe1 = makeRecipe({ uid: "r1" as RecipeUid });
      const recipe2 = makeRecipe({ uid: "r2" as RecipeUid });
      const store = new RecipeStore();
      store.load([recipe1, recipe2], []);
      const { server } = makeTestServer();
      const ctx = makeCtx(store, server);
      const sync = makeMockSync();
      const config = makeEnabledConfig();

      mockVectorStore.size = 10;
      mockVectorStore.indexRecipes.mockRejectedValueOnce(new Error("First error")).mockResolvedValueOnce(undefined); // Second call succeeds

      await setupDiscoverFeature(server, ctx, sync, config);

      // First sync: error
      const syncResult1: SyncResult = {
        added: [recipe1],
        updated: [],
        removedUids: [],
      };
      sync.events.emit("sync:complete", syncResult1);

      await new Promise((r) => setTimeout(r, 10));

      // Second sync: success
      const syncResult2: SyncResult = {
        added: [recipe2],
        updated: [],
        removedUids: [],
      };
      sync.events.emit("sync:complete", syncResult2);

      await new Promise((r) => setTimeout(r, 10));

      // Both should have been attempted
      expect(mockVectorStore.indexRecipes).toHaveBeenCalledTimes(2);
    });
  });
});
