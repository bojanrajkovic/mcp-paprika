#!/usr/bin/env node
/**
 * Test-specific server entry point that mocks PaprikaClient for E2E testing.
 *
 * This is spawned by e2e.test.integration.ts to test the MCP server
 * without needing real Paprika credentials.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DiskCache } from "./cache/disk-cache.js";
import { RecipeStore } from "./cache/recipe-store.js";
import { loadConfig } from "./utils/config.js";
import { getCacheDir } from "./utils/xdg.js";
import { registerSearchTool } from "./tools/search.js";
import { registerFilterTools } from "./tools/filter.js";
import { registerCategoryTools } from "./tools/categories.js";
import { registerReadTool } from "./tools/read.js";
import { registerCreateTool } from "./tools/create.js";
import { registerUpdateTool } from "./tools/update.js";
import { registerDeleteTool } from "./tools/delete.js";
import { registerListTool } from "./tools/list.js";
import { registerRecipeResources } from "./resources/recipes.js";
import { setupDiscoverFeature } from "./features/discover-feature.js";
import type { ServerContext } from "./types/server-context.js";
import type { Category, Recipe, RecipeEntry, RecipeUid, CategoryUid } from "./paprika/types.js";

function log(msg: string): void {
  process.stderr.write(`[mcp-paprika-test] ${msg}\n`);
}

// Mock PaprikaClient for testing
interface IMockPaprikaClient {
  authenticate(): Promise<void>;
  listRecipes(): Promise<Array<RecipeEntry>>;
  getRecipe(uid: string): Promise<Recipe>;
  getRecipes(uids: ReadonlyArray<string>): Promise<Array<Recipe>>;
  listCategories(): Promise<Array<Category>>;
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

  async authenticate(): Promise<void> {
    log("Mock authentication (no-op)");
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
  // 1. Load and validate config
  log("Loading configuration...");
  const configResult = loadConfig();
  const config = configResult.match(
    (cfg) => cfg,
    (err) => {
      throw err;
    },
  );

  // 2. Use mock client instead of real one
  log("Using mock Paprika client for testing...");
  const client = new MockPaprikaClient();
  await client.authenticate();
  log("Mock authentication complete.");

  // 3. Construct DiskCache and initialize
  log("Initializing disk cache...");
  const cache = new DiskCache(getCacheDir());
  await cache.init();

  // 4. Construct RecipeStore and hydrate from cache
  const store = new RecipeStore();
  const cachedRecipes = await cache.getAllRecipes();
  for (const recipe of cachedRecipes) {
    store.set(recipe);
  }
  log(`Hydrated store with ${cachedRecipes.length} cached recipes.`);

  // 5. Construct McpServer
  const server = new McpServer({
    name: "mcp-paprika",
    version: "0.0.0",
  });

  // 6. Assemble ServerContext
  const ctx: ServerContext = {
    client: client as unknown as ServerContext["client"],
    cache,
    store,
    server,
  };

  // 7. Register all tools
  registerSearchTool(server, ctx);
  registerFilterTools(server, ctx);
  registerCategoryTools(server, ctx);
  registerListTool(server, ctx);
  registerReadTool(server, ctx);
  registerCreateTool(server, ctx);
  registerUpdateTool(server, ctx);
  registerDeleteTool(server, ctx);
  log("Registered 8 tools.");

  // 8. Register recipe resources
  registerRecipeResources(server, ctx);
  log("Registered recipe resources.");

  // 9. Construct SyncEngine (but don't use real one, keep it minimal)
  // For testing, we skip the sync engine to avoid background polling
  log("Sync engine disabled for E2E testing.");

  // 10. Setup discover feature (if configured)
  if (config.features?.embeddings) {
    log("Setting up discover feature...");
    // Mock SyncEngine for discover feature
    const mockSync = {
      events: { on: () => {}, off: () => {} },
    } as unknown;
    await setupDiscoverFeature(server, ctx, mockSync as any, config);
  } else {
    log("Discover feature disabled (embeddings not configured).");
  }

  // 11. Register SIGINT handler
  process.on("SIGINT", () => {
    log("SIGINT received, shutting down...");
    process.exit(0);
  });

  // 12. Connect stdio transport
  log("Connecting stdio transport...");
  await server.connect(new StdioServerTransport());
  log("Server ready.");
}

main().catch((err) => {
  /* oxlint-disable-next-line no-console */
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
