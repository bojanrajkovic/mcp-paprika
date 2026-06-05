import type { DiscoverApi } from "./api.js";

import { defineModule, register } from "../../kernel/registry.js";
import { EMBEDDING_SCHEMA_VERSION, EmbeddingClient } from "../embeddings.js";
import { VectorStore } from "../vector-store.js";
import { discoverRecipesTool } from "./tools/discover-recipes.js";

declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    discover: DiscoverApi;
  }
}

/**
 * The discover module's internals. A FEATURE module: it owns the DERIVED vector
 * index, not a Paprika entity, so it has no store/cache pair and contributes no
 * `syncs[]` — the index is rebuilt from the recipe store on the post-sync `index`
 * boot phase and kept warm by the kernel re-index seam (`infra.indexEvents`).
 *
 * `vectorStore` is NULLABLE: it is `null` when embeddings are unconfigured
 * ("semantic search disabled"). The kernel registers the
 * `discover_recipes` tool unconditionally, so the feature gate lives INSIDE the tool
 * (and inside the boot hook): both no-op cleanly when `vectorStore === null` rather
 * than being conditionally registered (ADR-0009 §5#9). The `embedder` rides along
 * for symmetry / future per-cycle re-indexing and is `null` on the same condition.
 */
export interface DiscoverState {
  readonly vectorStore: VectorStore | null;
  readonly embedder: EmbeddingClient | null;
}

register(
  defineModule("discover", ["recipe"])
    .state<DiscoverState>(async (infra) => {
      // Read embeddings config off the root's single parsed config (carried on infra).
      // Using `infra.config` ensures there is no second, divergent parse whose error
      // arm would silently disable the feature. Unconfigured → a null vectorStore,
      // and both the tool and the index hook below no-op cleanly.
      const embeddingsConfig = infra.config.features?.embeddings;

      if (embeddingsConfig === undefined) {
        infra.log.child({ component: "discover" }).info("semantic search disabled");
        return { vectorStore: null, embedder: null };
      }

      // Build the embedding client + vector store. `infra.cacheDir` is the base the
      // `VectorStore` receives; the store appends its own `vectors/` subdir. `init()`
      // runs the corruption-recovery + model/schema-invalidation handshake (vector-store.ts).
      const embedder = new EmbeddingClient(embeddingsConfig, infra.log.child({ component: "embeddings" }));
      const vectorStore = new VectorStore(
        infra.cacheDir,
        embedder,
        embeddingsConfig.model,
        EMBEDDING_SCHEMA_VERSION,
        infra.log.child({ component: "vector-store" }),
      );
      await vectorStore.init();

      return { vectorStore, embedder };
    })
    .build(() => ({
      api: {},
      tools: [discoverRecipesTool],
      // No syncs[] — discover owns no Paprika entity. The vector index is derived
      // from recipes and (re)built on the post-sync `index` boot phase below, not
      // reconciled in the sync cycle.
      onReady: {
        // Post-sync indexing — the cold-start reconcile + the live re-index subscription,
        // driven off the kernel re-index seam. The boot pipeline guarantees this runs AFTER
        // the initial `syncOnce()`, so the recipe store is warm. All recipe reads go through
        // the recipe contract (`ctx.deps.recipe`), never a store reach-around.
        index: async (ctx) => {
          const { vectorStore } = ctx.state;
          if (vectorStore === null) return; // feature disabled — nothing to index

          const discoverLog = ctx.infra.log.child({ component: "discover" });
          const resolveNames = ctx.deps.recipe.resolveCategoryNames;

          // Reconcile the whole index against the recipe store. `indexRecipes` re-embeds
          // only recipes whose embedding text drifted (skipping the rest by content hash,
          // so this is cheap when nothing changed), and clears hashes first when the index
          // is short relative to the store to force a full rebuild. Used at startup and as
          // the retry below.
          const reconcile = async (): Promise<void> => {
            if (ctx.deps.recipe.size() === 0) return;
            if (vectorStore.size < ctx.deps.recipe.size() * 0.9) vectorStore.clearHashes();
            await vectorStore.indexRecipes(ctx.deps.recipe.getAll(), resolveNames);
          };

          // Startup reconciliation. The initial `syncOnce()` fired its re-index events
          // BEFORE this subscription existed, so anything that changed while the server was
          // down — notably a category rename, which changes no recipe hash — is repaired
          // here (#177). Best-effort: a transient embeddings outage at startup must not
          // crash the process; on failure, latch a retry the per-cycle handler drains.
          let reconcilePending = false;
          try {
            await reconcile();
          } catch (err) {
            reconcilePending = true;
            discoverLog.error(
              { err },
              "vector index error during startup reconcile; will retry on the next sync cycle",
            );
          }

          // The single re-index channel: recipe writes and the recipe/category reconciles
          // emit here; discover
          // re-embeds. Handlers are fire-and-forget (the VectorStore serializes its writes
          // via an async-mutex, so overlapping emits are safe) and each swallows its own
          // errors — a re-index failure must not break a sync cycle or a tool write.
          ctx.infra.indexEvents.on((event) => {
            void (async () => {
              try {
                if (event.type === "recipe-changed") {
                  // Fires every cycle: drain a pending startup reconcile first (the #177
                  // self-heal — a recovered embeddings backend repairs without a recipe
                  // edit), then re-embed any changed recipes.
                  if (reconcilePending) {
                    reconcilePending = false;
                    try {
                      await reconcile();
                    } catch (err) {
                      reconcilePending = true;
                      discoverLog.error(
                        { err },
                        "vector index startup-reconcile retry failed; will retry on the next cycle",
                      );
                    }
                  }
                  if (event.recipes.length > 0) await vectorStore.indexRecipes(event.recipes, resolveNames);
                } else if (event.type === "recipe-removed") {
                  for (const uid of event.uids) await vectorStore.removeRecipe(uid);
                } else {
                  // category-changed: re-embed every live recipe referencing a changed
                  // category — its display name is baked into their embedding text, but no
                  // recipe hash changed, so the recipe diff never re-fetched them. Read
                  // recipes through the contract.
                  const changed = new Set<string>(event.uids);
                  const affected = ctx.deps.recipe.getAll().filter((r) => r.categories.some((uid) => changed.has(uid)));
                  if (affected.length > 0) await vectorStore.indexRecipes(affected, resolveNames);
                }
              } catch (err) {
                discoverLog.error({ err }, "vector index error during re-index");
              }
            })();
          });

          discoverLog.info("semantic search enabled");
        },
      },
    })),
);
