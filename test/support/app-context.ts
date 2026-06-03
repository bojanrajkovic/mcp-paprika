import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { DiskCacheRoot } from "../../src/cache/disk-cache-root.js";
import type { PaprikaClient } from "../../src/paprika/client.js";
import type { AppContext, SessionContext } from "../../src/server/app-context.js";

import { AisleStore } from "../../src/aisle/store.js";
import { CategoryStore } from "../../src/category/store.js";
import { GeneratedImageStore } from "../../src/features/generated-image-store.js";
import { GroceryIngredientStore } from "../../src/grocery-ingredient/store.js";
import { GroceryItemStore } from "../../src/grocery-item/store.js";
import { GroceryListStore } from "../../src/grocery-list/store.js";
import { MealTypeStore } from "../../src/meal-type/store.js";
import { MealStore } from "../../src/meal/store.js";
import { MenuItemStore } from "../../src/menu-item/store.js";
import { MenuStore } from "../../src/menu/store.js";
import { PantryStore } from "../../src/pantry/store.js";
import { PhotoStore } from "../../src/photo/store.js";
import { RecipeStore } from "../../src/recipe/store.js";
import { SILENT_LOG } from "../../src/utils/log.js";

/**
 * Single source of truth for a test {@link AppContext}. Every field is given a
 * sensible default — real empty stores, a no-op notifier, a silent logger, and
 * minimal `client`/`cache` stubs — and `overrides` is spread on top.
 *
 * This is the ONE place a new `AppContext` field has to be added when an entity
 * is introduced: tests that don't care about it inherit the default rather than
 * re-listing every field inline. `client` and `cache` default to empty casts
 * (the historical test convention); any test exercising them passes a mock via
 * `overrides`.
 */
export function makeAppContext(overrides: Partial<AppContext> = {}): AppContext {
  const base: AppContext = {
    client: {} as unknown as PaprikaClient,
    cache: {} as unknown as DiskCacheRoot,
    store: new RecipeStore(),
    categoryStore: new CategoryStore(),
    pantryStore: new PantryStore(),
    aisleStore: new AisleStore(),
    groceryListStore: new GroceryListStore(),
    groceryItemStore: new GroceryItemStore(),
    groceryIngredientStore: new GroceryIngredientStore(),
    mealStore: new MealStore(),
    mealTypeStore: new MealTypeStore(),
    menuStore: new MenuStore(),
    menuItemStore: new MenuItemStore(),
    photoStore: new PhotoStore(),
    generatedImageStore: new GeneratedImageStore(),
    vectorStore: null,
    photographyClient: null,
    notifier: {
      resourceListChanged: () => {},
      loggingMessage: async () => {},
    },
    auth: null,
    log: SILENT_LOG,
  };
  return { ...base, ...overrides };
}

/**
 * {@link makeAppContext} plus a `server` (defaulting to an empty stub) for tests
 * that need a full {@link SessionContext}/`ServerContext`. Pass `server` in
 * `overrides` to supply a real or captured `McpServer`.
 */
export function makeServerContext(overrides: Partial<SessionContext> = {}): SessionContext {
  const { server, ...appOverrides } = overrides;
  return {
    ...makeAppContext(appOverrides),
    server: server ?? ({} as unknown as McpServer),
  };
}
