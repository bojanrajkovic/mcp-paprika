import { EmbeddingClient, EMBEDDING_SCHEMA_VERSION } from "./embeddings.js";
import { VectorStore } from "./vector-store.js";
import { getCacheDir } from "../utils/xdg.js";
import type { CategoryStore } from "../cache/category-store.js";
import type { RecipeStore } from "../cache/recipe-store.js";
import type { AnySyncResult, Category, EntityChanges } from "../paprika/types.js";
import type { PaprikaConfig } from "../utils/config.js";
import type { Logger } from "pino";

/**
 * View over the SyncEngine event stream. Matches `SyncEngine.events` (a
 * `Pick<SyncEventEmitter, "on" | "off">`). Declared locally to avoid
 * pulling a hard dependency on `SyncEngine` itself.
 */
export interface SyncEventsView {
  on(event: "sync:complete", handler: (data: AnySyncResult) => void): void;
  on(event: "sync:error", handler: (data: Error) => void): void;
  on(event: "sync:category-change", handler: (data: EntityChanges<Category>) => void): void;
  off(event: "sync:complete", handler?: (data: AnySyncResult) => void): void;
  off(event: "sync:error", handler?: (data: Error) => void): void;
  off(event: "sync:category-change", handler?: (data: EntityChanges<Category>) => void): void;
}

/**
 * Re-embed every live recipe that references any of the given category UIDs.
 * The single operation behind both category-rename paths (the `update_category`
 * tool hook and the `sync:category-change` subscriber), because a category's
 * display name is baked into its recipes' embedding text via
 * `recipeToEmbeddingText`.
 *
 * Precise without filtering to true renames: `vectorStore.indexRecipes` skips
 * recipes whose embedding text (and thus content hash) is unchanged, so passing
 * UIDs that only re-parented or reordered costs a hash recompute and no
 * embedding API call. A removed category resolves to no name, dropping its token
 * from referencing recipes' text — which the same change detection re-embeds.
 */
export async function reindexRecipesForCategoryChange(
  vectorStore: VectorStore,
  store: RecipeStore,
  categoryStore: CategoryStore,
  changedUids: ReadonlyArray<string>,
): Promise<void> {
  if (changedUids.length === 0) return;
  const changed = new Set<string>(changedUids);
  const affected = store.getAll().filter((recipe) => recipe.categories.some((uid) => changed.has(uid)));
  if (affected.length === 0) return;
  await vectorStore.indexRecipes(affected, (uids) => categoryStore.resolveNames(uids));
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
  categoryStore: CategoryStore,
  syncEvents: SyncEventsView,
  log?: Logger,
): Promise<VectorStore | null> {
  const embeddingsConfig = config.features?.embeddings;
  const discoverLog = log?.child({ component: "discover" });

  if (!embeddingsConfig) {
    discoverLog?.info("semantic search disabled");
    return null;
  }

  const embedder = new EmbeddingClient(embeddingsConfig, log?.child({ component: "embeddings" }));
  const vectorStore = new VectorStore(
    getCacheDir(),
    embedder,
    embeddingsConfig.model,
    EMBEDDING_SCHEMA_VERSION,
    log?.child({ component: "vector-store" }),
  );
  await vectorStore.init();

  // Reconcile the whole index against the current store. indexRecipes re-embeds
  // only recipes whose embedding text drifted since last run (skipping the rest
  // by content hash, so this is cheap when nothing changed), and clears hashes
  // first when the index is empty/corrupt/model-invalidated to force a full
  // rebuild. Used at startup and as a retry (below).
  const reconcileIndex = async (): Promise<void> => {
    if (store.size === 0) return;
    if (vectorStore.size < store.size * 0.9) {
      vectorStore.clearHashes();
    }
    await vectorStore.indexRecipes(store.getAll(), (uids) => categoryStore.resolveNames(uids));
  };

  // Startup reconciliation. The initial sync.syncOnce() in the entry point fires
  // its events (sync:complete AND sync:category-change) BEFORE this subscription
  // exists, so anything that changed while the server was down — notably a
  // category rename, which changes no recipe hash — is missed by the live
  // handlers and must be repaired here (#177).
  //
  // Best-effort: a transient embeddings outage at startup must not crash the
  // process. On failure, flag a retry — the recipe sync:complete handler below
  // re-attempts it on the next cycle (which fires even with no recipe changes),
  // so a recovered embeddings backend self-heals without waiting for a recipe
  // edit or a restart.
  let reconcilePending = false;
  try {
    await reconcileIndex();
  } catch (err) {
    reconcilePending = true;
    discoverLog?.error({ err }, "vector index error during startup reconcile; will retry on the next sync cycle");
  }

  syncEvents.on("sync:complete", async (result) => {
    try {
      if (result.changeType !== "recipes") return;

      // Retry a failed startup reconcile (e.g. embeddings were down at boot).
      // The recipes event fires every cycle, including no-change cycles, so this
      // keeps retrying until the full index is repaired, then stops.
      if (reconcilePending) {
        reconcilePending = false;
        try {
          await reconcileIndex();
        } catch (err) {
          reconcilePending = true;
          discoverLog?.error({ err }, "vector index startup-reconcile retry failed; will retry on the next cycle");
        }
      }

      const changed = [...result.changes.added, ...result.changes.updated];

      if (changed.length === 0 && result.changes.removedUids.length === 0) {
        return;
      }

      if (changed.length > 0) {
        await vectorStore.indexRecipes(changed, (uids) => categoryStore.resolveNames(uids));
      }

      for (const uid of result.changes.removedUids) {
        await vectorStore.removeRecipe(uid);
      }
    } catch (err) {
      discoverLog?.error({ err }, "vector index error during sync-driven re-index");
    }
  });

  // App-side category renames/deletes don't change any recipe's hash, so the
  // recipe sync above never re-fetches the affected recipes. Re-embed them when
  // the category catalog reports a name-relevant change.
  syncEvents.on("sync:category-change", async (changes) => {
    try {
      const changedUids = [...changes.updated.map((c) => c.uid), ...changes.removedUids];
      await reindexRecipesForCategoryChange(vectorStore, store, categoryStore, changedUids);
    } catch (err) {
      discoverLog?.error({ err }, "vector index error during category-change re-index");
    }
  });

  discoverLog?.info("semantic search enabled");
  return vectorStore;
}
