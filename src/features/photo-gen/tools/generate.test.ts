import { fromAny } from "@total-typescript/shoehorn";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GeneratedPhoto, GeneratePhotoOptions, PhotographyClient } from "../../photography.js";

import { makeRecipe } from "../../../../test/cache/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { RecipeUidSchema } from "../../../ids.js";
import { fetchImageBytes } from "../../../shared/photo-fetch.js";
import { CircuitOpenError } from "../../../utils/errors.js";
import { PhotographyAPIError, PhotographyError } from "../../photography-errors.js";

// restyle's image download is exercised end-to-end in photo-fetch.test.ts; here
// we stub it to test generate_recipe_photo's restyle wiring.
vi.mock("../../../shared/photo-fetch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../shared/photo-fetch.js")>();
  return { ...actual, fetchImageBytes: vi.fn() };
});

const RECIPE_UID = RecipeUidSchema.parse("recipe-1");

let imageBytes: Buffer;
beforeAll(async () => {
  // 600x400 so the ~280px preview thumbnail is distinguishably smaller than the full image.
  imageBytes = await sharp({
    create: { width: 600, height: 400, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
});

// Inject a mock PhotographyClient into the photo-gen module's self after setup.
// `PhotoGenSelf.photographyClient` is TypeScript-readonly but a plain JS object at
// runtime, so the cast lets us swap in a spy — the same pattern discover.test.ts
// uses to inject its mock vector store.
function injectPhotographyClient(kh: ReturnType<typeof useKernelHarness>, client: PhotographyClient): void {
  (kh.self() as { photographyClient: PhotographyClient | null }).photographyClient = client;
}

function makeGeneratedPhoto(overrides?: Partial<GeneratedPhoto>): GeneratedPhoto {
  return {
    bytes: imageBytes,
    mimeType: "image/png",
    costUsd: 0.04,
    servedModel: "served/seedream",
    ...overrides,
  };
}

function lastOptions(generate: ReturnType<typeof vi.fn>): GeneratePhotoOptions {
  return generate.mock.calls[generate.mock.calls.length - 1]![0] as GeneratePhotoOptions;
}

describe("generate_recipe_photo tool", () => {
  const kh = useKernelHarness("photo-gen");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper: seed a recipe and stub the uploadPhoto client method (used by the
  // attach path through ctx.deps.recipe.attachGeneratedPhoto). The mock photography
  // client is injected into photo-gen's self post-setup.
  function seedAndInject(opts?: {
    recipe?: ReturnType<typeof makeRecipe>;
    synced?: boolean;
    generated?: Partial<GeneratedPhoto>;
    generate?: ReturnType<typeof vi.fn>;
  }): {
    generate: ReturnType<typeof vi.fn>;
  } {
    const recipe = opts?.recipe ?? makeRecipe({ uid: RECIPE_UID, name: "Test Recipe" });
    const generated = makeGeneratedPhoto(opts?.generated);
    const generate = opts?.generate ?? vi.fn().mockResolvedValue(generated);

    // Mirrors the real client: uploadPhoto returns the hash-stamped recipe.
    vi.mocked(kh.client().uploadPhoto).mockResolvedValue(recipe);
    vi.mocked(kh.client().getRecipe).mockResolvedValue(recipe);

    kh.seed({
      recipes: [recipe],
      // load() flips hasSynced=true; omit photos to simulate photo catalog not yet synced.
      ...(opts?.synced !== false ? { photos: [] } : {}),
    });

    injectPhotographyClient(kh, fromAny({ generate }) as PhotographyClient);
    return { generate };
  }

  it("generates with the default model from a name-based prompt, attaches, and reports cost + UID", async () => {
    const { generate } = seedAndInject();

    const result = await kh.callTool("generate_recipe_photo", { recipe_uid: RECIPE_UID });

    expect(generate).toHaveBeenCalledTimes(1);
    const opts = lastOptions(generate);
    expect(opts.model).toBe("seedream");
    expect(opts.prompt).toContain("Test Recipe");
    expect(opts.referenceImage).toBeUndefined();
    expect(kh.client().uploadPhoto).toHaveBeenCalledTimes(1);

    const text = getText(result);
    expect(text).toContain('Generated and attached a photo to "Test Recipe"');
    expect(text).toContain("seedream");
    expect(text).toContain("$0.0400");
  });

  it("appends the style hint to the prompt", async () => {
    const { generate } = seedAndInject();
    await kh.callTool("generate_recipe_photo", {
      recipe_uid: RECIPE_UID,
      style: "on white marble",
    });
    expect(lastOptions(generate).prompt).toContain("on white marble");
  });

  it("forwards the chosen model and aspect_ratio", async () => {
    const { generate } = seedAndInject();
    await kh.callTool("generate_recipe_photo", {
      recipe_uid: RECIPE_UID,
      model: "gpt-image",
      aspect_ratio: "4:3",
    });
    const opts = lastOptions(generate);
    expect(opts.model).toBe("gpt-image");
    expect(opts.aspectRatio).toBe("4:3");
  });

  it("attach:false returns an inline ~280px thumbnail preview without uploading", async () => {
    seedAndInject();
    const result = await kh.callTool("generate_recipe_photo", {
      recipe_uid: RECIPE_UID,
      attach: false,
    });
    expect(kh.client().uploadPhoto).not.toHaveBeenCalled();
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

  it("attach:false stashes the full generated bytes under a returned token", async () => {
    seedAndInject();
    const result = await kh.callTool("generate_recipe_photo", {
      recipe_uid: RECIPE_UID,
      attach: false,
    });

    const text = getText(result);
    const token = text.match(/gen_[A-Za-z0-9_-]+/)?.[0];
    expect(token).toBeDefined();
    expect(text).toContain("generation_token");

    // The token resolves to the exact full-resolution generated bytes (not the
    // downscaled preview thumbnail), tagged with the recipe it was made for.
    const stashed = kh.infra().generatedImageStore.consume(token!);
    expect(stashed?.bytes).toEqual(imageBytes);
    expect(stashed?.recipeUid).toBe(RECIPE_UID);
    expect(stashed?.model).toBe("seedream");
  });

  it("omits the cost suffix when the provider reports no cost", async () => {
    seedAndInject({ generated: { costUsd: null } });
    const result = await kh.callTool("generate_recipe_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result)).not.toContain("cost:");
  });

  it("returns not-configured message when photo-gen client is null (feature gate)", async () => {
    // Default setup: photographyClient is null (no IMAGE_GEN_API_KEY in test config).
    // No injectPhotographyClient call — the gate fires.
    kh.seed({ recipes: [makeRecipe({ uid: RECIPE_UID })], photos: [] });
    const result = await kh.callTool("generate_recipe_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result)).toContain("not configured");
  });

  it("returns cold-start guidance when the recipe store is empty", async () => {
    // inject a real photography client so the feature gate passes; cold-start fires on
    // empty recipe store (hasSynced false, store size 0).
    const generate = vi.fn();
    injectPhotographyClient(kh, fromAny({ generate }) as PhotographyClient);
    // store never seeded — hasSynced false
    const result = await kh.callTool("generate_recipe_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result).toLowerCase()).toContain("no recipe found");
  });

  it("waits when the photo catalog is not yet synced (attach path)", async () => {
    // The kernel tool generates first, then the attach path (via ctx.deps.recipe.attachGeneratedPhoto)
    // gates on photo catalog sync. So when the catalog isn't synced, generation still runs and the
    // failure surfaces at attach — generate IS called, even though the result says "still syncing".
    seedAndInject({ synced: false });
    const result = await kh.callTool("generate_recipe_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result).toLowerCase()).toContain("still syncing");
  });

  it("reports a not-found for an unknown recipe", async () => {
    seedAndInject();
    const result = await kh.callTool("generate_recipe_photo", {
      recipe_uid: RecipeUidSchema.parse("nope"),
    });
    expect(getText(result)).toContain("No recipe found");
  });

  it("restyle_existing errors when the recipe has no photo", async () => {
    const recipe = makeRecipe({ uid: RECIPE_UID, name: "Test Recipe", photoUrl: null });
    const { generate } = seedAndInject({ recipe });
    const result = await kh.callTool("generate_recipe_photo", {
      recipe_uid: RECIPE_UID,
      restyle_existing: true,
    });
    expect(getText(result)).toContain("no photo to restyle");
    expect(generate).not.toHaveBeenCalled();
  });

  it("restyle_existing re-fetches the authoritative recipe and passes its photo as a reference image", async () => {
    const recipe = makeRecipe({
      uid: RECIPE_UID,
      name: "Test Recipe",
      photoUrl: "https://photos.example/p.jpg",
    });
    vi.mocked(fetchImageBytes).mockResolvedValue({ bytes: imageBytes, contentType: "image/png" });
    const { generate } = seedAndInject({ recipe });
    // getRecipe is already mocked to return recipe in seedAndInject; confirm it's used.
    vi.mocked(kh.client().getRecipe).mockResolvedValue(recipe);

    await kh.callTool("generate_recipe_photo", {
      recipe_uid: RECIPE_UID,
      restyle_existing: true,
    });

    expect(kh.client().getRecipe).toHaveBeenCalledWith(RECIPE_UID);
    expect(fetchImageBytes).toHaveBeenCalledWith("https://photos.example/p.jpg");
    const opts = lastOptions(generate);
    expect(opts.referenceImage).toBeDefined();
    expect(opts.referenceImage?.mimeType).toBe("image/png");
    expect(opts.referenceImage?.data.equals(imageBytes)).toBe(true);
  });

  it("restyle uses the re-fetched photoUrl even when the cached recipe has none (just-attached photo)", async () => {
    // Cached recipe has no photoUrl (sync lag), but the authoritative re-fetch returns one.
    const cached = makeRecipe({ uid: RECIPE_UID, name: "Test Recipe", photoUrl: null });
    const fresh = makeRecipe({
      uid: RECIPE_UID,
      name: "Test Recipe",
      photoUrl: "https://photos.example/new.jpg",
    });
    vi.mocked(fetchImageBytes).mockResolvedValue({ bytes: imageBytes, contentType: "image/jpeg" });

    const generate = vi.fn().mockResolvedValue(makeGeneratedPhoto());
    vi.mocked(kh.client().uploadPhoto).mockResolvedValue(cached);
    vi.mocked(kh.client().getRecipe).mockResolvedValue(fresh);

    kh.seed({ recipes: [cached], photos: [] });
    injectPhotographyClient(kh, fromAny({ generate }) as PhotographyClient);

    const result = await kh.callTool("generate_recipe_photo", {
      recipe_uid: RECIPE_UID,
      restyle_existing: true,
    });

    expect(getText(result)).not.toContain("no photo to restyle");
    expect(lastOptions(generate).referenceImage).toBeDefined();
  });

  it("surfaces a generic generation failure as a tool error", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("provider exploded"));
    seedAndInject({ generate });
    const result = await kh.callTool("generate_recipe_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result)).toContain("Failed to generate photo");
    expect(kh.client().uploadPhoto).not.toHaveBeenCalled();
  });

  it("a tripped breaker surfaces a 'temporarily unavailable' message", async () => {
    const generate = vi.fn().mockRejectedValue(new CircuitOpenError("photography", "https://x/chat/completions"));
    seedAndInject({ generate });
    const result = await kh.callTool("generate_recipe_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result)).toContain("temporarily unavailable");
  });

  it("a 401 from the provider yields a credentials hint", async () => {
    const generate = vi.fn().mockRejectedValue(new PhotographyAPIError("bad key", 401, "https://x/chat/completions"));
    seedAndInject({ generate });
    const result = await kh.callTool("generate_recipe_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result)).toContain("IMAGE_GEN_API_KEY");
  });

  it("a no-image refusal yields a model/style hint", async () => {
    const generate = vi.fn().mockRejectedValue(new PhotographyError("returned no image"));
    seedAndInject({ generate });
    const result = await kh.callTool("generate_recipe_photo", { recipe_uid: RECIPE_UID });
    expect(getText(result)).toContain("no image");
  });
});
