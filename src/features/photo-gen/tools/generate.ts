import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { ReferenceImage } from "../../photography.js";
import type { PhotoGenState } from "../module.js";

import { RecipeUidSchema } from "../../../domains/recipe/ids.js";
import { makeThumbnail } from "../../../domains/recipe/photo-helpers.js";
import { defineTool } from "../../../kernel/tool.js";
import { fetchImageBytes } from "../../../shared/photo-fetch.js";
import { imageResult, toolResult } from "../../../shared/tools.js";
import { CircuitOpenError } from "../../../utils/errors.js";
import { toMessage } from "../../../utils/log.js";
import { PhotographyAPIError } from "../../photography-errors.js";
import { DEFAULT_PHOTO_MODEL, PHOTO_ASPECT_RATIOS, PHOTO_MODELS, recipeToPhotoPrompt } from "../../photography.js";

/**
 * Kept exported so tests can `safeParse` the `.strict`-style enums directly (the
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
 * `generate_recipe_photo` — generate (or restyle) an AI photo for a recipe. Reaches
 * recipe via `ctx.deps.recipe` (the read contract + `attachGeneratedPhoto`) and the
 * ephemeral preview ring buffer via `ctx.infra.generatedImageStore` — a shared
 * recipe↔photo-gen seam that avoids a dependency cycle.
 *
 * FEATURE GATE: the kernel registers every module's tools
 * unconditionally. When `ctx.state.photographyClient === null` (image generation
 * unconfigured) the tool early-returns a clear "not configured" message.
 */
