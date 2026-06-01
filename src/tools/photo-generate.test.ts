import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import sharp from "sharp";

import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { RecipeUidSchema, type Recipe } from "../paprika/types.js";
import { makeCtx, makeTestServer, getText, seed } from "./tool-test-utils.js";
import { registerGeneratePhotoTool } from "./photo-generate.js";
import type { PhotographyClient, GeneratedPhoto, GeneratePhotoOptions } from "../features/photography.js";
import { CircuitOpenError } from "../utils/errors.js";
import { PhotographyError, PhotographyAPIError } from "../features/photography-errors.js";
import { fetchImageBytes } from "./photo-fetch.js";

// restyle's image download is exercised end-to-end in photo-fetch.test.ts; here
// we stub it to test generate_photo's restyle wiring.
vi.mock("./photo-fetch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./photo-fetch.js")>();
  return { ...actual, fetchImageBytes: vi.fn() };
});

const RECIPE_UID = RecipeUidSchema.parse("recipe-1");

let imageBytes: Buffer;
beforeAll(async () => {
  // 600x400 so the ~280px preview thumbnail is distinguishably smaller than the full image.
  imageBytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 10, g: 120, b: 200 } } })
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
  const recipe = opts?.recipe ?? makeRecipe({ uid: RECIPE_UID, name: "Test Recipe" });

  const generated: GeneratedPhoto = {
    bytes: imageBytes,
    mimeType: "image/png",
    costUsd: 0.04,
    servedModel: "served/seedream",
    ...opts?.generated,
  };
  const generate = opts?.generate ?? vi.fn().mockResolvedValue(generated);
  // Mirrors the real client: uploadPhoto returns the hash-stamped recipe (see client.test.ts).
  const uploadPhoto = vi.fn(async (recipe: Recipe): Promise<Recipe> => recipe);
  // restyle re-fetches authoritative recipe state for the freshest photoUrl.
  const getRecipe = vi.fn().mockResolvedValue(recipe);

  const { server, callTool } = makeTestServer();
  const ctx = seed(
    makeCtx(new RecipeStore(), server, {
      client: fromAny({ uploadPhoto, getRecipe, notifySync: vi.fn().mockResolvedValue(undefined) }),
      cache: fromAny({
        recipes: { put: vi.fn().mockResolvedValue(undefined) },
        photos: { put: vi.fn().mockResolvedValue(undefined) },
        flush: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    {
      recipes: [recipe],
      // load() flips hasSynced=true; omit photos key to simulate the photo catalog not yet synced.
      ...(opts?.synced !== false ? { photos: [] } : {}),
    },
  );
  const photographyClient = fromAny({ generate }) as PhotographyClient;
  registerGeneratePhotoTool(server, ctx, photographyClient);
  return { callTool, generate, uploadPhoto, getRecipe };
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

  it("attach:false returns an inline ~280px thumbnail preview without uploading", async () => {
    const { callTool, uploadPhoto } = setup();
    const result = await callTool("generate_photo", { recipe_uid: RECIPE_UID, attach: false });
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(getText(result)).toContain("Not attached");
    const imageBlock = result.content[1];
    expect(imageBlock?.type).toBe("image");
    if (imageBlock?.type === "image") {
      expect(imageBlock.mimeType).toBe("image/jpeg");
      // The preview is the thumbnail (≤280px longest edge), not the 600px full image.
      const meta = await sharp(Buffer.from(imageBlock.data, "base64")).metadata();
      expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(280);
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

  it("restyle_existing re-fetches the authoritative recipe and passes its photo as a reference image", async () => {
    const recipe = makeRecipe({ uid: RECIPE_UID, name: "Test Recipe", photoUrl: "https://photos.example/p.jpg" });
    vi.mocked(fetchImageBytes).mockResolvedValue({ bytes: imageBytes, contentType: "image/png" });
    const { callTool, generate, getRecipe } = setup({ recipe });

    await callTool("generate_photo", { recipe_uid: RECIPE_UID, restyle_existing: true });

    expect(getRecipe).toHaveBeenCalledWith(RECIPE_UID);
    expect(fetchImageBytes).toHaveBeenCalledWith("https://photos.example/p.jpg");
    const opts = lastOptions(generate);
    expect(opts.referenceImage).toBeDefined();
    expect(opts.referenceImage?.mimeType).toBe("image/png");
    expect(opts.referenceImage?.data.equals(imageBytes)).toBe(true);
  });

  it("restyle uses the re-fetched photoUrl even when the cached recipe has none (just-attached photo)", async () => {
    // Store has no photoUrl yet (sync lag), but the authoritative re-fetch returns one.
    const cached = makeRecipe({ uid: RECIPE_UID, name: "Test Recipe", photoUrl: null });
    const fresh = makeRecipe({ uid: RECIPE_UID, name: "Test Recipe", photoUrl: "https://photos.example/new.jpg" });
    vi.mocked(fetchImageBytes).mockResolvedValue({ bytes: imageBytes, contentType: "image/jpeg" });
    const { server, callTool } = makeTestServer();
    const generate = vi.fn().mockResolvedValue({
      bytes: imageBytes,
      mimeType: "image/png",
      costUsd: 0.04,
      servedModel: "x",
    });
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        client: fromAny({
          uploadPhoto: vi.fn(async (recipe: Recipe): Promise<Recipe> => recipe),
          getRecipe: vi.fn().mockResolvedValue(fresh),
          notifySync: vi.fn().mockResolvedValue(undefined),
        }),
        cache: fromAny({
          recipes: { put: vi.fn().mockResolvedValue(undefined) },
          photos: { put: vi.fn().mockResolvedValue(undefined) },
          flush: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      { recipes: [cached], photos: [] },
    );
    registerGeneratePhotoTool(server, ctx, fromAny({ generate }) as PhotographyClient);

    const result = await callTool("generate_photo", { recipe_uid: RECIPE_UID, restyle_existing: true });

    expect(getText(result)).not.toContain("no photo to restyle");
    expect(lastOptions(generate).referenceImage).toBeDefined();
  });

  it("surfaces a generic generation failure as a tool error", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("provider exploded"));
    const { callTool, uploadPhoto } = setup({ generate });
    const result = await callTool("generate_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result)).toContain("Failed to generate photo");
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("a tripped breaker surfaces a 'temporarily unavailable' message", async () => {
    const generate = vi.fn().mockRejectedValue(new CircuitOpenError("photography", "https://x/chat/completions"));
    const { callTool } = setup({ generate });
    const result = await callTool("generate_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result)).toContain("temporarily unavailable");
  });

  it("a 401 from the provider yields a credentials hint", async () => {
    const generate = vi.fn().mockRejectedValue(new PhotographyAPIError("bad key", 401, "https://x/chat/completions"));
    const { callTool } = setup({ generate });
    const result = await callTool("generate_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result)).toContain("IMAGE_GEN_API_KEY");
  });

  it("a no-image refusal yields a model/style hint", async () => {
    const generate = vi.fn().mockRejectedValue(new PhotographyError("returned no image"));
    const { callTool } = setup({ generate });
    const result = await callTool("generate_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result)).toContain("no image");
  });
});
