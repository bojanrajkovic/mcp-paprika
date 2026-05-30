import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AisleStore } from "../cache/aisle-store.js";
import { DiskCacheRoot } from "../cache/disk/index.js";
import { GroceryIngredientStore } from "../cache/grocery-ingredient-store.js";
import { GroceryItemStore } from "../cache/grocery-item-store.js";
import { GroceryListStore } from "../cache/grocery-list-store.js";
import { MealStore } from "../cache/meal-store.js";
import { MealTypeStore } from "../cache/meal-type-store.js";
import { MenuStore } from "../cache/menu-store.js";
import { MenuItemStore } from "../cache/menu-item-store.js";
import { PantryStore } from "../cache/pantry-store.js";
import { RecipeStore } from "../cache/recipe-store.js";
import { buildDiscoverComponents } from "../features/discover-feature.js";
import { PaprikaClient } from "../paprika/client.js";
import { SyncEngine } from "../paprika/sync.js";
import { registerCategoryTools } from "../tools/categories.js";
import { registerCreateTool } from "../tools/create.js";
import { registerDeleteTool } from "../tools/delete.js";
import { registerDiscoverTool } from "../tools/discover.js";
import { registerFilterTools } from "../tools/filter.js";
import { registerListTool } from "../tools/list.js";
import { registerAislesTool } from "../tools/aisles.js";
import { registerMealTypesTool } from "../tools/meal-types.js";
import {
  registerCreateGroceryListTool,
  registerDeleteGroceryListTool,
  registerListGroceryListsTool,
  registerReadGroceryListTool,
  registerRenameGroceryListTool,
} from "../tools/grocery-list.js";
import {
  registerAddGroceryItemsTool,
  registerUpdateGroceryItemTool,
  registerDeleteGroceryItemTool,
} from "../tools/grocery-item.js";
import { registerMoveToPantryTool } from "../tools/grocery-move.js";
import { registerClearPurchasedTool, registerClearAllTool } from "../tools/grocery-clear.js";
import { registerMealHistoryTool } from "../tools/meal-history.js";
import { registerAddMealsTool, registerDeleteMealTool, registerUpdateMealTool } from "../tools/meal-writes.js";
import { registerListMenusTool, registerReadMenuTool } from "../tools/menu-read.js";
import { registerCreateMenuTool, registerDeleteMenuTool, registerUpdateMenuTool } from "../tools/menu-write.js";
import {
  registerAddMenuItemsTool,
  registerDeleteMenuItemTool,
  registerUpdateMenuItemTool,
} from "../tools/menu-item-write.js";
import { registerAddPantryItemsTool } from "../tools/pantry-batch-add.js";
import { registerDeletePantryItemTool } from "../tools/pantry-delete.js";
import { registerGetPantryItemTool } from "../tools/pantry-get.js";
import { registerListPantryTool } from "../tools/pantry-list.js";
import { registerUpdatePantryItemTool } from "../tools/pantry-update.js";
import { registerReadTool } from "../tools/read.js";
import { registerSearchTool } from "../tools/search.js";
import { registerUpdateTool } from "../tools/update.js";
import { registerRecipeResources } from "../resources/recipes.js";
import { registerGroceryListResources } from "../resources/grocery-lists.js";
import { registerMenuResources } from "../resources/menus.js";
import type { PaprikaConfig } from "../utils/config.js";
import { getCacheDir } from "../utils/xdg.js";
import type { AppContext, SessionContext } from "./app-context.js";
import type { Notifier } from "./notifier.js";
import { buildAuthContext } from "../auth/build.js";
import { createRequire } from "node:module";
import { createLogger } from "../utils/log.js";

const SERVER_NAME = "mcp-paprika";
const _require = createRequire(import.meta.url);
const _pkg = _require("../../package.json") as { version: string };
const SERVER_VERSION = _pkg.version;

