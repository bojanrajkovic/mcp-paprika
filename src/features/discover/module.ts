import type { DiscoverApi } from "./api.js";

import { defineModule, register } from "../../kernel/registry.js";
import { loadConfig } from "../../utils/config.js";
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
 * boot phase (and, after the flip, kept warm by a per-cycle re-index seam).
 *
 * `vectorStore` is NULLABLE: it is `null` when embeddings are unconfigured, exactly
 * mirroring the legacy `buildDiscoverComponents`, which returns `null` and logs
 * "semantic search disabled" in that case. The kernel registers the
 * `discover_recipes` tool unconditionally, so the feature gate lives INSIDE the tool
 * (and inside the boot hook): both no-op cleanly when `vectorStore === null` rather
 * than being conditionally registered (ADR-0009 §5#9). The `embedder` rides along
 * for symmetry / future per-cycle re-indexing and is `null` on the same condition.
 */
export interface DiscoverSelf {
  readonly vectorStore: VectorStore | null;
  readonly embedder: EmbeddingClient | null;
}

register(
  defineModule("discover", ["recipe"])
    .self<DiscoverSelf>(async (infra) => {
      // Infra carries no `config`, so read it the same way the legacy composition
      // root does (`loadConfig` is a pure env+file read). On a config error, treat
      // discover as disabled rather than aborting the whole kernel build — the
      // legacy root only reaches `buildDiscoverComponents` once config has already
      // parsed, so a parse failure here can only mean a degraded environment; a null
      // vectorStore keeps the rest of the server up.
      const embeddingsConfig = loadConfig().match(
        (config) => config.features?.embeddings,
        () => undefined,
      );

      if (embeddingsConfig === undefined) {
        infra.log.child({ component: "discover" }).info("semantic search disabled");
        return { vectorStore: null, embedder: null };
      }

      // Build the embedding client + vector store EXACTLY as legacy buildFeatures
      // does. `infra.cacheDir` is the same base the legacy `VectorStore` received
      // (`getCacheDir()`); the store appends its own `vectors/` subdir, so this is the
      // reuse-in-place path — no `<domain>/<entity>` reshape this phase. `init()` runs
      // the corruption-recovery + model/schema-invalidation handshake (vector-store.ts).
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
        // Post-sync indexing — the cold-start reconcile the legacy root runs once the
        // initial `syncOnce()` has populated the recipe store (lifted from
        // `discover-feature.ts:96-121`). The kernel's boot pipeline guarantees this
        // runs AFTER the initial sync cycle, so the recipe store is warm.
        index: async (ctx) => {
          const { vectorStore } = ctx.self;
          if (vectorStore === null) return; // feature disabled — nothing to index

          const discoverLog = ctx.infra.log.child({ component: "discover" });

          // FLIP (cross-domain coupling — no kernel channel yet): the legacy
          // `reconcileIndex` reads the WHOLE recipe store:
          //
          //     if (store.size === 0) return;
          //     if (vectorStore.size < store.size * 0.9) vectorStore.clearHashes();
          //     await vectorStore.indexRecipes(store.getAll(),
          //       (uids) => categoryStore.resolveNames(uids));
          //
          // `deps.recipe.resolveCategoryNames` ALREADY exists (used in the resolver
          // callback), but the bulk enumeration does NOT: `RecipeApi` exposes
          // `get`/`resolveCategoryRefs`/`resolveCategoryNames`/`recipesInCategory`,
          // and NEITHER a `getAll(): readonly Recipe[]` NOR a `size`/`count(): number`.
          // The recipe domain owns recipes, so those two reads MUST be added to
          // RecipeApi (owning domain: recipe) for this hook to drive the cold-start
          // rebuild through the contract. Adding them is a FLIP-phase change to
          // `src/recipe/api.ts` + `src/recipe/module.ts` (the store already has
          // `getAll()` and `size`); this inert module must not invent them, so the
          // rebuild body is deferred rather than calling methods that do not exist.
          //
          // FLIP (per-cycle re-index — no kernel channel yet): the legacy root ALSO
          // subscribes `sync:complete` (re-embed added/updated recipes, drop removed
          // UIDs, retry a failed startup reconcile) and `sync:category-change`
          // (re-embed recipes under a renamed/removed category — a rename changes no
          // recipe hash, so the recipe diff never re-fetches them). `SyncContribution`
          // returns `AnySyncResult | void`, which has no channel to deliver those
          // signals to discover. The flip wires a discover write-hook / event (an
          // emitter on `Infra`, or a widened sync return union) and moves this hook's
          // body + the two subscriptions onto it.
          discoverLog.debug(
            "discover index boot hook: deferred — awaiting RecipeApi.getAll()/size + a per-cycle re-index channel (FLIP)",
          );
        },
      },
    })),
);
