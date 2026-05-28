import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PaprikaClient } from "./paprika/client.js";
import { AisleStore } from "./cache/aisle-store.js";
import { DiskCacheRoot } from "./cache/disk/index.js";
import { GroceryIngredientStore } from "./cache/grocery-ingredient-store.js";
import { GroceryItemStore } from "./cache/grocery-item-store.js";
import { GroceryListStore } from "./cache/grocery-list-store.js";
import { MealStore } from "./cache/meal-store.js";
import { MealTypeStore } from "./cache/meal-type-store.js";
import { RecipeStore } from "./cache/recipe-store.js";
import { PantryStore } from "./cache/pantry-store.js";
import { SyncEngine } from "./paprika/sync.js";
import { makeCategory, makeRecipe, makeSnakeCaseRecipe } from "./cache/__fixtures__/recipes.js";
import { makePantryItem, makeSnakeCasePantryItem } from "./cache/__fixtures__/pantry.js";
import type { PantryItem, PantryItemUid, RecipeUid } from "./paprika/types.js";
import { makeTestServer, makeCtx, getText } from "./tools/tool-test-utils.js";
import { registerSearchTool } from "./tools/search.js";
import { registerReadTool } from "./tools/read.js";
import { registerListTool } from "./tools/list.js";
import { registerFilterTools } from "./tools/filter.js";
import { registerCategoryTools } from "./tools/categories.js";
import { SILENT_LOG } from "./utils/log.js";

const API_BASE = "https://paprikaapp.com/api/v2/sync";

const server = setupServer();
let tempDir: string;

beforeAll(() => {
  server.listen();
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  // Create a unique temp directory for each test
  tempDir = await mkdtemp(join(tmpdir(), "paprika-sync-tool-"));
  server.resetHandlers();
  // Baseline handlers: always-empty endpoints every test needs. Individual tests
  // override only what they care about via server.use() (last-registered wins in MSW).
  server.use(
    http.get(`${API_BASE}/recipes/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/categories/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/groceryaisles/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/pantry/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/grocerylists/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/groceries/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/groceryingredients/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/mealtypes/`, () => HttpResponse.json({ result: [] })),
    http.get(`${API_BASE}/meals/`, () => HttpResponse.json({ result: [] })),
  );
});

afterEach(async () => {
  // Clean up temp directory
  await rm(tempDir, { recursive: true, force: true });
});

