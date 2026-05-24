import { vi, describe, it, expect, afterEach, beforeEach, expectTypeOf } from "vitest";

import { SyncEngine } from "./sync.js";
import { createLogger, SILENT_LOG } from "../utils/log.js";
import type { AppContext } from "../server/app-context.js";
import type { Notifier } from "../server/notifier.js";
import type { RecipeStore } from "../cache/recipe-store.js";
import type { PaprikaClient } from "./client.js";
import type { DiskCacheRoot } from "../cache/disk/index.js";
import type { PantryStore } from "../cache/pantry-store.js";
import type { AisleStore } from "../cache/aisle-store.js";
import type { AnySyncResult, PantryItemUid, RecipeEntry, RecipeUid } from "./types.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { makeAisle } from "../cache/__fixtures__/aisles.js";
import { PantryStore as RealPantryStore } from "../cache/pantry-store.js";
import { AisleStore as RealAisleStore } from "../cache/aisle-store.js";

function makeMockNotifier(): Notifier {
  return {
    resourceListChanged: vi.fn(),
    loggingMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockStore(): RecipeStore {
  return {
    set: vi.fn(),
    delete: vi.fn(),
    setCategories: vi.fn(),
    markSynced: vi.fn(),
    isPendingUpsert: vi.fn().mockReturnValue(false),
    isPendingDelete: vi.fn().mockReturnValue(false),
    clearPending: vi.fn(),
    sweepPending: vi.fn().mockReturnValue(0),
  } as unknown as RecipeStore;
}

function makeMockClient(): PaprikaClient {
  return {
    listRecipes: vi.fn().mockResolvedValue([]),
    getRecipes: vi.fn().mockResolvedValue([]),
    listCategories: vi.fn().mockResolvedValue([]),
    listAisles: vi.fn().mockResolvedValue([]),
    listPantry: vi.fn().mockResolvedValue([]),
  } as unknown as PaprikaClient;
}

function makeMockCache(): DiskCacheRoot {
  return {
    recipes: {
      diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
      put: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    categories: { put: vi.fn() },
    aisles: {
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn(),
    },
    pantry: {
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as DiskCacheRoot;
}

function makeMockAisleStore(): AisleStore {
  return {
    load: vi.fn(),
    set: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
    resolveByName: vi.fn().mockReturnValue(undefined),
    isPendingUpsert: vi.fn().mockReturnValue(false),
    isPendingDelete: vi.fn().mockReturnValue(false),
    clearPending: vi.fn(),
    sweepPending: vi.fn().mockReturnValue(0),
    get hasSynced() {
      return true;
    },
    get size() {
      return 0;
    },
  } as unknown as AisleStore;
}

function makeMockPantryStore(): PantryStore {
  return {
    load: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
    findByIngredient: vi.fn().mockReturnValue([]),
    isPendingUpsert: vi.fn().mockReturnValue(false),
    isPendingDelete: vi.fn().mockReturnValue(false),
    clearPending: vi.fn(),
    sweepPending: vi.fn().mockReturnValue(0),
    get hasSynced() {
      return false;
    },
    get size() {
      return 0;
    },
  } as unknown as PantryStore;
}

function makeTestContext(): AppContext {
  return {
    client: makeMockClient(),
    cache: makeMockCache(),
    store: makeMockStore(),
    pantryStore: makeMockPantryStore(),
    aisleStore: makeMockAisleStore(),
    vectorStore: null,
    notifier: makeMockNotifier(),
    auth: null,
    log: SILENT_LOG,
  };
}

describe("SyncEngine", () => {
  let engine: SyncEngine;

  beforeEach(() => {
    engine = new SyncEngine(makeTestContext(), 10);
  });

  afterEach(() => {
    engine.stop();
  });

  it("AC1.1: start() runs syncOnce() immediately", async () => {
    const syncCompleteEvents: unknown[] = [];
    let handlerCalled = false;

    engine.events.on("sync:complete", (result) => {
      handlerCalled = true;
      syncCompleteEvents.push(result);
    });

    engine.start();

    // Poll until handler is called
    let attempts = 0;
    while (!handlerCalled && attempts < 100) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      attempts++;
    }

    expect(handlerCalled).toBe(true);
    // Two events per cycle: recipe result first, pantry result second
    expect(syncCompleteEvents.length).toBeGreaterThanOrEqual(2);

    engine.stop();
  });

  it("AC1.2: stop() breaks the loop", async () => {
    const syncCompleteEvents: unknown[] = [];

    engine.events.on("sync:complete", () => {
      syncCompleteEvents.push(1);
    });

    engine.start();

    // Wait for at least one event
    let attempts = 0;
    while (syncCompleteEvents.length === 0 && attempts < 100) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      attempts++;
    }

    expect(syncCompleteEvents.length).toBeGreaterThan(0);

    const countAtStop = syncCompleteEvents.length;
    engine.stop();

    // Wait a bit longer than the interval (10ms * 5 = 50ms)
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should not have added more events
    expect(syncCompleteEvents.length).toBe(countAtStop);
  });

  it("AC1.3: Double start() is a no-op", async () => {
    const spy = vi.spyOn(engine, "syncOnce");

    engine.start();
    engine.start(); // Second call should be ignored

    // Wait for at least 6 sync:complete events (2 per cycle × 3 cycles)
    const syncCompleteEvents: unknown[] = [];
    engine.events.on("sync:complete", () => {
      syncCompleteEvents.push(1);
    });

    let attempts = 0;
    while (syncCompleteEvents.length < 6 && attempts < 100) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      attempts++;
    }

    // Count calls at this point
    const callsBeforeStop = spy.mock.calls.length;

    engine.stop();

    // Wait a bit to ensure no additional calls
    await new Promise((resolve) => setTimeout(resolve, 50));

    const callsAfterStop = spy.mock.calls.length;

    // Verify that syncOnce was called a reasonable number of times
    // and no new calls happened after stop
    expect(callsBeforeStop).toBeGreaterThanOrEqual(3);
    expect(callsAfterStop).toBe(callsBeforeStop);
  });

  it("AC1.4: stop() when not running is a no-op", () => {
    const fresh = new SyncEngine(makeTestContext(), 10);

    // Should not throw
    expect(() => {
      fresh.stop();
    }).not.toThrow();
  });

  it("AC2.1: events getter exposes on and off", () => {
    expect(typeof engine.events.on).toBe("function");
    expect(typeof engine.events.off).toBe("function");
  });

  it("AC2.2: sync:complete handler receives AnySyncResult (two events per cycle)", async () => {
    const receivedResults: AnySyncResult[] = [];

    engine.events.on("sync:complete", (result) => {
      receivedResults.push(result);
    });

    engine.start();

    // Poll until both events (recipe + pantry) are received
    let attempts = 0;
    while (receivedResults.length < 2 && attempts < 100) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      attempts++;
    }

    expect(receivedResults).toHaveLength(2);
    // First event: recipe result
    expect(receivedResults[0]).toEqual({
      changeType: "recipes",
      changes: { added: [], updated: [], removedUids: [] },
    });
    // Second event: pantry result
    expect(receivedResults[1]).toEqual({
      changeType: "pantry",
      changes: { added: [], updated: [], removedUids: [] },
    });

    engine.stop();
  });

  it("AC2.3: sync:error handler receives Error", async () => {
    let receivedError: unknown = null;

    // Mock syncOnce to throw once
    const originalSyncOnce = engine.syncOnce.bind(engine);
    let throwOnce = true;
    vi.spyOn(engine, "syncOnce").mockImplementation(async () => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error("test error");
      }
      return originalSyncOnce();
    });

    engine.events.on("sync:error", (error) => {
      receivedError = error;
    });

    engine.start();

    // Poll until handler is called or timeout
    let attempts = 0;
    while (receivedError === null && attempts < 100) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      attempts++;
    }

    expect(receivedError).toBeInstanceOf(Error);
    expect((receivedError as Error).message).toBe("test error");

    engine.stop();
  });

  it("AC2.4: events does not expose emit", () => {
    // Type-level check: events should not have emit method
    expectTypeOf(engine.events).not.toHaveProperty("emit");
  });
});