/**
 * Build the process-wide AppContext and SyncEngine.
 *
 * Ordering (load-bearing):
 *
 * 1. Authenticate the Paprika client (this is the real fast-fail for bad
 *    credentials — `authenticate()` throws; `syncOnce()` swallows everything).
 * 2. Hydrate `DiskCache`, `RecipeStore` (recipes only — the cache deliberately
 *    has no `getAllCategories()`), and `PantryStore`.
 * 3. Construct `SyncEngine` against a placeholder `AppContext` (`vectorStore: null`).
 *    `SyncEngine` never reads `vectorStore`, so this is safe.
 * 4. **Run the initial `sync.syncOnce()`** before building discover components.
 *    This is the load-bearing step: `RecipeStore.setCategories()` is only
 *    called from inside `syncOnce()`, so cold-start vector indexing must run
 *    AFTER the first sync — otherwise embeddings get computed with empty
 *    category names and stay that way until a recipe mutation forces a
 *    re-embed (warm-restart + unchanged-hashes case). `syncOnce()` is
 *    documented to never throw, so this can't block startup.
 * 5. Build discover components (subscribes the vector store to `sync.events`
 *    for incremental re-indexing on subsequent cycles).
 *
 * Returns the fully-assembled `AppContext` and the `SyncEngine`. The caller
 * decides whether to call `sync.start()` to enable the background loop.
 */
