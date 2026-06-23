import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeUid } from "../ids.js";
import type { RecipeState } from "../module.js";
import type { Photo } from "../photo/types.js";
import type { Recipe } from "../types.js";

import { fetchImageBytes } from "../../../shared/photo-fetch.js";
import { resourceNotFound, tracedResourceRead } from "../../../shared/resources.js";
import { MAX_PHOTO_DIMENSION, resizePhotoJpeg } from "../photo-helpers.js";
import { PhotoByteCache } from "../photo/byte-cache.js";
import { recipePhotoResourceUri } from "../recipe-markdown.js";

/** Per-session resized-bytes cache cap (see {@link PhotoByteCache}). */
const PHOTO_BYTE_CACHE_MAX = 64;

/**
 * The recipe's primary/cover photo: the catalog entry whose `filename` matches the
 * recipe's `photoLarge` (the cover image Paprika itself displays — verified against
 * `docs/wire-captures/`, where `recipe.photo_large` equals the primary photo's
 * `{uid}.jpg`). Falls back to the first gallery photo (`orderFlag` 0; `getByRecipeUid`
 * sorts ascending) when nothing matches `photoLarge` — e.g. a brief sync skew.
 */
function resolvePrimaryPhoto(recipe: Recipe, photos: ReadonlyArray<Photo>): Photo | undefined {
  if (recipe.photoLarge) {
    const match = photos.find((p) => p.filename === recipe.photoLarge);
    if (match) return match;
  }
  return photos[0];
}

/**
 * Parse a plain-decimal positive integer, or `null` if `raw` is not one. Restricted to
 * `^\d+$` so `Number`'s hex/exponent/whitespace coercions (`0x10`, `1e3`, ` 5 `) can't
 * widen the accepted form past what the URI contract documents.
 */
function parsePositiveInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

/** Parse a `w`/`h` query value to a bounded positive int, or `undefined` when absent. */
function parseDimension(raw: string | null): number | undefined {
  if (raw === null || raw === "") return undefined;
  const value = parsePositiveInt(raw);
  if (value === null || value > MAX_PHOTO_DIMENSION) {
    resourceNotFound(`Invalid photo dimension "${raw}" (expected an integer 1–${MAX_PHOTO_DIMENSION.toString()}).`);
  }
  return value;
}

/** Wrap resized JPEG bytes as a base64 blob resource content. */
function blobResult(uri: URL, bytes: Buffer): ReadResourceResult {
  return { contents: [{ uri: uri.href, mimeType: "image/jpeg", blob: bytes.toString("base64") }] };
}

/**
 * `ui://recipe/{uid}/photo/{n}{?w,h}` — serve a recipe's photo bytes for a host to
 * render in a sandboxed widget iframe. It closes the asymmetry where a user-UPLOADED
 * photo has no read surface: uploaded photos carry no public URL, so the bytes are
 * resolved server-side — the per-photo presigned S3 URL via the sync-authenticated client,
 * fetched through the SSRF-guarded `fetchImageBytes` — while a web-imported recipe
 * falls back to its source `imageUrl`/`photoUrl` through the same fetch. A sandboxed
 * widget iframe can only load `data:`/same-origin, so this proxy is the only way it
 * can show either.
 *
 * - no `{n}` → the primary/cover photo ({@link resolvePrimaryPhoto}); `{n}` selects the
 *   nth gallery photo positionally in display order (`getByRecipeUid` sorts by `orderFlag`),
 *   1-indexed (`n=1` is the first), so it stays stable even if `orderFlag`s are non-contiguous.
 * - `w`/`h` resize via sharp (`resizePhotoJpeg`): both fit a box, one scales that axis.
 *
 * Two `ResourceTemplate`s register one handler: a bare `…/photo` and a catch-all
 * `…/photo{+rest}` covering `/n` and/or a `?w&h` query — the SDK's `UriTemplate`
 * matcher anchors on the full URI and can't express an optional query, so the handler
 * parses dimensions and the index off the real `URL` rather than the template vars.
 */
