import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { ReferenceImage } from "../../photography.js";
import type { PhotoGenSelf } from "../module.js";

import { RecipeUidSchema } from "../../../ids.js";
import { textResult } from "../../../tools/helpers.js";
import { fetchImageBytes } from "../../../tools/photo-fetch.js";
import { makeThumbnail } from "../../../tools/photo-helpers.js";
import { CircuitOpenError } from "../../../utils/errors.js";
import { toMessage } from "../../../utils/log.js";
import { PhotographyAPIError, PhotographyError } from "../../photography-errors.js";
import { DEFAULT_PHOTO_MODEL, PHOTO_ASPECT_RATIOS, PHOTO_MODELS, recipeToPhotoPrompt } from "../../photography.js";

/**
 * Input schema lifted verbatim from `src/tools/photo-generate.ts`. Kept exported so
 * the flip-phase tests can `safeParse` the `.strict`-style enums directly (the
 * kernel test harness bypasses Zod, per the test-harness note).
 */
export const generatePhotoInputSchema = z.object({
  recipe_uid: RecipeUidSchema.describe("UID of the recipe to generate a photo for."),
  model: z
    .enum(PHOTO_MODELS)
    .optional()
    .describe(
      "Image model (default seedream). Relative tradeoffs (not absolute prices, which change): " +
        "seedream — inexpensive, fast, strong food realism (recommended). " +
        "nano-banana (Google Gemini 2.5) — among the cheapest and fastest. " +
        "nano-banana-2 (Gemini 3.1) — higher-end Gemini. " +
        "gpt-image (GPT Image 2) — highest quality but markedly slower and pricier; its latency can " +
        "exceed some MCP clients' request timeouts. Check OpenRouter for current per-image pricing.",
    ),
  style: z
    .string()
    .optional()
    .describe(
      "Optional free-text styling/plating guidance appended to the prompt (e.g. " +
        "'on a white marble surface, bright daylight'). Use it to steer plating, or to describe an " +
        "obscure dish the model may not recognize from its name alone.",
    ),
  aspect_ratio: z
    .enum(PHOTO_ASPECT_RATIOS)
    .optional()
    .describe("Output aspect ratio (default 1:1, a square thumbnail). Options: 1:1, 4:3, 3:2, 16:9."),
  restyle_existing: z
    .boolean()
    .optional()
    .describe(
      "When true, restyle the recipe's CURRENT photo (image-to-image) instead of generating from " +
        "scratch — useful to re-light or re-plate an existing shot. Errors if the recipe has no photo.",
    ),
  attach: z
    .boolean()
    .optional()
    .describe("When true (default), attach the generated image to the recipe. When false, return a preview only."),
});

/**
 * Registers `generate_recipe_photo`, kernel-shaped — `DomainCtx<PhotoGenSelf, "recipe">`.
 * Lifted from `src/tools/photo-generate.ts`, rewired to the module seam:
 *   - the recipe lookup `ctx.store.get` → `ctx.deps.recipe.get` (the read contract);
 *   - `ctx.categoryStore.resolveNames` → `ctx.deps.recipe.resolveCategoryNames`
 *     (categories collapsed into recipe — see recipe's `RecipeApi`);
 *   - the restyle re-fetch `ctx.client.getRecipe` → `ctx.infra.client.getRecipe`;
 *   - the preview ring buffer `ctx.generatedImageStore` → `ctx.self.generatedImageStore` (OWNED).
 *
 * FEATURE GATE (ADR-0009 §5#9): the legacy registered this tool only when
 * `photographyClient !== null`. The kernel's `registerAll` registers every module's
 * tools unconditionally, so the gate moves INSIDE the wrapper — when
 * `ctx.self.photographyClient === null` the tool early-returns a clear
 * "not configured" message instead of failing. In the inert additive phase
 * `photographyClient` is ALWAYS null (the `.self` factory cannot reach config yet —
 * see module.ts), so this tool is a clean no-op message until the flip wires the
 * client; the gate and the inert state share one branch.
 */
