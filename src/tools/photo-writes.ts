import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { PhotoUidSchema, RecipeUidSchema, type Photo } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";
import { toMessage } from "../utils/log.js";
import { coldStartGuard, textResult } from "./helpers.js";
import { attachPhotoToRecipe, commitPhotoDelete, normalizePhoto } from "./photo-helpers.js";
import { fetchImageBytes, MAX_IMAGE_BYTES } from "./photo-fetch.js";

export const uploadPhotoInputSchema = z.object({
  recipe_uid: RecipeUidSchema.describe("UID of the recipe to attach the photo to."),
  url: z
    .string()
    .url()
    .optional()
    .describe(
      "HTTP(S) URL of an image. PREFERRED — the server downloads it and re-encodes to JPEG. Pass a link, " +
        "not inline bytes. Provide exactly one of `url` or `image_base64`.",
    ),
  image_base64: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Base64-encoded image bytes. For programmatic/testing callers only; agents should use `url`. " +
        "Provide exactly one of `url` or `image_base64`.",
    ),
});

export const deletePhotoInputSchema = z.object({
  photo_uid: PhotoUidSchema.describe("UID of the photo to delete."),
});

/** Magic-byte sniff for the raster formats sharp decodes (Paprika stores all as JPEG). */
function sniffImage(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true; // JPEG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true; // PNG
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true; // GIF
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return true; // WEBP
  return false;
}

/** Resolves the image bytes from `url` XOR `image_base64`, or returns an error message. */
async function resolveBytes(args: {
  url?: string | undefined;
  image_base64?: string | undefined;
}): Promise<{ bytes: Buffer } | { error: string }> {
  const hasUrl = args.url !== undefined;
  const hasB64 = args.image_base64 !== undefined;
  if (hasUrl === hasB64) return { error: "Provide exactly one of `url` or `image_base64`." };

  if (hasUrl) {
    // SSRF-safe fetch (scheme + IP-literal guard, rebinding-safe dispatcher,
    // redirect block, streaming size cap) — shared with generate_photo's restyle.
    const fetched = await fetchImageBytes(args.url!);
    return "error" in fetched ? fetched : { bytes: fetched.bytes };
  }

  const buf = Buffer.from(args.image_base64!, "base64");
  if (buf.length === 0) return { error: "Invalid or empty base64 image data." };
  if (buf.length > MAX_IMAGE_BYTES) {
    return { error: `Image too large (${buf.length.toString()} bytes; max ${MAX_IMAGE_BYTES.toString()}).` };
  }
  return { bytes: buf };
}

export function registerUploadPhotoTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "upload_photo" });
  server.registerTool(
    "upload_photo",
    {
      description:
        "Attach a photo to a recipe. Provide the image as a `url` (PREFERRED — the server downloads it) OR, " +
        "for programmatic callers, inline `image_base64`. If you created the recipe from a web page, pass that " +
        "page's main/hero (og:image) image URL here as `url`. The server normalizes any format (JPEG/PNG/WEBP/GIF) " +
        "to JPEG and generates the thumbnail automatically. There is NO file-path option — the server cannot " +
        "read your local filesystem. Photos are appended to the recipe's gallery in order.",
      inputSchema: uploadPhotoInputSchema.shape,
    },
    async (args) => {
      log.info(
        { tool: "upload_photo", recipe_uid: args.recipe_uid, source: args.url !== undefined ? "url" : "base64" },
        "tool invoked",
      );
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Gate on the photo catalog being synced — order_flag/name are derived from the
          // existing gallery, so uploading before photos sync could assign a colliding index.
          if (!ctx.photoStore.hasSynced) {
            return textResult("The photo catalog is still syncing; try again in a moment.");
          }
          const recipe = ctx.store.get(args.recipe_uid);
          if (recipe === undefined) return textResult(`No recipe found with UID "${args.recipe_uid}".`);

          const resolved = await resolveBytes(args);
          if ("error" in resolved) return textResult(resolved.error);
          if (!sniffImage(resolved.bytes)) {
            return textResult("Unsupported image format. Provide a JPEG, PNG, WEBP, or GIF image.");
          }

          let thumbnail: Buffer;
          let full: Buffer;
          try {
            ({ thumbnail, full } = await normalizePhoto(resolved.bytes));
          } catch (error) {
            log.error({ err: error, recipe_uid: args.recipe_uid }, "normalizePhoto failed");
            return textResult(`Failed to process image: ${toMessage(error)}`);
          }

          let photo: Photo;
          try {
            photo = await attachPhotoToRecipe(ctx, recipe, thumbnail, full);
          } catch (error) {
            log.error({ err: error, recipe_uid: args.recipe_uid }, "uploadPhoto failed");
            return textResult(`Failed to upload photo: ${toMessage(error)}`);
          }

          return textResult(`Attached photo ${photo.name} to "${recipe.name}" (photo UID: ${photo.uid}).`);
        },
        (guard) => guard,
      );
    },
  );
}

export function registerDeletePhotoTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "delete_photo" });
  server.registerTool(
    "delete_photo",
    {
      description:
        "Delete a photo from a recipe by UID. Idempotent: a second delete on the same UID returns a friendly " +
        "'already deleted' message without re-POSTing. Requires an exact photo UID.",
      inputSchema: deletePhotoInputSchema.shape,
    },
    async (args) => {
      log.info({ tool: "delete_photo", photo_uid: args.photo_uid }, "tool invoked");
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Gate on the photo catalog being synced, else a not-yet-synced photo reads as
          // "not found" and the idempotent tombstone signal would be wrong.
          if (!ctx.photoStore.hasSynced) {
            return textResult("The photo catalog is still syncing; try again in a moment.");
          }
          const existing = ctx.photoStore.get(args.photo_uid);
          if (existing === undefined) {
            if (ctx.photoStore.isTombstone(args.photo_uid)) {
              return textResult(`Photo with UID "${args.photo_uid}" is already deleted.`);
            }
            return textResult(`No photo found with UID "${args.photo_uid}".`);
          }

          try {
            await ctx.client.deletePhoto(existing);
            await commitPhotoDelete(ctx, { ...existing, deleted: true });
          } catch (error) {
            log.error({ err: error, photo_uid: args.photo_uid }, "deletePhoto failed");
            return textResult(`Failed to delete photo: ${toMessage(error)}`);
          }

          return textResult(`Deleted photo ${existing.name} from recipe.`);
        },
        (guard) => guard,
      );
    },
  );
}