export function recipePhotoResource(ctx: DomainCtx<RecipeState, never>): void {
  // One cache per session registration: regenerable bytes, evict-oldest on overflow.
  const cache = new PhotoByteCache(PHOTO_BYTE_CACHE_MAX);

  const read = tracedResourceRead(
    "recipe-photos",
    async (uri: URL, variables: Variables): Promise<ReadResourceResult> => {
      const uid = variables["uid"] as RecipeUid;

      // Path shape is [uid, "photo"] or [uid, "photo", n]; anything else is malformed.
      const segments = uri.pathname.split("/").filter((s) => s.length > 0);
      if (segments.length < 2 || segments.length > 3 || segments[1] !== "photo") {
        resourceNotFound(`Malformed photo resource URI: ${uri.href}`);
      }
      let index: number | undefined;
      const indexSegment = segments[2];
      if (indexSegment !== undefined) {
        const parsed = parsePositiveInt(indexSegment);
        if (parsed === null) {
          resourceNotFound(`Invalid photo index "${indexSegment}" (expected a positive integer).`);
        }
        index = parsed;
      }
      const width = parseDimension(uri.searchParams.get("w"));
      const height = parseDimension(uri.searchParams.get("h"));
      const dimSuffix = `${(width ?? "").toString()}x${(height ?? "").toString()}`;

      const recipe = ctx.state.recipe.store.get(uid);
      if (!recipe) {
        resourceNotFound(`Recipe not found: ${uid}`);
      }

      const photos = ctx.state.photo.store.getByRecipeUid(uid);
      const photo = index === undefined ? resolvePrimaryPhoto(recipe, photos) : photos[index - 1];

      // Resolve the cache key + the source URL, short-circuiting on a cache hit before any
      // network work. A catalog photo's bytes come from its presigned download URL; a
      // web-imported recipe with no catalog photo (primary read only) falls back to its
      // source image. The shared fetch → resize → cache tail runs once for both.
      let cacheKey: string;
      let sourceUrl: string;
      if (photo !== undefined) {
        // Key by the photo's content hash, so a changed photo never serves stale bytes.
        cacheKey = `photo:${photo.hash}:${dimSuffix}`;
        const hit = cache.get(cacheKey);
        if (hit) return blobResult(uri, hit);
        sourceUrl = (await ctx.infra.client.getPhotoDownloadUrl(photo.uid)).match(
          (u) => u,
          (e) => {
            ctx.infra.log.warn({ err: e, uid, photoUid: photo.uid }, "failed to resolve photo download URL");
            resourceNotFound(`Could not load the photo for recipe ${uid}.`);
          },
        );
      } else if (index === undefined && (recipe.imageUrl || recipe.photoUrl)) {
        const src = recipe.imageUrl || recipe.photoUrl;
        if (!src) resourceNotFound(`Recipe ${uid} has no photo.`);
        cacheKey = `url:${src}:${dimSuffix}`;
        const hit = cache.get(cacheKey);
        if (hit) return blobResult(uri, hit);
        sourceUrl = src;
      } else {
        resourceNotFound(
          index === undefined ? `Recipe ${uid} has no photo.` : `Recipe ${uid} has no photo #${index.toString()}.`,
        );
      }

      const fetched = await fetchImageBytes(sourceUrl);
      if ("error" in fetched) {
        resourceNotFound(`Could not download the photo for recipe ${uid}: ${fetched.error}`);
      }
      const resized = await resizePhotoJpeg(fetched.bytes, { width, height });
      cache.set(cacheKey, resized);
      return blobResult(uri, resized);
    },
  );

  // Bare template carries the `list` (one entry per recipe that has a photo, the
  // primary URI); the catch-all routes sized/indexed reads to the same handler.
  const bare = new ResourceTemplate("ui://recipe/{uid}/photo", {
    list: async () => ({
      resources: ctx.state.recipe.store
        .getAll()
        .map((recipe) => ({ recipe, uri: recipePhotoResourceUri(recipe) }))
        .filter((r): r is { recipe: Recipe; uri: string } => r.uri !== null)
        .map(({ recipe, uri }) => ({ uri, name: `${recipe.name} photo`, mimeType: "image/jpeg" })),
    }),
  });
  const sized = new ResourceTemplate("ui://recipe/{uid}/photo{+rest}", { list: undefined });

  ctx.server.registerResource(
    "recipe-photo",
    bare,
    { description: "A recipe's cover photo, served as image bytes by UID (ui://recipe/{uid}/photo)" },
    read,
  );
  ctx.server.registerResource(
    "recipe-photo-sized",
    sized,
    { description: "A recipe photo by gallery index and/or size (ui://recipe/{uid}/photo/{n}?w=&h=)" },
    read,
  );
}
