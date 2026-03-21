import { EmbeddingClient } from "./embeddings.js";
import { VectorStore } from "./vector-store.js";
import { registerDiscoverTool } from "../tools/discover.js";
import { getCacheDir } from "../utils/xdg.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../types/server-context.js";
import type { SyncEngine } from "../paprika/sync.js";
import type { PaprikaConfig } from "../utils/config.js";

export async function setupDiscoverFeature(
  server: McpServer,
  ctx: ServerContext,
  sync: SyncEngine,
  config: PaprikaConfig,
): Promise<void> {
  const embeddingsConfig = config.features?.embeddings;

  if (!embeddingsConfig) {
    process.stderr.write("[mcp-paprika] Semantic search: disabled\n");
    return;
  }

  const embedder = new EmbeddingClient(embeddingsConfig);
  const vectorStore = new VectorStore(getCacheDir(), embedder);
  await vectorStore.init();

  registerDiscoverTool(server, ctx, vectorStore);

  // Cold-start initial indexing: the initial sync.syncOnce() in index.ts fires
  // sync:complete BEFORE this subscription exists. On first-ever startup (empty
  // vector index), explicitly index all recipes already in the store.
  if (vectorStore.size === 0 && ctx.store.size > 0) {
    await vectorStore.indexRecipes(ctx.store.getAll(), (uids) => ctx.store.resolveCategories(uids));
  }

  sync.events.on("sync:complete", async (result) => {
    try {
      const changed = [...result.added, ...result.updated];

      if (changed.length === 0 && result.removedUids.length === 0) {
        return;
      }

      if (changed.length > 0) {
        await vectorStore.indexRecipes(changed, (uids) => ctx.store.resolveCategories(uids));
      }

      for (const uid of result.removedUids) {
        await vectorStore.removeRecipe(uid);
      }
    } catch (err) {
      process.stderr.write(`[mcp-paprika] Vector index error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  });

  process.stderr.write("[mcp-paprika] Semantic search: enabled\n");
}
