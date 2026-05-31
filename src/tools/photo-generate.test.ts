import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import sharp from "sharp";

import { RecipeStore } from "../cache/recipe-store.js";
import { PhotoStore } from "../cache/photo-store.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { RecipeUidSchema, type Recipe } from "../paprika/types.js";
import { makeCtx, makeTestServer, getText } from "./tool-test-utils.js";
import { registerGeneratePhotoTool } from "./photo-generate.js";
import type { PhotographyClient, GeneratedPhoto, GeneratePhotoOptions } from "../features/photography.js";

const RECIPE_UID = RecipeUidSchema.parse("recipe-1");

let imageBytes: Buffer;
beforeAll(async () => {
  imageBytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .png()
    .toBuffer();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(opts?: {
  recipe?: Recipe;
  synced?: boolean;
  generated?: Partial<GeneratedPhoto>;
  generate?: ReturnType<typeof vi.fn>;
}) {
  const store = new RecipeStore();
  store.load([opts?.recipe ?? makeRecipe({ uid: RECIPE_UID, name: "Test Recipe" })]);
  const photoStore = new PhotoStore();
  // load() flips hasSynced=true; skip it to simulate the photo catalog not yet synced.
  if (opts?.synced !== false) photoStore.load([]);

  const generated: GeneratedPhoto = {
    bytes: imageBytes,
    mimeType: "image/png",
    costUsd: 0.04,
    servedModel: "served/seedream",
    ...opts?.generated,
  };
  const generate = opts?.generate ?? vi.fn().mockResolvedValue(generated);
  const uploadPhoto = vi.fn().mockResolvedValue(undefined);

  const { server, callTool } = makeTestServer();
  const ctx = makeCtx(store, server, {
    photoStore,
    client: fromAny({ uploadPhoto, notifySync: vi.fn().mockResolvedValue(undefined) }),
    cache: fromAny({
      recipes: { put: vi.fn().mockResolvedValue(undefined) },
      photos: { put: vi.fn().mockResolvedValue(undefined) },
      flush: vi.fn().mockResolvedValue(undefined),
    }),
  });
  const photographyClient = fromAny({ generate }) as PhotographyClient;
  registerGeneratePhotoTool(server, ctx, photographyClient);
  return { callTool, generate, uploadPhoto };
}

function lastOptions(generate: ReturnType<typeof vi.fn>): GeneratePhotoOptions {
  return generate.mock.calls[generate.mock.calls.length - 1]![0] as GeneratePhotoOptions;
}

describe("generate_photo", () => {
  it("generates with the default model from a name-based prompt, attaches, and reports cost + UID", async () => {
    const { callTool, generate, uploadPhoto } = setup();

    const result = await callTool("generate_photo", { recipe_uid: RECIPE_UID });

    expect(generate).toHaveBeenCalledTimes(1);
    const opts = lastOptions(generate);
    expect(opts.model).toBe("seedream");
    expect(opts.prompt).toContain("Test Recipe");
    expect(opts.referenceImage).toBeUndefined();
    expect(uploadPhoto).toHaveBeenCalledTimes(1);

    const text = getText(result);
    expect(text).toContain('Generated a photo for "Test Recipe"');
    expect(text).toContain("seedream");
    expect(text).toContain("$0.0400");
  });

  it("appends the style hint to the prompt", async () => {
    const { callTool, generate } = setup();
    await callTool("generate_photo", { recipe_uid: RECIPE_UID, style: "on white marble" });
    expect(lastOptions(generate).prompt).toContain("on white marble");
  });

  it("forwards the chosen model and aspect_ratio", async () => {
    const { callTool, generate } = setup();
    await callTool("generate_photo", { recipe_uid: RECIPE_UID, model: "gpt-image", aspect_ratio: "4:3" });
    const opts = lastOptions(generate);
    expect(opts.model).toBe("gpt-image");
    expect(opts.aspectRatio).toBe("4:3");
  });

  it("attach:false returns an inline image preview without uploading", async () => {
    const { callTool, uploadPhoto } = setup();
    const result = await callTool("generate_photo", { recipe_uid: RECIPE_UID, attach: false });
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(getText(result)).toContain("Not attached");
    const imageBlock = result.content[1];
    expect(imageBlock?.type).toBe("image");
    if (imageBlock?.type === "image") {
      expect(imageBlock.mimeType).toBe("image/jpeg");
      expect(imageBlock.data.length).toBeGreaterThan(0);
    }
  });

  it("omits the cost suffix when the provider reports no cost", async () => {
    const { callTool } = setup({ generated: { costUsd: null } });
    const result = await callTool("generate_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result)).not.toContain("cost:");
  });

  it("returns cold-start guidance when the recipe store is empty", async () => {
    const store = new RecipeStore(); // not loaded
    const { server, callTool } = makeTestServer();
    registerGeneratePhotoTool(server, makeCtx(store, server), fromAny({ generate: vi.fn() }) as PhotographyClient);
    const result = await callTool("generate_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result).toLowerCase()).toContain("try again");
  });

  it("waits when the photo catalog is not yet synced (attach path)", async () => {
    const { callTool, generate } = setup({ synced: false });
    const result = await callTool("generate_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result).toLowerCase()).toContain("still syncing");
    expect(generate).not.toHaveBeenCalled();
  });

  it("reports a not-found for an unknown recipe", async () => {
    const { callTool } = setup();
    const result = await callTool("generate_photo", { recipe_uid: RecipeUidSchema.parse("nope") });
    expect(getText(result)).toContain("No recipe found");
  });

  it("restyle_existing errors when the recipe has no photo", async () => {
    const recipe = makeRecipe({ uid: RECIPE_UID, name: "Test Recipe", photoUrl: null });
    const { callTool, generate } = setup({ recipe });
    const result = await callTool("generate_photo", { recipe_uid: RECIPE_UID, restyle_existing: true });
    expect(getText(result)).toContain("no photo to restyle");
    expect(generate).not.toHaveBeenCalled();
  });

  it("restyle_existing fetches the current photo and passes it as a reference image", async () => {
    const recipe = makeRecipe({ uid: RECIPE_UID, name: "Test Recipe", photoUrl: "https://photos.example/p.jpg" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(imageBytes, { status: 200, headers: { "content-type": "image/png" } }) as unknown as Response,
    );
    const { callTool, generate } = setup({ recipe });

    await callTool("generate_photo", { recipe_uid: RECIPE_UID, restyle_existing: true });

    const opts = lastOptions(generate);
    expect(opts.referenceImage).toBeDefined();
    expect(opts.referenceImage?.mimeType).toBe("image/png");
    expect(opts.referenceImage?.data.equals(imageBytes)).toBe(true);
  });

  it("surfaces a generation failure as a tool error", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("provider exploded"));
    const { callTool, uploadPhoto } = setup({ generate });
    const result = await callTool("generate_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result)).toContain("Failed to generate photo");
    expect(uploadPhoto).not.toHaveBeenCalled();
  });
});
