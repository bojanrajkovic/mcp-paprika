import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";

import type { AisleStore } from "../aisle/store.js";
import type { CategoryStore } from "../category/store.js";
import type { DiskCacheRoot } from "../cache/disk-cache-root.js";
import type { GroceryIngredientStore } from "../grocery-ingredient/store.js";
import type { GroceryItemStore } from "../grocery-item/store.js";
import type { GroceryListStore } from "../grocery-list/store.js";
import type { MealStore } from "../meal/store.js";
import type { MealTypeStore } from "../meal-type/store.js";
import type { MenuStore } from "../menu/store.js";
import type { MenuItemStore } from "../menu-item/store.js";
import type { PantryStore } from "../pantry/store.js";
import type { PhotoStore } from "../photo/store.js";
import type { RecipeStore } from "../recipe/store.js";
import type { VectorStore } from "../features/vector-store.js";
import type { PhotographyClient } from "../features/photography.js";
import type { GeneratedImageStore } from "../features/generated-image-store.js";
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
  readonly cache: DiskCacheRoot;
  readonly store: RecipeStore;
  readonly categoryStore: CategoryStore;
  readonly pantryStore: PantryStore;
  readonly aisleStore: AisleStore;
  readonly groceryListStore: GroceryListStore;
  readonly groceryItemStore: GroceryItemStore;
  readonly groceryIngredientStore: GroceryIngredientStore;
  readonly mealStore: MealStore;
  readonly mealTypeStore: MealTypeStore;
  readonly menuStore: MenuStore;
  readonly menuItemStore: MenuItemStore;
  readonly photoStore: PhotoStore;
  readonly vectorStore: VectorStore | null;
  /** OpenRouter image-generation client; `null` when image generation is not configured. */
  readonly photographyClient: PhotographyClient | null;
  /** Ephemeral cache of generated-photo previews, keyed by `gen_` token (#photo-preview-attach). */
  readonly generatedImageStore: GeneratedImageStore;
  readonly notifier: Notifier;
  /** OAuth runtime state. null in stdio mode (auth not required). */
  readonly auth: AuthContext | null;
  /** Structured pino logger for this process. Child loggers via `.child({component})`. */
  readonly log: Logger;
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
