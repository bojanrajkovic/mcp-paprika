#!/usr/bin/env node
/**
 * Test-specific server entry point that mocks PaprikaClient for E2E testing.
 *
 * This is spawned by e2e.test.integration.ts to test the MCP server
 * without needing real Paprika credentials. Reuses `buildMcpServer` for
 * tool/resource registration so production and e2e paths share the same
 * wiring. Sync is intentionally disabled; vectorStore is `null` (the
 * discover tool is gated on its presence, matching the prior 10-tool
 * subset semantics asserted by `e2e.test.integration.ts`).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AisleStore } from "./cache/aisle-store.js";
import { DiskCacheRoot } from "./cache/disk/index.js";
import { RecipeStore } from "./cache/recipe-store.js";
import { PantryStore } from "./cache/pantry-store.js";
import { buildMcpServer } from "./server/build.js";
import type { AppContext } from "./server/app-context.js";
import { singleServerNotifier } from "./server/notifier.js";
import { getCacheDir } from "./utils/xdg.js";
import { createLogger, toMessage } from "./utils/log.js";
import type {
  Category,
  Recipe,
  RecipeEntry,
  RecipeUid,
  CategoryUid,
  PantryItem,
  PantryItemUid,
} from "./paprika/types.js";

interface IMockPaprikaClient {
  authenticate(): Promise<void>;
  listRecipes(): Promise<Array<RecipeEntry>>;
  getRecipe(uid: string): Promise<Recipe>;
  getRecipes(uids: ReadonlyArray<string>): Promise<Array<Recipe>>;
  listCategories(): Promise<Array<Category>>;
  listPantry(): Promise<Array<PantryItem>>;
  saveRecipe(recipe: Readonly<Recipe>): Promise<Recipe>;
  deleteRecipe(uid: RecipeUid): Promise<void>;
  notifySync(): Promise<void>;
}

class MockPaprikaClient implements IMockPaprikaClient {
  private mockRecipe: Recipe = {
    uid: "test-recipe-1" as RecipeUid,
    hash: "hash-123",
    name: "Test Recipe",
    categories: [],
    ingredients: "test ingredients",
    directions: "test directions",
    description: "A test recipe",
    notes: null,
    prepTime: null,
    cookTime: null,
    totalTime: null,
    servings: null,
    difficulty: null,
    rating: 0,
    created: "2024-01-01T00:00:00Z",
    imageUrl: null,
    photo: null,
    photoHash: null,
    photoLarge: null,
    photoUrl: null,
    source: null,
    sourceUrl: null,
    onFavorites: false,
    inTrash: false,
    isPinned: false,
    onGroceryList: false,
    scale: null,
    nutritionalInfo: null,
  };

  private mockCategory: Category = {
    uid: "cat-1" as CategoryUid,
    name: "Main Dishes",
    orderFlag: 0,
    parentUid: null,
  };

  private mockPantryItem: PantryItem = {
    uid: "pantry-1" as PantryItemUid,
    ingredient: "Flour",
    quantity: "2 lbs",
    aisle: "Baking",
    aisleUid: "aisle-1",
    expirationDate: null,
    hasExpiration: false,
    inStock: true,
    purchaseDate: null,
    notes: null,
    deleted: false,
  };

  getMockRecipe(): Recipe {
    return this.mockRecipe;
  }

  getMockCategory(): Category {
    return this.mockCategory;
  }

  getMockPantryItem(): PantryItem {
    return this.mockPantryItem;
  }

  async authenticate(): Promise<void> {
    // no-op
  }

  async listRecipes(): Promise<Array<RecipeEntry>> {
    return [{ uid: "test-recipe-1" as RecipeUid, hash: "hash-123" }];
  }

  async getRecipe(_uid: string): Promise<Recipe> {
    return this.mockRecipe;
  }

  async getRecipes(_uids: ReadonlyArray<string>): Promise<Array<Recipe>> {
    return [this.mockRecipe];
  }

  async listCategories(): Promise<Array<Category>> {
    return [this.mockCategory];
  }

  async listPantry(): Promise<Array<PantryItem>> {
    return [this.mockPantryItem];
  }

  async saveRecipe(recipe: Readonly<Recipe>): Promise<Recipe> {
    return recipe as Recipe;
  }

  async deleteRecipe(_uid: RecipeUid): Promise<void> {
    // no-op
  }

  async notifySync(): Promise<void> {
    // no-op
  }
}

async function main(): Promise<void> {
  // Deferred-getter notifier (see src/index.ts for the rationale).
  // Hoisted to top of main() so log can reference notifier and log calls
  // below do not hit the TDZ.
  let server: McpServer | undefined;
  const notifier = singleServerNotifier(() => server);

  const log = createLogger({
    transport: "stdio",
    notifier,
    level: "info", // e2e startup messages should be visible
    notifyLevel: "fatal",
    pretty: true,
  }).child({ component: "e2e" });

  log.info("using mock Paprika client for testing");
  const client = new MockPaprikaClient();
  await client.authenticate();
  log.info("mock authentication complete");

  log.info("initializing disk cache");
  const cache = new DiskCacheRoot(getCacheDir(), log.child({ component: "disk-cache" }));
  await cache.init();

  const store = new RecipeStore();
  const cachedRecipes = await cache.recipes.getAll();
  for (const recipe of cachedRecipes) {
    store.set(recipe);
  }
  store.set(client.getMockRecipe());
  store.setCategories([client.getMockCategory()]);
  log.info({ count: store.size }, "hydrated recipe store");

  const pantryStore = new PantryStore();
  pantryStore.load([client.getMockPantryItem()]);
  log.info("hydrated pantry store with mock data");

  const aisleStore = new AisleStore();
  aisleStore.load([]);

  const app: AppContext = {
    client: client as unknown as AppContext["client"],
    cache,
    store,
    pantryStore,
    aisleStore,
    vectorStore: null, // discover tool intentionally not registered (no embeddings in e2e)
    notifier,
    auth: null,
    log,
  };

  server = buildMcpServer(app);
  log.info("registered tools and resources via buildMcpServer");
  log.info("sync engine disabled for E2E testing");

  process.on("SIGINT", () => {
    log.info("SIGINT received, shutting down");
    process.exit(0);
  });

  log.info("connecting stdio transport");
  await server.connect(new StdioServerTransport());
  log.info("server ready");
}

main().catch((err: unknown) => {
  process.stderr.write(`${toMessage(err)}\n`);
  process.exit(1);
});