describe("Sync → Tool Pipeline Integration", () => {
  describe("AC1: Basic sync and query flow", () => {
    it("AC1.1: syncOnce() populates store, then tools query the synced data", async () => {
      // Setup MSW handlers for mock Paprika API
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          return HttpResponse.json({
            result: [
              { uid: "recipe-1", hash: "hash-1" },
              { uid: "recipe-2", hash: "hash-2" },
            ],
          });
        }),
        http.get(`${API_BASE}/recipe/:uid/`, ({ params }) => {
          const recipe = makeSnakeCaseRecipe(params["uid"] as string, {
            ingredients: params["uid"] === "recipe-1" ? "eggs, flour" : "chocolate, butter",
            name: params["uid"] === "recipe-1" ? "Scrambled Eggs" : "Chocolate Cake",
          });
          return HttpResponse.json({ result: recipe });
        }),
      );

      // Create real instances
      const client = new PaprikaClient("test@example.com", "password");
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();

      const store = new RecipeStore();
      const pantryStore = new PantryStore();
      const aisleStore = new AisleStore();
      const notifier = {
        resourceListChanged: () => {},
        loggingMessage: async () => {},
      };

      const context = {
        client,
        cache,
        store,
        pantryStore,
        aisleStore,
        groceryListStore: new GroceryListStore(),
        groceryItemStore: new GroceryItemStore(),
        groceryIngredientStore: new GroceryIngredientStore(),
        mealStore: new MealStore(),
        mealTypeStore: new MealTypeStore(),
        vectorStore: null,
        notifier,
        auth: null,
        log: SILENT_LOG,
      };

      const engine = new SyncEngine(context, 100);

      // Run one sync cycle
      await engine.syncOnce();

      // Verify store is populated
      expect(store.size).toBe(2);
      expect(store.get("recipe-1" as RecipeUid)?.name).toBe("Scrambled Eggs");
      expect(store.get("recipe-2" as RecipeUid)?.name).toBe("Chocolate Cake");

      // Setup test server and register tools
      const testServer = makeTestServer();
      registerSearchTool(testServer.server, makeCtx(store, testServer.server));
      registerReadTool(testServer.server, makeCtx(store, testServer.server));

      // Search tool should return synced recipes
      const searchResult = await testServer.callTool("search_recipes", {
        query: "chocolate",
        limit: 20,
      });
      expect(getText(searchResult)).toContain("Chocolate Cake");

      // Read tool should return synced recipe
      const readResult = await testServer.callTool("read_recipe", {
        lookup: { uid: "recipe-1" as RecipeUid },
      });
      expect(getText(readResult)).toContain("Scrambled Eggs");
    });

    it("AC1.2: search_recipes returns empty result when store is empty (before sync)", async () => {
      const store = new RecipeStore();
      const testServer = makeTestServer();
      registerSearchTool(testServer.server, makeCtx(store, testServer.server));

      // Before any sync, store is empty
      const result = await testServer.callTool("search_recipes", {
        query: "anything",
        limit: 20,
      });

      // Should return cold-start message, not crash
      const text = getText(result);
      expect(text.toLowerCase()).toContain("try again");
    });
  });

  describe("AC2: Multiple sync cycles with data changes", () => {
    it("AC2.1: Second sync adds new recipe, tools reflect the change", async () => {
      let syncCount = 0;

      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          // First sync: 1 recipe; second sync: 2 recipes
          const recipes =
            syncCount === 0
              ? [{ uid: "recipe-1", hash: "hash-1" }]
              : [
                  { uid: "recipe-1", hash: "hash-1" },
                  { uid: "recipe-2", hash: "hash-2-updated" },
                ];
          syncCount++;
          return HttpResponse.json({ result: recipes });
        }),
        http.get(`${API_BASE}/recipe/:uid/`, ({ params }) => {
          const recipe = makeSnakeCaseRecipe(params["uid"] as string, {
            name: params["uid"] === "recipe-1" ? "Pasta" : "Salad",
          });
          return HttpResponse.json({ result: recipe });
        }),
      );

      // Setup
      const client = new PaprikaClient("test@example.com", "password");
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const store = new RecipeStore();
      const pantryStore = new PantryStore();
      const aisleStore = new AisleStore();
      const notifier = {
        resourceListChanged: () => {},
        loggingMessage: async () => {},
      };

      const context = {
        client,
        cache,
        store,
        pantryStore,
        aisleStore,
        groceryListStore: new GroceryListStore(),
        groceryItemStore: new GroceryItemStore(),
        groceryIngredientStore: new GroceryIngredientStore(),
        mealStore: new MealStore(),
        mealTypeStore: new MealTypeStore(),
        vectorStore: null,
        notifier,
        auth: null,
        log: SILENT_LOG,
      };
      const engine = new SyncEngine(context, 100);

      // First sync
      await engine.syncOnce();
      expect(store.size).toBe(1);
      expect(store.get("recipe-1" as RecipeUid)?.name).toBe("Pasta");

      // Second sync should add recipe-2
      await engine.syncOnce();
      expect(store.size).toBe(2);
      expect(store.get("recipe-2" as RecipeUid)?.name).toBe("Salad");

      // Tools should find both recipes
      const testServer = makeTestServer();
      registerSearchTool(testServer.server, makeCtx(store, testServer.server));

      const searchResult = await testServer.callTool("search_recipes", {
        query: "salad",
        limit: 20,
      });
      expect(getText(searchResult)).toContain("Salad");
    });

    it("AC2.2: Second sync removes a recipe, tools no longer return it", async () => {
      let syncCount = 0;

      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          // First sync: 2 recipes; second sync: 1 recipe (recipe-2 removed)
          const recipes =
            syncCount === 0
              ? [
                  { uid: "recipe-1", hash: "hash-1" },
                  { uid: "recipe-2", hash: "hash-2" },
                ]
              : [{ uid: "recipe-1", hash: "hash-1" }];
          syncCount++;
          return HttpResponse.json({ result: recipes });
        }),
        http.get(`${API_BASE}/recipe/:uid/`, ({ params }) => {
          const recipe = makeSnakeCaseRecipe(params["uid"] as string, {
            name: params["uid"] === "recipe-1" ? "Pasta" : "Salad",
          });
          return HttpResponse.json({ result: recipe });
        }),
      );

      // Setup
      const client = new PaprikaClient("test@example.com", "password");
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const store = new RecipeStore();
      const pantryStore = new PantryStore();
      const aisleStore = new AisleStore();
      const notifier = {
        resourceListChanged: () => {},
        loggingMessage: async () => {},
      };

      const context = {
        client,
        cache,
        store,
        pantryStore,
        aisleStore,
        groceryListStore: new GroceryListStore(),
        groceryItemStore: new GroceryItemStore(),
        groceryIngredientStore: new GroceryIngredientStore(),
        mealStore: new MealStore(),
        mealTypeStore: new MealTypeStore(),
        vectorStore: null,
        notifier,
        auth: null,
        log: SILENT_LOG,
      };
      const engine = new SyncEngine(context, 100);

      // First sync: both recipes
      await engine.syncOnce();
      expect(store.size).toBe(2);

      // Second sync: only recipe-1
      await engine.syncOnce();
      expect(store.size).toBe(1);
      expect(store.get("recipe-1" as RecipeUid)).not.toBeUndefined();
      expect(store.get("recipe-2" as RecipeUid)).toBeUndefined();

      // Search should not find the deleted recipe
      const testServer = makeTestServer();
      registerSearchTool(testServer.server, makeCtx(store, testServer.server));

      const searchResult = await testServer.callTool("search_recipes", {
        query: "salad",
        limit: 20,
      });
      const text = getText(searchResult);
      expect(text.toLowerCase()).toContain("no recipes");
    });
  });

  describe("AC3: Tool variety after sync", () => {
    it("AC3.1: Multiple tools work with synced recipes (search, read, list, filter)", async () => {
      const category = makeCategory({ name: "Breakfast" });

      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          return HttpResponse.json({
            result: [
              { uid: "eggs", hash: "hash-eggs" },
              { uid: "toast", hash: "hash-toast" },
            ],
          });
        }),
        http.get(`${API_BASE}/recipe/:uid/`, ({ params }) => {
          let recipe;
          if (params["uid"] === "eggs") {
            recipe = makeSnakeCaseRecipe("eggs", {
              name: "Scrambled Eggs",
              ingredients: "eggs, butter, salt",
              categories: [category.uid],
            });
          } else {
            recipe = makeSnakeCaseRecipe("toast", {
              name: "French Toast",
              ingredients: "bread, eggs, milk",
              categories: [category.uid],
            });
          }
          return HttpResponse.json({ result: recipe });
        }),
        http.get(`${API_BASE}/categories/`, () => {
          return HttpResponse.json({
            result: [
              {
                uid: category.uid,
                name: category.name,
                order_flag: 1,
                parent_uid: null,
              },
            ],
          });
        }),
      );

      // Setup and sync
      const client = new PaprikaClient("test@example.com", "password");
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const store = new RecipeStore();
      const pantryStore = new PantryStore();
      const aisleStore = new AisleStore();
      const notifier = {
        resourceListChanged: () => {},
        loggingMessage: async () => {},
      };

      const context = {
        client,
        cache,
        store,
        pantryStore,
        aisleStore,
        groceryListStore: new GroceryListStore(),
        groceryItemStore: new GroceryItemStore(),
        groceryIngredientStore: new GroceryIngredientStore(),
        mealStore: new MealStore(),
        mealTypeStore: new MealTypeStore(),
        vectorStore: null,
        notifier,
        auth: null,
        log: SILENT_LOG,
      };
      const engine = new SyncEngine(context, 100);
      await engine.syncOnce();

      // Setup test server with multiple tools
      const testServer = makeTestServer();
      registerSearchTool(testServer.server, makeCtx(store, testServer.server));
      registerReadTool(testServer.server, makeCtx(store, testServer.server));
      registerListTool(testServer.server, makeCtx(store, testServer.server));
      registerFilterTools(testServer.server, makeCtx(store, testServer.server));
      registerCategoryTools(testServer.server, makeCtx(store, testServer.server));

      // Test search_recipes
      const searchResult = await testServer.callTool("search_recipes", {
        query: "eggs",
        limit: 20,
      });
      expect(getText(searchResult)).toContain("Scrambled Eggs");

      // Test read_recipe
      const readResult = await testServer.callTool("read_recipe", {
        lookup: { uid: "eggs" },
      });
      expect(getText(readResult)).toContain("Scrambled Eggs");
      expect(getText(readResult)).toContain("Breakfast");

      // Test list_categories
      const listResult = await testServer.callTool("list_categories", {});
      const listText = getText(listResult);
      expect(listText).toContain("Breakfast");
      expect(listText).toContain("2"); // 2 recipes in category

      // Test filter_by_ingredient
      const filterResult = await testServer.callTool("filter_by_ingredient", {
        ingredients: ["eggs"],
        mode: "any",
        limit: 20,
      });
      const filterText = getText(filterResult);
      expect(filterText).toContain("Scrambled Eggs");
      expect(filterText).toContain("French Toast");
    });
  });

  describe("AC4: Recipe mutation and sync", () => {
    it("AC4.1: Recipe changes during sync are reflected in tools", async () => {
      let recipeName = "Original Name";

      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          return HttpResponse.json({
            result: [{ uid: "recipe-1", hash: "hash-original" }],
          });
        }),
        http.get(`${API_BASE}/recipe/:uid/`, ({ params }) => {
          const recipe = makeSnakeCaseRecipe(params["uid"] as string, {
            name: recipeName,
          });
          return HttpResponse.json({ result: recipe });
        }),
      );

      // Setup
      const client = new PaprikaClient("test@example.com", "password");
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const store = new RecipeStore();
      const pantryStore = new PantryStore();
      const aisleStore = new AisleStore();
      const notifier = {
        resourceListChanged: () => {},
        loggingMessage: async () => {},
      };

      const context = {
        client,
        cache,
        store,
        pantryStore,
        aisleStore,
        groceryListStore: new GroceryListStore(),
        groceryItemStore: new GroceryItemStore(),
        groceryIngredientStore: new GroceryIngredientStore(),
        mealStore: new MealStore(),
        mealTypeStore: new MealTypeStore(),
        vectorStore: null,
        notifier,
        auth: null,
        log: SILENT_LOG,
      };
      const engine = new SyncEngine(context, 100);

      // First sync with original name
      await engine.syncOnce();
      expect(store.get("recipe-1" as RecipeUid)?.name).toBe("Original Name");

      // Update the mock API to return a new name
      recipeName = "Updated Name";

      // Force a new hash to trigger update detection
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          return HttpResponse.json({
            result: [{ uid: "recipe-1", hash: "hash-updated" }],
          });
        }),
      );

      // Second sync should update the recipe
      await engine.syncOnce();
      expect(store.get("recipe-1" as RecipeUid)?.name).toBe("Updated Name");

      // Tool should reflect the updated name
      const testServer = makeTestServer();
      registerSearchTool(testServer.server, makeCtx(store, testServer.server));

      const searchResult = await testServer.callTool("search_recipes", {
        query: "updated",
        limit: 20,
      });
      expect(getText(searchResult)).toContain("Updated Name");
    });
  });

  describe("AC5: Write→sync propagation race protection (issue #57)", () => {
    function makeRaceContext(): {
      client: PaprikaClient;
      cache: DiskCacheRoot;
      store: RecipeStore;
      pantryStore: PantryStore;
      engine: SyncEngine;
    } {
      const client = new PaprikaClient("test@example.com", "password");
      const cache = new DiskCacheRoot(tempDir);
      const store = new RecipeStore();
      const pantryStore = new PantryStore();
      const aisleStore = new AisleStore();
      const notifier = {
        resourceListChanged: () => {},
        loggingMessage: async (): Promise<void> => {},
      };
      const context = {
        client,
        cache,
        store,
        pantryStore,
        aisleStore,
        groceryListStore: new GroceryListStore(),
        groceryItemStore: new GroceryItemStore(),
        groceryIngredientStore: new GroceryIngredientStore(),
        mealStore: new MealStore(),
        mealTypeStore: new MealTypeStore(),
        vectorStore: null,
        notifier,
        auth: null,
        log: SILENT_LOG,
      };
      const engine = new SyncEngine(context, 100);
      return { client, cache, store, pantryStore, engine };
    }

    it("AC5.1: pantry upsert is not orphaned by a sync with stale (pre-write) canonical list", async () => {
      // The stale canonical list is empty (Paprika hadn't propagated our write
      // when sync's listPantry was issued). Without protection, sync would
      // treat our just-upserted UID as an orphan and remove it locally.

      const { cache, pantryStore, engine } = makeRaceContext();
      await cache.init();

      const item = makePantryItem({ uid: "PANTRY-UID-1" as PantryItemUid, ingredient: "Eggs" });
      pantryStore.load([item]);
      await cache.pantry.put(item);
      await cache.flush();
      pantryStore.markPendingUpsert(item.uid);

      await engine.syncOnce();

      expect(pantryStore.get(item.uid)).toEqual(item);
      expect(pantryStore.size).toBe(1);
    });

    it("AC5.2: pantry delete is not resurrected by a sync with stale (pre-delete) canonical list", async () => {
      const stalePantryWire = makeSnakeCasePantryItem("PANTRY-UID-2", { ingredient: "Eggs" });
      server.use(http.get(`${API_BASE}/pantry/`, () => HttpResponse.json({ result: [stalePantryWire] })));

      const { pantryStore, cache, engine } = makeRaceContext();
      await cache.init();

      const uid = "PANTRY-UID-2" as PantryItemUid;
      pantryStore.load([]);
      pantryStore.markPendingDelete(uid);

      await engine.syncOnce();

      expect(pantryStore.get(uid)).toBeUndefined();
      expect(pantryStore.size).toBe(0);
    });

    it("AC5.3: recipe upsert is not removed by a sync with stale (pre-write) canonical list", async () => {
      const { cache, store, engine } = makeRaceContext();
      await cache.init();

      const recipe = makeRecipe({ uid: "recipe-just-written" as RecipeUid, name: "Just Written", hash: "hash-new" });
      await cache.recipes.put(recipe);
      await cache.flush();
      store.set(recipe);
      store.markPendingUpsert(recipe.uid);

      await engine.syncOnce();

      expect(store.get(recipe.uid)?.name).toBe("Just Written");
      expect(store.size).toBe(1);
    });

    it("AC5.4: recipe soft-delete (inTrash) is not resurrected by a sync with stale canonical list", async () => {
      // The stale canonical list still contains the recipe with its pre-trash
      // hash. Without protection, sync would diff.changed and re-fetch the
      // non-trashed version, undoing our local trash.
      server.use(
        http.get(`${API_BASE}/recipes/`, () =>
          HttpResponse.json({ result: [{ uid: "recipe-trashed", hash: "hash-pre-trash" }] }),
        ),
        http.get(`${API_BASE}/recipe/:uid/`, ({ params }) =>
          HttpResponse.json({
            result: makeSnakeCaseRecipe(params["uid"] as string, { name: "Pre-Trash Version", in_trash: false }),
          }),
        ),
      );

      const { cache, store, engine } = makeRaceContext();
      await cache.init();

      const trashedRecipe = makeRecipe({
        uid: "recipe-trashed" as RecipeUid,
        name: "Pre-Trash Version",
        hash: "hash-post-trash",
        inTrash: true,
      });
      await cache.recipes.put(trashedRecipe);
      await cache.flush();
      store.set(trashedRecipe);
      store.markPendingDelete(trashedRecipe.uid);

      await engine.syncOnce();

      // Local "trashed" state should survive the sync — diff.changed for this
      // UID is filtered out by the pending-delete guard.
      expect(store.get(trashedRecipe.uid)?.inTrash).toBe(true);
    });

    it("AC5.6: pantry pending-upsert clears on content match (not UID match alone)", async () => {
      // Codex P1: clearing pending-upsert on UID presence drops protection for
      // updates, since the UID is already in listPantry with pre-write content.
      // This test guards against that regression for the update path.
      const { cache, pantryStore, engine } = makeRaceContext();
      await cache.init();

      // Match makeSnakeCasePantryItem's defaults so pantryItemsEqual can return true
      // when the wire item matches our local content.
      const updated = makePantryItem({
        uid: "PANTRY-UPDATE" as PantryItemUid,
        ingredient: "Eggs",
        quantity: "2 dozen",
        aisle: "",
        aisleUid: "" as PantryItem["aisleUid"],
        purchaseDate: "2026-05-21 00:00:00",
      });
      pantryStore.load([updated]);
      await cache.pantry.put(updated);
      await cache.flush();
      pantryStore.markPendingUpsert(updated.uid);

      // First sync: canonical list returns the pre-write version (different quantity).
      const wireDefaults = { ingredient: "Eggs", purchase_date: "2026-05-21 00:00:00" };
      const stalePantryWire = makeSnakeCasePantryItem("PANTRY-UPDATE", { ...wireDefaults, quantity: "1 dozen" });
      server.use(http.get(`${API_BASE}/pantry/`, () => HttpResponse.json({ result: [stalePantryWire] })));
      await engine.syncOnce();
      // Pending-upsert must still be set — content didn't match.
      expect(pantryStore.isPendingUpsert(updated.uid)).toBe(true);
      expect(pantryStore.get(updated.uid)?.quantity).toBe("2 dozen");

      // Second sync: canonical list now matches our local content.
      const propagatedWire = makeSnakeCasePantryItem("PANTRY-UPDATE", { ...wireDefaults, quantity: "2 dozen" });
      server.use(http.get(`${API_BASE}/pantry/`, () => HttpResponse.json({ result: [propagatedWire] })));
      await engine.syncOnce();
      // Pending-upsert cleared because content matched.
      expect(pantryStore.isPendingUpsert(updated.uid)).toBe(false);
      expect(pantryStore.get(updated.uid)?.quantity).toBe("2 dozen");
    });

    it("AC5.7: recipe pending-upsert clears on hash match (not UID match alone)", async () => {
      // Codex P1: same regression guard for recipes — UID is in entries with
      // pre-write hash while propagation is in flight.
      const { cache, store, engine } = makeRaceContext();
      await cache.init();

      const recipe = makeRecipe({ uid: "recipe-edit" as RecipeUid, name: "After Edit", hash: "hash-new" });
      await cache.recipes.put(recipe);
      await cache.flush();
      store.set(recipe);
      store.markPendingUpsert(recipe.uid);

      // First sync: canonical entries return the pre-write hash.
      server.use(
        http.get(`${API_BASE}/recipes/`, () =>
          HttpResponse.json({ result: [{ uid: "recipe-edit", hash: "hash-old" }] }),
        ),
        http.get(`${API_BASE}/recipe/:uid/`, ({ params }) =>
          HttpResponse.json({ result: makeSnakeCaseRecipe(params["uid"] as string, { name: "Before Edit" }) }),
        ),
      );
      await engine.syncOnce();
      // Pending-upsert must still be set — hash didn't match.
      expect(store.isPendingUpsert(recipe.uid)).toBe(true);
      expect(store.get(recipe.uid)?.name).toBe("After Edit");

      // Second sync: canonical entries now have our hash.
      server.use(
        http.get(`${API_BASE}/recipes/`, () =>
          HttpResponse.json({ result: [{ uid: "recipe-edit", hash: "hash-new" }] }),
        ),
      );
      await engine.syncOnce();
      // Pending-upsert cleared because hash matched.
      expect(store.isPendingUpsert(recipe.uid)).toBe(false);
      expect(store.get(recipe.uid)?.name).toBe("After Edit");
    });

    it("AC5.5: TTL fallback eventually clears pending-deletes after expiry", async () => {
      // Use a tiny TTL so we don't have to wait. After the TTL elapses and
      // sweepPending runs (called at end of syncOnce), pending-delete clears
      // and the next sync reconciles canonical state normally.
      const client = new PaprikaClient("test@example.com", "password");
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const store = new RecipeStore({ pendingWriteTtlMs: 50 });
      const pantryStore = new PantryStore({ pendingWriteTtlMs: 50 });
      const aisleStore = new AisleStore();
      const notifier = { resourceListChanged: () => {}, loggingMessage: async (): Promise<void> => {} };
      const context = {
        client,
        cache,
        store,
        pantryStore,
        aisleStore,
        groceryListStore: new GroceryListStore(),
        groceryItemStore: new GroceryItemStore(),
        groceryIngredientStore: new GroceryIngredientStore(),
        mealStore: new MealStore(),
        mealTypeStore: new MealTypeStore(),
        vectorStore: null,
        notifier,
        auth: null,
        log: SILENT_LOG,
      };
      const engine = new SyncEngine(context, 100);

      const stalePantryWire = makeSnakeCasePantryItem("PANTRY-UID-3", { ingredient: "Milk" });
      server.use(http.get(`${API_BASE}/pantry/`, () => HttpResponse.json({ result: [stalePantryWire] })));

      const uid = "PANTRY-UID-3" as PantryItemUid;
      pantryStore.load([]);
      pantryStore.markPendingDelete(uid, Date.now() - 1000); // pre-aged past TTL

      // First sync: filters the incoming, but then sweepPending evicts the stale entry.
      await engine.syncOnce();
      expect(pantryStore.size).toBe(0); // first sync still protected before sweep

      // Second sync: pending-delete is gone (swept), now sync reflects canonical state.
      await engine.syncOnce();
      expect(pantryStore.size).toBe(1);
      expect(pantryStore.get(uid)?.ingredient).toBe("Milk");
    });
  });
});
