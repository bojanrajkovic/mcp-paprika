import { vi, describe, it, expect, afterEach, beforeEach, expectTypeOf } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";

import { SyncEngine, syncReplaceAllEntity } from "./sync.js";
import { createLogger, SILENT_LOG } from "../utils/log.js";
import type { AppContext } from "../server/app-context.js";
import type { Notifier } from "../server/notifier.js";
import type { RecipeStore } from "../cache/recipe-store.js";
import type { PaprikaClient } from "./client.js";
import type { DiskCacheRoot } from "../cache/disk/index.js";
import type { DiskCache } from "../cache/disk/base.js";
import type { PantryStore } from "../cache/pantry-store.js";
import type { AisleStore } from "../cache/aisle-store.js";
import type {
  AnySyncResult,
  Category,
  CategoryUid,
  EntityChanges,
  GroceryIngredientUid,
  GroceryItemUid,
  GroceryListUid,
  MenuItemUid,
  MenuUid,
  PantryItemUid,
  RecipeEntry,
  RecipeUid,
} from "./types.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { makeAisle } from "../cache/__fixtures__/aisles.js";
import { PantryStore as RealPantryStore } from "../cache/pantry-store.js";
import { AisleStore as RealAisleStore } from "../cache/aisle-store.js";
import { CategoryStore as RealCategoryStore } from "../cache/category-store.js";
import { GroceryIngredientStore } from "../cache/grocery-ingredient-store.js";
import { GroceryItemStore } from "../cache/grocery-item-store.js";
import { GroceryListStore } from "../cache/grocery-list-store.js";
import { makeAppContext } from "../__fixtures__/app-context.js";
import { makeGroceryList } from "../cache/__fixtures__/grocery-lists.js";
import { makeGroceryItem } from "../cache/__fixtures__/grocery-items.js";
import { makeGroceryIngredient } from "../cache/__fixtures__/grocery-ingredients.js";
import { makeMenu, makeMenuItem } from "../cache/__fixtures__/menus.js";
import { makePhoto } from "../cache/__fixtures__/photos.js";

