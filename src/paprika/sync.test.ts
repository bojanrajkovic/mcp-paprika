import { vi, describe, it, expect, afterEach, beforeEach, expectTypeOf } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { SyncEngine } from "./sync.js";
import type { ServerContext } from "../types/server-context.js";
import type { RecipeStore } from "../cache/recipe-store.js";
import type { PaprikaClient } from "./client.js";
import type { DiskCache } from "../cache/disk-cache.js";
import type { RecipeEntry, RecipeUid, SyncResult } from "./types.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";

function makeMockServer(): McpServer {
  return {
    sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    sendResourceListChanged: vi.fn(),
  } as unknown as McpServer;
}

function makeMockStore(): RecipeStore {
  return {
    set: vi.fn(),
    delete: vi.fn(),
    setCategories: vi.fn(),
  } as unknown as RecipeStore;
}

function makeMockClient(): PaprikaClient {
  return {
    listRecipes: vi.fn().mockResolvedValue([]),
    getRecipes: vi.fn().mockResolvedValue([]),
    listCategories: vi.fn().mockResolvedValue([]),
  } as unknown as PaprikaClient;
}

function makeMockCache(): DiskCache {
  return {
    diffRecipes: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
    putRecipe: vi.fn(),
    removeRecipe: vi.fn().mockResolvedValue(undefined),
    putCategory: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as DiskCache;
}

function makeTestContext(): ServerContext {
  return {
    client: makeMockClient(),
    cache: makeMockCache(),
    store: makeMockStore(),
    server: makeMockServer(),
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
    } as unknown as PaprikaClient;
  }

  function makeMockCacheDefault(): DiskCache {
    return {
      diffRecipes: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
      putRecipe: vi.fn(),
      removeRecipe: vi.fn().mockResolvedValue(undefined),
      putCategory: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    } as unknown as DiskCache;
  }

  function makeMockStoreDefault(): RecipeStore {
    return {
      set: vi.fn(),
      delete: vi.fn(),
      setCategories: vi.fn(),
    } as unknown as RecipeStore;
  }

  function makeMockServerDefault(): McpServer {
    return {
      sendResourceListChanged: vi.fn(),
      sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as McpServer;
  }

  function makeSyncEngine(
    clientOverrides?: Partial<PaprikaClient>,
    cacheOverrides?: Partial<DiskCache>,
    storeOverrides?: Partial<RecipeStore>,
    serverOverrides?: Partial<McpServer>,
  ): SyncEngine {
    const context: ServerContext = {
      client: { ...makeMockClientDefault(), ...clientOverrides } as PaprikaClient,
      cache: { ...makeMockCacheDefault(), ...cacheOverrides } as DiskCache,
      store: { ...makeMockStoreDefault(), ...storeOverrides } as RecipeStore,
      server: { ...makeMockServerDefault(), ...serverOverrides } as McpServer,
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

  it("AC5.1: sendResourceListChanged called when recipe changes exist", async () => {
    const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });
    const entry: RecipeEntry = { uid: recipe.uid, hash: recipe.hash };

    const sendResourceListChanged = vi.fn();

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
        sendResourceListChanged,
      },
    );
    await engine.syncOnce();

    expect(sendResourceListChanged).toHaveBeenCalled();
  });

  it("AC5.2: sendResourceListChanged NOT called when no recipe changes", async () => {
    const sendResourceListChanged = vi.fn();

    const engine = makeSyncEngine(undefined, undefined, undefined, {
      sendResourceListChanged,
    });
    await engine.syncOnce();

    expect(sendResourceListChanged).not.toHaveBeenCalled();
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

  it("AC7.1: sendLoggingMessage called with level info on success", async () => {
    const sendLoggingMessage = vi.fn().mockResolvedValue(undefined);

    const engine = makeSyncEngine(undefined, undefined, undefined, {
      sendLoggingMessage,
    });
    await engine.syncOnce();

    expect(sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
      }),
    );
  });

  it("AC7.2: sendLoggingMessage called with level error on failure", async () => {
    const sendLoggingMessage = vi.fn().mockResolvedValue(undefined);

    const engine = makeSyncEngine(
      {
        listRecipes: vi.fn().mockRejectedValue(new Error("API Error")),
      },
      undefined,
      undefined,
      {
        sendLoggingMessage,
      },
    );
    await engine.syncOnce();

    expect(sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
      }),
    );
  });
});
