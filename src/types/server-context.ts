import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { DiskCache } from "../cache/disk-cache.js";
import type { PantryStore } from "../cache/pantry-store.js";
import type { RecipeStore } from "../cache/recipe-store.js";
import type { PaprikaClient } from "../paprika/client.js";

export interface ServerContext {
  readonly client: PaprikaClient;
  readonly cache: DiskCache;
  readonly store: RecipeStore;
  readonly pantryStore: PantryStore;
  readonly server: McpServer;
}
