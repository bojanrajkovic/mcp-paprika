import { fromAny } from "@total-typescript/shoehorn";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Photo } from "../photo/types.js";
import type { Recipe } from "../recipe/types.js";

import { makePhoto } from "../../test/cache/__fixtures__/photos.js";
import { makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { PhotoUidSchema, RecipeUidSchema } from "../ids.js";
import { RecipeStore } from "../recipe/store.js";
import { fetchImageBytes, isBlockedIp, ssrfLookup } from "./photo-fetch.js";
import { registerDeletePhotoTool, registerUploadPhotoTool, uploadPhotoInputSchema } from "./photo-writes.js";

// The URL download is exercised end-to-end (real undici fetch + dispatcher) in
// photo-fetch.test.ts. Here we stub fetchImageBytes to test upload_photo's
// handling of its results; isBlockedIp/ssrfLookup stay real for the unit tests.
vi.mock("./photo-fetch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./photo-fetch.js")>();
  return { ...actual, fetchImageBytes: vi.fn() };
});

const RECIPE_UID = RecipeUidSchema.parse("recipe-1");

let jpegBase64: string;
beforeAll(async () => {
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .jpeg()
    .toBuffer();
  jpegBase64 = bytes.toString("base64");
});

function setup(opts?: { photos?: Array<Photo>; recipe?: Recipe; synced?: boolean }) {
  // Mirrors the real client: uploadPhoto returns the hash-stamped recipe, which
  // attachPhotoToRecipe commits. Returning the input recipe is sufficient here (the
  // hashing is the client's responsibility, covered in client.test.ts).
  const uploadPhoto = vi.fn(
    async (recipe: Recipe, _photo: Photo, _thumbnail: Buffer, _full: Buffer): Promise<Recipe> => recipe,
  );
  const deletePhoto = vi.fn().mockResolvedValue(undefined);
  const { server, callTool } = makeTestServer();
  const ctx = seed(
    makeCtx(new RecipeStore(), server, {
      client: fromAny({ uploadPhoto, deletePhoto, notifySync: vi.fn().mockResolvedValue(undefined) }),
      cache: fromAny({
        recipes: { put: vi.fn().mockResolvedValue(undefined) },
        photos: { put: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
        flush: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    {
      recipes: [opts?.recipe ?? makeRecipe({ uid: RECIPE_UID, name: "Test Recipe" })],
      // load() flips hasSynced=true; omit photos key to simulate the photo catalog not yet synced.
      ...(opts?.synced !== false ? { photos: opts?.photos ?? [] } : {}),
    },
  );
  registerUploadPhotoTool(server, ctx);
  registerDeletePhotoTool(server, ctx);
  return { callTool, uploadPhoto, deletePhoto, ctx };
}

describe("upload_photo", () => {
  it("uploads a base64 image: calls client.uploadPhoto with recipe photo fields + a first-photo entity", async () => {
    const { callTool, uploadPhoto } = setup();

    const result = await callTool("upload_photo", { recipe_uid: RECIPE_UID, source: { image_base64: jpegBase64 } });

    expect(uploadPhoto).toHaveBeenCalledTimes(1);
    const [recipeWithPhoto, photo, thumbnail, full] = uploadPhoto.mock.calls[0] as [Recipe, Photo, Buffer, Buffer];
    // recipe.photo (thumbnail uid) and photo_large (photo-entity uid) are DISTINCT filenames.
    expect(recipeWithPhoto.photo).toMatch(/\.jpg$/);
    expect(recipeWithPhoto.photoLarge).toBe(`${photo.uid}.jpg`);
    expect(recipeWithPhoto.photo).not.toBe(recipeWithPhoto.photoLarge);
    expect(recipeWithPhoto.photoHash).toMatch(/^[0-9A-F]{64}$/);
    // first photo → orderFlag 0, name "1", filename {uid}.jpg
    expect(photo.orderFlag).toBe(0);
    expect(photo.name).toBe("1");
    expect(photo.filename).toBe(`${photo.uid}.jpg`);
    expect(photo.recipeUid).toBe(RECIPE_UID);
    expect(Buffer.isBuffer(thumbnail) && Buffer.isBuffer(full)).toBe(true);
    expect(getText(result)).toContain('Attached photo 1 to "Test Recipe"');
    // The success message returns the generated photo UID so the caller can delete_photo it.
    expect(getText(result)).toContain(photo.uid);
  });

  it("auto-assigns order_flag/name from the existing gallery (max + 1)", async () => {
    const existing = [
      makePhoto({ recipeUid: RECIPE_UID, orderFlag: 0 }),
      makePhoto({ recipeUid: RECIPE_UID, orderFlag: 1 }),
    ];
    const { callTool, uploadPhoto } = setup({ photos: existing });

    await callTool("upload_photo", { recipe_uid: RECIPE_UID, source: { image_base64: jpegBase64 } });

    const [, photo] = uploadPhoto.mock.calls[0] as [Recipe, Photo, Buffer, Buffer];
    expect(photo.orderFlag).toBe(2);
    expect(photo.name).toBe("3");
  });

  it("downloads from a url and uploads (server fetches the bytes via fetchImageBytes)", async () => {
    const { callTool, uploadPhoto } = setup();
    vi.mocked(fetchImageBytes).mockResolvedValue({
      bytes: Buffer.from(jpegBase64, "base64"),
      contentType: "image/jpeg",
    });

    await callTool("upload_photo", { recipe_uid: RECIPE_UID, source: { url: "https://images.example/cake.jpg" } });

    expect(fetchImageBytes).toHaveBeenCalledWith("https://images.example/cake.jpg");
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
  });

  it("surfaces a fetchImageBytes download error (e.g. too large / SSRF-blocked) without uploading", async () => {
    const { callTool, uploadPhoto } = setup();
    vi.mocked(fetchImageBytes).mockResolvedValue({ error: "Image too large (exceeds 10485760 bytes)." });

    const result = await callTool("upload_photo", {
      recipe_uid: RECIPE_UID,
      source: { url: "https://images.example/big.jpg" },
    });

    expect(getText(result)).toContain("too large");
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("schema rejects more than one source (exactly-one enforced by the union)", () => {
    const both = uploadPhotoInputSchema.safeParse({
      recipe_uid: RECIPE_UID,
      source: { url: "https://example.com/a.jpg", image_base64: jpegBase64 },
    });
    expect(both.success).toBe(false);
  });

  it("schema rejects an empty source (no url/token/bytes)", () => {
    expect(uploadPhotoInputSchema.safeParse({ recipe_uid: RECIPE_UID, source: {} }).success).toBe(false);
  });

  it("schema accepts each single source shape", () => {
    expect(
      uploadPhotoInputSchema.safeParse({ recipe_uid: RECIPE_UID, source: { url: "https://x.test/a.jpg" } }).success,
    ).toBe(true);
    expect(
      uploadPhotoInputSchema.safeParse({ recipe_uid: RECIPE_UID, source: { generation_token: "gen_abc" } }).success,
    ).toBe(true);
    expect(uploadPhotoInputSchema.safeParse({ recipe_uid: RECIPE_UID, source: { image_base64: "abc" } }).success).toBe(
      true,
    );
  });

  it("attaches a previewed image by generation_token (no regeneration, no base64)", async () => {
    const { callTool, uploadPhoto, ctx } = setup();
    const token = ctx.generatedImageStore.put({
      bytes: Buffer.from(jpegBase64, "base64"),
      mimeType: "image/jpeg",
      recipeUid: RECIPE_UID,
      model: "seedream",
    });

    const result = await callTool("upload_photo", { recipe_uid: RECIPE_UID, source: { generation_token: token } });

    expect(uploadPhoto).toHaveBeenCalledTimes(1);
    expect(getText(result)).toContain('Attached photo 1 to "Test Recipe"');
    // single-use: the token is spent
    expect(ctx.generatedImageStore.consume(token)).toBeNull();
  });

  it("rejects an expired/unknown generation_token without uploading", async () => {
    const { callTool, uploadPhoto } = setup();
    const result = await callTool("upload_photo", {
      recipe_uid: RECIPE_UID,
      source: { generation_token: "gen_does_not_exist" },
    });
    expect(getText(result).toLowerCase()).toContain("expired");
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("rejects a generation_token minted for a different recipe and preserves it", async () => {
    const { callTool, uploadPhoto, ctx } = setup();
    const token = ctx.generatedImageStore.put({
      bytes: Buffer.from(jpegBase64, "base64"),
      mimeType: "image/jpeg",
      recipeUid: "SOME-OTHER-RECIPE",
      model: "seedream",
    });
    const result = await callTool("upload_photo", { recipe_uid: RECIPE_UID, source: { generation_token: token } });
    expect(getText(result).toLowerCase()).toContain("different recipe");
    expect(uploadPhoto).not.toHaveBeenCalled();
    // Validation failure restores the token — it is still attachable (here we
    // confirm by consuming it back; in practice the caller would retry).
    expect(ctx.generatedImageStore.consume(token)).not.toBeNull();
  });

  it("does NOT restore the token after an attach failure (avoids a duplicate photo on retry)", async () => {
    const { callTool, uploadPhoto, ctx } = setup();
    const token = ctx.generatedImageStore.put({
      bytes: Buffer.from(jpegBase64, "base64"),
      mimeType: "image/jpeg",
      recipeUid: RECIPE_UID,
      model: "seedream",
    });
    uploadPhoto.mockRejectedValueOnce(new Error("commit failure after the remote upload"));

    const failed = await callTool("upload_photo", { recipe_uid: RECIPE_UID, source: { generation_token: token } });
    expect(getText(failed)).toContain("Failed to upload");

    // attachPhotoToRecipe uploads to Paprika before the local commit, so the
    // photo may already exist remotely. The token is consumed and NOT restored,
    // so a retry can't re-attach (which would duplicate the photo).
    const retry = await callTool("upload_photo", { recipe_uid: RECIPE_UID, source: { generation_token: token } });
    expect(getText(retry).toLowerCase()).toContain("expired");
  });

  it("a token attaches at most once — a duplicate call gets the already-used error", async () => {
    const { callTool, uploadPhoto, ctx } = setup();
    const token = ctx.generatedImageStore.put({
      bytes: Buffer.from(jpegBase64, "base64"),
      mimeType: "image/jpeg",
      recipeUid: RECIPE_UID,
      model: "seedream",
    });

    const first = await callTool("upload_photo", { recipe_uid: RECIPE_UID, source: { generation_token: token } });
    expect(getText(first)).toContain("Attached photo");

    // Consumed atomically on the first attach — a second (duplicate/retry) call
    // cannot re-attach the same preview.
    const second = await callTool("upload_photo", { recipe_uid: RECIPE_UID, source: { generation_token: token } });
    expect(getText(second).toLowerCase()).toContain("expired");
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
  });

  it("caps a generated-token upload's full image at 2048px, but not a user-supplied one", async () => {
    const { callTool, uploadPhoto, ctx } = setup();
    const big3000 = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();

    // generated source → capped at 2048
    const token = ctx.generatedImageStore.put({
      bytes: big3000,
      mimeType: "image/png",
      recipeUid: RECIPE_UID,
      model: "seedream",
    });
    await callTool("upload_photo", { recipe_uid: RECIPE_UID, source: { generation_token: token } });
    const [, , , genFull] = uploadPhoto.mock.calls[0] as [Recipe, Photo, Buffer, Buffer];
    const genMeta = await sharp(genFull).metadata();
    expect(Math.max(genMeta.width ?? 0, genMeta.height ?? 0)).toBeLessThanOrEqual(2048);

    // user-supplied base64 of the same size → NOT capped (native resolution kept)
    uploadPhoto.mockClear();
    const big3000Jpeg = (
      await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 4, g: 5, b: 6 } } })
        .jpeg()
        .toBuffer()
    ).toString("base64");
    await callTool("upload_photo", { recipe_uid: RECIPE_UID, source: { image_base64: big3000Jpeg } });
    const [, , , userFull] = uploadPhoto.mock.calls[0] as [Recipe, Photo, Buffer, Buffer];
    const userMeta = await sharp(userFull).metadata();
    expect(Math.max(userMeta.width ?? 0, userMeta.height ?? 0)).toBeGreaterThan(2048);
  });

  it("rejects non-image bytes via the magic-byte sniff", async () => {
    const { callTool, uploadPhoto } = setup();
    const notAnImage = Buffer.from("this is plainly not an image at all").toString("base64");
    const result = await callTool("upload_photo", { recipe_uid: RECIPE_UID, source: { image_base64: notAnImage } });
    expect(getText(result)).toContain("Unsupported image format");
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("returns not-found for an unknown recipe without uploading", async () => {
    const { callTool, uploadPhoto } = setup();
    const result = await callTool("upload_photo", {
      recipe_uid: RecipeUidSchema.parse("nope"),
      source: { image_base64: jpegBase64 },
    });
    expect(getText(result)).toContain("No recipe found");
    expect(uploadPhoto).not.toHaveBeenCalled();
  });
});

describe("delete_photo", () => {
  it("deletes an existing photo via the client tombstone", async () => {
    const photo = makePhoto({ uid: PhotoUidSchema.parse("p-1"), recipeUid: RECIPE_UID });
    const { callTool, deletePhoto } = setup({ photos: [photo] });

    const result = await callTool("delete_photo", { photo_uid: "p-1" });

    expect(deletePhoto).toHaveBeenCalledTimes(1);
    expect(getText(result)).toContain("Deleted photo");
  });

  it("is idempotent: a retried delete reports 'already deleted' without re-POSTing", async () => {
    const photo = makePhoto({ uid: PhotoUidSchema.parse("p-1"), recipeUid: RECIPE_UID });
    const { callTool, deletePhoto, ctx } = setup({ photos: [photo] });

    await callTool("delete_photo", { photo_uid: "p-1" });
    deletePhoto.mockClear();
    // The store now tombstones p-1; a second delete should short-circuit.
    expect(ctx.photoStore.isTombstone(PhotoUidSchema.parse("p-1"))).toBe(true);
    const result = await callTool("delete_photo", { photo_uid: "p-1" });

    expect(getText(result)).toContain("already deleted");
    expect(deletePhoto).not.toHaveBeenCalled();
  });

  it("returns not-found for an unknown photo UID", async () => {
    const { callTool, deletePhoto } = setup();
    const result = await callTool("delete_photo", { photo_uid: "ghost" });
    expect(getText(result)).toContain("No photo found");
    expect(deletePhoto).not.toHaveBeenCalled();
  });

  it("refuses to delete until the photo catalog has synced", async () => {
    const { callTool, deletePhoto } = setup({ synced: false });
    const result = await callTool("delete_photo", { photo_uid: "p-1" });
    expect(getText(result)).toContain("still syncing");
    expect(deletePhoto).not.toHaveBeenCalled();
  });
});

describe("upload_photo / photo-sync gate", () => {
  it("refuses to upload until the photo catalog has synced (order_flag would be stale)", async () => {
    const { callTool, uploadPhoto } = setup({ synced: false });
    const result = await callTool("upload_photo", { recipe_uid: RECIPE_UID, source: { image_base64: jpegBase64 } });
    expect(getText(result)).toContain("still syncing");
    expect(uploadPhoto).not.toHaveBeenCalled();
  });
});

describe("SSRF address guard", () => {
  it("isBlockedIp allows public unicast and blocks loopback/private/link-local/mapped forms", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
    expect(isBlockedIp("127.0.0.1")).toBe(true); // loopback
    expect(isBlockedIp("10.0.0.1")).toBe(true); // private
    expect(isBlockedIp("172.16.0.1")).toBe(true); // private
    expect(isBlockedIp("192.168.1.1")).toBe(true); // private
    expect(isBlockedIp("169.254.169.254")).toBe(true); // cloud metadata (link-local)
    expect(isBlockedIp("100.64.0.1")).toBe(true); // CGNAT
    expect(isBlockedIp("::1")).toBe(true); // IPv6 loopback
    expect(isBlockedIp("fc00::1")).toBe(true); // IPv6 ULA
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true); // IPv4-mapped (dotted)
    expect(isBlockedIp("::ffff:7f00:1")).toBe(true); // IPv4-mapped (hex, what Node normalizes to)
    expect(isBlockedIp("not-an-ip")).toBe(true); // unparseable → blocked
  });

  // ssrfLookup is the undici Agent's connect-time resolver; it validates the SAME
  // resolution used for the socket (closing DNS rebinding). IP-literal "hostnames"
  // resolve offline, so this exercises the validation without real DNS.
  const resolve = (host: string): Promise<{ err: Error | null; address: unknown }> =>
    new Promise((res) => {
      ssrfLookup(host, { all: false }, (err, address) => res({ err, address }));
    });

  it("ssrfLookup errors before connect when the resolved address is private/reserved", async () => {
    const { err } = await resolve("169.254.169.254");
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("SSRF guard");
  });

  it("ssrfLookup passes a public address through to the connection", async () => {
    const { err, address } = await resolve("8.8.8.8");
    expect(err).toBeNull();
    expect(address).toBe("8.8.8.8");
  });
});
