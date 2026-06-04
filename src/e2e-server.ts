#!/usr/bin/env node
/**
 * Test-specific server entry point that mocks PaprikaClient for E2E testing.
 *
 * Spawned by e2e.test.integration.ts to test the MCP server without real Paprika
 * credentials. It builds the REAL kernel (`buildKernel` + `registerAll`) so the e2e
 * path exercises the same composition as production stdio/http — only the Paprika
 * client is a mock and the background sync INTERVAL loop is not started. `buildKernel`
 * still runs ONE initial sync against the mock, and that is what populates the stores.
 *
 * The mock implements every list/get method the initial sync calls; recipes, the one
 * category, and the one pantry item come back as data and everything else empty, so
 * after the initial sync the stores hold exactly that (matching the prior direct-seed).
 * `features` is forced off (so discover_recipes + generate_recipe_photo register but
 * decline — the kernel gates them inside the tool — and nothing touches the network).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { Aisle } from "./aisle/types.js";
import type { Category } from "./category/types.js";
import type { GroceryIngredient } from "./grocery-ingredient/types.js";
import type { GroceryItem } from "./grocery-item/types.js";
import type { GroceryList } from "./grocery-list/types.js";
import type { AisleUid, CategoryUid, PantryItemUid, RecipeUid } from "./ids.js";
import type { MealType } from "./meal-type/types.js";
import type { Meal } from "./meal/types.js";
import type { MenuItem } from "./menu-item/types.js";
import type { Menu } from "./menu/types.js";
import type { PantryItem } from "./pantry/types.js";
import type { PaprikaClient } from "./paprika/client.js";
import type { Photo } from "./photo/types.js";
import type { Recipe, RecipeEntry } from "./recipe/types.js";

import { GeneratedImageStore } from "./features/generated-image-store.js";
import { buildKernel } from "./kernel/registry.js";
import { buildBrandedServer } from "./server/build.js";
import { createIndexEvents } from "./server/index-events.js";
import { createServerRef, singleServerNotifier } from "./server/notifier.js";
import { loadConfig } from "./utils/config.js";
import { createLogger, toMessage } from "./utils/log.js";
import { getCacheDir } from "./utils/xdg.js";
// Side-effect: every domain/feature module self-registers on import.
import "./kernel/modules.generated.js";

interface IMockPaprikaClient {
  authenticate(): Promise<void>;
  listRecipes(): Promise<Array<RecipeEntry>>;
  getRecipe(uid: string): Promise<Recipe>;
  getRecipes(uids: ReadonlyArray<string>): Promise<Array<Recipe>>;
  listCategories(): Promise<Array<Category>>;
  listAisles(): Promise<Array<Aisle>>;
  listPantry(): Promise<Array<PantryItem>>;
  listGroceryLists(): Promise<Array<GroceryList>>;
  listGroceryItems(): Promise<Array<GroceryItem>>;
  listGroceryIngredients(): Promise<Array<GroceryIngredient>>;
  listMealTypes(): Promise<Array<MealType>>;
  listMeals(): Promise<Array<Meal>>;
  listMenus(): Promise<Array<Menu>>;
  listMenuItems(): Promise<Array<MenuItem>>;
  listPhotos(): Promise<Array<Photo>>;
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
    deleted: false,
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
    aisleUid: "aisle-1" as AisleUid,
    expirationDate: null,
    hasExpiration: false,
    inStock: true,
    purchaseDate: null,
    notes: null,
    deleted: false,
  };

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

  // Everything else the initial sync reconciles returns empty — after the sync the
  // stores hold only the seeded recipe, category, and pantry item.
  async listAisles(): Promise<Array<Aisle>> {
    return [];
  }

  async listGroceryLists(): Promise<Array<GroceryList>> {
    return [];
  }

  async listGroceryItems(): Promise<Array<GroceryItem>> {
    return [];
  }

  async listGroceryIngredients(): Promise<Array<GroceryIngredient>> {
    return [];
  }

  async listMealTypes(): Promise<Array<MealType>> {
    return [];
  }

  async listMeals(): Promise<Array<Meal>> {
    return [];
  }

  async listMenus(): Promise<Array<Menu>> {
    return [];
  }

  async listMenuItems(): Promise<Array<MenuItem>> {
    return [];
  }

  async listPhotos(): Promise<Array<Photo>> {
    return [];
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
  // A ServerRef breaks the notifier/server cycle (see src/server/notifier.ts).
  // Created at the top of main() so log/notifier exist before any log call.
  const serverRef = createServerRef();
  const notifier = singleServerNotifier(serverRef.get);

  const log = createLogger({
    transport: "stdio",
    notifier,
    level: "info", // e2e startup messages should be visible
    notifyLevel: "fatal",
    pretty: true,
  }).child({ component: "e2e" });

  // Force features OFF regardless of ambient env: OPENAI_API_KEY / IMAGE_GEN_API_KEY
  // would otherwise enable embeddings/image-gen and make discover + generate_recipe_photo
  // try to hit the network. Dropping the `features` key (it is optional) leaves
  // `config.features?.…` undefined, so both feature modules build null components and
  // their tools register-but-decline. The test isolates XDG_CONFIG_HOME so no real
  // config.json bleeds in; env still supplies the (mock-satisfied) Paprika credentials.
  const { features: _features, ...config } = loadConfig().match(
    (c) => c,
    (err) => {
      throw new Error(`e2e config load failed: ${toMessage(err)}`);
    },
  );

  log.info("using mock Paprika client for testing");
  const client = new MockPaprikaClient();
  await client.authenticate();
  log.info("mock authentication complete");

  // Build the real kernel against the mock client. buildKernel runs ONE initial sync
  // internally (populating the stores from the mock); the interval loop is intentionally
  // NOT started for the e2e round-trip.
  const indexEvents = createIndexEvents(log);
  const kernel = await buildKernel({
    client: client as unknown as PaprikaClient,
    cacheDir: getCacheDir(),
    notifier,
    log,
    config,
    indexEvents,
    generatedImageStore: new GeneratedImageStore(),
  });

  const server = buildBrandedServer();
  kernel.registerAll(server);
  serverRef.set(server);
  log.info("registered tools and resources via the kernel");
  log.info("background sync loop disabled for E2E testing (initial sync ran once)");

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