function makeMockNotifier(): Notifier {
  return {
    resourceListChanged: vi.fn(),
    loggingMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockStore(): RecipeStore {
  return fromAny({
    set: vi.fn(),
    delete: vi.fn(),
    markSynced: vi.fn(),
    setLastSyncedAt: vi.fn(),
    isPendingUpsert: vi.fn().mockReturnValue(false),
    isPendingDelete: vi.fn().mockReturnValue(false),
    clearPending: vi.fn(),
    sweepPending: vi.fn().mockReturnValue(0),
  });
}

function makeMockClient(): PaprikaClient {
  return fromAny({
    listRecipes: vi.fn().mockResolvedValue([]),
    getRecipes: vi.fn().mockResolvedValue([]),
    listCategories: vi.fn().mockResolvedValue([]),
    listAisles: vi.fn().mockResolvedValue([]),
    listPantry: vi.fn().mockResolvedValue([]),
    listGroceryLists: vi.fn().mockResolvedValue([]),
    listGroceryItems: vi.fn().mockResolvedValue([]),
    listGroceryIngredients: vi.fn().mockResolvedValue([]),
    listMeals: vi.fn().mockResolvedValue([]),
    listMealTypes: vi.fn().mockResolvedValue([]),
    listMenus: vi.fn().mockResolvedValue([]),
    listMenuItems: vi.fn().mockResolvedValue([]),
    listPhotos: vi.fn().mockResolvedValue([]),
  });
}

function makeMockCache(): DiskCacheRoot {
  return fromAny({
    recipes: {
      diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
      put: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    categories: {
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    aisles: {
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn(),
    },
    pantry: {
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    groceryLists: {
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    groceryItems: {
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    groceryIngredients: {
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    meals: {
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    mealTypes: {
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    menus: {
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    menuItems: {
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    photos: {
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    flush: vi.fn().mockResolvedValue(undefined),
  });
}

function makeMockAisleStore(): AisleStore {
  return fromAny({
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
  });
}

function makeMockPantryStore(): PantryStore {
  return fromAny({
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
  });
}

function makeTestContext(): AppContext {
  return makeAppContext({
    client: makeMockClient(),
    cache: makeMockCache(),
    store: makeMockStore(),
    pantryStore: makeMockPantryStore(),
    aisleStore: makeMockAisleStore(),
    notifier: makeMockNotifier(),
  });
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

  it("drops grocery ingredients with no aisle (empty aisleUid) and keeps aisled ones", async () => {
    const ctx = makeTestContext();
    const aisled = makeGroceryIngredient({ name: "white pepper", aisleUid: "AISLE-PRODUCE" });
    const noAisle = makeGroceryIngredient({ name: "baby formula", aisleUid: "" });
    vi.mocked(ctx.client.listGroceryIngredients).mockResolvedValue([aisled, noAisle]);

    const localEngine = new SyncEngine(ctx, 10);
    await localEngine.syncOnce();

    const names = ctx.groceryIngredientStore.getAll().map((i) => i.name);
    expect(names).toContain("white pepper");
    expect(names).not.toContain("baby formula");
    // The dropped entry is never written to the disk cache.
    expect(ctx.cache.groceryIngredients.put).toHaveBeenCalledWith(aisled);
    expect(ctx.cache.groceryIngredients.put).not.toHaveBeenCalledWith(noAisle);
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

    // Wait for at least 18 sync:complete events (6 per cycle × 3 cycles)
    const syncCompleteEvents: unknown[] = [];
    engine.events.on("sync:complete", () => {
      syncCompleteEvents.push(1);
    });

    let attempts = 0;
    while (syncCompleteEvents.length < 18 && attempts < 100) {
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

  it("AC2.2: sync:complete handler receives AnySyncResult (six events per cycle)", async () => {
    const receivedResults: AnySyncResult[] = [];

    engine.events.on("sync:complete", (result) => {
      receivedResults.push(result);
    });

    engine.start();

    // Poll until all six events (recipe, pantry, grocery-lists, grocery-items, menus, menu-items) are received
    let attempts = 0;
    while (receivedResults.length < 6 && attempts < 100) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      attempts++;
    }

    expect(receivedResults).toHaveLength(6);
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
    // Third event: grocery-lists result
    expect(receivedResults[2]).toEqual({
      changeType: "grocery-lists",
      changes: { added: [], updated: [], removedUids: [] },
    });
    // Fourth event: grocery-items result
    expect(receivedResults[3]).toEqual({
      changeType: "grocery-items",
      changes: { added: [], updated: [], removedUids: [] },
    });
    // Fifth event: menus result
    expect(receivedResults[4]).toEqual({
      changeType: "menus",
      changes: { added: [], updated: [], removedUids: [] },
    });
    // Sixth event: menu-items result
    expect(receivedResults[5]).toEqual({
      changeType: "menu-items",
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
    return fromAny({
      listRecipes: vi.fn().mockResolvedValue([]),
      getRecipes: vi.fn().mockResolvedValue([]),
      listCategories: vi.fn().mockResolvedValue([]),
      listAisles: vi.fn().mockResolvedValue([]),
      listPantry: vi.fn().mockResolvedValue([]),
      listGroceryLists: vi.fn().mockResolvedValue([]),
      listGroceryItems: vi.fn().mockResolvedValue([]),
      listGroceryIngredients: vi.fn().mockResolvedValue([]),
      listMeals: vi.fn().mockResolvedValue([]),
      listMealTypes: vi.fn().mockResolvedValue([]),
      listMenus: vi.fn().mockResolvedValue([]),
      listMenuItems: vi.fn().mockResolvedValue([]),
      listPhotos: vi.fn().mockResolvedValue([]),
    });
  }

  // Cache mock overrides take a nested shape that mirrors DiskCacheRoot's
  // composition API. Tests pass `{ recipes: { put: spy } }` and the factory
  // shallow-merges each subcache with its defaults.
  type CacheMockOverrides = {
    recipes?: Partial<DiskCacheRoot["recipes"]>;
    categories?: Partial<DiskCacheRoot["categories"]>;
    aisles?: Partial<DiskCacheRoot["aisles"]>;
    pantry?: Partial<DiskCacheRoot["pantry"]>;
    groceryLists?: Partial<DiskCacheRoot["groceryLists"]>;
    groceryItems?: Partial<DiskCacheRoot["groceryItems"]>;
    groceryIngredients?: Partial<DiskCacheRoot["groceryIngredients"]>;
    menus?: Partial<DiskCacheRoot["menus"]>;
    menuItems?: Partial<DiskCacheRoot["menuItems"]>;
    photos?: Partial<DiskCacheRoot["photos"]>;
    flush?: () => Promise<void>;
  };

  function makeMockCacheDefault(overrides?: CacheMockOverrides): DiskCacheRoot {
    return fromAny({
      recipes: {
        diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
        put: vi.fn(),
        remove: vi.fn().mockResolvedValue(undefined),
        ...overrides?.recipes,
      },
      categories: {
        getAll: vi.fn().mockResolvedValue([]),
        put: vi.fn(),
        remove: vi.fn().mockResolvedValue(undefined),
        ...overrides?.categories,
      },
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
      groceryLists: {
        getAll: vi.fn().mockResolvedValue([]),
        put: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        ...overrides?.groceryLists,
      },
      groceryItems: {
        getAll: vi.fn().mockResolvedValue([]),
        put: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        ...overrides?.groceryItems,
      },
      groceryIngredients: {
        getAll: vi.fn().mockResolvedValue([]),
        put: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        ...overrides?.groceryIngredients,
      },
      meals: {
        getAll: vi.fn().mockResolvedValue([]),
        put: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      mealTypes: {
        getAll: vi.fn().mockResolvedValue([]),
        put: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      menus: {
        getAll: vi.fn().mockResolvedValue([]),
        put: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        ...overrides?.menus,
      },
      menuItems: {
        getAll: vi.fn().mockResolvedValue([]),
        put: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        ...overrides?.menuItems,
      },
      photos: {
        getAll: vi.fn().mockResolvedValue([]),
        put: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        ...overrides?.photos,
      },
      flush: overrides?.flush ?? vi.fn().mockResolvedValue(undefined),
    });
  }

  function makeMockStoreDefault(): RecipeStore {
    return fromAny({
      set: vi.fn(),
      delete: vi.fn(),
      markSynced: vi.fn(),
      setLastSyncedAt: vi.fn(),
      isPendingUpsert: vi.fn().mockReturnValue(false),
      isPendingDelete: vi.fn().mockReturnValue(false),
      clearPending: vi.fn(),
      sweepPending: vi.fn().mockReturnValue(0),
    });
  }

  function makeMockPantryStoreDefault(): PantryStore {
    return fromAny({
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
    });
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
    const context: AppContext = makeAppContext({
      client: { ...makeMockClientDefault(), ...clientOverrides } as PaprikaClient,
      cache: makeMockCacheDefault(cacheOverrides),
      store: { ...makeMockStoreDefault(), ...storeOverrides } as RecipeStore,
      pantryStore: { ...makeMockPantryStoreDefault(), ...pantryStoreOverrides } as PantryStore,
      aisleStore: { ...makeMockAisleStore(), ...aisleStoreOverrides } as AisleStore,
      notifier: { ...makeMockNotifierDefault(), ...notifierOverrides } as Notifier,
    });
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

  it("AC-photos: photos fetched via listPhotos are written to the photo cache", async () => {
    const photo = makePhoto({ recipeUid: "recipe-1" });
    const putPhoto = vi.fn().mockResolvedValue(undefined);

    const engine = makeSyncEngine({ listPhotos: vi.fn().mockResolvedValue([photo]) }, { photos: { put: putPhoto } });
    await engine.syncOnce();

    expect(putPhoto).toHaveBeenCalledWith(photo);
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

    // Six events emitted: recipe, pantry, grocery-lists, grocery-items, menus, menu-items
    expect(receivedResults).toHaveLength(6);
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

  it("AC3.5: No changes detected emits sync:complete with empty changes (six events)", async () => {
    const engine = makeSyncEngine();

    const receivedResults: AnySyncResult[] = [];
    engine.events.on("sync:complete", (result) => {
      receivedResults.push(result);
    });

    await engine.syncOnce();

    expect(receivedResults).toHaveLength(6);
    expect(receivedResults[0]).toEqual({
      changeType: "recipes",
      changes: { added: [], updated: [], removedUids: [] },
    });
    expect(receivedResults[1]).toEqual({
      changeType: "pantry",
      changes: { added: [], updated: [], removedUids: [] },
    });
    expect(receivedResults[2]).toEqual({
      changeType: "grocery-lists",
      changes: { added: [], updated: [], removedUids: [] },
    });
    expect(receivedResults[3]).toEqual({
      changeType: "grocery-items",
      changes: { added: [], updated: [], removedUids: [] },
    });
    expect(receivedResults[4]).toEqual({
      changeType: "menus",
      changes: { added: [], updated: [], removedUids: [] },
    });
    expect(receivedResults[5]).toEqual({
      changeType: "menu-items",
      changes: { added: [], updated: [], removedUids: [] },
    });
  });

  it("AC4.1: categoryStore loaded with all fetched categories", async () => {
    const category1 = makeCategory();
    const category2 = makeCategory();

    const categoryStore = new RealCategoryStore();
    const context: AppContext = makeAppContext({
      client: fromAny({
        ...makeMockClientDefault(),
        listCategories: vi.fn().mockResolvedValue([category1, category2]),
      }),
      cache: makeMockCacheDefault(),
      store: makeMockStoreDefault(),
      pantryStore: makeMockPantryStoreDefault(),
      aisleStore: makeMockAisleStore(),
      categoryStore,
    });
    const engine = new SyncEngine(context, 10);
    await engine.syncOnce();

    expect(categoryStore.getAll()).toEqual([category1, category2]);
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

  it("AC4.3: emits sync:category-change when a category is renamed (cache vs server diff) (#177)", async () => {
    const cat = makeCategory({ uid: "c" as CategoryUid, name: "Old" });
    const renamed: Category = { ...cat, name: "New" };

    // Disk cache holds the old name; the server now returns the new name → the
    // category sync reports `updated`, which fires the re-embed signal.
    const engine = makeSyncEngine(
      { listCategories: vi.fn().mockResolvedValue([renamed]) },
      { categories: { getAll: vi.fn().mockResolvedValue([cat]) } },
    );

    let received: EntityChanges<Category> | null = null;
    engine.events.on("sync:category-change", (changes) => {
      received = changes;
    });
    await engine.syncOnce();

    expect(received).not.toBeNull();
    const changes = received as unknown as EntityChanges<Category>;
    expect(changes.updated.map((c) => c.uid)).toEqual(["c"]);
    expect(changes.removedUids).toEqual([]);
  });

  it("AC4.4: emits sync:category-change with removedUids when a category disappears server-side (#177)", async () => {
    const cat = makeCategory({ uid: "gone" as CategoryUid, name: "Gone" });

    // Cached but no longer listed by the server → orphan → removedUids.
    const engine = makeSyncEngine(
      { listCategories: vi.fn().mockResolvedValue([]) },
      { categories: { getAll: vi.fn().mockResolvedValue([cat]) } },
    );

    let received: EntityChanges<Category> | null = null;
    engine.events.on("sync:category-change", (changes) => {
      received = changes;
    });
    await engine.syncOnce();

    expect(received).not.toBeNull();
    const changes = received as unknown as EntityChanges<Category>;
    expect(changes.removedUids).toEqual(["gone"]);
  });

  it("AC4.5: does NOT emit sync:category-change when the catalog is unchanged (#177)", async () => {
    const cat = makeCategory({ uid: "c" as CategoryUid, name: "Same" });

    const engine = makeSyncEngine(
      { listCategories: vi.fn().mockResolvedValue([cat]) },
      { categories: { getAll: vi.fn().mockResolvedValue([cat]) } },
    );

    const handler = vi.fn();
    engine.events.on("sync:category-change", handler);
    await engine.syncOnce();

    expect(handler).not.toHaveBeenCalled();
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

    const context: AppContext = makeAppContext({
      client: makeMockClientDefault(),
      cache: makeMockCacheDefault(),
      store: makeMockStoreDefault(),
      pantryStore: makeMockPantryStoreDefault(),
      aisleStore: makeMockAisleStore(),
      notifier,
      log,
    });
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

    const context: AppContext = makeAppContext({
      client: fromAny({
        ...makeMockClientDefault(),
        listRecipes: vi.fn().mockRejectedValue(new Error("API Error")),
      }),
      cache: makeMockCacheDefault(),
      store: makeMockStoreDefault(),
      pantryStore: makeMockPantryStoreDefault(),
      aisleStore: makeMockAisleStore(),
      notifier,
      log,
    });
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

      const context: AppContext = makeAppContext({
        client: fromAny({
          listRecipes: vi.fn().mockResolvedValue([]),
          getRecipes: vi.fn().mockResolvedValue([]),
          listCategories: vi.fn().mockResolvedValue([]),
          listAisles: vi.fn().mockResolvedValue([]),
          listPantry: vi.fn().mockResolvedValue([item]),
          listGroceryLists: vi.fn().mockResolvedValue([]),
          listGroceryItems: vi.fn().mockResolvedValue([]),
          listGroceryIngredients: vi.fn().mockResolvedValue([]),
          listMeals: vi.fn().mockResolvedValue([]),
          listMealTypes: vi.fn().mockResolvedValue([]),
        }),
        cache: fromAny({
          recipes: {
            diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
            put: vi.fn(),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          categories: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn(),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          aisles: { getAll: vi.fn().mockResolvedValue([]), put: vi.fn() },
          pantry: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn(),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          groceryLists: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          groceryItems: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          groceryIngredients: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          meals: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          mealTypes: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          menus: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          menuItems: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          flush: vi.fn().mockResolvedValue(undefined),
        }),
        store: fromAny({
          set: vi.fn(),
          delete: vi.fn(),
          markSynced: vi.fn(),
          setLastSyncedAt: vi.fn(),
          isPendingUpsert: vi.fn().mockReturnValue(false),
          isPendingDelete: vi.fn().mockReturnValue(false),
          clearPending: vi.fn(),
          sweepPending: vi.fn().mockReturnValue(0),
        }),
        pantryStore: realPantryStore,
        aisleStore: new RealAisleStore(),
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);

      await engine.syncOnce();

      expect(realPantryStore.hasSynced).toBe(true);
    });

    it("pantry-read.AC4.6 Edge: Empty pantry from API handled gracefully", async () => {
      const realPantryStore = new RealPantryStore();

      const context: AppContext = makeAppContext({
        client: fromAny({
          listRecipes: vi.fn().mockResolvedValue([]),
          getRecipes: vi.fn().mockResolvedValue([]),
          listCategories: vi.fn().mockResolvedValue([]),
          listAisles: vi.fn().mockResolvedValue([]),
          listPantry: vi.fn().mockResolvedValue([]),
          listGroceryLists: vi.fn().mockResolvedValue([]),
          listGroceryItems: vi.fn().mockResolvedValue([]),
          listGroceryIngredients: vi.fn().mockResolvedValue([]),
          listMeals: vi.fn().mockResolvedValue([]),
          listMealTypes: vi.fn().mockResolvedValue([]),
        }),
        cache: fromAny({
          recipes: {
            diff: vi.fn().mockReturnValue({ added: [], changed: [], removed: [] }),
            put: vi.fn(),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          categories: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn(),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          aisles: { getAll: vi.fn().mockResolvedValue([]), put: vi.fn() },
          pantry: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn(),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          groceryLists: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          groceryItems: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          groceryIngredients: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          meals: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          mealTypes: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          menus: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          menuItems: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
          flush: vi.fn().mockResolvedValue(undefined),
        }),
        store: fromAny({
          set: vi.fn(),
          delete: vi.fn(),
          markSynced: vi.fn(),
          setLastSyncedAt: vi.fn(),
          isPendingUpsert: vi.fn().mockReturnValue(false),
          isPendingDelete: vi.fn().mockReturnValue(false),
          clearPending: vi.fn(),
          sweepPending: vi.fn().mockReturnValue(0),
        }),
        pantryStore: realPantryStore,
        aisleStore: new RealAisleStore(),
        notifier: makeMockNotifier(),
      });
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

  describe("grocery-list-sync: Grocery list sync step", () => {
    it("grocery-list-sync.AC3.1a: fetched lists are loaded into store and written to cache", async () => {
      const list1 = makeGroceryList({ uid: "gl-1" as GroceryListUid });
      const list2 = makeGroceryList({ uid: "gl-2" as GroceryListUid });

      const putList = vi.fn().mockResolvedValue(undefined);
      const groceryListStore = new GroceryListStore();
      const loadSpy = vi.spyOn(groceryListStore, "load");

      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryLists: vi.fn().mockResolvedValue([list1, list2]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryLists: {
            getAll: vi.fn().mockResolvedValue([]),
            put: putList,
            remove: vi.fn().mockResolvedValue(undefined),
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryListStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      expect(loadSpy).toHaveBeenCalledWith(expect.arrayContaining([list1, list2]));
      expect(putList).toHaveBeenCalledWith(list1);
      expect(putList).toHaveBeenCalledWith(list2);
    });

    it("grocery-list-sync.AC3.1b: orphan lists (cached but not in server response) are removed from cache", async () => {
      const orphanList = makeGroceryList({ uid: "gl-orphan" as GroceryListUid });
      const incomingList = makeGroceryList({ uid: "gl-incoming" as GroceryListUid });

      const removeList = vi.fn().mockResolvedValue(undefined);
      const groceryListStore = new GroceryListStore();

      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryLists: vi.fn().mockResolvedValue([incomingList]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryLists: {
            getAll: vi.fn().mockResolvedValue([orphanList, incomingList]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: removeList,
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryListStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      expect(removeList).toHaveBeenCalledWith(orphanList.uid);
      expect(removeList).not.toHaveBeenCalledWith(incomingList.uid);
    });

    it("grocery-list-sync.AC3.1c: pending-upserted lists are preserved from cache (not overwritten by server)", async () => {
      const pendingList = makeGroceryList({ uid: "gl-pending" as GroceryListUid, name: "Local Version" });
      const serverList = makeGroceryList({ uid: "gl-pending" as GroceryListUid, name: "Server Version" });

      const groceryListStore = new GroceryListStore();
      groceryListStore.markPendingUpsert(pendingList.uid);
      const loadSpy = vi.spyOn(groceryListStore, "load");

      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryLists: vi.fn().mockResolvedValue([serverList]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryLists: {
            getAll: vi.fn().mockResolvedValue([pendingList]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryListStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      // The effective list should contain the pending (cached) version, not the server version
      const loadedArg = loadSpy.mock.calls[0]![0] as Array<ReturnType<typeof makeGroceryList>>;
      const loadedList = loadedArg.find((l) => l.uid === pendingList.uid);
      expect(loadedList).toBeDefined();
      expect(loadedList!.name).toBe("Local Version");
    });

    it("grocery-list-sync.AC3.1d: pending-deleted lists from server are filtered out", async () => {
      const pendingDeleteList = makeGroceryList({ uid: "gl-pending-del" as GroceryListUid });
      const otherList = makeGroceryList({ uid: "gl-other" as GroceryListUid });

      const groceryListStore = new GroceryListStore();
      groceryListStore.markPendingDelete(pendingDeleteList.uid);
      const loadSpy = vi.spyOn(groceryListStore, "load");

      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryLists: vi.fn().mockResolvedValue([pendingDeleteList, otherList]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryLists: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryListStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      const loadedArg = loadSpy.mock.calls[0]![0] as Array<ReturnType<typeof makeGroceryList>>;
      const loadedUids = loadedArg.map((l) => l.uid);
      expect(loadedUids).not.toContain(pendingDeleteList.uid);
      expect(loadedUids).toContain(otherList.uid);
    });
  });

  describe("grocery-item-sync: Grocery item sync step", () => {
    it("grocery-item-sync.AC3.2a: fetched items are loaded into store and written to cache", async () => {
      const item1 = makeGroceryItem({ uid: "gi-1" as GroceryItemUid });
      const item2 = makeGroceryItem({ uid: "gi-2" as GroceryItemUid });

      const putItem = vi.fn().mockResolvedValue(undefined);
      const groceryItemStore = new GroceryItemStore();
      const loadSpy = vi.spyOn(groceryItemStore, "load");

      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryItems: vi.fn().mockResolvedValue([item1, item2]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryItems: {
            getAll: vi.fn().mockResolvedValue([]),
            put: putItem,
            remove: vi.fn().mockResolvedValue(undefined),
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryItemStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      expect(loadSpy).toHaveBeenCalledWith(expect.arrayContaining([item1, item2]));
      expect(putItem).toHaveBeenCalledWith(item1);
      expect(putItem).toHaveBeenCalledWith(item2);
    });

    it("grocery-item-sync.AC3.2b: orphan items are removed from cache", async () => {
      const orphanItem = makeGroceryItem({ uid: "gi-orphan" as GroceryItemUid });
      const incomingItem = makeGroceryItem({ uid: "gi-incoming" as GroceryItemUid });

      const removeItem = vi.fn().mockResolvedValue(undefined);

      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryItems: vi.fn().mockResolvedValue([incomingItem]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryItems: {
            getAll: vi.fn().mockResolvedValue([orphanItem, incomingItem]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: removeItem,
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      expect(removeItem).toHaveBeenCalledWith(orphanItem.uid);
      expect(removeItem).not.toHaveBeenCalledWith(incomingItem.uid);
    });

    it("grocery-item-sync.AC3.2d: pending-deleted items from server are filtered out", async () => {
      const pendingDeleteItem = makeGroceryItem({ uid: "gi-pending-del" as GroceryItemUid });
      const otherItem = makeGroceryItem({ uid: "gi-other" as GroceryItemUid });

      const groceryItemStore = new GroceryItemStore();
      groceryItemStore.markPendingDelete(pendingDeleteItem.uid);
      const loadSpy = vi.spyOn(groceryItemStore, "load");

      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryItems: vi.fn().mockResolvedValue([pendingDeleteItem, otherItem]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryItems: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryItemStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      const loadedArg = loadSpy.mock.calls[0]![0] as Array<ReturnType<typeof makeGroceryItem>>;
      const loadedUids = loadedArg.map((i) => i.uid);
      expect(loadedUids).not.toContain(pendingDeleteItem.uid);
      expect(loadedUids).toContain(otherItem.uid);
    });

    it("grocery-item-sync.AC3.2c: pending-write filtering works independently from grocery list sync", async () => {
      const pendingItem = makeGroceryItem({ uid: "gi-pending" as GroceryItemUid, name: "Local Item" });
      const serverItem = makeGroceryItem({ uid: "gi-pending" as GroceryItemUid, name: "Server Item" });

      const groceryItemStore = new GroceryItemStore();
      groceryItemStore.markPendingUpsert(pendingItem.uid);
      const loadSpy = vi.spyOn(groceryItemStore, "load");

      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryItems: vi.fn().mockResolvedValue([serverItem]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryItems: {
            getAll: vi.fn().mockResolvedValue([pendingItem]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryItemStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      const loadedArg = loadSpy.mock.calls[0]![0] as Array<ReturnType<typeof makeGroceryItem>>;
      const loadedItem = loadedArg.find((i) => i.uid === pendingItem.uid);
      expect(loadedItem).toBeDefined();
      expect(loadedItem!.name).toBe("Local Item");
    });
  });

  describe("grocery-sync-events: sync:complete event emission for grocery entities", () => {
    it("grocery-sync-events.AC3.4: sync:complete emits GroceryListSyncResult with correct added/updated/removedUids", async () => {
      const newList = makeGroceryList({ uid: "gl-new" as GroceryListUid });
      const changedList = makeGroceryList({ uid: "gl-changed" as GroceryListUid, name: "Updated Name" });
      const cachedChangedList = makeGroceryList({ uid: "gl-changed" as GroceryListUid, name: "Old Name" });
      const orphanList = makeGroceryList({ uid: "gl-orphan" as GroceryListUid });

      const engine = makeSyncEngine(
        {
          listGroceryLists: vi.fn().mockResolvedValue([newList, changedList]),
        },
        {
          groceryLists: {
            // Cached: changedList (old version) + orphanList
            getAll: vi.fn().mockResolvedValue([cachedChangedList, orphanList]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        },
      );

      const receivedResults: AnySyncResult[] = [];
      engine.events.on("sync:complete", (result) => receivedResults.push(result));
      await engine.syncOnce();

      const listResult = receivedResults.find((r) => r.changeType === "grocery-lists");
      expect(listResult).toBeDefined();
      expect(listResult!.changes.added).toHaveLength(1);
      expect(listResult!.changes.added[0]).toEqual(newList);
      expect(listResult!.changes.updated).toHaveLength(1);
      expect(listResult!.changes.updated[0]).toEqual(changedList);
      expect(listResult!.changes.removedUids).toHaveLength(1);
      expect(listResult!.changes.removedUids[0]).toBe(orphanList.uid);
    });

    it("grocery-sync-events.AC3.5: sync:complete emits GroceryItemSyncResult with correct added/updated/removedUids", async () => {
      const newItem = makeGroceryItem({ uid: "gi-new" as GroceryItemUid });
      const changedItem = makeGroceryItem({ uid: "gi-changed" as GroceryItemUid, name: "Updated Item" });
      const cachedChangedItem = makeGroceryItem({ uid: "gi-changed" as GroceryItemUid, name: "Old Item" });
      const orphanItem = makeGroceryItem({ uid: "gi-orphan" as GroceryItemUid });

      const engine = makeSyncEngine(
        {
          listGroceryItems: vi.fn().mockResolvedValue([newItem, changedItem]),
        },
        {
          groceryItems: {
            getAll: vi.fn().mockResolvedValue([cachedChangedItem, orphanItem]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        },
      );

      const receivedResults: AnySyncResult[] = [];
      engine.events.on("sync:complete", (result) => receivedResults.push(result));
      await engine.syncOnce();

      const itemResult = receivedResults.find((r) => r.changeType === "grocery-items");
      expect(itemResult).toBeDefined();
      expect(itemResult!.changes.added).toHaveLength(1);
      expect(itemResult!.changes.added[0]).toEqual(newItem);
      expect(itemResult!.changes.updated).toHaveLength(1);
      expect(itemResult!.changes.updated[0]).toEqual(changedItem);
      expect(itemResult!.changes.removedUids).toHaveLength(1);
      expect(itemResult!.changes.removedUids[0]).toBe(orphanItem.uid);
    });
  });

  describe("menu-sync: sync:complete event emission for menu entities", () => {
    it("sync:complete emits MenuSyncResult with correct added/updated/removedUids", async () => {
      const newMenu = makeMenu({ uid: "menu-new" as MenuUid });
      const changedMenu = makeMenu({ uid: "menu-changed" as MenuUid, name: "Updated Plan" });
      const cachedChangedMenu = makeMenu({ uid: "menu-changed" as MenuUid, name: "Old Plan" });
      const orphanMenu = makeMenu({ uid: "menu-orphan" as MenuUid });

      const engine = makeSyncEngine(
        {
          listMenus: vi.fn().mockResolvedValue([newMenu, changedMenu]),
        },
        {
          menus: {
            getAll: vi.fn().mockResolvedValue([cachedChangedMenu, orphanMenu]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        },
      );

      const receivedResults: AnySyncResult[] = [];
      engine.events.on("sync:complete", (result) => receivedResults.push(result));
      await engine.syncOnce();

      const menuResult = receivedResults.find((r) => r.changeType === "menus");
      expect(menuResult).toBeDefined();
      expect(menuResult!.changes.added).toHaveLength(1);
      expect(menuResult!.changes.added[0]).toEqual(newMenu);
      expect(menuResult!.changes.updated).toHaveLength(1);
      expect(menuResult!.changes.updated[0]).toEqual(changedMenu);
      expect(menuResult!.changes.removedUids).toHaveLength(1);
      expect(menuResult!.changes.removedUids[0]).toBe(orphanMenu.uid);
    });

    it("sync:complete emits MenuItemSyncResult with correct added/updated/removedUids", async () => {
      const newItem = makeMenuItem({ uid: "mi-new" as MenuItemUid });
      const changedItem = makeMenuItem({ uid: "mi-changed" as MenuItemUid, name: "Updated Item" });
      const cachedChangedItem = makeMenuItem({ uid: "mi-changed" as MenuItemUid, name: "Old Item" });
      const orphanItem = makeMenuItem({ uid: "mi-orphan" as MenuItemUid });

      const engine = makeSyncEngine(
        {
          listMenuItems: vi.fn().mockResolvedValue([newItem, changedItem]),
        },
        {
          menuItems: {
            getAll: vi.fn().mockResolvedValue([cachedChangedItem, orphanItem]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        },
      );

      const receivedResults: AnySyncResult[] = [];
      engine.events.on("sync:complete", (result) => receivedResults.push(result));
      await engine.syncOnce();

      const itemResult = receivedResults.find((r) => r.changeType === "menu-items");
      expect(itemResult).toBeDefined();
      expect(itemResult!.changes.added).toHaveLength(1);
      expect(itemResult!.changes.added[0]).toEqual(newItem);
      expect(itemResult!.changes.updated).toHaveLength(1);
      expect(itemResult!.changes.updated[0]).toEqual(changedItem);
      expect(itemResult!.changes.removedUids).toHaveLength(1);
      expect(itemResult!.changes.removedUids[0]).toBe(orphanItem.uid);
    });

    it("menuStore.setLastSyncedAt is invoked during menu sync (afterLoad hook)", async () => {
      const engine = makeSyncEngine();
      const ctx = (engine as unknown as { _context: AppContext })._context;
      const spy = vi.spyOn(ctx.menuStore, "setLastSyncedAt");

      await engine.syncOnce();

      expect(spy).toHaveBeenCalled();
    });

    it("menu sync failure is best-effort and does not surface as sync:error", async () => {
      const engine = makeSyncEngine({
        listMenus: vi.fn().mockRejectedValue(new Error("menus endpoint 503")),
      });

      let receivedError: Error | null = null;
      engine.events.on("sync:error", (error) => {
        receivedError = error;
      });

      const completeEvents: Array<string> = [];
      engine.events.on("sync:complete", (result) => completeEvents.push(result.changeType));

      await expect(engine.syncOnce()).resolves.toBeUndefined();
      expect(receivedError).toBeNull();
      // Core events still fire; menu/menu-item events still emit (with empty changes)
      expect(completeEvents).toEqual(
        expect.arrayContaining(["recipes", "pantry", "grocery-lists", "grocery-items", "menus", "menu-items"]),
      );
    });

    it("sweepPending is called for both menu store and menu item store during finalization", async () => {
      const engine = makeSyncEngine();
      const ctx = (engine as unknown as { _context: AppContext })._context;
      const sweepMenuSpy = vi.spyOn(ctx.menuStore, "sweepPending");
      const sweepMenuItemSpy = vi.spyOn(ctx.menuItemStore, "sweepPending");

      await engine.syncOnce();

      expect(sweepMenuSpy).toHaveBeenCalledOnce();
      expect(sweepMenuItemSpy).toHaveBeenCalledOnce();
    });
  });

  describe("grocery-sweep: sweepPending for grocery stores", () => {
    it("grocery-sweep.AC3.7: sweepPending is called for both grocery list store and grocery item store during finalization", async () => {
      const groceryListStore = new GroceryListStore();
      const groceryItemStore = new GroceryItemStore();
      const sweepListSpy = vi.spyOn(groceryListStore, "sweepPending");
      const sweepItemSpy = vi.spyOn(groceryItemStore, "sweepPending");

      const context: AppContext = makeAppContext({
        client: makeMockClient(),
        cache: makeMockCache(),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryListStore,
        groceryItemStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      expect(sweepListSpy).toHaveBeenCalledOnce();
      expect(sweepItemSpy).toHaveBeenCalledOnce();
    });
  });

  describe("grocery-observation-clearing: Observation-based pending-upsert clearing", () => {
    it("grocery-observation-clearing.AC3.9a: grocery list pending-upsert is cleared when server content matches cached content", async () => {
      const list = makeGroceryList({ uid: "gl-match" as GroceryListUid, name: "Same Name" });
      // Server response has same content as what's cached
      const serverList = { ...list };

      const groceryListStore = new GroceryListStore();
      groceryListStore.markPendingUpsert(list.uid);
      const clearPendingSpy = vi.spyOn(groceryListStore, "clearPending");

      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryLists: vi.fn().mockResolvedValue([serverList]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryLists: {
            getAll: vi.fn().mockResolvedValue([list]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryListStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      expect(clearPendingSpy).toHaveBeenCalledWith(list.uid);
    });

    it("grocery-observation-clearing.AC3.9b: grocery list pending-upsert is NOT cleared when server content differs from cached content", async () => {
      const cachedList = makeGroceryList({ uid: "gl-diff" as GroceryListUid, name: "Local Name" });
      const serverList = makeGroceryList({ uid: "gl-diff" as GroceryListUid, name: "Different Server Name" });

      const groceryListStore = new GroceryListStore();
      groceryListStore.markPendingUpsert(cachedList.uid);
      const clearPendingSpy = vi.spyOn(groceryListStore, "clearPending");

      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryLists: vi.fn().mockResolvedValue([serverList]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryLists: {
            getAll: vi.fn().mockResolvedValue([cachedList]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryListStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      expect(clearPendingSpy).not.toHaveBeenCalledWith(cachedList.uid);
    });

    it("grocery-observation-clearing.AC3.9c: grocery item pending-upsert is cleared when server content matches cached content", async () => {
      const item = makeGroceryItem({ uid: "gi-match" as GroceryItemUid, name: "Same Item" });
      const serverItem = { ...item };

      const groceryItemStore = new GroceryItemStore();
      groceryItemStore.markPendingUpsert(item.uid);
      const clearPendingSpy = vi.spyOn(groceryItemStore, "clearPending");

      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryItems: vi.fn().mockResolvedValue([serverItem]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryItems: {
            getAll: vi.fn().mockResolvedValue([item]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryItemStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      expect(clearPendingSpy).toHaveBeenCalledWith(item.uid);
    });

    it("grocery-observation-clearing.AC3.9d: grocery item pending-upsert is NOT cleared when server content differs from cached content", async () => {
      const cachedItem = makeGroceryItem({ uid: "gi-diff" as GroceryItemUid, name: "Local Item" });
      const serverItem = makeGroceryItem({ uid: "gi-diff" as GroceryItemUid, name: "Different Server Item" });

      const groceryItemStore = new GroceryItemStore();
      groceryItemStore.markPendingUpsert(cachedItem.uid);
      const clearPendingSpy = vi.spyOn(groceryItemStore, "clearPending");

      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryItems: vi.fn().mockResolvedValue([serverItem]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryItems: {
            getAll: vi.fn().mockResolvedValue([cachedItem]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryItemStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      expect(clearPendingSpy).not.toHaveBeenCalledWith(cachedItem.uid);
    });
  });

  describe("grocery-ingredient-sync: Ingredient catalog sync step", () => {
    it("grocery-ingredient-sync.AC3.3a: non-deleted ingredients are loaded into store and written to cache", async () => {
      const activeIngredient = makeGroceryIngredient({ uid: "gi-1" as GroceryIngredientUid });
      const deletedIngredient = makeGroceryIngredient({ uid: "gi-deleted" as GroceryIngredientUid, deleted: true });

      const putIngredient = vi.fn().mockResolvedValue(undefined);
      const groceryIngredientStore = new GroceryIngredientStore();
      const loadSpy = vi.spyOn(groceryIngredientStore, "load");

      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryIngredients: vi.fn().mockResolvedValue([activeIngredient, deletedIngredient]),
          listMeals: vi.fn().mockResolvedValue([]),
          listMealTypes: vi.fn().mockResolvedValue([]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryIngredients: {
            getAll: vi.fn().mockResolvedValue([]),
            put: putIngredient,
            remove: vi.fn().mockResolvedValue(undefined),
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryIngredientStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      // Only non-deleted ingredients are loaded and written
      expect(loadSpy).toHaveBeenCalledWith(expect.arrayContaining([activeIngredient]));
      const loadedArg = loadSpy.mock.calls[0]![0] as ReadonlyArray<typeof activeIngredient>;
      expect(loadedArg.map((i) => i.uid)).not.toContain(deletedIngredient.uid);
      expect(putIngredient).toHaveBeenCalledWith(activeIngredient);
      expect(putIngredient).not.toHaveBeenCalledWith(deletedIngredient);
    });

    it("grocery-ingredient-sync.AC3.3b: orphan ingredients (cached but not in filtered response) are removed from cache", async () => {
      const orphanIngredient = makeGroceryIngredient({ uid: "gi-orphan" as GroceryIngredientUid });
      const activeIngredient = makeGroceryIngredient({ uid: "gi-active" as GroceryIngredientUid });

      const removeIngredient = vi.fn().mockResolvedValue(undefined);

      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryIngredients: vi.fn().mockResolvedValue([activeIngredient]),
          listMeals: vi.fn().mockResolvedValue([]),
          listMealTypes: vi.fn().mockResolvedValue([]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryIngredients: {
            getAll: vi.fn().mockResolvedValue([orphanIngredient, activeIngredient]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: removeIngredient,
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      expect(removeIngredient).toHaveBeenCalledWith(orphanIngredient.uid);
      expect(removeIngredient).not.toHaveBeenCalledWith(activeIngredient.uid);
    });

    it("grocery-ingredient-sync.AC3.3c: no sync:complete event is emitted for ingredient catalog", async () => {
      const ingredient = makeGroceryIngredient({ uid: "gi-1" as GroceryIngredientUid });

      const engine = makeSyncEngine({
        listGroceryIngredients: vi.fn().mockResolvedValue([ingredient]),
      });

      const receivedResults: AnySyncResult[] = [];
      engine.events.on("sync:complete", (result) => receivedResults.push(result));
      await engine.syncOnce();

      // Should have exactly 6 events (recipes, pantry, grocery-lists, grocery-items, menus, menu-items) — NOT ingredients
      expect(receivedResults).toHaveLength(6);
      const changeTypes = receivedResults.map((r) => r.changeType);
      expect(changeTypes).not.toContain("grocery-ingredients");
      expect(changeTypes).toContain("recipes");
      expect(changeTypes).toContain("pantry");
      expect(changeTypes).toContain("grocery-lists");
      expect(changeTypes).toContain("grocery-items");
      expect(changeTypes).toContain("menus");
      expect(changeTypes).toContain("menu-items");
    });
  });

  describe("grocery-subscriber: Subscriber wiring for resource-list notifications", () => {
    // Helper: wire the same subscriber logic as buildAppContext does
    function wireGrocerySubscriber(engine: SyncEngine, resourceListChanged: () => void): void {
      engine.events.on("sync:complete", (result) => {
        if (
          result.changeType !== "recipes" &&
          result.changeType !== "grocery-lists" &&
          result.changeType !== "grocery-items"
        ) {
          return;
        }
        const { added, updated, removedUids } = result.changes;
        if (added.length > 0 || updated.length > 0 || removedUids.length > 0) {
          resourceListChanged();
        }
      });
    }

    it("grocery-subscriber.AC3.6a: resourceListChanged() fires when grocery-lists sync has non-empty added", async () => {
      const resourceListChanged = vi.fn();
      const newList = makeGroceryList({ uid: "gl-new" as GroceryListUid });

      const engine = makeSyncEngine(
        {
          listGroceryLists: vi.fn().mockResolvedValue([newList]),
        },
        {
          groceryLists: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        },
      );
      wireGrocerySubscriber(engine, resourceListChanged);
      await engine.syncOnce();

      expect(resourceListChanged).toHaveBeenCalled();
    });

    it("grocery-subscriber.AC3.6b: resourceListChanged() fires when grocery-items sync has non-empty removedUids", async () => {
      const resourceListChanged = vi.fn();
      const orphanItem = makeGroceryItem({ uid: "gi-orphan" as GroceryItemUid });

      const engine = makeSyncEngine(
        {
          // Server returns no items — orphanItem becomes orphan
          listGroceryItems: vi.fn().mockResolvedValue([]),
        },
        {
          groceryItems: {
            getAll: vi.fn().mockResolvedValue([orphanItem]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        },
      );
      wireGrocerySubscriber(engine, resourceListChanged);
      await engine.syncOnce();

      expect(resourceListChanged).toHaveBeenCalled();
    });

    it("grocery-subscriber.AC3.6c: resourceListChanged() does NOT fire when grocery sync has empty changes", async () => {
      const resourceListChanged = vi.fn();

      // makeSyncEngine defaults: empty server responses + empty caches = no changes
      const engine = makeSyncEngine();
      wireGrocerySubscriber(engine, resourceListChanged);
      await engine.syncOnce();

      expect(resourceListChanged).not.toHaveBeenCalled();
    });

    it("grocery-subscriber.AC3.6d: resourceListChanged() does NOT fire when pantry sync has non-empty changes", async () => {
      const resourceListChanged = vi.fn();
      const pantryItem = makePantryItem();

      const engine = makeSyncEngine(
        {
          // Server returns one item not in cache → it's "added" in pantry changes
          listPantry: vi.fn().mockResolvedValue([pantryItem]),
        },
        {
          pantry: {
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn(),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        },
      );
      // Only wire grocery subscriber, NOT a generic subscriber
      engine.events.on("sync:complete", (result) => {
        if (
          result.changeType !== "recipes" &&
          result.changeType !== "grocery-lists" &&
          result.changeType !== "grocery-items"
        ) {
          return;
        }
        const { added, updated, removedUids } = result.changes;
        if (added.length > 0 || updated.length > 0 || removedUids.length > 0) {
          resourceListChanged();
        }
      });
      await engine.syncOnce();

      // Pantry event has non-empty added, but subscriber filters it out
      expect(resourceListChanged).not.toHaveBeenCalled();
    });
  });

  describe("grocery-cold-start: Cold-start hydration of grocery stores", () => {
    it("grocery-cold-start.AC3.8a: grocery list store is hydrated from disk cache before first sync", async () => {
      const cachedList = makeGroceryList({ uid: "gl-cached" as GroceryListUid });
      const realGroceryListStore = new GroceryListStore();

      expect(realGroceryListStore.hasSynced).toBe(false);

      // Hydrate from cache (as buildAppContext does)
      realGroceryListStore.load([cachedList]);

      expect(realGroceryListStore.hasSynced).toBe(true);
      expect(realGroceryListStore.getAll()).toHaveLength(1);
      expect(realGroceryListStore.getAll()[0]).toEqual(cachedList);

      // After syncOnce() the store is replaced with server data
      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryLists: vi.fn().mockResolvedValue([]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryLists: {
            getAll: vi.fn().mockResolvedValue([cachedList]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryListStore: realGroceryListStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      // Server returned empty list and cachedList is in cache — but server list wins as effective list
      // (cachedList is not pending, so it's filtered by being absent from server response as orphan)
      expect(realGroceryListStore.hasSynced).toBe(true);
    });

    it("grocery-cold-start.AC3.8b: grocery item store is hydrated from disk cache before first sync", async () => {
      const cachedItem = makeGroceryItem({ uid: "gi-cached" as GroceryItemUid });
      const realGroceryItemStore = new GroceryItemStore();

      expect(realGroceryItemStore.hasSynced).toBe(false);

      // Hydrate from cache
      realGroceryItemStore.load([cachedItem]);

      expect(realGroceryItemStore.hasSynced).toBe(true);
      expect(realGroceryItemStore.getAll()).toHaveLength(1);

      // After syncOnce() the store is reloaded from effective items
      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryItems: vi.fn().mockResolvedValue([cachedItem]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryItems: {
            getAll: vi.fn().mockResolvedValue([cachedItem]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryItemStore: realGroceryItemStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      expect(realGroceryItemStore.hasSynced).toBe(true);
      expect(realGroceryItemStore.getAll()).toHaveLength(1);
      expect(realGroceryItemStore.getAll()[0]).toEqual(cachedItem);
    });

    it("grocery-cold-start.AC3.8c: grocery ingredient store is hydrated from disk cache before first sync", async () => {
      const cachedIngredient = makeGroceryIngredient({ uid: "gg-cached" as GroceryIngredientUid });
      const realGroceryIngredientStore = new GroceryIngredientStore();

      expect(realGroceryIngredientStore.hasSynced).toBe(false);

      // Hydrate from cache (as buildAppContext does, filtering deleted:true)
      realGroceryIngredientStore.load([cachedIngredient]);

      expect(realGroceryIngredientStore.hasSynced).toBe(true);
      expect(realGroceryIngredientStore.getAll()).toHaveLength(1);

      // After syncOnce() the store is reloaded from server data
      const context: AppContext = makeAppContext({
        client: fromAny({
          ...makeMockClient(),
          listGroceryIngredients: vi.fn().mockResolvedValue([cachedIngredient]),
          listMeals: vi.fn().mockResolvedValue([]),
          listMealTypes: vi.fn().mockResolvedValue([]),
        }),
        cache: fromAny({
          ...makeMockCache(),
          groceryIngredients: {
            getAll: vi.fn().mockResolvedValue([cachedIngredient]),
            put: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        }),
        store: makeMockStore(),
        pantryStore: makeMockPantryStore(),
        aisleStore: makeMockAisleStore(),
        groceryIngredientStore: realGroceryIngredientStore,
        notifier: makeMockNotifier(),
      });
      const engine = new SyncEngine(context, 10);
      await engine.syncOnce();

      expect(realGroceryIngredientStore.hasSynced).toBe(true);
      expect(realGroceryIngredientStore.getAll()).toHaveLength(1);
      expect(realGroceryIngredientStore.getAll()[0]).toEqual(cachedIngredient);
    });
  });

  describe("meal sync isolation (best-effort, does not abort core sync)", () => {
    it("listMealTypes() failure does not propagate to sync:error and core sync continues", async () => {
      const engine = makeSyncEngine({
        listMealTypes: vi.fn().mockRejectedValue(new Error("mealtypes endpoint down")),
      });

      let receivedError: Error | null = null;
      engine.events.on("sync:error", (error) => {
        receivedError = error;
      });

      await expect(engine.syncOnce()).resolves.toBeUndefined();
      // Meal failure must NOT surface as sync:error — that's reserved for
      // core-pipeline failures that abort the cycle.
      expect(receivedError).toBeNull();
    });

    it("listMeals() failure does not propagate to sync:error and core sync continues", async () => {
      const engine = makeSyncEngine({
        listMeals: vi.fn().mockRejectedValue(new Error("meals endpoint 503")),
      });

      let receivedError: Error | null = null;
      engine.events.on("sync:error", (error) => {
        receivedError = error;
      });

      await expect(engine.syncOnce()).resolves.toBeUndefined();
      expect(receivedError).toBeNull();
    });

    it("core sync:complete events still emit when meal sync fails", async () => {
      const engine = makeSyncEngine({
        listMeals: vi.fn().mockRejectedValue(new Error("meals down")),
      });

      const completeEvents: Array<string> = [];
      engine.events.on("sync:complete", (result) => {
        completeEvents.push(result.changeType);
      });

      await engine.syncOnce();

      // Four core sync:complete events fire regardless of meal-side failure
      expect(completeEvents).toEqual(expect.arrayContaining(["recipes", "pantry", "grocery-lists", "grocery-items"]));
    });

    it("filters soft-deleted meal types out of the store load", async () => {
      const liveMt = {
        uid: "live-uid",
        name: "Live",
        color: "",
        orderFlag: 0,
        originalType: 0,
        exportAllDay: false,
        exportTime: 0,
        deleted: false,
      };
      const deletedMt = {
        uid: "dead-uid",
        name: "Dead",
        color: "",
        orderFlag: 1,
        originalType: 1,
        exportAllDay: false,
        exportTime: 0,
        deleted: true,
      };

      const load = vi.fn();
      const engine = makeSyncEngine({ listMealTypes: vi.fn().mockResolvedValue([liveMt, deletedMt]) });
      // Replace mealTypeStore.load via context spy
      // Cannot easily intercept; instead assert via cache.put (only live one written)
      const putMealType = vi.fn();
      const ctxAny = (engine as unknown as { _context: AppContext })._context;
      (ctxAny.cache.mealTypes as unknown as { put: typeof putMealType }).put = putMealType;
      (ctxAny.cache.mealTypes as unknown as { getAll: typeof load }).getAll = vi.fn().mockResolvedValue([]);

      await engine.syncOnce();

      // Only the live mealtype is persisted; the deleted one is filtered before cache.put
      expect(putMealType).toHaveBeenCalledTimes(1);
      expect(putMealType).toHaveBeenCalledWith(liveMt);
    });
  });
});

describe("syncReplaceAllEntity", () => {
  type GList = ReturnType<typeof makeGroceryList>;

  function makeCache(initial: ReadonlyArray<GList> = []) {
    const getAll = vi.fn().mockResolvedValue(initial);
    const put = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const cache: Pick<DiskCache<GList>, "getAll" | "put" | "remove"> = fromAny({ getAll, put, remove });
    return { cache, getAll, put, remove };
  }

  function listsEqual(a: ReturnType<typeof makeGroceryList>, b: ReturnType<typeof makeGroceryList>): boolean {
    return a.uid === b.uid && a.name === b.name && a.deleted === b.deleted;
  }

  it("returns empty changes when fetch and cache are both empty", async () => {
    const store = new GroceryListStore();
    const { cache } = makeCache([]);
    const result = await syncReplaceAllEntity({
      fetch: async () => [],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.removedUids).toHaveLength(0);
  });

  it("returns added for UIDs present in fetch but not in cache", async () => {
    const list = makeGroceryList();
    const store = new GroceryListStore();
    const { cache } = makeCache([]);
    const result = await syncReplaceAllEntity({
      fetch: async () => [list],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.uid).toBe(list.uid);
    expect(result.updated).toHaveLength(0);
    expect(result.removedUids).toHaveLength(0);
  });

  it("returns updated for UIDs in both fetch and cache where equals returns false", async () => {
    const list = makeGroceryList({ name: "Old Name" });
    const updated = { ...list, name: "New Name" };
    const store = new GroceryListStore();
    const { cache } = makeCache([list]);
    const result = await syncReplaceAllEntity({
      fetch: async () => [updated],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]?.name).toBe("New Name");
    expect(result.removedUids).toHaveLength(0);
  });

  it("returns removedUids and calls cache.remove for UIDs in cache but not in effective", async () => {
    const list = makeGroceryList();
    const store = new GroceryListStore();
    const { cache, remove } = makeCache([list]);
    const result = await syncReplaceAllEntity({
      fetch: async () => [],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    expect(result.removedUids).toHaveLength(1);
    expect(result.removedUids[0]).toBe(list.uid);
    expect(remove).toHaveBeenCalledWith(list.uid);
    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
  });

  it("excludes pending-upsert UIDs from incoming and splices them back from cache", async () => {
    const list = makeGroceryList({ name: "Local (pending)" });
    const serverVersion = { ...list, name: "Server (stale)" };
    const store = new GroceryListStore();
    store.markPendingUpsert(list.uid);
    const { cache } = makeCache([list]);
    const result = await syncReplaceAllEntity({
      fetch: async () => [serverVersion],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    // The local pending version must survive
    expect(store.get(list.uid)?.name).toBe("Local (pending)");
    // UID is not in removedUids (spliced back from cache)
    expect(result.removedUids).not.toContain(list.uid);
    // Not in added (was already in cache)
    expect(result.added.map((l) => l.uid)).not.toContain(list.uid);
  });

  it("excludes pending-delete UIDs from incoming", async () => {
    const list = makeGroceryList();
    const store = new GroceryListStore();
    store.load([list]);
    store.markPendingDelete(list.uid);
    const { cache } = makeCache([]);
    const result = await syncReplaceAllEntity({
      fetch: async () => [list],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    // Pending-delete UID was excluded from effective — not re-loaded
    expect(store.get(list.uid)).toBeUndefined();
    expect(result.added.map((l) => l.uid)).not.toContain(list.uid);
  });

  it("clears pending-upsert when rawIncoming equals the cached snapshot", async () => {
    const list = makeGroceryList();
    const store = new GroceryListStore();
    store.markPendingUpsert(list.uid);
    const { cache } = makeCache([list]);
    await syncReplaceAllEntity({
      fetch: async () => [list], // server caught up — same content
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    expect(store.isPendingUpsert(list.uid)).toBe(false);
  });

  it("does NOT clear pending-upsert when rawIncoming content differs from cached snapshot", async () => {
    const list = makeGroceryList({ name: "Local" });
    const staleServer = { ...list, name: "Old server version" };
    const store = new GroceryListStore();
    store.markPendingUpsert(list.uid);
    const { cache } = makeCache([list]);
    await syncReplaceAllEntity({
      fetch: async () => [staleServer],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    expect(store.isPendingUpsert(list.uid)).toBe(true);
  });

  it("calls afterLoad between store.load and cache.put loop", async () => {
    const list = makeGroceryList();
    const store = new GroceryListStore();
    const loadSpy = vi.spyOn(store, "load");
    const { cache, put } = makeCache([]);
    const afterLoadOrder: Array<string> = [];
    loadSpy.mockImplementation((...args) => {
      afterLoadOrder.push("load");
      return GroceryListStore.prototype.load.call(store, ...args);
    });
    put.mockImplementation(async () => {
      afterLoadOrder.push("put");
    });
    const afterLoad = vi.fn(() => {
      afterLoadOrder.push("afterLoad");
    });
    await syncReplaceAllEntity({
      fetch: async () => [list],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
      afterLoad,
    });
    const loadIdx = afterLoadOrder.indexOf("load");
    const afterLoadIdx = afterLoadOrder.indexOf("afterLoad");
    const putIdx = afterLoadOrder.indexOf("put");
    expect(loadIdx).toBeLessThan(afterLoadIdx);
    expect(afterLoadIdx).toBeLessThan(putIdx);
  });

  it("propagates errors from fetch", async () => {
    const store = new GroceryListStore();
    const { cache } = makeCache([]);
    await expect(
      syncReplaceAllEntity({
        fetch: async () => {
          throw new Error("network error");
        },
        cache,
        store,
        equals: listsEqual,
        label: "grocery lists",
        log: SILENT_LOG,
      }),
    ).rejects.toThrow("network error");
  });

  it("propagates errors from cache.getAll", async () => {
    const list = makeGroceryList();
    const store = new GroceryListStore();
    const cache: Pick<DiskCache<GList>, "getAll" | "put" | "remove"> = fromAny({
      getAll: vi.fn().mockRejectedValue(new Error("disk error")),
      put: vi.fn(),
      remove: vi.fn(),
    });
    await expect(
      syncReplaceAllEntity({
        fetch: async () => [list],
        cache,
        store,
        equals: listsEqual,
        label: "grocery lists",
        log: SILENT_LOG,
      }),
    ).rejects.toThrow("disk error");
  });
});
