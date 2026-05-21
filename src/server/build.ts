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
import { buildAuthContext } from "../auth/build.js";
import { createLogger } from "../utils/log.js";

const SERVER_NAME = "mcp-paprika";
const SERVER_VERSION = "0.0.0";

const log = createLogger("mcp-paprika");

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
  log("Authenticating with Paprika...");
  const client = new PaprikaClient(config.paprika.email, config.paprika.password);
  await client.authenticate();
  log("Authenticated successfully.");

  log("Initializing disk cache...");
  const cache = new DiskCache(getCacheDir());
  await cache.init();

  const auth = await buildAuthContext(config, cache);
  if (auth !== null) {
    log(
      `OAuth configured: issuer=${auth.config.publicUrl}, allowlist=${(auth.config.allowlist.emails.length + auth.config.allowlist.subs.length).toString()} entries`,
    );
  }

  // When background sync is disabled, syncOnce() never runs after startup, so
  // pending-write marks would never be swept. Pass TTL=0 to disable the
  // feature entirely in that mode (markPending* becomes a no-op). See
  // src/cache/CLAUDE.md "Pending-writes (issue #57)" and codex P2 on PR #92.
  const pendingWriteTtlMs = config.sync.enabled ? config.sync.pendingWriteTtl : 0;
  const store = new RecipeStore({ pendingWriteTtlMs });
  const cachedRecipes = await cache.getAllRecipes();
  for (const recipe of cachedRecipes) {
    store.set(recipe);
  }
  log(`Hydrated store with ${cachedRecipes.length.toString()} cached recipes.`);

  const pantryStore = new PantryStore({ pendingWriteTtlMs });
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
    auth, // null for stdio, populated for HTTP
  };
  const sync = new SyncEngine(syncCtx, config.sync.interval);

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
  log("Running initial sync...");
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
    log("Initial sync complete.");
  } else {
    log(`Initial sync failed: ${errorBox.value.message}. Continuing startup; background sync will retry.`);
  }

  const vectorStore = await buildDiscoverComponents(config, store, sync.events);

  const app: AppContext = {
    client,
    cache,
    store,
    pantryStore,
    vectorStore,
    notifier,
    auth, // null for stdio, populated for HTTP
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