export async function buildAppContext(
  config: PaprikaConfig,
  notifier: Notifier,
): Promise<{ app: AppContext; sync: SyncEngine }> {
  const log = createLogger({
    transport: config.transport,
    notifier,
    level: config.logging.level,
    notifyLevel: config.logging.notifyLevel,
    pretty: config.logging.pretty,
    ...(config.logging.file !== undefined ? { file: config.logging.file } : {}),
  });
  log.info({ transport: config.transport }, "mcp-paprika starting");

  log.info("authenticating with paprika");
  const client = new PaprikaClient(
    config.paprika.email,
    config.paprika.password,
    log.child({ component: "paprika-client" }),
  );
  await client.authenticate();
  log.info("authenticated with paprika");

  log.info("initializing disk cache");
  const cache = new DiskCacheRoot(getCacheDir(), log.child({ component: "disk-cache" }));
  await cache.init();

  const auth = await buildAuthContext(config, cache, log);
  if (auth !== null) {
    log.info(
      {
        issuer: auth.config.publicUrl,
        allowlistSize: auth.config.allowlist.emails.length + auth.config.allowlist.subs.length,
      },
      "oauth configured",
    );
  }

  // When background sync is disabled, syncOnce() never runs after startup, so
  // pending-write marks would never be swept. Pass TTL=0 to disable the
  // feature entirely in that mode (markPending* becomes a no-op). See
  // src/cache/CLAUDE.md "Pending-writes (issue #57)" and codex P2 on PR #92.
  const pendingWriteTtlMs = config.sync.enabled ? config.sync.pendingWriteTtl : 0;
  const store = new RecipeStore({ pendingWriteTtlMs });
  const cachedRecipes = await cache.recipes.getAll();
  for (const recipe of cachedRecipes) {
    store.set(recipe);
  }
  if (cachedRecipes.length > 0) {
    store.markSynced();
  }
  log.info({ count: cachedRecipes.length }, "hydrated recipe store from cache");

  const pantryStore = new PantryStore({ pendingWriteTtlMs });
  const cachedPantryItems = await cache.pantry.getAll();
  if (cachedPantryItems.length > 0) {
    pantryStore.load(cachedPantryItems);
  }
  log.info({ count: cachedPantryItems.length }, "hydrated pantry store from cache");

  const aisleStore = new AisleStore({ pendingWriteTtlMs });
  const cachedAisles = (await cache.aisles.getAll()).filter((a) => !a.deleted);
  if (cachedAisles.length > 0) {
    aisleStore.load(cachedAisles);
  }
  log.info({ count: cachedAisles.length }, "hydrated aisle store from cache");

  const groceryListStore = new GroceryListStore({ pendingWriteTtlMs });
  const cachedGroceryLists = await cache.groceryLists.getAll();
  if (cachedGroceryLists.length > 0) {
    groceryListStore.load(cachedGroceryLists);
  }
  log.info({ count: cachedGroceryLists.length }, "hydrated grocery list store from cache");

  const groceryItemStore = new GroceryItemStore({ pendingWriteTtlMs });
  const cachedGroceryItems = await cache.groceryItems.getAll();
  if (cachedGroceryItems.length > 0) {
    groceryItemStore.load(cachedGroceryItems);
  }
  log.info({ count: cachedGroceryItems.length }, "hydrated grocery item store from cache");

  const groceryIngredientStore = new GroceryIngredientStore();
  const cachedGroceryIngredients = (await cache.groceryIngredients.getAll()).filter((i) => !i.deleted);
  if (cachedGroceryIngredients.length > 0) {
    groceryIngredientStore.load(cachedGroceryIngredients);
  }
  log.info({ count: cachedGroceryIngredients.length }, "hydrated grocery ingredient store from cache");

  const mealStore = new MealStore({ pendingWriteTtlMs });
  const cachedMeals = (await cache.meals.getAll()).filter((m) => !m.deleted);
  if (cachedMeals.length > 0) {
    mealStore.load(cachedMeals);
  }
  log.info({ count: cachedMeals.length }, "hydrated meal store from cache");

  const mealTypeStore = new MealTypeStore({ pendingWriteTtlMs });
  const cachedMealTypes = (await cache.mealTypes.getAll()).filter((mt) => !mt.deleted);
  if (cachedMealTypes.length > 0) {
    mealTypeStore.load(cachedMealTypes);
  }
  log.info({ count: cachedMealTypes.length }, "hydrated meal type store from cache");

  const menuStore = new MenuStore({ pendingWriteTtlMs });
  const cachedMenus = (await cache.menus.getAll()).filter((m) => !m.deleted);
  if (cachedMenus.length > 0) {
    menuStore.load(cachedMenus);
  }
  log.info({ count: cachedMenus.length }, "hydrated menu store from cache");

  const menuItemStore = new MenuItemStore({ pendingWriteTtlMs });
  const cachedMenuItems = (await cache.menuItems.getAll()).filter((mi) => !mi.deleted);
  if (cachedMenuItems.length > 0) {
    menuItemStore.load(cachedMenuItems);
  }
  log.info({ count: cachedMenuItems.length }, "hydrated menu item store from cache");

  // SyncEngine only reads client/cache/store/pantryStore/notifier — never
  // vectorStore — so it is safe to construct with a placeholder appContext
  // whose vectorStore is null. The vector store is then built with
  // sync.events so it can subscribe to "sync:complete" notifications.
  const syncCtx: AppContext = {
    client,
    cache,
    store,
    pantryStore,
    aisleStore,
    groceryListStore,
    groceryItemStore,
    groceryIngredientStore,
    mealStore,
    mealTypeStore,
    menuStore,
    menuItemStore,
    vectorStore: null,
    notifier,
    auth, // null for stdio, populated for HTTP
    log,
  };
  const sync = new SyncEngine(syncCtx, config.sync.interval);

  // Translate sync:complete events into MCP resource-list notifications.
  // Wired here (not inside SyncEngine) so the engine stays decoupled from the
  // notifier decision — subscribers pick what to do with each entity's changes.
  sync.events.on("sync:complete", (result) => {
    if (
      result.changeType !== "recipes" &&
      result.changeType !== "grocery-lists" &&
      result.changeType !== "grocery-items" &&
      result.changeType !== "menus" &&
      result.changeType !== "menu-items"
    ) {
      return;
    }
    const { added, updated, removedUids } = result.changes;
    if (added.length > 0 || updated.length > 0 || removedUids.length > 0) {
      notifier.resourceListChanged();
    }
  });

  // Run the initial sync BEFORE building discover components.
  //
  // `RecipeStore.setCategories()` is only ever called from within
  // `SyncEngine.syncOnce()`. Cold-start indexing in `buildDiscoverComponents`
  // calls `store.resolveCategories(uids)` per recipe to construct the
  // embedding text — if categories are unpopulated, embeddings get computed
  // with empty category names and stay that way until a recipe mutation
  // (Codex #75 review). On a warm restart with unchanged remote hashes the
  // post-build sync emits nothing, so the sync:complete subscription never
  // gets a chance to fix it.
  //
  // `syncOnce()` is documented to never throw (any failure is logged + emitted
  // as `sync:error`), so this is safe to await unconditionally — same fail-soft
  // semantics as the pre-Phase-1 entry point.
  log.info("running initial sync");
  // `syncOnce()` never throws — instead it emits `sync:complete` on success or
  // `sync:error` on failure. Subscribe so the startup log reflects the actual
  // outcome rather than always claiming success (#76). Wrap the capture in an
  // object because TS narrows locals mutated only via closure to their initial
  // type, which would force a cast on every read.
  const errorBox: { value: Error | null } = { value: null };
  const onError = (err: Error): void => {
    errorBox.value = err;
  };
  sync.events.on("sync:error", onError);
  await sync.syncOnce();
  sync.events.off("sync:error", onError);
  if (errorBox.value === null) {
    log.info("initial sync complete");
  } else {
    log.warn({ err: errorBox.value }, "initial sync failed; background sync will retry");
  }

  const vectorStore = await buildDiscoverComponents(config, store, sync.events, log);

  const app: AppContext = {
    client,
    cache,
    store,
    pantryStore,
    aisleStore,
    groceryListStore,
    groceryItemStore,
    groceryIngredientStore,
    mealStore,
    mealTypeStore,
    menuStore,
    menuItemStore,
    vectorStore,
    notifier,
    auth, // null for stdio, populated for HTTP
    log,
  };

  return { app, sync };
}

