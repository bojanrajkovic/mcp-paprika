import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Category } from "../category/types.js";
import type { AnySyncResult, EntityChanges, RecipeSyncResult } from "../paprika/sync-types.js";
import type { CategoryUid, RecipeUid } from "../ids.js";
import { RecipeStore } from "../recipe/store.js";
import { CategoryStore } from "../category/store.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { makePinoCapture, DEFAULT_LOGGING_CONFIG } from "../tools/tool-test-utils.js";
// mitt's package shape (flat-conditioned `exports`, .d.ts using `export default`) confuses
// TS strict resolution under @tsconfig/strictest + nodenext into typing the default import
// as the namespace. The namespace's `.default` member IS the function, so we recover the
// callable type by casting through `unknown` to `typeof _mitt.default`. Runtime is unaffected
// (esModuleInterop unwraps the default at the JS layer).
import { fromAny } from "@total-typescript/shoehorn";
import _mitt from "mitt";
const mitt: typeof _mitt.default = fromAny(_mitt);

// Mock all the feature dependencies
vi.mock("./embeddings.js", () => ({
  EmbeddingClient: vi.fn(),
  EMBEDDING_SCHEMA_VERSION: 1,
}));

vi.mock("./vector-store.js", () => ({
  VectorStore: vi.fn(),
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

// Helper to create a mock sync events view (mitt-backed)
function makeMockSyncEvents() {
  return mitt<{
    "sync:complete": AnySyncResult;
    "sync:error": Error;
    "sync:category-change": EntityChanges<Category>;
  }>();
}

function makeEnabledConfig(overrides: Record<string, unknown> = {}) {
  return {
    transport: "stdio" as const,
    paprika: { email: "test@example.com", password: "pass" },
    sync: { enabled: true, interval: 5000, pendingWriteTtl: 60000, recipeFetchConcurrency: 5 },
    http: { port: 3000, host: "0.0.0.0", allowedHosts: [], allowedOrigins: [], shutdownDrainMs: 0 },
    logging: DEFAULT_LOGGING_CONFIG,
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
      transport: "stdio" as const,
      paprika: { email: "test@example.com", password: "pass" },
      sync: { enabled: true, interval: 5000, pendingWriteTtl: 60000, recipeFetchConcurrency: 5 },
      http: { port: 3000, host: "0.0.0.0", allowedHosts: [], allowedOrigins: [], shutdownDrainMs: 0 },
      logging: DEFAULT_LOGGING_CONFIG,
      features: {},
    };
  }
  return {
    transport: "stdio" as const,
    paprika: { email: "test@example.com", password: "pass" },
    sync: { enabled: true, interval: 5000, pendingWriteTtl: 60000, recipeFetchConcurrency: 5 },
    http: { port: 3000, host: "0.0.0.0", allowedHosts: [], allowedOrigins: [], shutdownDrainMs: 0 },
    logging: DEFAULT_LOGGING_CONFIG,
  };
}

describe("p3-u08-discover-wiring: buildDiscoverComponents", () => {
  let mockVectorStore: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the mocked modules
    const { EmbeddingClient } = await import("./embeddings.js");
    const { VectorStore } = await import("./vector-store.js");

    mockVectorStore = makeMockVectorStore();

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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("p3-u08-discover-wiring.AC1: Feature gating", () => {
    it("AC1.1: returns a vector store when embeddings config is present", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();

      const vectorStore = await buildDiscoverComponents(config, store, categoryStore, syncEvents);

      expect(vectorStore).not.toBeNull();
    });

    it("AC1.2: returns null when embeddings config is absent", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([]);
      const syncEvents = makeMockSyncEvents();
      const config = makeDisabledConfig();

      const vectorStore = await buildDiscoverComponents(config, store, categoryStore, syncEvents);

      expect(vectorStore).toBeNull();
    });

    it("AC1.3: emits structured info log 'semantic search enabled' when embeddings configured", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();
      const { log, records } = makePinoCapture();

      await buildDiscoverComponents(config, store, categoryStore, syncEvents, log);

      const infoRecords = records.filter((r) => r["msg"] === "semantic search enabled");
      expect(infoRecords).toHaveLength(1);
      expect(infoRecords[0]!["level"]).toBe(30); // pino info = 30
    });

    it("AC1.4: emits structured info log 'semantic search disabled' when embeddings not configured", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([]);
      const syncEvents = makeMockSyncEvents();
      const config = makeDisabledConfig();
      const { log, records } = makePinoCapture();

      await buildDiscoverComponents(config, store, categoryStore, syncEvents, log);

      const infoRecords = records.filter((r) => r["msg"] === "semantic search disabled");
      expect(infoRecords).toHaveLength(1);
      expect(infoRecords[0]!["level"]).toBe(30); // pino info = 30
    });

    it("AC1.4 (alternative): emits 'semantic search disabled' when features.embeddings is undefined", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([]);
      const syncEvents = makeMockSyncEvents();
      const config = makeDisabledConfig(true);
      const { log, records } = makePinoCapture();

      await buildDiscoverComponents(config, store, categoryStore, syncEvents, log);

      const infoRecords = records.filter((r) => r["msg"] === "semantic search disabled");
      expect(infoRecords).toHaveLength(1);
      expect(infoRecords[0]!["level"]).toBe(30); // pino info = 30
    });
  });

  describe("p3-u08-discover-wiring.AC2: Component initialization", () => {
    it("AC2.1: creates EmbeddingClient with config.features.embeddings object", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const { EmbeddingClient } = await import("./embeddings.js");
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([]);
      const syncEvents = makeMockSyncEvents();
      const embeddingsConfig = {
        apiKey: "key123",
        baseUrl: "http://localhost:11434/v1",
        model: "embedder",
      };
      const config = {
        transport: "stdio" as const,
        paprika: { email: "test@example.com", password: "pass" },
        sync: { enabled: true, interval: 5000, pendingWriteTtl: 60000, recipeFetchConcurrency: 5 },
        http: { port: 3000, host: "0.0.0.0", allowedHosts: [], allowedOrigins: [], shutdownDrainMs: 0 },
        logging: DEFAULT_LOGGING_CONFIG,
        features: {
          embeddings: embeddingsConfig,
        },
      };

      await buildDiscoverComponents(config, store, categoryStore, syncEvents);

      // Second arg is the optional logger — undefined when no log is passed
      expect(vi.mocked(EmbeddingClient)).toHaveBeenCalledWith(embeddingsConfig, undefined);
    });

    it("AC2.2: creates VectorStore with getCacheDir() and EmbeddingClient instance", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const { VectorStore } = await import("./vector-store.js");
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();

      await buildDiscoverComponents(config, store, categoryStore, syncEvents);

      // VectorStore constructor is mocked and should have been called with the right args
      const callArgs = vi.mocked(VectorStore).mock.calls[0]!;
      expect(callArgs[0]).toBe("/mock/cache");
      expect(typeof callArgs[1]).toBe("object"); // EmbeddingClient instance
    });

    it("AC2.3: calls vectorStore.init() before returning", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();

      await buildDiscoverComponents(config, store, categoryStore, syncEvents);

      expect(mockVectorStore.init).toHaveBeenCalled();
    });

    it("cold-start: calls indexRecipes when vectorStore.size === 0 and store has recipes", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([recipe]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();

      mockVectorStore.size = 0; // Empty vector store

      await buildDiscoverComponents(config, store, categoryStore, syncEvents);

      expect(mockVectorStore.clearHashes).toHaveBeenCalled();
      expect(mockVectorStore.indexRecipes).toHaveBeenCalled();
      const callArgs = mockVectorStore.indexRecipes.mock.calls[0];
      expect(callArgs[0]).toEqual([recipe]); // First arg is recipes
      expect(typeof callArgs[1]).toBe("function"); // Second arg is resolver function
    });

    it("cold-start: reconciles via indexRecipes WITHOUT clearing hashes when sufficiently indexed (#177)", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const recipes = Array.from({ length: 10 }, (_, i) => makeRecipe({ uid: `recipe-${String(i)}` as RecipeUid }));
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load(recipes);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();

      mockVectorStore.size = 10; // Healthy index (>= 90% of store)

      await buildDiscoverComponents(config, store, categoryStore, syncEvents);

      // No full wipe — but still reconcile, so a category renamed/deleted while
      // the server was down (whose sync:category-change fired before this
      // subscription existed) gets repaired. indexRecipes skips unchanged recipes
      // by content hash, so this is cheap when nothing drifted.
      expect(mockVectorStore.clearHashes).not.toHaveBeenCalled();
      expect(mockVectorStore.indexRecipes).toHaveBeenCalled();
    });

    it("cold-start: re-indexes when vectorStore has stale/orphaned entries below 90% of store", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const recipes = Array.from({ length: 100 }, (_, i) => makeRecipe({ uid: `recipe-${String(i)}` as RecipeUid }));
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load(recipes);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();

      mockVectorStore.size = 2; // Only 2 entries (stale test data) vs 100 recipes

      await buildDiscoverComponents(config, store, categoryStore, syncEvents);

      expect(mockVectorStore.clearHashes).toHaveBeenCalled();
      expect(mockVectorStore.indexRecipes).toHaveBeenCalled();
    });

    it("cold-start: skips indexRecipes when store is empty", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();

      mockVectorStore.size = 0;

      await buildDiscoverComponents(config, store, categoryStore, syncEvents);

      expect(mockVectorStore.indexRecipes).not.toHaveBeenCalled();
    });
  });

  describe("p3-u08-discover-wiring.AC3: Sync event subscription", () => {
    it("AC3.2: calls vectorStore.indexRecipes when sync:complete fires with added/updated recipes", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const recipe1 = makeRecipe({ uid: "r1" as RecipeUid, name: "Recipe 1" });
      const recipe2 = makeRecipe({ uid: "r2" as RecipeUid, name: "Recipe 2" });
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([recipe1, recipe2]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();

      mockVectorStore.size = 10; // Skip cold-start indexing

      await buildDiscoverComponents(config, store, categoryStore, syncEvents);

      const syncResult: RecipeSyncResult = {
        changeType: "recipes",
        changes: { added: [recipe1], updated: [recipe2], removedUids: [] },
      };
      syncEvents.emit("sync:complete", syncResult);

      // Let async handler complete
      await new Promise((r) => setTimeout(r, 10));

      expect(mockVectorStore.indexRecipes).toHaveBeenCalled();
      const callArgs = mockVectorStore.indexRecipes.mock.calls[0];
      expect(callArgs[0]).toEqual([recipe1, recipe2]); // Both added and updated
      expect(typeof callArgs[1]).toBe("function"); // Category resolver
    });

    it("AC3.3: calls vectorStore.removeRecipe for each removedUid", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();

      mockVectorStore.size = 10; // Skip cold-start

      await buildDiscoverComponents(config, store, categoryStore, syncEvents);

      const syncResult: RecipeSyncResult = {
        changeType: "recipes",
        changes: { added: [], updated: [], removedUids: ["uid1" as RecipeUid, "uid2" as RecipeUid] },
      };
      syncEvents.emit("sync:complete", syncResult);

      // Let async handler complete
      await new Promise((r) => setTimeout(r, 10));

      expect(mockVectorStore.removeRecipe).toHaveBeenCalledWith("uid1");
      expect(mockVectorStore.removeRecipe).toHaveBeenCalledWith("uid2");
      expect(mockVectorStore.removeRecipe).toHaveBeenCalledTimes(2);
    });

    it("AC3.4: skips indexing and removal when no changes", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();

      mockVectorStore.size = 10;

      await buildDiscoverComponents(config, store, categoryStore, syncEvents);

      const syncResult: RecipeSyncResult = {
        changeType: "recipes",
        changes: { added: [], updated: [], removedUids: [] },
      };
      syncEvents.emit("sync:complete", syncResult);

      // Let async handler complete
      await new Promise((r) => setTimeout(r, 10));

      expect(mockVectorStore.indexRecipes).not.toHaveBeenCalled();
      expect(mockVectorStore.removeRecipe).not.toHaveBeenCalled();
    });

    it("AC3.5: skips indexing when changeType is pantry (not recipes)", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();

      mockVectorStore.size = 10;

      await buildDiscoverComponents(config, store, categoryStore, syncEvents);

      // Emit a pantry event — the subscriber must ignore it
      const pantryResult: AnySyncResult = {
        changeType: "pantry",
        changes: { added: [makePantryItem()], updated: [], removedUids: [] },
      };
      syncEvents.emit("sync:complete", pantryResult);

      // Let async handler complete
      await new Promise((r) => setTimeout(r, 10));

      expect(mockVectorStore.indexRecipes).not.toHaveBeenCalled();
      expect(mockVectorStore.removeRecipe).not.toHaveBeenCalled();
    });
  });

  describe("p3-u08-discover-wiring.AC4: Error isolation", () => {
    it("AC4.1: catches and logs error from vectorStore.indexRecipes", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const recipe = makeRecipe({ uid: "r1" as RecipeUid });
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([recipe]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();
      const { log, records } = makePinoCapture();

      mockVectorStore.size = 10;

      await buildDiscoverComponents(config, store, categoryStore, syncEvents, log);

      // Reject only the event-driven re-index; the startup reconcile already ran.
      mockVectorStore.indexRecipes.mockClear();
      mockVectorStore.indexRecipes.mockRejectedValueOnce(new Error("Embedding failed"));

      const syncResult: RecipeSyncResult = {
        changeType: "recipes",
        changes: { added: [recipe], updated: [], removedUids: [] },
      };
      syncEvents.emit("sync:complete", syncResult);

      // Let async handler complete
      await new Promise((r) => setTimeout(r, 10));

      const errorRecords = records.filter((r) => r["msg"] === "vector index error during sync-driven re-index");
      expect(errorRecords).toHaveLength(1);
      expect(errorRecords[0]!["err"]).toBeDefined();
    });

    it("AC4.2: catches and logs error from vectorStore.removeRecipe", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();
      const { log, records } = makePinoCapture();

      mockVectorStore.size = 10;
      const testError = new Error("Remove failed");
      mockVectorStore.removeRecipe.mockRejectedValueOnce(testError);

      await buildDiscoverComponents(config, store, categoryStore, syncEvents, log);

      const syncResult: RecipeSyncResult = {
        changeType: "recipes",
        changes: { added: [], updated: [], removedUids: ["uid1" as RecipeUid] },
      };
      syncEvents.emit("sync:complete", syncResult);

      // Let async handler complete
      await new Promise((r) => setTimeout(r, 10));

      const errorRecords = records.filter((r) => r["msg"] === "vector index error during sync-driven re-index");
      expect(errorRecords).toHaveLength(1);
      expect(errorRecords[0]!["err"]).toBeDefined();
    });

    it("structured-logging.AC9.4: emits structured error log on sync-driven re-index failure", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const recipe = makeRecipe({ uid: "r1" as RecipeUid });
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([recipe]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();
      const { log, records } = makePinoCapture();

      mockVectorStore.size = 10;

      await buildDiscoverComponents(config, store, categoryStore, syncEvents, log);

      // Reject only the event-driven re-index; the startup reconcile already ran.
      mockVectorStore.indexRecipes.mockClear();
      mockVectorStore.indexRecipes.mockRejectedValueOnce(new Error("indexing failed"));

      const syncResult: RecipeSyncResult = {
        changeType: "recipes",
        changes: { added: [recipe], updated: [], removedUids: [] },
      };
      syncEvents.emit("sync:complete", syncResult);

      // Let async handler complete
      await new Promise((r) => setTimeout(r, 10));

      const errorRecords = records.filter((r) => r["msg"] === "vector index error during sync-driven re-index");
      expect(errorRecords).toHaveLength(1);
      // Must carry the error object (not a string message)
      expect(errorRecords[0]!["err"]).toBeDefined();
    });

    it("AC4.3: subsequent sync events still work after an error", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const recipe1 = makeRecipe({ uid: "r1" as RecipeUid });
      const recipe2 = makeRecipe({ uid: "r2" as RecipeUid });
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([recipe1, recipe2]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();

      mockVectorStore.size = 10;

      await buildDiscoverComponents(config, store, categoryStore, syncEvents);

      // Startup reconcile already consumed one call; reset so the two events map
      // to the rejection-then-success sequence below.
      mockVectorStore.indexRecipes.mockClear();
      mockVectorStore.indexRecipes.mockRejectedValueOnce(new Error("First error")).mockResolvedValueOnce(undefined);

      // First sync: error
      const syncResult1: RecipeSyncResult = {
        changeType: "recipes",
        changes: { added: [recipe1], updated: [], removedUids: [] },
      };
      syncEvents.emit("sync:complete", syncResult1);

      await new Promise((r) => setTimeout(r, 10));

      // Second sync: success
      const syncResult2: RecipeSyncResult = {
        changeType: "recipes",
        changes: { added: [recipe2], updated: [], removedUids: [] },
      };
      syncEvents.emit("sync:complete", syncResult2);

      await new Promise((r) => setTimeout(r, 10));

      // Both should have been attempted
      expect(mockVectorStore.indexRecipes).toHaveBeenCalledTimes(2);
    });
  });

  describe("startup reconcile retry (#177)", () => {
    it("retries a failed startup reconcile on the next sync:complete cycle", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const recipe = makeRecipe({ uid: "r1" as RecipeUid });
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([recipe]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();
      mockVectorStore.size = 10; // healthy index — reconcile is a cheap skip-scan

      // Embeddings briefly down at boot: the startup reconcile fails.
      mockVectorStore.indexRecipes.mockRejectedValueOnce(new Error("embeddings down"));

      await buildDiscoverComponents(config, store, categoryStore, syncEvents);
      expect(mockVectorStore.indexRecipes).toHaveBeenCalledTimes(1); // startup attempt

      mockVectorStore.indexRecipes.mockClear();

      // A no-change recipe cycle still retries the full reconcile.
      const result: RecipeSyncResult = {
        changeType: "recipes",
        changes: { added: [], updated: [], removedUids: [] },
      };
      syncEvents.emit("sync:complete", result);
      await new Promise((r) => setTimeout(r, 10));

      expect(mockVectorStore.indexRecipes).toHaveBeenCalledTimes(1);
      const retried = mockVectorStore.indexRecipes.mock.calls[0]![0] as ReadonlyArray<{ uid: string }>;
      expect(retried.map((r) => r.uid)).toEqual(["r1"]); // full store re-scanned
    });

    it("does not retry once the startup reconcile has succeeded", async () => {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const recipe = makeRecipe({ uid: "r1" as RecipeUid });
      const store = new RecipeStore();
      const categoryStore = new CategoryStore();
      store.load([recipe]);
      const syncEvents = makeMockSyncEvents();
      const config = makeEnabledConfig();
      mockVectorStore.size = 10;

      // Startup reconcile succeeds (default mock resolves).
      await buildDiscoverComponents(config, store, categoryStore, syncEvents);
      mockVectorStore.indexRecipes.mockClear();

      // A no-change cycle does no reconcile and no per-change indexing.
      syncEvents.emit("sync:complete", {
        changeType: "recipes",
        changes: { added: [], updated: [], removedUids: [] },
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mockVectorStore.indexRecipes).not.toHaveBeenCalled();
    });
  });

  describe("reindexRecipesForCategoryChange helper (#177)", () => {
    const catA = "CAT-A" as CategoryUid;
    const catB = "CAT-B" as CategoryUid;
    const catC = "CAT-C" as CategoryUid;

    function seededStore() {
      const store = new RecipeStore();
      store.load([
        makeRecipe({ uid: "r1" as RecipeUid, categories: [catA] }),
        makeRecipe({ uid: "r2" as RecipeUid, categories: [catB] }),
        makeRecipe({ uid: "r3" as RecipeUid, categories: [catA, catC] }),
      ]);
      return store;
    }

    it("re-indexes only the recipes referencing a changed category UID", async () => {
      const { reindexRecipesForCategoryChange } = await import("./discover-feature.js");
      const store = seededStore();
      const categoryStore = new CategoryStore();

      await reindexRecipesForCategoryChange(fromAny(mockVectorStore), store, categoryStore, [catA]);

      expect(mockVectorStore.indexRecipes).toHaveBeenCalledTimes(1);
      const indexed = mockVectorStore.indexRecipes.mock.calls[0]![0] as ReadonlyArray<{ uid: string }>;
      expect(indexed.map((r) => r.uid).sort()).toEqual(["r1", "r3"]);
      expect(typeof mockVectorStore.indexRecipes.mock.calls[0]![1]).toBe("function"); // resolver
    });

    it("is a no-op when no recipe references any changed category", async () => {
      const { reindexRecipesForCategoryChange } = await import("./discover-feature.js");
      await reindexRecipesForCategoryChange(fromAny(mockVectorStore), seededStore(), new CategoryStore(), [
        "CAT-NONE" as CategoryUid,
      ]);
      expect(mockVectorStore.indexRecipes).not.toHaveBeenCalled();
    });

    it("is a no-op for an empty changed-UID list", async () => {
      const { reindexRecipesForCategoryChange } = await import("./discover-feature.js");
      await reindexRecipesForCategoryChange(fromAny(mockVectorStore), seededStore(), new CategoryStore(), []);
      expect(mockVectorStore.indexRecipes).not.toHaveBeenCalled();
    });
  });

  describe("sync:category-change subscription (#177)", () => {
    const catA = "CAT-A" as CategoryUid;
    const catB = "CAT-B" as CategoryUid;

    async function wireWithRecipes() {
      const { buildDiscoverComponents } = await import("./discover-feature.js");
      const r1 = makeRecipe({ uid: "r1" as RecipeUid, categories: [catA] });
      const r2 = makeRecipe({ uid: "r2" as RecipeUid, categories: [catB] });
      const store = new RecipeStore();
      store.load([r1, r2]);
      const categoryStore = new CategoryStore();
      const syncEvents = makeMockSyncEvents();
      mockVectorStore.size = 10; // skip cold-start
      const { log, records } = makePinoCapture();
      await buildDiscoverComponents(makeEnabledConfig(), store, categoryStore, syncEvents, log);
      // Discard the startup-reconcile indexRecipes call so the assertions below
      // see only event-driven re-indexing (#177).
      mockVectorStore.indexRecipes.mockClear();
      return { syncEvents, records };
    }

    it("re-indexes recipes referencing a renamed (updated) category", async () => {
      const { syncEvents } = await wireWithRecipes();

      const changes: EntityChanges<Category> = {
        added: [],
        updated: [makeCategory({ uid: catA, name: "Renamed" })],
        removedUids: [],
      };
      syncEvents.emit("sync:category-change", changes);
      await new Promise((r) => setTimeout(r, 10));

      expect(mockVectorStore.indexRecipes).toHaveBeenCalledTimes(1);
      const indexed = mockVectorStore.indexRecipes.mock.calls[0]![0] as ReadonlyArray<{ uid: string }>;
      expect(indexed.map((r) => r.uid)).toEqual(["r1"]);
    });

    it("re-indexes recipes referencing a removed category", async () => {
      const { syncEvents } = await wireWithRecipes();

      const changes: EntityChanges<Category> = { added: [], updated: [], removedUids: [catB] };
      syncEvents.emit("sync:category-change", changes);
      await new Promise((r) => setTimeout(r, 10));

      expect(mockVectorStore.indexRecipes).toHaveBeenCalledTimes(1);
      const indexed = mockVectorStore.indexRecipes.mock.calls[0]![0] as ReadonlyArray<{ uid: string }>;
      expect(indexed.map((r) => r.uid)).toEqual(["r2"]);
    });

    it("isolates and logs an error thrown during category-change re-index", async () => {
      const { syncEvents, records } = await wireWithRecipes();
      mockVectorStore.indexRecipes.mockRejectedValueOnce(new Error("embeddings down"));

      syncEvents.emit("sync:category-change", {
        added: [],
        updated: [makeCategory({ uid: catA, name: "Renamed" })],
        removedUids: [],
      });
      await new Promise((r) => setTimeout(r, 10));

      const errs = records.filter((r) => r["msg"] === "vector index error during category-change re-index");
      expect(errs).toHaveLength(1);
      expect(errs[0]!["err"]).toBeDefined();
    });
  });
});
