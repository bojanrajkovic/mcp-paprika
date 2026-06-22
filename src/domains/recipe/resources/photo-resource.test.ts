import { okAsync } from "neverthrow";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PhotoUid, RecipeUid } from "../ids.js";
import type { RecipeState } from "../module.js";

import { makePhoto } from "../../../../test/domains/recipe/__fixtures__/photos.js";
import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";

// fetchImageBytes does real network egress; mock it so the resource resolves bytes
// from a fixture JPEG. MAX_IMAGE_BYTES is re-exported because photo-writes imports it.
vi.mock("../../../shared/photo-fetch.js", () => ({
  fetchImageBytes: vi.fn(),
  MAX_IMAGE_BYTES: 10 * 1024 * 1024,
}));

import { fetchImageBytes } from "../../../shared/photo-fetch.js";

type ReadResult = { contents: Array<{ uri: string; mimeType: string; blob: string }> };

const PHOTO_URL = "https://cdn.example.com/full.jpg";
const getPhotoDownloadUrl = vi.fn(() => okAsync(PHOTO_URL));

describe("recipe photo MCP resource", () => {
  const kh = useKernelHarness<RecipeState>("recipe", { client: { getPhotoDownloadUrl } });
  let jpeg: Buffer;

  beforeAll(async () => {
    const { default: sharp } = await import("sharp");
    // A 20×12 source, so a w=10 request resizes to a known width.
    jpeg = await sharp({ create: { width: 20, height: 12, channels: 3, background: { r: 200, g: 60, b: 60 } } })
      .jpeg()
      .toBuffer();
  });

  beforeEach(() => {
    getPhotoDownloadUrl.mockClear();
    getPhotoDownloadUrl.mockReturnValue(okAsync(PHOTO_URL));
    vi.mocked(fetchImageBytes).mockReset();
    vi.mocked(fetchImageBytes).mockResolvedValue({ bytes: jpeg, contentType: "image/jpeg" });
  });
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  const read = (uri: string, uid: string, name = "recipe-photo"): Promise<ReadResult> =>
    kh.callResource(name, uid, uri) as Promise<ReadResult>;

  it("serves the primary (photoLarge) photo as a JPEG blob", async () => {
    kh.seed({
      recipes: [makeRecipe({ uid: "r1" as RecipeUid, photoLarge: "photo-cover.jpg" })],
      photos: [makePhoto({ uid: "photo-cover" as PhotoUid, recipeUid: "r1", orderFlag: 0 })],
    });

    const result = await read("ui://recipe/r1/photo", "r1");

    expect(getPhotoDownloadUrl).toHaveBeenCalledWith("photo-cover");
    expect(vi.mocked(fetchImageBytes)).toHaveBeenCalledWith(PHOTO_URL);
    expect(result.contents[0]?.mimeType).toBe("image/jpeg");
    expect(result.contents[0]?.uri).toBe("ui://recipe/r1/photo");
    expect((result.contents[0]?.blob ?? "").length).toBeGreaterThan(0);
  });

  it("resolves the cover by photoLarge filename, not gallery order", async () => {
    kh.seed({
      recipes: [makeRecipe({ uid: "r1" as RecipeUid, photoLarge: "photo-b.jpg" })],
      photos: [
        makePhoto({ uid: "photo-a" as PhotoUid, recipeUid: "r1", orderFlag: 0 }),
        makePhoto({ uid: "photo-b" as PhotoUid, recipeUid: "r1", orderFlag: 1 }),
      ],
    });

    await read("ui://recipe/r1/photo", "r1");
    expect(getPhotoDownloadUrl).toHaveBeenCalledWith("photo-b");
  });

  it("falls back to the first gallery photo when photoLarge matches nothing", async () => {
    kh.seed({
      recipes: [makeRecipe({ uid: "r1" as RecipeUid, photoLarge: "stale.jpg" })],
      photos: [
        makePhoto({ uid: "photo-a" as PhotoUid, recipeUid: "r1", orderFlag: 0 }),
        makePhoto({ uid: "photo-b" as PhotoUid, recipeUid: "r1", orderFlag: 1 }),
      ],
    });

    await read("ui://recipe/r1/photo", "r1");
    expect(getPhotoDownloadUrl).toHaveBeenCalledWith("photo-a");
  });

  it("serves an indexed gallery photo (1-indexed)", async () => {
    kh.seed({
      recipes: [makeRecipe({ uid: "r1" as RecipeUid, photoLarge: "photo-a.jpg" })],
      photos: [
        makePhoto({ uid: "photo-a" as PhotoUid, recipeUid: "r1", orderFlag: 0 }),
        makePhoto({ uid: "photo-b" as PhotoUid, recipeUid: "r1", orderFlag: 1 }),
      ],
    });

    await read("ui://recipe/r1/photo/2", "r1", "recipe-photo-sized");
    expect(getPhotoDownloadUrl).toHaveBeenCalledWith("photo-b");
  });

  it("rejects an out-of-range gallery index", async () => {
    kh.seed({
      recipes: [makeRecipe({ uid: "r1" as RecipeUid, photoLarge: "photo-a.jpg" })],
      photos: [makePhoto({ uid: "photo-a" as PhotoUid, recipeUid: "r1", orderFlag: 0 })],
    });
    await expect(read("ui://recipe/r1/photo/5", "r1", "recipe-photo-sized")).rejects.toThrow();
  });

  it("falls back to the imported source image when there is no catalog photo", async () => {
    kh.seed({
      recipes: [makeRecipe({ uid: "r1" as RecipeUid, imageUrl: "https://src.example.com/hero.jpg" })],
    });

    await read("ui://recipe/r1/photo", "r1");
    expect(getPhotoDownloadUrl).not.toHaveBeenCalled();
    expect(vi.mocked(fetchImageBytes)).toHaveBeenCalledWith("https://src.example.com/hero.jpg");
  });

  it("rejects when the recipe has no photo at all", async () => {
    kh.seed({ recipes: [makeRecipe({ uid: "r1" as RecipeUid, photoLarge: null, imageUrl: "" })] });
    await expect(read("ui://recipe/r1/photo", "r1")).rejects.toThrow();
  });

  it("rejects for an unknown recipe", async () => {
    kh.seed({ recipes: [] });
    await expect(read("ui://recipe/nope/photo", "nope")).rejects.toThrow();
  });

  it("resizes to the requested width, scaling height proportionally", async () => {
    kh.seed({
      recipes: [makeRecipe({ uid: "r1" as RecipeUid, photoLarge: "photo-a.jpg" })],
      photos: [makePhoto({ uid: "photo-a" as PhotoUid, recipeUid: "r1", orderFlag: 0 })],
    });

    const result = await read("ui://recipe/r1/photo?w=10", "r1", "recipe-photo-sized");
    const { default: sharp } = await import("sharp");
    const meta = await sharp(Buffer.from(result.contents[0]?.blob ?? "", "base64")).metadata();
    expect(meta.width).toBe(10);
    expect(meta.height).toBe(6); // 20×12 scaled to width 10 → height 6
  });

  it("rejects an invalid dimension", async () => {
    kh.seed({
      recipes: [makeRecipe({ uid: "r1" as RecipeUid, photoLarge: "photo-a.jpg" })],
      photos: [makePhoto({ uid: "photo-a" as PhotoUid, recipeUid: "r1", orderFlag: 0 })],
    });
    await expect(read("ui://recipe/r1/photo?w=0", "r1", "recipe-photo-sized")).rejects.toThrow();
    await expect(read("ui://recipe/r1/photo?w=abc", "r1", "recipe-photo-sized")).rejects.toThrow();
  });

  it("caches resized bytes by content hash + size (one fetch for a repeat read)", async () => {
    kh.seed({
      recipes: [makeRecipe({ uid: "r1" as RecipeUid, photoLarge: "photo-a.jpg" })],
      photos: [makePhoto({ uid: "photo-a" as PhotoUid, recipeUid: "r1", orderFlag: 0 })],
    });

    await read("ui://recipe/r1/photo?w=10", "r1", "recipe-photo-sized");
    await read("ui://recipe/r1/photo?w=10", "r1", "recipe-photo-sized");
    expect(vi.mocked(fetchImageBytes)).toHaveBeenCalledTimes(1);
  });

  describe("list", () => {
    it("lists the primary photo URI for recipes that have a photo", async () => {
      kh.seed({
        recipes: [
          makeRecipe({ uid: "r1" as RecipeUid, name: "Has Photo", photoLarge: "photo-a.jpg" }),
          makeRecipe({ uid: "r2" as RecipeUid, name: "No Photo", photoLarge: null, imageUrl: "" }),
        ],
      });

      const result = (await kh.callResourceList("recipe-photo")) as {
        resources: Array<{ uri: string; name: string; mimeType: string }>;
      };
      expect(result.resources).toEqual([
        { uri: "ui://recipe/r1/photo", name: "Has Photo photo", mimeType: "image/jpeg" },
      ]);
    });
  });
});
