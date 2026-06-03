import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AppContext, SessionContext } from "./app-context.js";
import type { Notifier } from "./notifier.js";

import { AisleStore } from "../aisle/store.js";
import { buildAuthContext } from "../auth/build.js";
import { DiskCacheRoot } from "../cache/disk-cache-root.js";
import { CategoryStore } from "../category/store.js";
import { buildDiscoverComponents } from "../features/discover-feature.js";
import { GeneratedImageStore } from "../features/generated-image-store.js";
import { PhotographyClient } from "../features/photography.js";
import { GroceryIngredientStore } from "../grocery-ingredient/store.js";
import { GroceryItemStore } from "../grocery-item/store.js";
import { GroceryListStore } from "../grocery-list/store.js";
import { MealTypeStore } from "../meal-type/store.js";
import { MealStore } from "../meal/store.js";
import { MenuItemStore } from "../menu-item/store.js";
import { MenuStore } from "../menu/store.js";
import { PantryStore } from "../pantry/store.js";
import { PaprikaClient } from "../paprika/client.js";
import { type SyncDeps, SyncEngine } from "../paprika/sync.js";
import { PhotoStore } from "../photo/store.js";
import { RecipeStore } from "../recipe/store.js";
import { registerGroceryListResources } from "../resources/grocery-lists.js";
import { registerMenuResources } from "../resources/menus.js";
import { registerRecipeResources } from "../resources/recipes.js";
import { registerAislesTool } from "../tools/aisles.js";
import { registerCategoryTools } from "../tools/categories.js";
import {
  registerCreateCategoryTool,
  registerDeleteCategoryTool,
  registerUpdateCategoryTool,
} from "../tools/category-writes.js";
import { registerCreateTool } from "../tools/create.js";
import { registerDeleteTool } from "../tools/delete.js";
import { registerDiscoverTool } from "../tools/discover.js";
import { registerEmptyTrashTool } from "../tools/empty-trash.js";
import { registerFilterTools } from "../tools/filter.js";
import { registerClearAllTool, registerClearPurchasedTool } from "../tools/grocery-clear.js";
import {
  registerAddGroceryItemsTool,
  registerDeleteGroceryItemTool,
  registerUpdateGroceryItemTool,
} from "../tools/grocery-item.js";
import {
  registerCreateGroceryListTool,
  registerDeleteGroceryListTool,
  registerListGroceryListsTool,
  registerReadGroceryListTool,
  registerRenameGroceryListTool,
} from "../tools/grocery-list.js";
import { registerMoveToPantryTool } from "../tools/grocery-move.js";
import { registerListTool } from "../tools/list.js";
import { registerAddMenuToPlannerTool } from "../tools/meal-add-menu.js";
import { registerMealHistoryTool } from "../tools/meal-history.js";
import { registerMealTypesTool } from "../tools/meal-types.js";
import { registerAddMealsTool, registerDeleteMealTool, registerUpdateMealTool } from "../tools/meal-writes.js";
import {
  registerAddMenuItemsTool,
  registerDeleteMenuItemTool,
  registerUpdateMenuItemTool,
} from "../tools/menu-item-write.js";
import { registerListMenusTool, registerReadMenuTool } from "../tools/menu-read.js";
import { registerCreateMenuTool, registerDeleteMenuTool, registerUpdateMenuTool } from "../tools/menu-write.js";
import { registerAddPantryItemsTool } from "../tools/pantry-batch-add.js";
import { registerDeletePantryItemTool } from "../tools/pantry-delete.js";
import { registerGetPantryItemTool } from "../tools/pantry-get.js";
import { registerListPantryTool } from "../tools/pantry-list.js";
import { registerUpdatePantryItemTool } from "../tools/pantry-update.js";
import { registerGeneratePhotoTool } from "../tools/photo-generate.js";
import { registerDeletePhotoTool, registerUploadPhotoTool } from "../tools/photo-writes.js";
import { registerReadTool } from "../tools/read.js";
import { registerSearchTool } from "../tools/search.js";
import { registerUpdateTool } from "../tools/update.js";
import { type PaprikaConfig, resolveImageGenConfig } from "../utils/config.js";
import { createLogger } from "../utils/log.js";
import { getCacheDir } from "../utils/xdg.js";