export const generatePhotoTool = defineTool(
  {
    name: "generate_recipe_photo",
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
  (ctx: DomainCtx<PhotoGenState, "recipe">) => {
    const log = ctx.infra.log.child({ component: "generate_recipe_photo" });
    return async (args): Promise<CallToolResult> => {
      const model = args.model ?? DEFAULT_PHOTO_MODEL;
      const restyle = args.restyle_existing ?? false;
      const attach = args.attach ?? true;

      // FEATURE GATE — null when image generation is unconfigured.
      const photographyClient = ctx.state.photographyClient;
      if (photographyClient === null) {
        return toolResult(
          "AI photo generation is not configured on this server. Set IMAGE_GEN_API_KEY (or reuse the " +
            "embeddings credentials) to enable generate_recipe_photo.",
        );
      }

      const recipe = ctx.deps.recipe.get(args.recipe_uid);
      if (recipe === undefined)
        return toolResult(`No recipe found with UID "${args.recipe_uid}" (it may not exist or was already deleted).`);

      // Restyle source: the recipe's CURRENT photo (the only image the server can
      // reach — chat-uploaded bytes never arrive at an MCP server).
      let referenceImage: ReferenceImage | undefined;
      if (restyle) {
        // The local store's photoUrl can lag a just-attached photo (the server assigns
        // photo_url, which arrives on the next sync). Re-fetch the authoritative recipe
        // so a generate→restyle chain uses the new photo; fall back to the cached value.
        const photoUrl = (await ctx.infra.client.getRecipe(args.recipe_uid)).match(
          (fresh) => fresh.photoUrl,
          (e) => {
            log.warn({ err: e, recipe_uid: args.recipe_uid }, "restyle: recipe re-fetch failed; using cached photoUrl");
            return recipe.photoUrl;
          },
        );
        if (photoUrl === null || photoUrl === "") {
          return toolResult(
            `"${recipe.name}" has no photo to restyle. Generate one first (restyle_existing:false), or use upload_recipe_photo.`,
          );
        }
        // SSRF-safe fetch (same hardened path as upload_recipe_photo) — photoUrl is
        // synced data, not inherently trusted to point only at public hosts.
        const ref = await fetchImageBytes(photoUrl);
        if ("error" in ref) return toolResult(`Couldn't fetch the existing photo to restyle: ${ref.error}`);
        referenceImage = { data: ref.bytes, mimeType: ref.contentType ?? "image/jpeg" };
      }

      const categoryNames = ctx.deps.recipe.resolveCategoryNames(recipe.categories);
      const prompt = recipeToPhotoPrompt(recipe, categoryNames, args.style);

      const generated = (
        await photographyClient.generate({
          prompt,
          model,
          ...(args.aspect_ratio !== undefined && { aspectRatio: args.aspect_ratio }),
          ...(referenceImage !== undefined && { referenceImage }),
        })
      ).match(
        (v) => v,
        (error) => {
          log.error({ err: error, recipe_uid: args.recipe_uid, model }, "image generation failed");
          if (error instanceof CircuitOpenError) {
            return toolResult(
              "Image generation is temporarily unavailable — the provider circuit opened after repeated failures. Try again in a minute.",
            );
          }
          if (error instanceof PhotographyAPIError) {
            if (error.status === 401 || error.status === 403) {
              return toolResult(
                "Image generation failed: the provider rejected the credentials. Check IMAGE_GEN_API_KEY (or the reused OpenRouter key).",
              );
            }
            return toolResult(`Image generation failed (HTTP ${error.status.toString()}): ${toMessage(error)}`);
          }
          // A base PhotographyError with no cause is the client's own classification
          // (a refusal / text-only reply / non-data-URI payload); one WITH a cause
          // wraps a foreign escape (malformed envelope, abort) — keep the generic copy.
          if (error.cause === undefined) {
            return toolResult(
              `The model returned no image (a refusal or text-only reply) — try a different model or a clearer style hint. (${toMessage(error)})`,
            );
          }
          return toolResult(`Failed to generate photo: ${toMessage(error)}`);
        },
      );
      if ("content" in generated) return generated;

      const costSuffix = generated.costUsd !== null ? ` (cost: $${generated.costUsd.toFixed(4)})` : "";

      // PREVIEW path — return just the lightweight ~280px thumbnail inline AND stash the
      // full generated bytes in the shared infra preview ring buffer under an opaque
      // single-use `gen_` token, so the user can attach THIS exact image later
      // (`upload_recipe_photo` with `generation_token`) without regenerating
      // (non-deterministic) or round-tripping base64. The store rides `infra` so recipe's
      // upload tool can consume the token — the recipe↔photo-gen handoff a dep edge can't carry.
      if (!attach) {
        let thumbnail: Buffer;
        try {
          thumbnail = await makeThumbnail(generated.bytes);
        } catch (error) {
          log.error({ err: error, recipe_uid: args.recipe_uid }, "makeThumbnail failed");
          return toolResult(`Generated an image but failed to process it: ${toMessage(error)}`);
        }
        const token = ctx.infra.generatedImageStore.put({
          bytes: generated.bytes,
          mimeType: generated.mimeType,
          recipeUid: args.recipe_uid,
          model,
        });
        return imageResult(
          `Generated a preview (≈280px thumbnail) for "${recipe.name}" using ${model}${costSuffix}. ` +
            `Not attached. To save THIS exact image, call upload_recipe_photo with generation_token \`${token}\` ` +
            `(no need to regenerate). The preview is held for about an hour.`,
          thumbnail,
        );
      }

      // ATTACH path — photos are RECIPE-owned, so the attach goes through the recipe
      // contract: `ctx.deps.recipe.attachGeneratedPhoto` owns the `photo.store.hasSynced`
      // gate + the sharp normalization (generated edge cap) + the verified 3-request upload
      // through recipe's own `attachPhotoToRecipe` chokepoint — the same path
      // upload_recipe_photo's generated source takes. photo-gen passes the raw full bytes
      // and never reaches recipe's store. It returns a Result so a failed attach renders a
      // message (and points at the preview-token fallback) rather than throwing.
      return (await ctx.deps.recipe.attachGeneratedPhoto(args.recipe_uid, generated.bytes)).match(
        (photo) =>
          toolResult(
            `Generated and attached a photo to "${recipe.name}" using ${model}${costSuffix} (photo UID: ${photo.uid}).`,
          ),
        (e) =>
          toolResult(
            `Generated an image for "${recipe.name}" using ${model}${costSuffix}, but attaching it failed: ${e.message} ` +
              `Retry, or call generate_recipe_photo with attach:false to get a preview token and upload_recipe_photo it separately.`,
          ),
      );
    };
  },
);
