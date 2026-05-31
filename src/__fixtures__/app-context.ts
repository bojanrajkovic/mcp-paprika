import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AisleStore } from "../cache/aisle-store.js";
import { GroceryIngredientStore } from "../cache/grocery-ingredient-store.js";
import { GroceryItemStore } from "../cache/grocery-item-store.js";
import { GroceryListStore } from "../cache/grocery-list-store.js";
import { MealStore } from "../cache/meal-store.js";
import { MealTypeStore } from "../cache/meal-type-store.js";
import { MenuStore } from "../cache/menu-store.js";
import { MenuItemStore } from "../cache/menu-item-store.js";
import { PantryStore } from "../cache/pantry-store.js";
import { PhotoStore } from "../cache/photo-store.js";
import { RecipeStore } from "../cache/recipe-store.js";
import type { AppContext, SessionContext } from "../server/app-context.js";
import type { DiskCacheRoot } from "../cache/disk/index.js";
import type { PaprikaClient } from "../paprika/client.js";
import { SILENT_LOG } from "../utils/log.js";

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
    vectorStore: null,
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