const SERVER_NAME = "mcp-paprika";
const _require = createRequire(import.meta.url);
const _pkg = _require("../../package.json") as { version: string };
const SERVER_VERSION = _pkg.version;

// Cross-tool orientation sent to clients at connect time (the MCP `instructions`
// field). This is the one channel that reaches the model with guidance the
// per-tool Zod descriptions cannot carry; keep it short and behavioral.
const SERVER_INSTRUCTIONS = `mcp-paprika bridges your Paprika recipe library: recipes, the pantry, grocery lists, meal planning, and menus.

Orientation:
- Recipes, grocery lists, and menus are exposed both as tools (which you call) and as paprika://… resources the user can attach. The read_* tools let you fetch one by UID on your own, without waiting for the user to attach it.
- Lookup: use search_recipes for name / ingredient / description matching; use discover_recipes (present only when semantic search is configured) for natural-language queries.
- Only recipe deletes are reversible: a deleted recipe moves to the trash, and purge_recipe then permanently removes one already there. Deleting anything else (grocery items, pantry items, menu items, lists) is immediate and permanent.
- When scheduling a meal or adding a menu item, link an existing recipe by its UID OR give a freeform name, never both; they are mutually exclusive. Grocery items take no recipe link; add_grocery_items wants an ingredient, quantity, and aisle.
- generate_recipe_photo (present only when image generation is configured) attaches the image and returns its photo UID by default. With attach:false it returns a preview plus a single-use token instead; pass that token to upload_recipe_photo to attach it later.
- Data is served from a local cache kept fresh by background sync, so it can briefly lag changes made directly in the Paprika apps.`;

// ── Phase-typed bootstrap builder ────────────────────────────────────────────
//
// buildAppContext runs a fixed sequence of phases whose order is load-bearing
// (see src/server/CLAUDE.md "buildAppContext construction order"). Each phase
// consumes the previous phase's result type and returns the next, so the order
// is a compile-time guarantee, not a convention: `buildFeatures` requires an
// `Indexed`, which only `runInitialSync` produces, so the vector store can never
// be built before the first sync has populated the stores.
//
// The shared 15-field `SyncDeps` slice (`core`) is assembled once in `hydrate`
// and reused for both the `SyncEngine` and the final `AppContext`, so no field
// is written twice. Handle field types are `AppContext["…"]` indexed-access, so
// they cannot drift from the canonical context type.

interface Authenticated {
  readonly config: PaprikaConfig;
  readonly log: AppContext["log"];
  readonly client: AppContext["client"];
  readonly notifier: AppContext["notifier"];
}

// Does NOT extend Authenticated: `client` and `log` would otherwise live both
// top-level and inside `core`. Past hydration they live only in `core` (the
// SyncDeps slice), so downstream phases read `core.log` — one canonical path,
// with no second copy that could drift from the one the SyncEngine and the
// final AppContext use.
interface Hydrated {
  readonly config: PaprikaConfig;
  readonly notifier: AppContext["notifier"];
  /** The slice SyncEngine consumes; also spread into the final AppContext. */
  readonly core: SyncDeps;
  readonly generatedImageStore: AppContext["generatedImageStore"];
}

interface Wired extends Hydrated {
  readonly auth: AppContext["auth"];
}

interface Synced extends Wired {
  readonly sync: SyncEngine;
}

interface Indexed extends Synced {
  // Phase discriminant. `runInitialSync` mutates the stores in place and adds no
  // field, so without this marker `Indexed` would be structurally identical to
  // `Synced` and `buildFeatures` could run before the initial sync. The literal
  // type makes the post-sync gate a compile-time requirement.
  readonly phase: "indexed";
}

