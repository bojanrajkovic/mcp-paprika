import type { PhotoGenApi } from "./api.js";

import { defineModule, register } from "../../kernel/registry.js";
import { resolveImageGenConfig } from "../../utils/config.js";
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
 * The ephemeral `gen_…` preview ring buffer is NOT a `state` field: it's a
 * recipe↔photo-gen handoff (`generate_recipe_photo` attach:false stashes; recipe's
 * `upload_recipe_photo` generation_token consumes), so it rides `infra` as a shared
 * seam (`Infra.generatedImageStore`) rather than either module's `state` — the same
 * reason a recipe→photo-gen dependency edge would be a cycle.
 *
 * `photographyClient` is the OpenRouter image-generation HTTP client, carried as a
 * NULLABLE field: `null` when image generation is unconfigured. The kernel registers
 * `generate_recipe_photo` unconditionally, so the feature gate lives
 * INSIDE the tool (ADR-0009 §5#9): it no-ops with a clear "not configured" message
 * when `photographyClient === null` rather than being conditionally registered.
 */
export interface PhotoGenState {
  readonly photographyClient: PhotographyClient | null;
}

register(
  defineModule("photo-gen", ["recipe"])
    .state<PhotoGenState>(async (infra) => {
      // Build the photography client from the root's single parsed config on `infra`.
      // A single config parse means no second, divergent parse whose error arm would
      // silently disable the feature. `null` (image generation unconfigured) degrades
      // the tool to its feature gate.
      const resolvedImageGen = resolveImageGenConfig(infra.config);
      const photographyClient =
        resolvedImageGen !== null
          ? new PhotographyClient(resolvedImageGen, infra.log.child({ component: "photography" }))
          : null;

      return { photographyClient };
    })
    .build(() => ({
      api: {},
      // ctx is INFERRED: DomainCtx<PhotoGenState, "recipe">. The tool reaches recipe via
      // `ctx.deps.recipe` (the read contract + attachGeneratedPhoto), the shared preview
      // ring buffer via `ctx.infra.generatedImageStore`, and its client via `ctx.state`.
      tools: [generatePhotoTool],
      // Owns no Paprika entity → contributes NO sync reconciles (the generated-image
      // store is in-memory and never syncs). No resource (feature, not Content).
    })),
);
