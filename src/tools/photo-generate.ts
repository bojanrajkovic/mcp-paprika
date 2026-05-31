import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { RecipeUidSchema, type Photo } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";
import { toMessage } from "../utils/log.js";
import {
  type PhotographyClient,
  type ReferenceImage,
  recipeToPhotoPrompt,
  PHOTO_MODELS,
  PHOTO_ASPECT_RATIOS,
  DEFAULT_PHOTO_MODEL,
} from "../features/photography.js";
import { coldStartGuard, textResult } from "./helpers.js";
import { attachPhotoToRecipe, normalizePhoto } from "./photo-helpers.js";

/** Longest edge (px) we cap generated `full` images to before upload (see normalizePhoto). */
const GENERATED_MAX_FULL_EDGE = 2048;
/** Reference-image (restyle) download cap. */
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const REFERENCE_FETCH_TIMEOUT_MS = 15_000;

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

/** Fetch the recipe's current photo bytes for image-to-image restyling. */
async function fetchReferenceImage(url: string): Promise<{ image: ReferenceImage } | { error: string }> {
  let res: Response;
  try {
    res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(REFERENCE_FETCH_TIMEOUT_MS) });
  } catch (e) {
    return { error: `Failed to download the existing photo to restyle: ${toMessage(e)}` };
  }
  if (!res.ok) return { error: `Failed to download the existing photo to restyle: HTTP ${res.status.toString()}` };

  const declared = res.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_REFERENCE_BYTES) {
    return { error: "The existing photo is too large to restyle." };
  }
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length === 0) return { error: "The existing photo was empty." };
  if (data.length > MAX_REFERENCE_BYTES) return { error: "The existing photo is too large to restyle." };

  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/jpeg";
  return { image: { data, mimeType } };
}

export function registerGeneratePhotoTool(
  server: McpServer,
  ctx: ServerContext,
  photographyClient: PhotographyClient,
): void {
  const log = ctx.log.child({ component: "generate_photo" });
  server.registerTool(
    "generate_photo",
    {
      description:
        "Generate a styled food photo for a recipe with an AI image model and (by default) attach it to the " +
        "recipe. The prompt is built from the recipe's name, description, and categories — so well-described, " +
        "categorized recipes produce the best results; pass `style` to guide plating or describe an obscure dish. " +
        "Set restyle_existing:true to re-style the recipe's current photo instead of generating from scratch. " +
        "Set attach:false to preview without saving.",
      inputSchema: generatePhotoInputSchema.shape,
    },
    async (args) => {
      const model = args.model ?? DEFAULT_PHOTO_MODEL;
      const restyle = args.restyle_existing ?? false;
      const attach = args.attach ?? true;
      log.info({ tool: "generate_photo", recipe_uid: args.recipe_uid, model, restyle, attach }, "tool invoked");

      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // order_flag for the attach path derives from the synced gallery.
          if (attach && !ctx.photoStore.hasSynced) {
            return textResult("The photo catalog is still syncing; try again in a moment.");
          }
          const recipe = ctx.store.get(args.recipe_uid);
          if (recipe === undefined) return textResult(`No recipe found with UID "${args.recipe_uid}".`);

          // Restyle source: the recipe's CURRENT photo (the only image the server
          // can reach — chat-uploaded bytes never arrive at an MCP server).
          let referenceImage: ReferenceImage | undefined;
          if (restyle) {
            if (recipe.photoUrl === null || recipe.photoUrl === "") {
              return textResult(
                `"${recipe.name}" has no photo to restyle. Generate one first (restyle_existing:false), or use upload_photo.`,
              );
            }
            const ref = await fetchReferenceImage(recipe.photoUrl);
            if ("error" in ref) return textResult(ref.error);
            referenceImage = ref.image;
          }

          const categoryNames = ctx.categoryStore.resolveNames(recipe.categories);
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
            return textResult(`Failed to generate photo: ${toMessage(error)}`);
          }

          let thumbnail: Buffer;
          let full: Buffer;
          try {
            ({ thumbnail, full } = await normalizePhoto(generated.bytes, { maxFullEdge: GENERATED_MAX_FULL_EDGE }));
          } catch (error) {
            log.error({ err: error, recipe_uid: args.recipe_uid }, "normalizePhoto failed");
            return textResult(`Generated an image but failed to process it: ${toMessage(error)}`);
          }

          const costSuffix = generated.costUsd !== null ? ` (cost: $${generated.costUsd.toFixed(4)})` : "";

          // Preview-only: return the lightweight ~280px thumbnail inline (not the
          // full image — keeps the tool result small) without persisting. The
          // saved version (attach:true) is the full-resolution image.
          if (!attach) {
            return {
              content: [
                {
                  type: "text",
                  text: `Generated a preview (≈280px thumbnail) for "${recipe.name}" using ${model}${costSuffix}. Not attached — call again with attach:true to save the full-resolution image.`,
                },
                { type: "image", data: thumbnail.toString("base64"), mimeType: "image/jpeg" },
              ],
            };
          }

          let photo: Photo;
          try {
            photo = await attachPhotoToRecipe(ctx, recipe, thumbnail, full);
          } catch (error) {
            log.error({ err: error, recipe_uid: args.recipe_uid }, "attachPhotoToRecipe failed");
            return textResult(`Generated an image but failed to attach it: ${toMessage(error)}`);
          }

          return textResult(
            `Generated a photo for "${recipe.name}" using ${model}${costSuffix} and attached it (photo UID: ${photo.uid}).`,
          );
        },
        (guard) => guard,
      );
    },
  );
}