interface Ready extends Indexed {
  readonly vectorStore: AppContext["vectorStore"];
  readonly photographyClient: AppContext["photographyClient"];
}

/**
 * Authenticate the Paprika client — the real fast-fail for bad credentials
 * (`client.authenticate()` throws here, whereas `syncOnce()` swallows
 * everything). Also builds the logger first, so startup records flow through
 * structured logging from the first line.
 */
async function authenticate(config: PaprikaConfig, notifier: Notifier): Promise<Authenticated> {
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
    { recipeFetchConcurrency: config.sync.recipeFetchConcurrency },
  );
  await client.authenticate();
  log.info("authenticated with paprika");

  return { config, log, client, notifier };
}

/**
 * Open the disk cache and hydrate every in-memory store from it, then assemble
 * the `core` SyncDeps slice. Content/Data/Reference stores hydrate from disk on
 * a warm restart and start empty on a true cold start.
 */
async function hydrate(prev: Authenticated): Promise<Hydrated> {
  const { config, log, client, notifier } = prev;

  log.info("initializing disk cache");
  const cache = new DiskCacheRoot(getCacheDir(), log.child({ component: "disk-cache" }));
  await cache.init();

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

  const categoryStore = new CategoryStore({ pendingWriteTtlMs });
  const cachedCategories = await cache.categories.getAll();
  if (cachedCategories.length > 0) {
    categoryStore.load(cachedCategories);
  }
  log.info({ count: cachedCategories.length }, "hydrated category store from cache");

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

  const photoStore = new PhotoStore({ pendingWriteTtlMs });
  const cachedPhotos = (await cache.photos.getAll()).filter((p) => !p.deleted);
  if (cachedPhotos.length > 0) {
    photoStore.load(cachedPhotos);
  }
  log.info({ count: cachedPhotos.length }, "hydrated photo store from cache");

  // Ephemeral, in-memory only (no disk hydration): holds generated-photo
  // previews awaiting attach-by-token (#photo-preview-attach).
  const generatedImageStore = new GeneratedImageStore();

  const core: SyncDeps = {
    client,
    cache,
    store,
    categoryStore,
    pantryStore,
    aisleStore,
    groceryListStore,
    groceryItemStore,
    groceryIngredientStore,
    mealStore,
    mealTypeStore,
    menuStore,
    menuItemStore,
    photoStore,
    log,
  };

  return { config, notifier, core, generatedImageStore };
}

/**
 * Build the OAuth runtime: `null` for stdio; for HTTP it fetches the OIDC
 * discovery document and assembles the OAuth stores/provider, throwing on
 * failure (no value in serving a public endpoint with broken auth).
 */
async function buildAuth(prev: Hydrated): Promise<Wired> {
  const { config, core } = prev;
  const { cache, log } = core;
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
  return { ...prev, auth };
}

/**
 * Construct the SyncEngine from the `core` slice and wire the sync:complete →
 * resourceListChanged subscriber. The subscriber lives here, not inside the
 * engine, so the engine stays decoupled from the notifier decision; it fires
 * only for changeTypes with an MCP resource surface and only when the change set
 * is non-empty (pantry is excluded — it has no resource surface).
 */
function wireSync(prev: Wired): Synced {
  const { config, core, notifier } = prev;
  const sync = new SyncEngine(core, config.sync.interval);

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

  return { ...prev, sync };
}

/**
 * Run the initial sync, BEFORE building discover components. On a cold start the
 * CategoryStore is empty until the first sync populates it; if vector indexing
 * ran first, embeddings would bake in empty category names and stay stale until
 * a recipe mutation (Codex #75). `syncOnce()` never throws (it emits sync:error
 * instead), so we subscribe to capture the outcome for the startup log rather
 * than always claiming success (#76).
 */
