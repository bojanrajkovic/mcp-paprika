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
import { registerRecipeResources } from "./resources/recipes.js";
import type { ServerContext } from "./types/server-context.js";

async function main(): Promise<void> {
  // 1. Load and validate config
  const configResult = loadConfig();
  const config = configResult.match(
    (cfg) => cfg,
    (err) => {
      throw err;
    },
  );

  // 2. Construct PaprikaClient and authenticate
  const client = new PaprikaClient(config.paprika.email, config.paprika.password);
  await client.authenticate();

  // 3. Construct DiskCache and initialize
  const cache = new DiskCache(getCacheDir());
  await cache.init();

  // 4. Construct RecipeStore
  const store = new RecipeStore();

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

  // 7. Register all 8 tools
  registerSearchTool(server, ctx);
  registerFilterTools(server, ctx);
  registerCategoryTools(server, ctx);
  registerReadTool(server, ctx);
  registerCreateTool(server, ctx);
  registerUpdateTool(server, ctx);
  registerDeleteTool(server, ctx);

  // 8. Register recipe resources
  registerRecipeResources(server, ctx);

  // 9. Construct SyncEngine and conditionally start
  const sync = new SyncEngine(ctx, config.sync.interval);
  if (config.sync.enabled) {
    sync.start();
  }

  // Phase 3 extension point

  // 10. Register SIGINT handler
  process.on("SIGINT", () => {
    sync.stop();
    process.exit(0);
  });

  // 11. Connect stdio transport
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  /* oxlint-disable-next-line no-console */
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