export function generatePhotoTool(ctx: DomainCtx<PhotoGenSelf, "recipe">): void {
  const log = ctx.infra.log.child({ component: "generate_recipe_photo" });
  ctx.server.registerTool(
    "generate_recipe_photo",
    {
      title: "Generate a recipe photo with AI",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      description:
        "Generate a styled food photo for a recipe with an AI image model and (by default) attach it to the " +
        "recipe. The prompt is built from the recipe's name, description, and categories — so well-described, " +
        "categorized recipes produce the best results; pass `style` to guide plating or describe an obscure dish. " +
        "Set restyle_existing:true to re-style the recipe's current photo instead of generating from scratch. " +
        "Set attach:false to preview without saving.",
      inputSchema: generatePhotoInputSchema.shape,
    },
    async (args): Promise<CallToolResult> => {
      const model = args.model ?? DEFAULT_PHOTO_MODEL;
      const restyle = args.restyle_existing ?? false;
      const attach = args.attach ?? true;
      log.info({ tool: "generate_recipe_photo", recipe_uid: args.recipe_uid, model, restyle, attach }, "tool invoked");

      // FEATURE GATE — null when image generation is unconfigured (and ALWAYS null
      // in the inert additive phase, since `.self` cannot reach config yet). Mirrors
      // the legacy `app.photographyClient !== null` registration gate, moved inside.
      const photographyClient = ctx.self.photographyClient;
      if (photographyClient === null) {
        return textResult(
          "AI photo generation is not configured on this server. Set IMAGE_GEN_API_KEY (or reuse the " +
            "embeddings credentials) to enable generate_recipe_photo.",
        );
      }

      const recipe = ctx.deps.recipe.get(args.recipe_uid);
      if (recipe === undefined) return textResult(`No recipe found with UID "${args.recipe_uid}".`);

      // Restyle source: the recipe's CURRENT photo (the only image the server can
      // reach — chat-uploaded bytes never arrive at an MCP server).
      let referenceImage: ReferenceImage | undefined;
      if (restyle) {
        // The local store's photoUrl can lag a just-attached photo (the server assigns
        // photo_url, which arrives on the next sync). Re-fetch the authoritative recipe
        // so a generate→restyle chain uses the new photo; fall back to the cached value.
        let photoUrl = recipe.photoUrl;
        try {
          photoUrl = (await ctx.infra.client.getRecipe(args.recipe_uid)).photoUrl;
        } catch (error) {
          log.warn(
            { err: error, recipe_uid: args.recipe_uid },
            "restyle: recipe re-fetch failed; using cached photoUrl",
          );
        }
        if (photoUrl === null || photoUrl === "") {
          return textResult(
            `"${recipe.name}" has no photo to restyle. Generate one first (restyle_existing:false), or use upload_recipe_photo.`,
          );
        }
        // SSRF-safe fetch (same hardened path as upload_recipe_photo) — photoUrl is
        // synced data, not inherently trusted to point only at public hosts.
        const ref = await fetchImageBytes(photoUrl);
        if ("error" in ref) return textResult(`Couldn't fetch the existing photo to restyle: ${ref.error}`);
        referenceImage = { data: ref.bytes, mimeType: ref.contentType ?? "image/jpeg" };
      }

      const categoryNames = ctx.deps.recipe.resolveCategoryNames(recipe.categories);
      const prompt = recipeToPhotoPrompt(recipe, categoryNames, args.style);

      let generated;
      try {
        generated = await photographyClient.generate({
          prompt,
          model,
          ...(args.aspect_ratio !== undefined && { aspectRatio: args.aspect_ratio }),
          ...(referenceImage !== undefined && { referenceImage }),
        });
      } catch (error) {
        log.error({ err: error, recipe_uid: args.recipe_uid, model }, "image generation failed");
        if (error instanceof CircuitOpenError) {
          return textResult(
            "Image generation is temporarily unavailable — the provider circuit opened after repeated failures. Try again in a minute.",
          );
        }
        if (error instanceof PhotographyAPIError) {
          if (error.status === 401 || error.status === 403) {
            return textResult(
              "Image generation failed: the provider rejected the credentials. Check IMAGE_GEN_API_KEY (or the reused OpenRouter key).",
            );
          }
          return textResult(`Image generation failed (HTTP ${error.status.toString()}): ${toMessage(error)}`);
        }
        if (error instanceof PhotographyError) {
          return textResult(
            `The model returned no image (a refusal or text-only reply) — try a different model or a clearer style hint. (${toMessage(error)})`,
          );
        }
        return textResult(`Failed to generate photo: ${toMessage(error)}`);
      }

      const costSuffix = generated.costUsd !== null ? ` (cost: $${generated.costUsd.toFixed(4)})` : "";

      // PREVIEW path — the self-contained half photo-gen owns end-to-end: return just
      // the lightweight ~280px thumbnail inline AND stash the full generated bytes in
      // this module's OWN ring buffer under an opaque single-use `gen_` token, so the
      // user can attach THIS exact image later (`upload_recipe_photo` with
      // `generation_token`) without regenerating (non-deterministic) or round-tripping
      // base64. The token store is photo-gen-owned; the attach side reads it cross-domain.
      if (!attach) {
        let thumbnail: Buffer;
        try {
          thumbnail = await makeThumbnail(generated.bytes);
        } catch (error) {
          log.error({ err: error, recipe_uid: args.recipe_uid }, "makeThumbnail failed");
          return textResult(`Generated an image but failed to process it: ${toMessage(error)}`);
        }
        const token = ctx.self.generatedImageStore.put({
          bytes: generated.bytes,
          mimeType: generated.mimeType,
          recipeUid: args.recipe_uid,
          model,
        });
        return {
          content: [
            {
              type: "text",
              text:
                `Generated a preview (≈280px thumbnail) for "${recipe.name}" using ${model}${costSuffix}. ` +
                `Not attached. To save THIS exact image, call upload_recipe_photo with generation_token \`${token}\` ` +
                `(no need to regenerate). The preview is held for about an hour.`,
            },
            { type: "image", data: thumbnail.toString("base64"), mimeType: "image/jpeg" },
          ],
        };
      }

      // ATTACH path — UNWIRED in the additive phase. The legacy attached via
      // `attachPhotoToRecipe(ctx, …)`, which writes BOTH the photo store AND the recipe
      // store through `commitPhotoUpload`. Under domain isolation photos are RECIPE-owned
      // (recipe's `RecipeSelf.attachPhotoToRecipe`), and photo-gen reaches recipe only
      // through the READ contract `RecipeApi` (`get` + category resolvers) — which exposes
      // NO attach/write method, and NO `photoStore.hasSynced` gate the attach needs.
      //
      // FLIP: expose a recipe-domain write on `RecipeApi`, e.g.
      //   `attachGeneratedPhoto(recipeUid: RecipeUid, full: Buffer): Promise<Result<Photo, …>>`
      // (owning the `photoStore.hasSynced` guard + sharp `normalizePhoto` + the
      // `attachPhotoToRecipe` 3-request upload internally), and call it here as
      // `ctx.deps.recipe.attachGeneratedPhoto(...)`. The method does NOT exist yet — it is a
      // flip-phase addition on the RECIPE domain (the owner of the photo entity). Until then,
      // steer callers to the working preview path.
      return textResult(
        `Generated an image for "${recipe.name}" using ${model}${costSuffix}, but in-place attach is not available yet. ` +
          `Call generate_recipe_photo with attach:false to get a preview token, then upload_recipe_photo with that ` +
          `generation_token to save it.`,
      );
    },
  );
}