async function runInitialSync(prev: Synced): Promise<Indexed> {
  const { core, sync } = prev;
  const { log } = core;
  log.info("running initial sync");
  // Wrap the capture in an object because TS narrows locals mutated only via
  // closure to their initial type, which would force a cast on every read.
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
  return { ...prev, phase: "indexed" };
}

/**
 * Build the optional discover (vector) and photo-generation features. Requires
 * an `Indexed`, so it cannot run before the initial sync. The vector store
 * subscribes to sync.events for incremental re-indexing on later cycles; the
 * photography client is built only when imageGen credentials resolve.
 */
async function buildFeatures(prev: Indexed): Promise<Ready> {
  const { config, core, sync } = prev;
  const { log } = core;
  const vectorStore = await buildDiscoverComponents(config, core.store, core.categoryStore, sync.events, log);

  const resolvedImageGen = resolveImageGenConfig(config);
  const photographyClient =
    resolvedImageGen !== null ? new PhotographyClient(resolvedImageGen, log.child({ component: "photography" })) : null;

  return { ...prev, vectorStore, photographyClient };
}

/**
 * Assemble the one AppContext. The `core` slice is spread in, so the 15 shared
 * fields written once in `hydrate` are reused rather than re-listed.
 */
function assemble(prev: Ready): { app: AppContext; sync: SyncEngine } {
  const { core, generatedImageStore, vectorStore, photographyClient, notifier, auth, sync } = prev;
  const app: AppContext = {
    ...core,
    generatedImageStore,
    vectorStore,
    photographyClient,
    notifier,
    auth, // null for stdio, populated for HTTP
  };
  return { app, sync };
}

/**
 * Build the process-wide AppContext and SyncEngine by running the bootstrap
 * phases in their one legal order (each phase's type gates the next; see the
 * section note above and src/server/CLAUDE.md). Returns the assembled AppContext
 * and SyncEngine; the caller decides whether to `sync.start()` the background loop.
 */
export async function buildAppContext(
  config: PaprikaConfig,
  notifier: Notifier,
): Promise<{ app: AppContext; sync: SyncEngine }> {
  const authenticated = await authenticate(config, notifier);
  const hydrated = await hydrate(authenticated);
  const wired = await buildAuth(hydrated);
  const synced = wireSync(wired);
  const indexed = await runInitialSync(synced);
  const ready = await buildFeatures(indexed);
  return assemble(ready);
}

/**
 * Build a fully-registered McpServer for the given AppContext.
 *
 * Registers the full tool surface and the recipe, grocery-list, and menu resource families. Called once for
 * stdio, once per session for HTTP. Tool registration is pure (closures over the
 * session context), so registering the same tool name on N independent
 * server instances is safe — there is no module-level mutable state.
 *
 * If `vectorStore` is present on the AppContext, the discover tool is
 * registered as well.
 */
export function buildMcpServer(app: AppContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  const sessionCtx: SessionContext = { ...app, server };

  registerSearchTool(server, sessionCtx);
  registerFilterTools(server, sessionCtx);
  registerCategoryTools(server, sessionCtx);
  registerCreateCategoryTool(server, sessionCtx);
  registerUpdateCategoryTool(server, sessionCtx);
  registerDeleteCategoryTool(server, sessionCtx);
  registerListTool(server, sessionCtx);
  registerReadTool(server, sessionCtx);
  registerCreateTool(server, sessionCtx);
  registerUpdateTool(server, sessionCtx);
  registerDeleteTool(server, sessionCtx);
  registerEmptyTrashTool(server, sessionCtx);
  registerUploadPhotoTool(server, sessionCtx);
  registerDeletePhotoTool(server, sessionCtx);
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
  registerAddMenuToPlannerTool(server, sessionCtx);
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
  if (app.photographyClient !== null) {
    registerGeneratePhotoTool(server, sessionCtx, app.photographyClient);
  }

  registerRecipeResources(server, sessionCtx);
  registerGroceryListResources(server, sessionCtx);
  registerMenuResources(server, sessionCtx);

  return server;
}
