import type { PhotoGenApi } from "./api.js";

import { defineModule, register } from "../../kernel/registry.js";
import { loadConfig, resolveImageGenConfig } from "../../utils/config.js";
import { GeneratedImageStore } from "../generated-image-store.js";
import { PhotographyClient } from "../photography.js";
import { generatePhotoTool } from "./tools/generate.js";

// Self-register the public contract TYPE. Photo-gen is a FEATURE (the AI
// recipe-photo generation surface): no sibling consumes it, so its contract is
// empty — exactly like discover. It DEPENDS ON recipe (it validates the target
// recipe and resolves category names for the prompt via `ctx.deps.recipe`), but
// nothing depends ON it.
declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    "photo-gen": PhotoGenApi;
  }
}

/**
 * The photo-gen module's internals. A FEATURE module: it owns no Paprika entity,
 * so it has no store/cache pair and contributes no `syncs[]`.
 *
 * `generatedImageStore` is the ONE piece of state photo-gen genuinely owns: the
 * ephemeral `gen_…` preview ring buffer (`generate_recipe_photo` attach:false stashes
 * the full bytes here; recipe's `upload_recipe_photo` later `consume`s the token). It
 * is in-memory, bounded + short-TTL, with NO `DiskCache` and NO `init()` — built once
 * at kernel construction (once per process), never per session.
 *
 * `photographyClient` is the OpenRouter image-generation HTTP client, carried as a
 * NULLABLE field: `null` when image generation is unconfigured, exactly mirroring the
 * legacy `buildFeatures`, which sets `photographyClient = null` in that case. The
 * kernel registers `generate_recipe_photo` unconditionally, so the feature gate lives
 * INSIDE the tool (ADR-0009 §5#9): it no-ops with a clear "not configured" message
 * when `photographyClient === null` rather than being conditionally registered.
 */
export interface PhotoGenSelf {
  readonly generatedImageStore: GeneratedImageStore;
  readonly photographyClient: PhotographyClient | null;
}

register(
  defineModule("photo-gen", ["recipe"])
    .self<PhotoGenSelf>(async (infra) => {
      // Owned, in-memory, no disk, no init() — the ephemeral preview ring buffer.
      const generatedImageStore = new GeneratedImageStore();

      // Build the photography client EXACTLY as legacy `buildFeatures` does:
      //   resolveImageGenConfig(config) !== null
      //     ? new PhotographyClient(resolved, log.child({ component: "photography" }))
      //     : null
      // `Infra` carries no `config`, so read it the same way the discover module
      // does (`loadConfig` is a pure env+file read). On a config error, treat photo
      // generation as disabled (null client) rather than aborting the whole kernel
      // build — the legacy root reaches `buildFeatures` only after config has already
      // parsed, so a parse failure here means a degraded environment; a null client
      // keeps the rest of the server up and the tool degrades to its gate message.
      const resolvedImageGen = loadConfig().match(
        (config) => resolveImageGenConfig(config),
        () => null,
      );
      const photographyClient =
        resolvedImageGen !== null
          ? new PhotographyClient(resolvedImageGen, infra.log.child({ component: "photography" }))
          : null;

      return { generatedImageStore, photographyClient };
    })
    .build(() => ({
      api: {},
      // ctx is INFERRED: DomainCtx<PhotoGenSelf, "recipe">. The tool reaches recipe via
      // `ctx.deps.recipe` (read contract only) and its OWN ring buffer via `ctx.self`.
      tools: [generatePhotoTool],
      // Owns no Paprika entity → contributes NO sync reconciles (the generated-image
      // store is in-memory and never syncs). No resource (feature, not Content).
    })),
);
