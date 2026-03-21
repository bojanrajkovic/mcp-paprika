import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PaprikaClient } from "./paprika/client.js";
import { DiskCache } from "./cache/disk-cache.js";
import { RecipeStore } from "./cache/recipe-store.js";
import { SyncEngine } from "./paprika/sync.js";
import { makeCategory } from "./cache/__fixtures__/recipes.js";
import type { RecipeUid } from "./paprika/types.js";
import { makeTestServer, makeCtx, getText } from "./tools/tool-test-utils.js";
import { registerSearchTool } from "./tools/search.js";
import { registerReadTool } from "./tools/read.js";
import { registerListTool } from "./tools/list.js";
import { registerFilterTools } from "./tools/filter.js";
import { registerCategoryTools } from "./tools/categories.js";

const API_BASE = "https://paprikaapp.com/api/v2/sync";

function makeSnakeCaseRecipe(uid: string, overrides?: Partial<Record<string, unknown>>): object {
  return {
    uid,
    hash: `hash-${uid}`,
    name: `Recipe ${uid}`,
    categories: [],
    ingredients: "eggs, flour",
    directions: "Mix and bake.",
    description: null,
    notes: null,
    prep_time: null,
    cook_time: null,
    total_time: null,
    servings: null,
    difficulty: null,
    rating: 0,
    created: "2024-01-01T00:00:00Z",
    image_url: "",
    photo: null,
    photo_hash: null,
    photo_large: null,
    photo_url: null,
    source: null,
    source_url: null,
    on_favorites: false,
    in_trash: false,
    is_pinned: false,
    on_grocery_list: false,
    scale: null,
    nutritional_info: null,
    ...overrides,
  };
}

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
          const recipe = makeSnakeCaseRecipe(params.uid as string, {
            ingredients: params.uid === "recipe-1" ? "eggs, flour" : "chocolate, butter",
            name: params.uid === "recipe-1" ? "Scrambled Eggs" : "Chocolate Cake",
          });
          return HttpResponse.json({ result: recipe });
        }),
        http.get(`${API_BASE}/categories/`, () => {
          return HttpResponse.json({ result: [] });
        }),
      );

      // Create real instances
      const client = new PaprikaClient("test@example.com", "password");
      const cache = new DiskCache(tempDir);
      await cache.init();

      const store = new RecipeStore();
      const mockServer = {
        sendLoggingMessage: async () => {},
        sendResourceListChanged: () => {},
      };

      const context = {
        client,
        cache,
        store,
        server: mockServer,
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
        uid: "recipe-1" as RecipeUid,
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
          const recipe = makeSnakeCaseRecipe(params.uid as string, {
            name: params.uid === "recipe-1" ? "Pasta" : "Salad",
          });
          return HttpResponse.json({ result: recipe });
        }),
        http.get(`${API_BASE}/categories/`, () => {
          return HttpResponse.json({ result: [] });
        }),
      );

      // Setup
      const client = new PaprikaClient("test@example.com", "password");
      const cache = new DiskCache(tempDir);
      await cache.init();
      const store = new RecipeStore();
      const mockServer = {
        sendLoggingMessage: async () => {},
        sendResourceListChanged: () => {},
      };

      const context = { client, cache, store, server: mockServer };
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
          const recipe = makeSnakeCaseRecipe(params.uid as string, {
            name: params.uid === "recipe-1" ? "Pasta" : "Salad",
          });
          return HttpResponse.json({ result: recipe });
        }),
        http.get(`${API_BASE}/categories/`, () => {
          return HttpResponse.json({ result: [] });
        }),
      );

      // Setup
      const client = new PaprikaClient("test@example.com", "password");
      const cache = new DiskCache(tempDir);
      await cache.init();
      const store = new RecipeStore();
      const mockServer = {
        sendLoggingMessage: async () => {},
        sendResourceListChanged: () => {},
      };

      const context = { client, cache, store, server: mockServer };
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
          if (params.uid === "eggs") {
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
      const cache = new DiskCache(tempDir);
      await cache.init();
      const store = new RecipeStore();
      const mockServer = {
        sendLoggingMessage: async () => {},
        sendResourceListChanged: () => {},
      };

      const context = { client, cache, store, server: mockServer };
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
        uid: "eggs",
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
          const recipe = makeSnakeCaseRecipe(params.uid as string, {
            name: recipeName,
          });
          return HttpResponse.json({ result: recipe });
        }),
        http.get(`${API_BASE}/categories/`, () => {
          return HttpResponse.json({ result: [] });
        }),
      );

      // Setup
      const client = new PaprikaClient("test@example.com", "password");
      const cache = new DiskCache(tempDir);
      await cache.init();
      const store = new RecipeStore();
      const mockServer = {
        sendLoggingMessage: async () => {},
        sendResourceListChanged: () => {},
      };

      const context = { client, cache, store, server: mockServer };
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
});
