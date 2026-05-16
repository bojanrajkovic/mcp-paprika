import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { DiskCache } from "../cache/disk-cache.js";
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
import { registerAddPantryItemTool } from "../tools/pantry-add.js";
import { registerDeletePantryItemTool } from "../tools/pantry-delete.js";
import { registerGetPantryItemTool } from "../tools/pantry-get.js";
import { registerListPantryTool } from "../tools/pantry-list.js";
import { registerUpdatePantryItemTool } from "../tools/pantry-update.js";
import { registerReadTool } from "../tools/read.js";
import { registerSearchTool } from "../tools/search.js";
import { registerUpdateTool } from "../tools/update.js";
import { registerPantryResources } from "../resources/pantry.js";
import { registerRecipeResources } from "../resources/recipes.js";
import type { PaprikaConfig } from "../utils/config.js";
import { getCacheDir } from "../utils/xdg.js";
import type { AppContext, SessionContext } from "./app-context.js";
import type { Notifier } from "./notifier.js";

const SERVER_NAME = "mcp-paprika";
const SERVER_VERSION = "0.0.0";

function log(msg: string): void {
  process.stderr.write(`[mcp-paprika] ${msg}\n`);
}

/**
 * Build the process-wide AppContext and SyncEngine.
 *
 * Authenticates the Paprika client, hydrates caches and stores, constructs
 * the SyncEngine, then builds the (optional) vector store. The vector store
 * subscribes to `sync.events` so it can incrementally re-index when a sync
 * cycle reports added/updated/removed recipes.
 *
 * SyncEngine is constructed BEFORE the vector store so the latter can
 * subscribe to its event stream — SyncEngine itself never reads
 * `app.vectorStore`, so it is safe to omit at construction time.
 */
export async function buildAppContext(
  config: PaprikaConfig,
  notifier: Notifier,
): Promise<{ app: AppContext; sync: SyncEngine }> {
  log("Authenticating with Paprika...");
  const client = new PaprikaClient(config.paprika.email, config.paprika.password);
  await client.authenticate();
  log("Authenticated successfully.");

  log("Initializing disk cache...");
  const cache = new DiskCache(getCacheDir());
  await cache.init();

  const store = new RecipeStore();
  const cachedRecipes = await cache.getAllRecipes();
  for (const recipe of cachedRecipes) {
    store.set(recipe);
  }
  log(`Hydrated store with ${cachedRecipes.length.toString()} cached recipes.`);

  const pantryStore = new PantryStore();
  const cachedPantryItems = await cache.getAllPantryItems();
  if (cachedPantryItems.length > 0) {
    pantryStore.load(cachedPantryItems);
  }
  log(`Hydrated pantry store with ${cachedPantryItems.length.toString()} cached pantry items.`);

  // SyncEngine only reads client/cache/store/pantryStore/notifier — never
  // vectorStore — so it is safe to construct with a placeholder appContext
  // whose vectorStore is null. The vector store is then built with
  // sync.events so it can subscribe to "sync:complete" notifications.
  const syncCtx: AppContext = {
    client,
    cache,
    store,
    pantryStore,
    vectorStore: null,
    notifier,
  };
  const sync = new SyncEngine(syncCtx, config.sync.interval);

  const vectorStore = await buildDiscoverComponents(config, store, sync.events);

  const app: AppContext = {
    client,
    cache,
    store,
    pantryStore,
    vectorStore,
    notifier,
  };

  return { app, sync };
}

/**
 * Build a fully-registered McpServer for the given AppContext.
 *
 * Registers all 14 tools and both resource families. Called once for stdio,
 * once per session for HTTP. Tool registration is pure (closures over the
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
  registerAddPantryItemTool(server, sessionCtx);
  registerUpdatePantryItemTool(server, sessionCtx);
  registerDeletePantryItemTool(server, sessionCtx);

  if (app.vectorStore !== null) {
    registerDiscoverTool(server, sessionCtx, app.vectorStore);
  }

  registerRecipeResources(server, sessionCtx);
  registerPantryResources(server, sessionCtx);

  return server;
}