describe("syncOnce", () => {
  function makeMockClientDefault(): PaprikaClient {
    return {
      listRecipes: vi.fn().mockResolvedValue([]),
      getRecipes: vi.fn().mockResolvedValue([]),
      listCategories: vi.fn().mockResolvedValue([]),
      listAisles: vi.fn().mockResolvedValue([]),
      listPantry: vi.fn().mockResolvedValue([]),
    } as unknown as PaprikaClient;
  }

  // Cache mock overrides take a nested shape that mirrors DiskCacheRoot's
  // composition API. Tests pass `{ recipes: { put: spy } }` and the factory
  // shallow-merges each subcache with its defaults.
  type CacheMockOverrides = {
    recipes?: Partial<DiskCacheRoot["recipes"]>;
    categories?: Partial<DiskCacheRoot["categories"]>;
    aisles?: Partial<DiskCacheRoot["aisles"]>;
    pantry?: Partial<DiskCacheRoot["pantry"]>;
    flush?: () => Promise<void>;
  };

  function makeMockCacheDefault(overrides?: CacheMockOverrides): DiskCacheRoot {
    return {
      recipes: {
        diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
        put: vi.fn(),
        remove: vi.fn().mockResolvedValue(undefined),
        ...overrides?.recipes,
      },
      categories: { put: vi.fn(), ...overrides?.categories },
      aisles: {
        getAll: vi.fn().mockResolvedValue([]),
        put: vi.fn(),
        ...overrides?.aisles,
      },
      pantry: {
        getAll: vi.fn().mockResolvedValue([]),
        put: vi.fn(),
        remove: vi.fn().mockResolvedValue(undefined),
        ...overrides?.pantry,
      },
      flush: overrides?.flush ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as DiskCacheRoot;
  }

  function makeMockStoreDefault(): RecipeStore {
    return {
      set: vi.fn(),
      delete: vi.fn(),
      setCategories: vi.fn(),
      markSynced: vi.fn(),
      isPendingUpsert: vi.fn().mockReturnValue(false),
      isPendingDelete: vi.fn().mockReturnValue(false),
      clearPending: vi.fn(),
      sweepPending: vi.fn().mockReturnValue(0),
    } as unknown as RecipeStore;
  }

  function makeMockPantryStoreDefault(): PantryStore {
    return {
      load: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
      findByIngredient: vi.fn().mockReturnValue([]),
      isPendingUpsert: vi.fn().mockReturnValue(false),
      isPendingDelete: vi.fn().mockReturnValue(false),
      clearPending: vi.fn(),
      sweepPending: vi.fn().mockReturnValue(0),
      get hasSynced() {
        return false;
      },
      get size() {
        return 0;
      },
    } as unknown as PantryStore;
  }

  function makeMockNotifierDefault(): Notifier {
    return {
      resourceListChanged: vi.fn(),
      loggingMessage: vi.fn().mockResolvedValue(undefined),
    };
  }

  function makeSyncEngine(
    clientOverrides?: Partial<PaprikaClient>,
    cacheOverrides?: CacheMockOverrides,
    storeOverrides?: Partial<RecipeStore>,
    notifierOverrides?: Partial<Notifier>,
    pantryStoreOverrides?: Partial<PantryStore>,
    aisleStoreOverrides?: Partial<AisleStore>,
  ): SyncEngine {
    const context: AppContext = {
      client: { ...makeMockClientDefault(), ...clientOverrides } as PaprikaClient,
      cache: makeMockCacheDefault(cacheOverrides),
      store: { ...makeMockStoreDefault(), ...storeOverrides } as RecipeStore,
      pantryStore: { ...makeMockPantryStoreDefault(), ...pantryStoreOverrides } as PantryStore,
      aisleStore: { ...makeMockAisleStore(), ...aisleStoreOverrides } as AisleStore,
      vectorStore: null,
      notifier: { ...makeMockNotifierDefault(), ...notifierOverrides } as Notifier,
      auth: null,
      log: SILENT_LOG,
    };
    return new SyncEngine(context, 10);
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("AC3.1: Added recipes are fetched, written to cache, and set in store", async () => {
    const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });
    const entry: RecipeEntry = { uid: recipe.uid, hash: recipe.hash };

    const putRecipe = vi.fn();
    const set = vi.fn();

    const engine = makeSyncEngine(
      {
        listRecipes: vi.fn().mockResolvedValue([entry]),
        getRecipes: vi.fn().mockResolvedValue([recipe]),
      },
      {
        recipes: {
          diff: vi.fn().mockReturnValue({ added: ["recipe-1"], changed: [], removed: [] }),
          put: putRecipe,
        },
      },
      {
        set,
      },
    );
    await engine.syncOnce();

    expect(putRecipe).toHaveBeenCalledWith(recipe);
    expect(set).toHaveBeenCalledWith(recipe);
  });

  it("AC3.2: Changed recipes are fetched, written to cache, and updated in store", async () => {
    const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });
    const entry: RecipeEntry = { uid: recipe.uid, hash: recipe.hash };

    const putRecipe = vi.fn();
    const set = vi.fn();

    const engine = makeSyncEngine(
      {
        listRecipes: vi.fn().mockResolvedValue([entry]),
        getRecipes: vi.fn().mockResolvedValue([recipe]),
      },
      {
        recipes: {
          diff: vi.fn().mockReturnValue({ added: [], changed: ["recipe-1"], removed: [] }),
          put: putRecipe,
        },
      },
      {
        set,
      },
    );
    await engine.syncOnce();

    expect(putRecipe).toHaveBeenCalledWith(recipe);
    expect(set).toHaveBeenCalledWith(recipe);
  });

  it("AC3.3: Removed recipes are deleted from cache and store", async () => {
    const removeRecipe = vi.fn().mockResolvedValue(undefined);
    const storeDelete = vi.fn();

    const engine = makeSyncEngine(
      undefined,
      {
        recipes: {
          diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: ["recipe-1"] }),
          remove: removeRecipe,
        },
      },
      {
        delete: storeDelete,
      },
    );
    await engine.syncOnce();

    expect(removeRecipe).toHaveBeenCalledWith("recipe-1");
    expect(storeDelete).toHaveBeenCalledWith("recipe-1");
  });

  it("AC3.4: SyncResult partitions added vs updated recipes correctly and includes removedUids", async () => {
    const addedRecipe = makeRecipe({ uid: "recipe-added" as RecipeUid });
    const changedRecipe = makeRecipe({ uid: "recipe-changed" as RecipeUid });
    const removedUid = "recipe-removed" as RecipeUid;

    const removeRecipe = vi.fn().mockResolvedValue(undefined);
    const storeDelete = vi.fn();

    const engine = makeSyncEngine(
      {
        listRecipes: vi.fn().mockResolvedValue([
          { uid: addedRecipe.uid, hash: addedRecipe.hash },
          { uid: changedRecipe.uid, hash: changedRecipe.hash },
        ]),
        getRecipes: vi.fn().mockResolvedValue([addedRecipe, changedRecipe]),
      },
      {
        recipes: {
          diff: vi.fn().mockReturnValue({
            added: ["recipe-added"],
            changed: ["recipe-changed"],
            removed: [removedUid],
          }),
          remove: removeRecipe,
        },
      },
      {
        delete: storeDelete,
      },
    );

    const receivedResults: AnySyncResult[] = [];
    engine.events.on("sync:complete", (result) => {
      receivedResults.push(result);
    });

    await engine.syncOnce();

    // Two events emitted: recipe first, pantry second
    expect(receivedResults).toHaveLength(2);
    const recipeResult = receivedResults[0]!;
    expect(recipeResult.changeType).toBe("recipes");
    expect(recipeResult.changes.added).toHaveLength(1);
    expect(recipeResult.changes.added[0]).toEqual(addedRecipe);
    expect(recipeResult.changes.updated).toHaveLength(1);
    expect(recipeResult.changes.updated[0]).toEqual(changedRecipe);
    expect(recipeResult.changes.removedUids).toEqual([removedUid]);
    expect(removeRecipe).toHaveBeenCalledWith(removedUid);
    expect(storeDelete).toHaveBeenCalledWith(removedUid);
  });

  it("AC3.5: No changes detected emits sync:complete with empty changes (two events)", async () => {
    const engine = makeSyncEngine();

    const receivedResults: AnySyncResult[] = [];
    engine.events.on("sync:complete", (result) => {
      receivedResults.push(result);
    });

    await engine.syncOnce();

    expect(receivedResults).toHaveLength(2);
    expect(receivedResults[0]).toEqual({
      changeType: "recipes",
      changes: { added: [], updated: [], removedUids: [] },
    });
    expect(receivedResults[1]).toEqual({
      changeType: "pantry",
      changes: { added: [], updated: [], removedUids: [] },
    });
  });

  it("AC4.1: store.setCategories called with all fetched categories", async () => {
    const category1 = makeCategory();
    const category2 = makeCategory();

    const setCategories = vi.fn();

    const engine = makeSyncEngine(
      {
        listCategories: vi.fn().mockResolvedValue([category1, category2]),
      },
      undefined,
      {
        setCategories,
      },
    );
    await engine.syncOnce();

    expect(setCategories).toHaveBeenCalledWith([category1, category2]);
  });

  it("AC4.2: cache.categories.put called for each category", async () => {
    const category1 = makeCategory();
    const category2 = makeCategory();

    const putCategory = vi.fn();

    const engine = makeSyncEngine(
      {
        listCategories: vi.fn().mockResolvedValue([category1, category2]),
      },
      {
        categories: { put: putCategory },
      },
    );
    await engine.syncOnce();

    expect(putCategory).toHaveBeenCalledWith(category1);
    expect(putCategory).toHaveBeenCalledWith(category2);
  });

  it("AC5.1: sync:complete subscriber calls resourceListChanged when recipe changes exist", async () => {
    const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });
    const entry: RecipeEntry = { uid: recipe.uid, hash: recipe.hash };

    const resourceListChanged = vi.fn();

    const engine = makeSyncEngine(
      {
        listRecipes: vi.fn().mockResolvedValue([entry]),
        getRecipes: vi.fn().mockResolvedValue([recipe]),
      },
      {
        recipes: { diff: vi.fn().mockReturnValue({ added: ["recipe-1"], changed: [], removed: [] }) },
      },
    );
    engine.events.on("sync:complete", (result) => {
      const { added, updated, removedUids } = result.changes;
      if (added.length > 0 || updated.length > 0 || removedUids.length > 0) {
        resourceListChanged();
      }
    });
    await engine.syncOnce();

    expect(resourceListChanged).toHaveBeenCalled();
  });

  it("AC5.2: sync:complete subscriber does NOT call resourceListChanged when no changes", async () => {
    const resourceListChanged = vi.fn();

    const engine = makeSyncEngine();
    engine.events.on("sync:complete", (result) => {
      const { added, updated, removedUids } = result.changes;
      if (added.length > 0 || updated.length > 0 || removedUids.length > 0) {
        resourceListChanged();
      }
    });
    await engine.syncOnce();

    expect(resourceListChanged).not.toHaveBeenCalled();
  });

  it("AC6.1: syncOnce never throws on API error", async () => {
    const engine = makeSyncEngine({
      listRecipes: vi.fn().mockRejectedValue(new Error("API Error")),
    });

    // Should not throw
    await expect(engine.syncOnce()).resolves.toBeUndefined();
  });

  it("AC6.2: sync:error emitted with caught Error", async () => {
    const testError = new Error("API Error");

    const engine = makeSyncEngine({
      listRecipes: vi.fn().mockRejectedValue(testError),
    });

    let receivedError: Error | null = null;
    engine.events.on("sync:error", (error) => {
      receivedError = error;
    });

    await engine.syncOnce();

    expect(receivedError).toBe(testError);
  });

  it("AC6.3: Next sync cycle runs after a failed cycle", async () => {
    let callCount = 0;
    const testError = new Error("First attempt fails");

    const engine = makeSyncEngine({
      listRecipes: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw testError;
        }
        return [];
      }),
    });

    const events: string[] = [];
    engine.events.on("sync:error", () => {
      events.push("error");
    });
    engine.events.on("sync:complete", () => {
      events.push("complete");
    });

    engine.start();

    // Wait for both error and complete events
    let attempts = 0;
    while (events.length < 2 && attempts < 200) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      attempts++;
    }

    engine.stop();

    // Should have at least one error and one complete
    expect(events).toContain("error");
    expect(events).toContain("complete");
  });

  it("AC7.1: success emits info record that fans out to notifier", async () => {
    // Use notifyLevel: "info" so info records fan out during this test.
    // Default production notifyLevel is "warn"; this override is test-only.
    const loggingMessage = vi.fn().mockResolvedValue(undefined);
    const notifier: Notifier = { resourceListChanged: vi.fn(), loggingMessage };
    const log = createLogger({ transport: "stdio", notifier, level: "trace", notifyLevel: "info", pretty: false });

    const context: AppContext = {
      client: makeMockClientDefault(),
      cache: makeMockCacheDefault(),
      store: makeMockStoreDefault(),
      pantryStore: makeMockPantryStoreDefault(),
      aisleStore: makeMockAisleStore(),
      vectorStore: null,
      notifier,
      auth: null,
      log,
    };
    const engine = new SyncEngine(context, 10);
    await engine.syncOnce();

    expect(loggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
        data: expect.objectContaining({ msg: "sync complete" }),
      }),
    );
  });

  it("AC7.2: failure emits error record that fans out to notifier", async () => {
    // Use notifyLevel: "warn" (default) — error records fan out.
    const loggingMessage = vi.fn().mockResolvedValue(undefined);
    const notifier: Notifier = { resourceListChanged: vi.fn(), loggingMessage };
    const log = createLogger({ transport: "stdio", notifier, level: "trace", notifyLevel: "warn", pretty: false });

    const context: AppContext = {
      client: {
        ...makeMockClientDefault(),
        listRecipes: vi.fn().mockRejectedValue(new Error("API Error")),
      } as unknown as PaprikaClient,
      cache: makeMockCacheDefault(),
      store: makeMockStoreDefault(),
      pantryStore: makeMockPantryStoreDefault(),
      aisleStore: makeMockAisleStore(),
      vectorStore: null,
      notifier,
      auth: null,
      log,
    };
    const engine = new SyncEngine(context, 10);
    await engine.syncOnce();

    expect(loggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        data: expect.objectContaining({ msg: "sync failed" }),
      }),
    );
  });

  describe("pantry-read.AC4: Sync Engine Integration", () => {
    // Import SyncEngine at describe level so it's available for tests that construct ServerContext directly
    beforeEach(() => {
      // beforeEach hook to ensure SyncEngine is available
    });

    it("pantry-read.AC4.1 Success: syncOnce() populates PantryStore via load() with items from API", async () => {
      const item1 = makePantryItem();
      const item2 = makePantryItem();

      const load = vi.fn();

      const engine = makeSyncEngine(
        {
          listPantry: vi.fn().mockResolvedValue([item1, item2]),
        },
        undefined,
        undefined,
        undefined,
        {
          load,
        },
      );

      await engine.syncOnce();

      expect(load).toHaveBeenCalledOnce();
      expect(load).toHaveBeenCalledWith(expect.arrayContaining([item1, item2]));
    });

    it("pantry-read.AC4.2 Success: syncOnce() writes all pantry items to DiskCache", async () => {
      const item1 = makePantryItem();
      const item2 = makePantryItem();

      const putPantryItem = vi.fn();

      const engine = makeSyncEngine(
        {
          listPantry: vi.fn().mockResolvedValue([item1, item2]),
        },
        {
          pantry: { put: putPantryItem },
        },
      );

      await engine.syncOnce();

      expect(putPantryItem).toHaveBeenCalledTimes(2);
      expect(putPantryItem).toHaveBeenCalledWith(item1);
      expect(putPantryItem).toHaveBeenCalledWith(item2);
    });

    it("pantry-read.AC4.3 Success: Orphan pantry files removed, but not keeper or newItem", async () => {
      const orphan1 = makePantryItem();
      const orphan2 = makePantryItem();
      const keeper = makePantryItem();
      const newItem = makePantryItem();

      const removePantryItem = vi.fn().mockResolvedValue(undefined);

      const engine = makeSyncEngine(
        {
          listPantry: vi.fn().mockResolvedValue([keeper, newItem]),
        },
        {
          pantry: {
            getAll: vi.fn().mockResolvedValue([orphan1, orphan2, keeper]),
            remove: removePantryItem,
          },
        },
      );

      await engine.syncOnce();

      expect(removePantryItem).toHaveBeenCalledTimes(2);
      expect(removePantryItem).toHaveBeenCalledWith(orphan1.uid);
      expect(removePantryItem).toHaveBeenCalledWith(orphan2.uid);
      expect(removePantryItem).not.toHaveBeenCalledWith(keeper.uid);
      expect(removePantryItem).not.toHaveBeenCalledWith(newItem.uid);
    });

    it("pantry-read.AC4.4 Success: subscriber calls resourceListChanged when pantry changes exist, not when no changes", async () => {
      const newItem = makePantryItem();

      const resourceListChanged = vi.fn();

      function wireNotifier(eng: SyncEngine, fn: () => void): void {
        eng.events.on("sync:complete", (result) => {
          const { added, updated, removedUids } = result.changes;
          if (added.length > 0 || updated.length > 0 || removedUids.length > 0) {
            fn();
          }
        });
      }

      // Test with pantry change
      const engine1 = makeSyncEngine(
        {
          listRecipes: vi.fn().mockResolvedValue([]),
          listPantry: vi.fn().mockResolvedValue([newItem]),
        },
        {
          recipes: { diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }) },
          pantry: { getAll: vi.fn().mockResolvedValue([]) },
        },
      );
      wireNotifier(engine1, resourceListChanged);

      await engine1.syncOnce();
      expect(resourceListChanged).toHaveBeenCalledOnce();

      // Test with no changes (empty cache, empty incoming)
      vi.clearAllMocks();
      const resourceListChanged2 = vi.fn();
      const engine2 = makeSyncEngine(
        {
          listRecipes: vi.fn().mockResolvedValue([]),
          listPantry: vi.fn().mockResolvedValue([]),
        },
        {
          recipes: { diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }) },
          pantry: { getAll: vi.fn().mockResolvedValue([]) },
        },
      );
      wireNotifier(engine2, resourceListChanged2);

      await engine2.syncOnce();
      expect(resourceListChanged2).not.toHaveBeenCalled();
    });

    it("pantry-read.AC4.4 Success: subscriber fires when same-UID pantry item content changes", async () => {
      const sharedUid = "uid-shared" as PantryItemUid;
      const cachedItem = makePantryItem({ uid: sharedUid, ingredient: "Old Ingredient", quantity: "1" });
      const incomingItem = makePantryItem({
        uid: sharedUid,
        ingredient: "Old Ingredient",
        quantity: "2",
      });

      const resourceListChanged = vi.fn();

      const engine = makeSyncEngine(
        {
          listRecipes: vi.fn().mockResolvedValue([]),
          listPantry: vi.fn().mockResolvedValue([incomingItem]),
        },
        {
          recipes: { diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }) },
          pantry: { getAll: vi.fn().mockResolvedValue([cachedItem]) },
        },
      );
      engine.events.on("sync:complete", (result) => {
        const { added, updated, removedUids } = result.changes;
        if (added.length > 0 || updated.length > 0 || removedUids.length > 0) {
          resourceListChanged();
        }
      });

      await engine.syncOnce();
      expect(resourceListChanged).toHaveBeenCalledOnce();
    });

    it("SyncResult (pantry) changes.added populated when new pantry items synced", async () => {
      const newItem = makePantryItem();

      const engine = makeSyncEngine(
        {
          listRecipes: vi.fn().mockResolvedValue([]),
          listPantry: vi.fn().mockResolvedValue([newItem]),
        },
        {
          recipes: { diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }) },
          pantry: { getAll: vi.fn().mockResolvedValue([]) },
        },
      );

      const receivedResults: AnySyncResult[] = [];
      engine.events.on("sync:complete", (result) => receivedResults.push(result));
      await engine.syncOnce();

      const pantryResult = receivedResults.find((r) => r.changeType === "pantry");
      expect(pantryResult).toBeDefined();
      expect(pantryResult!.changes.added).toHaveLength(1);
      expect(pantryResult!.changes.added[0]).toEqual(newItem);
      expect(pantryResult!.changes.updated).toHaveLength(0);
      expect(pantryResult!.changes.removedUids).toHaveLength(0);
    });

    it("SyncResult (pantry) changes.updated populated when same-UID content changes", async () => {
      const sharedUid = "uid-shared" as PantryItemUid;
      const cachedItem = makePantryItem({ uid: sharedUid, quantity: "1" });
      const incomingItem = makePantryItem({ uid: sharedUid, quantity: "2" });

      const engine = makeSyncEngine(
        {
          listRecipes: vi.fn().mockResolvedValue([]),
          listPantry: vi.fn().mockResolvedValue([incomingItem]),
        },
        {
          recipes: { diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }) },
          pantry: { getAll: vi.fn().mockResolvedValue([cachedItem]) },
        },
      );

      const receivedResults: AnySyncResult[] = [];
      engine.events.on("sync:complete", (result) => receivedResults.push(result));
      await engine.syncOnce();

      const pantryResult = receivedResults.find((r) => r.changeType === "pantry");
      expect(pantryResult).toBeDefined();
      expect(pantryResult!.changes.added).toHaveLength(0);
      expect(pantryResult!.changes.updated).toHaveLength(1);
      expect(pantryResult!.changes.updated[0]).toEqual(incomingItem);
      expect(pantryResult!.changes.removedUids).toHaveLength(0);
    });

    it("SyncResult (pantry) changes.removedUids populated when pantry items removed", async () => {
      const orphanItem = makePantryItem();

      const engine = makeSyncEngine(
        {
          listRecipes: vi.fn().mockResolvedValue([]),
          listPantry: vi.fn().mockResolvedValue([]),
        },
        {
          recipes: { diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }) },
          pantry: { getAll: vi.fn().mockResolvedValue([orphanItem]) },
        },
      );

      const receivedResults: AnySyncResult[] = [];
      engine.events.on("sync:complete", (result) => receivedResults.push(result));
      await engine.syncOnce();

      const pantryResult = receivedResults.find((r) => r.changeType === "pantry");
      expect(pantryResult).toBeDefined();
      expect(pantryResult!.changes.added).toHaveLength(0);
      expect(pantryResult!.changes.updated).toHaveLength(0);
      expect(pantryResult!.changes.removedUids).toHaveLength(1);
      expect(pantryResult!.changes.removedUids[0]).toBe(orphanItem.uid);
    });

    it("SyncResult (pantry) changes empty when no pantry changes", async () => {
      const engine = makeSyncEngine(
        {
          listRecipes: vi.fn().mockResolvedValue([]),
          listPantry: vi.fn().mockResolvedValue([]),
        },
        {
          recipes: { diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }) },
          pantry: { getAll: vi.fn().mockResolvedValue([]) },
        },
      );

      const receivedResults: AnySyncResult[] = [];
      engine.events.on("sync:complete", (result) => receivedResults.push(result));
      await engine.syncOnce();

      const pantryResult = receivedResults.find((r) => r.changeType === "pantry");
      expect(pantryResult).toBeDefined();
      expect(pantryResult!.changes.added).toHaveLength(0);
      expect(pantryResult!.changes.updated).toHaveLength(0);
      expect(pantryResult!.changes.removedUids).toHaveLength(0);
    });

    it("pantry-read.AC4.5 Success: REAL PantryStore hasSynced flips to true after sync", async () => {
      const item = makePantryItem();
      const realPantryStore = new RealPantryStore();

      expect(realPantryStore.hasSynced).toBe(false);

      const context: AppContext = {
        client: {
          listRecipes: vi.fn().mockResolvedValue([]),
          getRecipes: vi.fn().mockResolvedValue([]),
          listCategories: vi.fn().mockResolvedValue([]),
          listAisles: vi.fn().mockResolvedValue([]),
          listPantry: vi.fn().mockResolvedValue([item]),
        } as unknown as PaprikaClient,
        cache: {
          recipes: {
            diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
            put: vi.fn(),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          categories: { put: vi.fn() },
          aisles: { getAll: vi.fn().mockResolvedValue([]), put: vi.fn() },
          pantry: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn(),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          flush: vi.fn().mockResolvedValue(undefined),
        } as unknown as DiskCacheRoot,
        store: {
          set: vi.fn(),
          delete: vi.fn(),
          setCategories: vi.fn(),
          markSynced: vi.fn(),
          isPendingUpsert: vi.fn().mockReturnValue(false),
          isPendingDelete: vi.fn().mockReturnValue(false),
          clearPending: vi.fn(),
          sweepPending: vi.fn().mockReturnValue(0),
        } as unknown as RecipeStore,
        pantryStore: realPantryStore,
        aisleStore: new RealAisleStore(),
        vectorStore: null,
        notifier: makeMockNotifier(),
        auth: null,
        log: SILENT_LOG,
      };
      const engine = new SyncEngine(context, 10);

      await engine.syncOnce();

      expect(realPantryStore.hasSynced).toBe(true);
    });

    it("pantry-read.AC4.6 Edge: Empty pantry from API handled gracefully", async () => {
      const realPantryStore = new RealPantryStore();

      const context: AppContext = {
        client: {
          listRecipes: vi.fn().mockResolvedValue([]),
          getRecipes: vi.fn().mockResolvedValue([]),
          listCategories: vi.fn().mockResolvedValue([]),
          listAisles: vi.fn().mockResolvedValue([]),
          listPantry: vi.fn().mockResolvedValue([]),
        } as unknown as PaprikaClient,
        cache: {
          recipes: {
            diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
            put: vi.fn(),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          categories: { put: vi.fn() },
          aisles: { getAll: vi.fn().mockResolvedValue([]), put: vi.fn() },
          pantry: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn(),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          flush: vi.fn().mockResolvedValue(undefined),
        } as unknown as DiskCacheRoot,
        store: {
          set: vi.fn(),
          delete: vi.fn(),
          setCategories: vi.fn(),
          markSynced: vi.fn(),
          isPendingUpsert: vi.fn().mockReturnValue(false),
          isPendingDelete: vi.fn().mockReturnValue(false),
          clearPending: vi.fn(),
          sweepPending: vi.fn().mockReturnValue(0),
        } as unknown as RecipeStore,
        pantryStore: realPantryStore,
        aisleStore: new RealAisleStore(),
        vectorStore: null,
        notifier: makeMockNotifier(),
        auth: null,
        log: SILENT_LOG,
      };
      const engine = new SyncEngine(context, 10);

      let errorEmitted = false;
      engine.events.on("sync:error", () => {
        errorEmitted = true;
      });

      await engine.syncOnce();

      expect(errorEmitted).toBe(false);
      expect(realPantryStore.hasSynced).toBe(true);
      expect(realPantryStore.size).toBe(0);
    });

    it("pantry-read.AC4.7 Failure: syncOnce() does not throw when listPantry() fails", async () => {
      const testError = new Error("network down");

      const engine = makeSyncEngine({
        listPantry: vi.fn().mockRejectedValue(testError),
      });

      let receivedError: Error | null = null;
      engine.events.on("sync:error", (error) => {
        receivedError = error;
      });

      // Should not throw
      await expect(engine.syncOnce()).resolves.toBeUndefined();

      // Should emit sync:error
      expect(receivedError).toBe(testError);
    });
  });

  describe("aisle-sync: Aisle sync step (step 2.5)", () => {
    it("aisle-sync.AC1: listAisles() is called during syncOnce()", async () => {
      const listAisles = vi.fn().mockResolvedValue([]);
      const engine = makeSyncEngine({ listAisles });

      await engine.syncOnce();

      expect(listAisles).toHaveBeenCalledOnce();
    });

    it("aisle-sync.AC2: non-deleted aisles are written to cache and aisleStore.load() is called", async () => {
      const aisle1 = makeAisle({ name: "Produce" });
      const aisle2 = makeAisle({ name: "Dairy" });

      const putAisle = vi.fn();
      const load = vi.fn();

      const engine = makeSyncEngine(
        { listAisles: vi.fn().mockResolvedValue([aisle1, aisle2]) },
        { aisles: { getAll: vi.fn().mockResolvedValue([]), put: putAisle } },
        undefined,
        undefined,
        undefined,
        { load, sweepPending: vi.fn().mockReturnValue(0) },
      );

      await engine.syncOnce();

      expect(putAisle).toHaveBeenCalledTimes(2);
      expect(putAisle).toHaveBeenCalledWith(aisle1);
      expect(putAisle).toHaveBeenCalledWith(aisle2);
      expect(load).toHaveBeenCalledOnce();
      expect(load).toHaveBeenCalledWith(expect.arrayContaining([aisle1, aisle2]));
    });

    it("aisle-sync.AC3: deleted aisles are filtered out before store.load() and cache.put()", async () => {
      const active = makeAisle({ name: "Produce" });
      const deleted = makeAisle({ name: "Old", deleted: true });

      const putAisle = vi.fn();
      const load = vi.fn();

      const engine = makeSyncEngine(
        { listAisles: vi.fn().mockResolvedValue([active, deleted]) },
        { aisles: { getAll: vi.fn().mockResolvedValue([]), put: putAisle } },
        undefined,
        undefined,
        undefined,
        { load, sweepPending: vi.fn().mockReturnValue(0) },
      );

      await engine.syncOnce();

      expect(putAisle).toHaveBeenCalledTimes(1);
      expect(putAisle).toHaveBeenCalledWith(active);
      expect(putAisle).not.toHaveBeenCalledWith(deleted);
      expect(load).toHaveBeenCalledWith(expect.not.arrayContaining([deleted]));
    });

    it("aisle-sync.AC4: pending-upsert aisles from cache override incoming list entries", async () => {
      const pendingAisle = makeAisle({ name: "Custom Pending" });
      // Incoming list doesn't contain the pending aisle (propagation lag)
      const otherAisle = makeAisle({ name: "Produce" });

      const putAisle = vi.fn();
      const load = vi.fn();

      const engine = makeSyncEngine(
        { listAisles: vi.fn().mockResolvedValue([otherAisle]) },
        { aisles: { getAll: vi.fn().mockResolvedValue([pendingAisle]), put: putAisle } },
        undefined,
        undefined,
        undefined,
        {
          load,
          isPendingUpsert: vi.fn().mockImplementation((uid) => uid === pendingAisle.uid),
          sweepPending: vi.fn().mockReturnValue(0),
        },
      );

      await engine.syncOnce();

      // load() receives both: the non-pending incoming aisle + the pending aisle from cache
      expect(load).toHaveBeenCalledWith(expect.arrayContaining([otherAisle, pendingAisle]));
    });

    it("aisle-sync.AC5: sweepPending is called during finalization", async () => {
      const sweepPending = vi.fn().mockReturnValue(0);

      const engine = makeSyncEngine(undefined, undefined, undefined, undefined, undefined, { sweepPending });

      await engine.syncOnce();

      expect(sweepPending).toHaveBeenCalledOnce();
    });
  });
});