/**
 * Build a fully-registered McpServer for the given AppContext.
 *
 * Registers all 31 tools and the recipe, grocery-list, and menu resource families. Called once for
 * stdio, once per session for HTTP. Tool registration is pure (closures over the
 * session context), so registering the same tool name on N independent
 * server instances is safe — there is no module-level mutable state.
 *
 * If `vectorStore` is present on the AppContext, the discover tool is
 * registered as well.
 */
export function buildMcpServer(app: AppContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const sessionCtx: SessionContext = { ...app, server };

  registerSearchTool(server, sessionCtx);
  registerFilterTools(server, sessionCtx);
  registerCategoryTools(server, sessionCtx);
  registerListTool(server, sessionCtx);
  registerReadTool(server, sessionCtx);
  registerCreateTool(server, sessionCtx);
  registerUpdateTool(server, sessionCtx);
  registerDeleteTool(server, sessionCtx);
  registerListPantryTool(server, sessionCtx);
  registerGetPantryItemTool(server, sessionCtx);
  registerAddPantryItemsTool(server, sessionCtx);
  registerUpdatePantryItemTool(server, sessionCtx);
  registerDeletePantryItemTool(server, sessionCtx);
  registerAislesTool(server, sessionCtx);
  registerMealTypesTool(server, sessionCtx);
  registerListGroceryListsTool(server, sessionCtx);
  registerReadGroceryListTool(server, sessionCtx);
  registerCreateGroceryListTool(server, sessionCtx);
  registerRenameGroceryListTool(server, sessionCtx);
  registerDeleteGroceryListTool(server, sessionCtx);
  registerAddGroceryItemsTool(server, sessionCtx);
  registerUpdateGroceryItemTool(server, sessionCtx);
  registerDeleteGroceryItemTool(server, sessionCtx);
  registerMoveToPantryTool(server, sessionCtx);
  registerClearPurchasedTool(server, sessionCtx);
  registerClearAllTool(server, sessionCtx);
  registerMealHistoryTool(server, sessionCtx);
  registerAddMealsTool(server, sessionCtx);
  registerUpdateMealTool(server, sessionCtx);
  registerDeleteMealTool(server, sessionCtx);
  registerListMenusTool(server, sessionCtx);
  registerReadMenuTool(server, sessionCtx);
  registerCreateMenuTool(server, sessionCtx);
  registerUpdateMenuTool(server, sessionCtx);
  registerDeleteMenuTool(server, sessionCtx);
  registerAddMenuItemsTool(server, sessionCtx);
  registerUpdateMenuItemTool(server, sessionCtx);
  registerDeleteMenuItemTool(server, sessionCtx);

  if (app.vectorStore !== null) {
    registerDiscoverTool(server, sessionCtx, app.vectorStore);
  }

  registerRecipeResources(server, sessionCtx);
  registerGroceryListResources(server, sessionCtx);
  registerMenuResources(server, sessionCtx);

  return server;
}
