import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { GeneratedImageStore } from "../../../features/generated-image-store.js";
import type { RecipeUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeSelf } from "../module.js";
import type { Photo } from "../photo/types.js";

import { PhotoUidSchema, RecipeUidSchema } from "../../../ids.js";
import { fetchImageBytes, MAX_IMAGE_BYTES } from "../../../shared/photo-fetch.js";
import { textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { GENERATED_MAX_FULL_EDGE, normalizePhoto } from "../photo-helpers.js";
import { recipeColdStartGuard } from "./guards.js";

/**
 * Image source for `upload_recipe_photo`: exactly one of `url`, `generation_token`, or
 * `image_base64`. A `z.union` of `.strict()` single-key objects (presence
 * dispatch, like `mealTypeSpecSchema`) so the "exactly one" rule is enforced at
 * the Zod boundary rather than a runtime check.
 */
export const uploadPhotoSourceSchema = z
  .union([
    z
      .object({
        url: z
          .string()
          .url()
          .describe(
            "HTTP(S) URL of an image. PREFERRED for web images — the server downloads and re-encodes it. " +
              "If you built the recipe from a web page, pass that page's main/hero (og:image) URL.",
          ),
      })
      .strict(),
    z
      .object({
        generation_token: z
          .string()
          .describe(
            "A `gen_` token returned by a generate_recipe_photo preview (attach:false). Attaches THAT exact previewed " +
              "image — no need to regenerate (which would produce a different image) or resend bytes. This is the " +
              "way to save a generated photo you previewed.",
          ),
      })
      .strict(),
    z
      .object({
        image_base64: z
          .string()
          .min(1)
          .describe("Base64-encoded image bytes. For programmatic/testing callers only; agents should use `url`."),
      })
      .strict(),
  ])
  .describe("Exactly one image source: { url } | { generation_token } | { image_base64 }.");

export const uploadPhotoInputSchema = z.object({
  recipe_uid: RecipeUidSchema.describe("UID of the recipe to attach the photo to."),
  source: uploadPhotoSourceSchema,
});

type UploadPhotoSource = z.infer<typeof uploadPhotoSourceSchema>;

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

/** Resolved image bytes plus provenance, or an error message. */
type ResolvedSource = { bytes: Buffer; generated: boolean } | { error: string };

/**
 * Resolves the image bytes from the chosen source, or returns an error message. The
 * `generation_token` source consumes the shared `infra.generatedImageStore` preview ring
 * buffer — the recipe↔photo-gen handoff a dependency edge can't carry, so it rides
 * `infra` (`generate_recipe_photo` attach:false stashes; this consumes), validating the
 * token was minted for THIS recipe. `url` is SSRF-safe-fetched; `image_base64` is decoded.
 */
async function resolveSource(
  source: UploadPhotoSource,
  recipeUid: RecipeUid,
  generatedImageStore: GeneratedImageStore,
): Promise<ResolvedSource> {
  if ("url" in source) {
    // SSRF-safe fetch (scheme + IP-literal guard, rebinding-safe dispatcher,
    // redirect block, streaming size cap) — shared with generate_recipe_photo's restyle.
    const fetched = await fetchImageBytes(source.url);
    return "error" in fetched ? fetched : { bytes: fetched.bytes, generated: false };
  }

  if ("generation_token" in source) {
    // consume() is atomic + synchronous (no await precedes it on this branch), so two
    // racing uploads can't both spend one token. A token minted for a DIFFERENT recipe is
    // restored and rejected before any write; a consumed token whose attach later fails is
    // deliberately NOT restored (duplicate-safe — regenerate instead). This is the legacy
    // consume/restore choreography (see src/features/CLAUDE.md "Generated-photo previews").
    const entry = generatedImageStore.consume(source.generation_token);
    if (entry === null) {
      return {
        error:
          "That generation_token is unknown or expired (previews last about an hour). " +
          "Generate a new one with generate_recipe_photo (attach:false).",
      };
    }
    if (entry.recipeUid !== recipeUid) {
      generatedImageStore.restore(source.generation_token, entry);
      return {
        error:
          "That generation_token was created for a different recipe. " +
          "Generate a preview for THIS recipe and use its token.",
      };
    }
    return { bytes: entry.bytes, generated: true };
  }

  const buf = Buffer.from(source.image_base64, "base64");
  if (buf.length === 0) return { error: "Invalid or empty base64 image data." };
  if (buf.length > MAX_IMAGE_BYTES) {
    return { error: `Image too large (${buf.length.toString()} bytes; max ${MAX_IMAGE_BYTES.toString()}).` };
  }
  return { bytes: buf, generated: false };
}

/**
 * Registers `upload_recipe_photo`, kernel-shaped — recipe owns photo, so the recipe
 * read, photo-gallery read, and the attach write all go through `ctx.self` (the bound
 * `attachPhotoToRecipe` chokepoint). The `generation_token` source consumes the shared
 * `infra.generatedImageStore` preview buffer (see `resolveSource`).
 */
export function uploadPhotoTool(ctx: DomainCtx<RecipeSelf, never>): void {
  const log = ctx.infra.log.child({ component: "upload_recipe_photo" });
  ctx.server.registerTool(
    "upload_recipe_photo",
    {
      title: "Upload a photo to a recipe",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      description:
        "Attach a photo to a recipe from exactly one `source`: a `url` (PREFERRED for web images — the server " +
        "downloads it), a `generation_token` (to save an image you previewed with generate_recipe_photo, attach:false — " +
        "no need to regenerate), or, for programmatic callers, inline `image_base64`. If you built the recipe " +
        "from a web page, pass that page's main/hero (og:image) URL. The server normalizes any format " +
        "(JPEG/PNG/WEBP/GIF) to JPEG and generates the thumbnail automatically. There is NO file-path option — the " +
        "server cannot read your local filesystem. Photos are appended to the recipe's gallery in order.",
      inputSchema: uploadPhotoInputSchema.shape,
    },
    async (args) => {
      const sourceKind =
        "url" in args.source ? "url" : "generation_token" in args.source ? "generation_token" : "base64";
      log.info({ tool: "upload_recipe_photo", recipe_uid: args.recipe_uid, source: sourceKind }, "tool invoked");
      return recipeColdStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          // Gate on the photo catalog being synced — order_flag/name are derived from the
          // existing gallery, so uploading before photos sync could assign a colliding index.
          if (!ctx.self.photo.store.hasSynced) {
            return textResult("The photo catalog is still syncing; try again in a moment.");
          }
          const recipe = ctx.self.recipe.store.get(args.recipe_uid);
          if (recipe === undefined) return textResult(`No recipe found with UID "${args.recipe_uid}".`);

          const resolved = await resolveSource(args.source, args.recipe_uid, ctx.infra.generatedImageStore);
          if ("error" in resolved) return textResult(resolved.error);
          if (!sniffImage(resolved.bytes)) {
            return textResult("Unsupported image format. Provide a JPEG, PNG, WEBP, or GIF image.");
          }

          let thumbnail: Buffer;
          let full: Buffer;
          try {
            // Cap generated-image output the same way generate_recipe_photo's attach
            // path does, so preview-then-save and generate-and-attach store the
            // same size. User-supplied url/base64 keep their native resolution.
            ({ thumbnail, full } = await normalizePhoto(
              resolved.bytes,
              resolved.generated ? { maxFullEdge: GENERATED_MAX_FULL_EDGE } : undefined,
            ));
          } catch (error) {
            log.error({ err: error, recipe_uid: args.recipe_uid }, "normalizePhoto failed");
            return textResult(`Failed to process image: ${toMessage(error)}`);
          }

          let photo: Photo;
          try {
            photo = await ctx.self.attachPhotoToRecipe(recipe, thumbnail, full);
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

/** Registers `delete_recipe_photo`, kernel-shaped — soft-delete through `ctx.self.commitPhotoDelete`. */
export function deletePhotoTool(ctx: DomainCtx<RecipeSelf, never>): void {
  const log = ctx.infra.log.child({ component: "delete_recipe_photo" });
  ctx.server.registerTool(
    "delete_recipe_photo",
    {
      title: "Delete a recipe photo",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      description:
        "Delete a photo from a recipe by UID. Idempotent: a second delete on the same UID returns a friendly " +
        "'already deleted' message without re-POSTing. Requires an exact photo UID.",
      inputSchema: deletePhotoInputSchema.shape,
    },
    async (args) => {
      log.info({ tool: "delete_recipe_photo", photo_uid: args.photo_uid }, "tool invoked");
      return recipeColdStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          // Gate on the photo catalog being synced, else a not-yet-synced photo reads as
          // "not found" and the idempotent tombstone signal would be wrong.
          if (!ctx.self.photo.store.hasSynced) {
            return textResult("The photo catalog is still syncing; try again in a moment.");
          }
          const existing = ctx.self.photo.store.get(args.photo_uid);
          if (existing === undefined) {
            if (ctx.self.photo.store.isTombstone(args.photo_uid)) {
              return textResult(`Photo with UID "${args.photo_uid}" is already deleted.`);
            }
            return textResult(`No photo found with UID "${args.photo_uid}".`);
          }

          try {
            await ctx.infra.client.deletePhoto(existing);
            await ctx.self.commitPhotoDelete({ ...existing, deleted: true });
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

/** Both photo-write registrars, in registration order. */
export const photoWriteTools = [uploadPhotoTool, deletePhotoTool];
