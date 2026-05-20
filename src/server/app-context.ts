import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { DiskCache } from "../cache/disk-cache.js";
import type { PantryStore } from "../cache/pantry-store.js";
import type { RecipeStore } from "../cache/recipe-store.js";
import type { VectorStore } from "../features/vector-store.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { AuthContext } from "../auth/types.js";
import type { Notifier } from "./notifier.js";

/**
 * Heavyweight, process-wide shared state. Built once per process.
 *
 * Shared across transports (stdio has one logical session; HTTP has N sessions).
 * The `notifier` is the load-bearing piece — in HTTP mode there is no single
 * "the server," so callers cannot reach `server.sendResourceListChanged()`
 * directly; they go through the notifier which broadcasts across all sessions.
 */
export interface AppContext {
  readonly client: PaprikaClient;
  readonly cache: DiskCache;
  readonly store: RecipeStore;
  readonly pantryStore: PantryStore;
  readonly vectorStore: VectorStore | null;
  readonly notifier: Notifier;
  /** OAuth runtime state. null in stdio mode (auth not required). */
  readonly auth: AuthContext | null;
}

/**
 * Per-session context = AppContext + the session's McpServer.
 *
 * Tool/resource handlers receive this. For stdio there is exactly one
 * SessionContext for the process lifetime; for HTTP one per active session.
 */
export interface SessionContext extends AppContext {
  readonly server: McpServer;
}
