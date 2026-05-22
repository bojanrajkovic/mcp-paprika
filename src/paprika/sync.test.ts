import { vi, describe, it, expect, afterEach, beforeEach, expectTypeOf } from "vitest";
import pino from "pino";

import { SyncEngine } from "./sync.js";
import type { AppContext } from "../server/app-context.js";
import type { Notifier } from "../server/notifier.js";
import type { RecipeStore } from "../cache/recipe-store.js";
import type { PaprikaClient } from "./client.js";
import type { DiskCache } from "../cache/disk-cache.js";
import type { PantryStore } from "../cache/pantry-store.js";
import type { PantryItemUid, RecipeEntry, RecipeUid, SyncResult } from "./types.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { PantryStore as RealPantryStore } from "../cache/pantry-store.js";

const SILENT_LOG = pino({ level: "silent" });

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
    listPantry: vi.fn().mockResolvedValue([]),
  } as unknown as PaprikaClient;
}

function makeMockCache(): DiskCache {
  return {
    diffRecipes: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
    putRecipe: vi.fn(),
    removeRecipe: vi.fn().mockResolvedValue(undefined),
    putCategory: vi.fn(),
    getAllPantryItems: vi.fn().mockResolvedValue([]),
    putPantryItem: vi.fn(),
    removePantryItem: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as DiskCache;
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
    expect(syncCompleteEvents).toHaveLength(1);
    expect(syncCompleteEvents[0]).toEqual({
      added: [],
      updated: [],
      removedUids: [],
    });

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

    // Wait for at least 3 sync:complete events
    const syncCompleteEvents: unknown[] = [];
    engine.events.on("sync:complete", () => {
      syncCompleteEvents.push(1);
    });

    let attempts = 0;
    while (syncCompleteEvents.length < 3 && attempts < 100) {
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

  it("AC2.2: sync:complete handler receives SyncResult", async () => {
    let receivedResult: unknown = null;
    let handlerCalled = false;

    engine.events.on("sync:complete", (result) => {
      receivedResult = result;
      handlerCalled = true;
    });

    engine.start();

    // Poll until handler is called
    let attempts = 0;
    while (!handlerCalled && attempts < 100) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      attempts++;
    }

    expect(handlerCalled).toBe(true);
    expect(receivedResult).toEqual({
      added: [],
      updated: [],
      removedUids: [],
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
      listPantry: vi.fn().mockResolvedValue([]),
    } as unknown as PaprikaClient;
  }

  function makeMockCacheDefault(): DiskCache {
    return {
      diffRecipes: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
      putRecipe: vi.fn(),
      removeRecipe: vi.fn().mockResolvedValue(undefined),
      putCategory: vi.fn(),
      getAllPantryItems: vi.fn().mockResolvedValue([]),
      putPantryItem: vi.fn(),
      removePantryItem: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined),
    } as unknown as DiskCache;
  }

  function makeMockStoreDefault(): RecipeStore {
    return {
      set: vi.fn(),
      delete: vi.fn(),
      setCategories: vi.fn(),
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
    cacheOverrides?: Partial<DiskCache>,
    storeOverrides?: Partial<RecipeStore>,
    notifierOverrides?: Partial<Notifier>,
    pantryStoreOverrides?: Partial<PantryStore>,
  ): SyncEngine {
    const context: AppContext = {
      client: { ...makeMockClientDefault(), ...clientOverrides } as PaprikaClient,
      cache: { ...makeMockCacheDefault(), ...cacheOverrides } as DiskCache,
      store: { ...makeMockStoreDefault(), ...storeOverrides } as RecipeStore,
      pantryStore: { ...makeMockPantryStoreDefault(), ...pantryStoreOverrides } as PantryStore,
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
        diffRecipes: vi.fn().mockReturnValue({ added: ["recipe-1"], changed: [], removed: [] }),
        putRecipe,
      },
      {
        set,
      },
    );
    await engine.syncOnce();

    expect(putRecipe).toHaveBeenCalledWith(recipe, recipe.hash);
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
        diffRecipes: vi.fn().mockReturnValue({ added: [], changed: ["recipe-1"], removed: [] }),
        putRecipe,
      },
      {
        set,
      },
    );
    await engine.syncOnce();

    expect(putRecipe).toHaveBeenCalledWith(recipe, recipe.hash);
    expect(set).toHaveBeenCalledWith(recipe);
  });

  it("AC3.3: Removed recipes are deleted from cache and store", async () => {
    const removeRecipe = vi.fn().mockResolvedValue(undefined);
    const storeDelete = vi.fn();

    const engine = makeSyncEngine(
      undefined,
      {
        diffRecipes: vi.fn().mockReturnValue({ added: [], changed: [], removed: ["recipe-1"] }),
        removeRecipe,
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
        diffRecipes: vi.fn().mockReturnValue({
          added: ["recipe-added"],
          changed: ["recipe-changed"],
          removed: [removedUid],
        }),
        removeRecipe,
      },
      {
        delete: storeDelete,
      },
    );

    let receivedResult: unknown = null;
    engine.events.on("sync:complete", (result) => {
      receivedResult = result;
    });

    await engine.syncOnce();

    const result = receivedResult as SyncResult;
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toEqual(addedRecipe);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toEqual(changedRecipe);
    expect(result.removedUids).toEqual([removedUid]);
    expect(removeRecipe).toHaveBeenCalledWith(removedUid);
    expect(storeDelete).toHaveBeenCalledWith(removedUid);
  });

  it("AC3.5: No changes detected emits sync:complete with empty arrays", async () => {
    const engine = makeSyncEngine();

    let receivedResult: unknown = null;
    engine.events.on("sync:complete", (result) => {
      receivedResult = result;
    });

    await engine.syncOnce();

    expect(receivedResult).toEqual({
      added: [],
      updated: [],
      removedUids: [],
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

  it("AC4.2: cache.putCategory called for each category", async () => {
    const category1 = makeCategory();
    const category2 = makeCategory();

    const putCategory = vi.fn();

    const engine = makeSyncEngine(
      {
        listCategories: vi.fn().mockResolvedValue([category1, category2]),
      },
      {
        putCategory,
      },
    );
    await engine.syncOnce();

    expect(putCategory).toHaveBeenCalledWith(category1, category1.uid);
    expect(putCategory).toHaveBeenCalledWith(category2, category2.uid);
  });

  it("AC5.1: notifier.resourceListChanged called when recipe changes exist", async () => {
    const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });
    const entry: RecipeEntry = { uid: recipe.uid, hash: recipe.hash };

    const resourceListChanged = vi.fn();

    const engine = makeSyncEngine(
      {
        listRecipes: vi.fn().mockResolvedValue([entry]),
        getRecipes: vi.fn().mockResolvedValue([recipe]),
      },
      {
        diffRecipes: vi.fn().mockReturnValue({ added: ["recipe-1"], changed: [], removed: [] }),
      },
      undefined,
      {
        resourceListChanged,
      },
    );
    await engine.syncOnce();

    expect(resourceListChanged).toHaveBeenCalled();
  });

  it("AC5.2: notifier.resourceListChanged NOT called when no recipe changes", async () => {
    const resourceListChanged = vi.fn();

    const engine = makeSyncEngine(undefined, undefined, undefined, {
      resourceListChanged,
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

  it("AC7.1: notifier.loggingMessage called with level info on success", async () => {
    const loggingMessage = vi.fn().mockResolvedValue(undefined);

    const engine = makeSyncEngine(undefined, undefined, undefined, {
      loggingMessage,
    });
    await engine.syncOnce();

    expect(loggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
      }),
    );
  });

  it("AC7.2: notifier.loggingMessage called with level error on failure", async () => {
    const loggingMessage = vi.fn().mockResolvedValue(undefined);

    const engine = makeSyncEngine(
      {
        listRecipes: vi.fn().mockRejectedValue(new Error("API Error")),
      },
      undefined,
      undefined,
      {
        loggingMessage,
      },
    );
    await engine.syncOnce();

    expect(loggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
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
          putPantryItem,
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
          getAllPantryItems: vi.fn().mockResolvedValue([orphan1, orphan2, keeper]),
          removePantryItem,
        },
      );

      await engine.syncOnce();

      expect(removePantryItem).toHaveBeenCalledTimes(2);
      expect(removePantryItem).toHaveBeenCalledWith(orphan1.uid);
      expect(removePantryItem).toHaveBeenCalledWith(orphan2.uid);
      expect(removePantryItem).not.toHaveBeenCalledWith(keeper.uid);
      expect(removePantryItem).not.toHaveBeenCalledWith(newItem.uid);
    });

    it("pantry-read.AC4.4 Success: notifier.resourceListChanged called when pantry changes exist, not when no changes", async () => {
      const newItem = makePantryItem();

      const resourceListChanged = vi.fn();

      // Test with pantry change
      const engine1 = makeSyncEngine(
        {
          listRecipes: vi.fn().mockResolvedValue([]),
          listPantry: vi.fn().mockResolvedValue([newItem]),
        },
        {
          diffRecipes: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
          getAllPantryItems: vi.fn().mockResolvedValue([]),
        },
        undefined,
        {
          resourceListChanged,
        },
      );

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
          diffRecipes: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
          getAllPantryItems: vi.fn().mockResolvedValue([]),
        },
        undefined,
        {
          resourceListChanged: resourceListChanged2,
        },
      );

      await engine2.syncOnce();
      expect(resourceListChanged2).not.toHaveBeenCalled();
    });

    it("pantry-read.AC4.4 Success: notifier.resourceListChanged fires when same-UID pantry item content changes", async () => {
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
          diffRecipes: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
          getAllPantryItems: vi.fn().mockResolvedValue([cachedItem]),
        },
        undefined,
        {
          resourceListChanged,
        },
      );

      await engine.syncOnce();
      expect(resourceListChanged).toHaveBeenCalledOnce();
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
          listPantry: vi.fn().mockResolvedValue([item]),
        } as unknown as PaprikaClient,
        cache: {
          diffRecipes: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
          putRecipe: vi.fn(),
          removeRecipe: vi.fn().mockResolvedValue(undefined),
          putCategory: vi.fn(),
          getAllPantryItems: vi.fn().mockResolvedValue([]),
          putPantryItem: vi.fn(),
          removePantryItem: vi.fn().mockResolvedValue(undefined),
          flush: vi.fn().mockResolvedValue(undefined),
        } as unknown as DiskCache,
        store: {
          set: vi.fn(),
          delete: vi.fn(),
          setCategories: vi.fn(),
          isPendingUpsert: vi.fn().mockReturnValue(false),
          isPendingDelete: vi.fn().mockReturnValue(false),
          clearPending: vi.fn(),
          sweepPending: vi.fn().mockReturnValue(0),
        } as unknown as RecipeStore,
        pantryStore: realPantryStore,
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
          listPantry: vi.fn().mockResolvedValue([]),
        } as unknown as PaprikaClient,
        cache: {
          diffRecipes: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
          putRecipe: vi.fn(),
          removeRecipe: vi.fn().mockResolvedValue(undefined),
          putCategory: vi.fn(),
          getAllPantryItems: vi.fn().mockResolvedValue([]),
          putPantryItem: vi.fn(),
          removePantryItem: vi.fn().mockResolvedValue(undefined),
          flush: vi.fn().mockResolvedValue(undefined),
        } as unknown as DiskCache,
        store: {
          set: vi.fn(),
          delete: vi.fn(),
          setCategories: vi.fn(),
          isPendingUpsert: vi.fn().mockReturnValue(false),
          isPendingDelete: vi.fn().mockReturnValue(false),
          clearPending: vi.fn(),
          sweepPending: vi.fn().mockReturnValue(0),
        } as unknown as RecipeStore,
        pantryStore: realPantryStore,
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
});
