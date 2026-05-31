import { describe, it, expect, beforeAll, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import sharp from "sharp";

import { RecipeStore } from "../cache/recipe-store.js";
import { PhotoStore } from "../cache/photo-store.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { makePhoto } from "../cache/__fixtures__/photos.js";
import { PhotoUidSchema, RecipeUidSchema, type Photo, type Recipe } from "../paprika/types.js";
import { makeCtx, makeTestServer, getText } from "./tool-test-utils.js";
import { registerUploadPhotoTool, registerDeletePhotoTool } from "./photo-writes.js";

const RECIPE_UID = RecipeUidSchema.parse("recipe-1");

let jpegBase64: string;
beforeAll(async () => {
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .jpeg()
    .toBuffer();
  jpegBase64 = bytes.toString("base64");
});

function setup(opts?: { photos?: Array<Photo>; recipe?: Recipe }) {
  const store = new RecipeStore();
  store.load([opts?.recipe ?? makeRecipe({ uid: RECIPE_UID, name: "Test Recipe" })], []);
  const photoStore = new PhotoStore();
  photoStore.load(opts?.photos ?? []);

  const uploadPhoto = vi.fn().mockResolvedValue(undefined);
  const deletePhoto = vi.fn().mockResolvedValue(undefined);
  const { server, callTool } = makeTestServer();
  const ctx = makeCtx(store, server, {
    photoStore,
    client: fromAny({ uploadPhoto, deletePhoto, notifySync: vi.fn().mockResolvedValue(undefined) }),
    cache: fromAny({
      recipes: { put: vi.fn().mockResolvedValue(undefined) },
      photos: { put: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
      flush: vi.fn().mockResolvedValue(undefined),
    }),
  });
  registerUploadPhotoTool(server, ctx);
  registerDeletePhotoTool(server, ctx);
  return { callTool, uploadPhoto, deletePhoto, photoStore };
}

describe("upload_photo", () => {
  it("uploads a base64 image: calls client.uploadPhoto with recipe photo fields + a first-photo entity", async () => {
    const { callTool, uploadPhoto } = setup();

    const result = await callTool("upload_photo", { recipe_uid: RECIPE_UID, image_base64: jpegBase64 });

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

    await callTool("upload_photo", { recipe_uid: RECIPE_UID, image_base64: jpegBase64 });

    const [, photo] = uploadPhoto.mock.calls[0] as [Recipe, Photo];
    expect(photo.orderFlag).toBe(2);
    expect(photo.name).toBe("3");
  });

  it("downloads from a url and uploads (server fetches the bytes)", async () => {
    const { callTool, uploadPhoto } = setup();
    const bytes = Buffer.from(jpegBase64, "base64");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(bytes, { status: 200 }) as unknown as Response);

    // Public IP literal → skips DNS and the SSRF private-address check passes.
    await callTool("upload_photo", { recipe_uid: RECIPE_UID, url: "https://93.184.216.34/cake.jpg" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it.each([
    ["http://169.254.169.254/latest/meta-data/", "cloud metadata (link-local)"],
    ["http://127.0.0.1/x.jpg", "loopback"],
    ["http://10.0.0.5/x.jpg", "private 10/8"],
    ["http://192.168.1.10/x.jpg", "private 192.168/16"],
    ["http://[::1]/x.jpg", "IPv6 loopback"],
    ["http://[::ffff:127.0.0.1]/x.jpg", "IPv4-mapped IPv6 loopback (dotted)"],
    ["http://[::ffff:7f00:1]/x.jpg", "IPv4-mapped IPv6 loopback (hex form Node normalizes to)"],
  ])("blocks SSRF to %s (%s) without fetching", async (url) => {
    const { callTool, uploadPhoto } = setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await callTool("upload_photo", { recipe_uid: RECIPE_UID, url });

    expect(getText(result)).toContain("private or reserved address");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(uploadPhoto).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("rejects an over-cap image by Content-Length before buffering the body", async () => {
    const { callTool, uploadPhoto } = setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Buffer.from(jpegBase64, "base64"), {
        status: 200,
        headers: { "content-length": String(11 * 1024 * 1024) },
      }) as unknown as Response,
    );

    const result = await callTool("upload_photo", { recipe_uid: RECIPE_UID, url: "https://93.184.216.34/big.jpg" });

    expect(getText(result)).toContain("too large");
    expect(uploadPhoto).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("rejects when both url and image_base64 are provided", async () => {
    const { callTool, uploadPhoto } = setup();
    const result = await callTool("upload_photo", {
      recipe_uid: RECIPE_UID,
      url: "https://example.com/a.jpg",
      image_base64: jpegBase64,
    });
    expect(getText(result)).toContain("exactly one");
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("rejects when neither url nor image_base64 is provided", async () => {
    const { callTool, uploadPhoto } = setup();
    const result = await callTool("upload_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result)).toContain("exactly one");
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("rejects non-image bytes via the magic-byte sniff", async () => {
    const { callTool, uploadPhoto } = setup();
    const notAnImage = Buffer.from("this is plainly not an image at all").toString("base64");
    const result = await callTool("upload_photo", { recipe_uid: RECIPE_UID, image_base64: notAnImage });
    expect(getText(result)).toContain("Unsupported image format");
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("returns not-found for an unknown recipe without uploading", async () => {
    const { callTool, uploadPhoto } = setup();
    const result = await callTool("upload_photo", {
      recipe_uid: RecipeUidSchema.parse("nope"),
      image_base64: jpegBase64,
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
    const { callTool, deletePhoto, photoStore } = setup({ photos: [photo] });

    await callTool("delete_photo", { photo_uid: "p-1" });
    deletePhoto.mockClear();
    // The store now tombstones p-1; a second delete should short-circuit.
    expect(photoStore.isTombstone(PhotoUidSchema.parse("p-1"))).toBe(true);
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
});
