import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import ipaddr from "ipaddr.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { PhotoUidSchema, RecipeUidSchema, type Photo, type Recipe } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";
import { toMessage } from "../utils/log.js";
import { coldStartGuard, textResult } from "./helpers.js";
import { commitPhotoDelete, commitPhotoUpload, normalizePhoto, sha256Hex } from "./photo-helpers.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

/**
 * True if an IP string (v4 or v6) is one we must never let the server fetch
 * (SSRF guard). Delegates classification to `ipaddr.js` — only `unicast`
 * (public) addresses are allowed; loopback, private, link-local, unique-local,
 * CGNAT, multicast, reserved, etc. are all blocked. IPv4-mapped IPv6 addresses
 * (in either the dotted `::ffff:127.0.0.1` or hex `::ffff:7f00:1` form) are
 * resolved to their embedded IPv4 and classified there, so a mapped loopback
 * can't slip through.
 */
function isBlockedIp(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return true; // unparseable → block
  }
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) return v6.toIPv4Address().range() !== "unicast";
  }
  return addr.range() !== "unicast";
}

/**
 * SSRF guard: rejects a URL whose host resolves to any loopback/link-local/private/
 * reserved address. Returns an error message, or null when the host is safe to fetch.
 * (Residual DNS-rebinding risk remains: the resolved address is checked, not pinned for
 * the fetch — acceptable for v1 alongside `redirect: "error"` and the size/format guards.)
 */
async function blockPrivateHost(hostname: string): Promise<string | null> {
  // URL.hostname wraps IPv6 literals in brackets (`[::1]`); strip them for isIP/lookup.
  const host = hostname.replace(/^\[(.+)\]$/, "$1");
  // A bare IP literal in the URL is checked directly (no DNS).
  if (isIP(host) !== 0) {
    return isBlockedIp(host) ? "URL resolves to a private or reserved address; refusing to fetch." : null;
  }
  let addresses: ReadonlyArray<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch (e) {
    return `Could not resolve image host: ${toMessage(e)}`;
  }
  if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a.address))) {
    return "URL resolves to a private or reserved address; refusing to fetch.";
  }
  return null;
}

/** Reads a fetch body into a Buffer, aborting once MAX_IMAGE_BYTES is exceeded. */
async function readCapped(res: Response): Promise<{ bytes: Buffer } | { error: string }> {
  const declared = res.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_IMAGE_BYTES) {
    return { error: `Image too large (${declared} bytes; max ${MAX_IMAGE_BYTES.toString()}).` };
  }
  const reader = res.body?.getReader();
  if (reader === undefined) return { error: "Empty image response." };
  const chunks: Array<Buffer> = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      return { error: `Image too large (exceeds ${MAX_IMAGE_BYTES.toString()} bytes).` };
    }
    chunks.push(Buffer.from(value));
  }
  return { bytes: Buffer.concat(chunks) };
}

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
    let parsed: URL;
    try {
      parsed = new URL(args.url!);
    } catch {
      return { error: `Invalid url: ${args.url!}` };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { error: "Only http(s) image URLs are supported." };
    }
    // SSRF guard: refuse hosts that resolve to loopback/link-local/private/reserved IPs.
    const blocked = await blockPrivateHost(parsed.hostname);
    if (blocked !== null) return { error: blocked };

    let res: Response;
    try {
      // `redirect: "error"` prevents a public URL from redirecting to a private host,
      // sidestepping the redirect-based SSRF bypass; the timeout bounds slow/endless responses.
      res = await fetch(parsed, { redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (e) {
      return { error: `Failed to download image: ${toMessage(e)}` };
    }
    if (!res.ok) return { error: `Failed to download image: HTTP ${res.status.toString()}` };
    return readCapped(res);
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
        "for programmatic callers, inline `image_base64`. The server normalizes any format (JPEG/PNG/WEBP/GIF) " +
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

          // order_flag / name auto-assigned from the synced gallery (max + 1), never caller-supplied —
          // same convention as add_meals never exposing order_flag. Staleness is cosmetic gallery order.
          const existing = ctx.photoStore.getByRecipeUid(args.recipe_uid);
          const orderFlag = existing.length > 0 ? Math.max(...existing.map((p) => p.orderFlag)) + 1 : 0;
          const photoUid = PhotoUidSchema.parse(randomUUID().toUpperCase());
          const thumbnailUid = randomUUID().toUpperCase();
          const photo: Photo = {
            uid: photoUid,
            recipeUid: args.recipe_uid,
            filename: `${photoUid}.jpg`,
            name: String(orderFlag + 1),
            orderFlag,
            hash: sha256Hex(full),
            deleted: false,
          };
          const recipeWithPhoto: Recipe = {
            ...recipe,
            photo: `${thumbnailUid}.jpg`,
            photoLarge: `${photoUid}.jpg`,
            photoHash: sha256Hex(thumbnail),
          };

          try {
            await ctx.client.uploadPhoto(recipeWithPhoto, photo, thumbnail, full);
            await commitPhotoUpload(ctx, recipeWithPhoto, photo);
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
