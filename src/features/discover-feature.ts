import { EmbeddingClient, EMBEDDING_SCHEMA_VERSION } from "./embeddings.js";
import { VectorStore } from "./vector-store.js";
import { getCacheDir } from "../utils/xdg.js";
import type { RecipeStore } from "../cache/recipe-store.js";
import type { SyncResult } from "../paprika/types.js";
import type { PaprikaConfig } from "../utils/config.js";
import { toMessage } from "../utils/log.js";
import type { Logger } from "pino";

/**
 * View over the SyncEngine event stream. Matches `SyncEngine.events` (a
 * `Pick<SyncEventEmitter, "on" | "off">`). Declared locally to avoid
 * pulling a hard dependency on `SyncEngine` itself.
 */
export interface SyncEventsView {
  on(event: "sync:complete", handler: (data: SyncResult) => void): void;
  on(event: "sync:error", handler: (data: Error) => void): void;
  off(event: "sync:complete", handler?: (data: SyncResult) => void): void;
  off(event: "sync:error", handler?: (data: Error) => void): void;
}

/**
 * Build the process-wide semantic-search components.
 *
 * - Returns `null` and logs "Semantic search: disabled" when embeddings are
 *   not configured. Callers should skip discover tool registration in that case.
 * - Otherwise: instantiates the embedding client + vector store, performs
 *   cold-start indexing if the vector store is missing entries relative to
 *   the recipe store, and subscribes to `syncEvents.on("sync:complete", …)`
 *   for incremental re-indexing.
 *
 * Tool registration is intentionally NOT done here — `buildMcpServer` calls
 * `registerDiscoverTool(server, sessionCtx, vectorStore)` per session.
 */
export async function buildDiscoverComponents(
  config: PaprikaConfig,
  store: RecipeStore,
  syncEvents: SyncEventsView,
  log?: Logger,
): Promise<VectorStore | null> {
  const embeddingsConfig = config.features?.embeddings;

  if (!embeddingsConfig) {
    process.stderr.write("[mcp-paprika] Semantic search: disabled\n");
    return null;
  }

  const embedder = new EmbeddingClient(embeddingsConfig);
  const vectorStore = new VectorStore(
    getCacheDir(),
    embedder,
    embeddingsConfig.model,
    EMBEDDING_SCHEMA_VERSION,
    log?.child({ component: "vector-store" }),
  );
  await vectorStore.init();

  // Cold-start initial indexing: the initial sync.syncOnce() in the entry
  // point fires sync:complete BEFORE this subscription exists. Re-index all
  // recipes when the vector store is empty or significantly out of sync
  // with the recipe store (stale test data, orphaned entries from a prior
  // crash, or a model/dimension change that invalidated the old vectors).
  if (store.size > 0 && vectorStore.size < store.size * 0.9) {
    vectorStore.clearHashes();
    await vectorStore.indexRecipes(store.getAll(), (uids) => store.resolveCategories(uids));
  }

  syncEvents.on("sync:complete", async (result) => {
    try {
      const changed = [...result.added, ...result.updated];

      if (changed.length === 0 && result.removedUids.length === 0) {
        return;
      }

      if (changed.length > 0) {
        await vectorStore.indexRecipes(changed, (uids) => store.resolveCategories(uids));
      }

      for (const uid of result.removedUids) {
        await vectorStore.removeRecipe(uid);
      }
    } catch (err) {
      process.stderr.write(`[mcp-paprika] Vector index error: ${toMessage(err)}\n`);
    }
  });

  process.stderr.write("[mcp-paprika] Semantic search: enabled\n");
  return vectorStore;
}
