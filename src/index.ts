import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PaprikaClient } from "./paprika/client.js";
import { SyncEngine } from "./paprika/sync.js";
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
import type { ServerContext } from "./types/server-context.js";

function log(msg: string): void {
  process.stderr.write(`[mcp-paprika] ${msg}\n`);
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

  // 2. Construct PaprikaClient and authenticate
  log("Authenticating with Paprika...");
  const client = new PaprikaClient(config.paprika.email, config.paprika.password);
  await client.authenticate();
  log("Authenticated successfully.");

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
    client,
    cache,
    store,
    server,
  };

  // 7. Register all 9 tools
  registerSearchTool(server, ctx);
  registerFilterTools(server, ctx);
  registerCategoryTools(server, ctx);
  registerListTool(server, ctx);
  registerReadTool(server, ctx);
  registerCreateTool(server, ctx);
  registerUpdateTool(server, ctx);
  registerDeleteTool(server, ctx);
  log("Registered 9 tools.");

  // 8. Register recipe resources
  registerRecipeResources(server, ctx);
  log("Registered recipe resources.");

  // 9. Construct SyncEngine, run initial sync, then start background loop
  const sync = new SyncEngine(ctx, config.sync.interval);
  log("Running initial sync...");
  await sync.syncOnce();
  log("Initial sync complete.");
  if (config.sync.enabled) {
    sync.start();
    log(`Sync engine started (interval: ${config.sync.interval}ms).`);
  } else {
    log("Background sync disabled.");
  }

  // Phase 3 extension point

  // 10. Register SIGINT handler
  process.on("SIGINT", () => {
    log("SIGINT received, shutting down...");
    sync.stop();
    process.exit(0);
  });

  // 11. Connect stdio transport
  log("Connecting stdio transport...");
  await server.connect(new StdioServerTransport());
  log("Server ready.");
}

main().catch((err) => {
  /* oxlint-disable-next-line no-console */
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
