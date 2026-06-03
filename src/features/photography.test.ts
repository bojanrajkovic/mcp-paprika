import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import type { ResolvedImageGenConfig } from "../utils/config.js";

import { makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { tripBreaker } from "../../test/support/tool-test-utils.js";
import { CircuitOpenError } from "../utils/errors.js";
import { PhotographyAPIError, PhotographyError } from "./photography-errors.js";
import {
  DEFAULT_PHOTO_MODEL,
  PHOTO_ASPECT_RATIOS,
  PHOTO_MODELS,
  PhotographyClient,
  type PhotoModel,
  recipeToPhotoPrompt,
} from "./photography.js";

const BASE_URL = "https://openrouter.ai/api/v1";
const API_KEY = "test-img-key";
const ENDPOINT = `${BASE_URL}/chat/completions`;

function makeConfig(): ResolvedImageGenConfig {
  return { apiKey: API_KEY, baseUrl: BASE_URL };
}

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7, 6]);

function imageResponse(opts?: { bytes?: Buffer; mime?: string; cost?: number; model?: string }): object {
  const bytes = opts?.bytes ?? JPEG_BYTES;
  const mime = opts?.mime ?? "image/jpeg";
  return {
    model: opts?.model ?? "served/model-x",
    usage: opts?.cost === undefined ? {} : { cost: opts.cost },
    choices: [
      {
        message: {
          content: "",
          images: [{ type: "image_url", image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` } }],
        },
      },
    ],
  };
}

const server = setupServer();
beforeAll(() => {
  server.listen();
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe("PhotographyClient", () => {
  describe("exports", () => {
    it("PHOTO_MODELS are the curated four; default is seedream", () => {
      expect([...PHOTO_MODELS]).toEqual(["seedream", "nano-banana", "nano-banana-2", "gpt-image"]);
      expect(DEFAULT_PHOTO_MODEL).toBe("seedream");
      expect([...PHOTO_ASPECT_RATIOS]).toEqual(["1:1", "4:3", "3:2", "16:9"]);
    });
  });

  describe("recipeToPhotoPrompt", () => {
    it("includes name, description, category names, and editorial cues; NOT ingredients", () => {
      const recipe = makeRecipe({
        name: "Butter Chicken",
        description: "A lighter butter chicken.",
        ingredients: "chicken breasts, garam masala, tomato sauce, jasmine rice",
      });
      const prompt = recipeToPhotoPrompt(recipe, ["Indian", "Chicken"]);
      expect(prompt).toContain("Butter Chicken");
      expect(prompt).toContain("A lighter butter chicken.");
      expect(prompt).toContain("Indian, Chicken");
      expect(prompt).toContain("editorial style");
      // The ingredient list must never be injected (scatter/infographic failure mode).
      expect(prompt).not.toContain("garam masala");
      expect(prompt).not.toContain("jasmine rice");
    });

    it("omits description and categories when absent (sparse recipe)", () => {
      const recipe = makeRecipe({ name: "Blueberry Crumb Bars", description: "" });
      const prompt = recipeToPhotoPrompt(recipe, []);
      expect(prompt).toContain("Blueberry Crumb Bars");
      expect(prompt).not.toContain("Cuisine/type:");
      expect(prompt.trim()).toBe(
        "Professional food photography of Blueberry Crumb Bars. Natural daylight, shallow depth of field, appetizing plating, editorial style.",
      );
    });

    it("appends a trimmed style hint when provided", () => {
      const recipe = makeRecipe({ name: "Bo Kho", description: "" });
      const prompt = recipeToPhotoPrompt(recipe, [], "  on white marble, bright daylight  ");
      expect(prompt).toContain("on white marble, bright daylight");
      // style sits before the standing editorial cues
      expect(prompt.indexOf("on white marble")).toBeLessThan(prompt.indexOf("editorial style"));
    });

    it("ignores a whitespace-only style hint", () => {
      const recipe = makeRecipe({ name: "Soup", description: "" });
      expect(recipeToPhotoPrompt(recipe, [], "   ")).toBe(
        "Professional food photography of Soup. Natural daylight, shallow depth of field, appetizing plating, editorial style.",
      );
    });
  });

  describe("request shape", () => {
    it("text-to-image: POSTs slug, string content, modalities ['image'] for seedream, default aspect 1:1", async () => {
      let body: Record<string, unknown> = {};
      let auth = "";
      server.use(
        http.post(ENDPOINT, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          auth = request.headers.get("Authorization") ?? "";
          return HttpResponse.json(imageResponse());
        }),
      );

      const client = new PhotographyClient(makeConfig());
      await client.generate({ prompt: "a bowl of soup", model: "seedream" });

      expect(auth).toBe(`Bearer ${API_KEY}`);
      expect(body["model"]).toBe("bytedance-seed/seedream-4.5");
      expect(body["modalities"]).toEqual(["image"]);
      expect(body["image_config"]).toEqual({ aspect_ratio: "1:1" });
      expect(body["messages"]).toEqual([{ role: "user", content: "a bowl of soup" }]);
      // image_size must NOT be sent (normalized downstream instead).
      expect(JSON.stringify(body)).not.toContain("image_size");
    });

    it("non-seedream models use modalities ['image','text']", async () => {
      let modalities: unknown = null;
      let model: unknown = null;
      server.use(
        http.post(ENDPOINT, async ({ request }) => {
          const b = (await request.json()) as Record<string, unknown>;
          modalities = b["modalities"];
          model = b["model"];
          return HttpResponse.json(imageResponse());
        }),
      );
      const client = new PhotographyClient(makeConfig());
      await client.generate({ prompt: "x", model: "nano-banana-2" });
      expect(model).toBe("google/gemini-3.1-flash-image-preview");
      expect(modalities).toEqual(["image", "text"]);
    });

    it("custom aspect_ratio is forwarded", async () => {
      let imageConfig: unknown = null;
      server.use(
        http.post(ENDPOINT, async ({ request }) => {
          imageConfig = ((await request.json()) as Record<string, unknown>)["image_config"];
          return HttpResponse.json(imageResponse());
        }),
      );
      const client = new PhotographyClient(makeConfig());
      await client.generate({ prompt: "x", model: "seedream", aspectRatio: "4:3" });
      expect(imageConfig).toEqual({ aspect_ratio: "4:3" });
    });

    it("image-to-image: reference image becomes a content array with a data-URI image_url", async () => {
      let content: unknown = null;
      server.use(
        http.post(ENDPOINT, async ({ request }) => {
          content = ((await request.json()) as { messages: Array<{ content: unknown }> }).messages[0]!.content;
          return HttpResponse.json(imageResponse());
        }),
      );
      const client = new PhotographyClient(makeConfig());
      await client.generate({
        prompt: "restyle on marble",
        model: "seedream",
        referenceImage: { data: JPEG_BYTES, mimeType: "image/jpeg" },
      });
      expect(content).toEqual([
        { type: "text", text: "restyle on marble" },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${JPEG_BYTES.toString("base64")}` } },
      ]);
    });
  });

  describe("response decoding", () => {
    it("decodes a JPEG data-URI to bytes + mime, with cost and served model", async () => {
      server.use(http.post(ENDPOINT, () => HttpResponse.json(imageResponse({ cost: 0.04, model: "served/seedream" }))));
      const client = new PhotographyClient(makeConfig());
      const out = await client.generate({ prompt: "x", model: "seedream" });
      expect(out.bytes.equals(JPEG_BYTES)).toBe(true);
      expect(out.mimeType).toBe("image/jpeg");
      expect(out.costUsd).toBe(0.04);
      expect(out.servedModel).toBe("served/seedream");
    });

    it("decodes a PNG data-URI", async () => {
      server.use(http.post(ENDPOINT, () => HttpResponse.json(imageResponse({ bytes: PNG_BYTES, mime: "image/png" }))));
      const client = new PhotographyClient(makeConfig());
      const out = await client.generate({ prompt: "x", model: "nano-banana" });
      expect(out.bytes.equals(PNG_BYTES)).toBe(true);
      expect(out.mimeType).toBe("image/png");
    });

    it("costUsd is null when usage.cost is absent", async () => {
      server.use(http.post(ENDPOINT, () => HttpResponse.json(imageResponse())));
      const client = new PhotographyClient(makeConfig());
      const out = await client.generate({ prompt: "x", model: "seedream" });
      expect(out.costUsd).toBeNull();
    });

    it("200 with no image → PhotographyError (refusal / text-only)", async () => {
      server.use(http.post(ENDPOINT, () => HttpResponse.json({ choices: [{ message: { content: "no" } }] })));
      const client = new PhotographyClient(makeConfig());
      await expect(client.generate({ prompt: "x", model: "seedream" })).rejects.toBeInstanceOf(PhotographyError);
    });

    it("non-data-URI image url → PhotographyError", async () => {
      server.use(
        http.post(ENDPOINT, () =>
          HttpResponse.json({
            choices: [{ message: { images: [{ image_url: { url: "https://cdn.example/x.png" } }] } }],
          }),
        ),
      );
      const client = new PhotographyClient(makeConfig());
      await expect(client.generate({ prompt: "x", model: "seedream" })).rejects.toBeInstanceOf(PhotographyError);
    });

    it("malformed envelope (no choices) → ZodError", async () => {
      server.use(http.post(ENDPOINT, () => HttpResponse.json({ not: "a completion" })));
      const client = new PhotographyClient(makeConfig());
      await expect(client.generate({ prompt: "x", model: "seedream" })).rejects.toBeInstanceOf(ZodError);
    });
  });

  describe("resilience", () => {
    it("permanent (400) → PhotographyAPIError carrying status + endpoint", async () => {
      server.use(http.post(ENDPOINT, () => HttpResponse.json({ error: "bad" }, { status: 400 })));
      const client = new PhotographyClient(makeConfig());
      try {
        await client.generate({ prompt: "x", model: "seedream" });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(PhotographyAPIError);
        expect((error as PhotographyAPIError).status).toBe(400);
        expect((error as PhotographyAPIError).endpoint).toBe(ENDPOINT);
      }
    });

    it("transient (503) retries then succeeds", async () => {
      let calls = 0;
      server.use(
        http.post(ENDPOINT, () => {
          calls += 1;
          if (calls === 1) return HttpResponse.json({}, { status: 503 });
          return HttpResponse.json(imageResponse());
        }),
      );
      const client = new PhotographyClient(makeConfig());
      const out = await client.generate({ prompt: "x", model: "seedream" });
      expect(out.bytes.equals(JPEG_BYTES)).toBe(true);
      expect(calls).toBe(2);
    });

    it("tripped breaker surfaces CircuitOpenError('photography')", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      try {
        server.use(http.post(ENDPOINT, () => HttpResponse.json({}, { status: 503 })));
        const client = new PhotographyClient(makeConfig());
        await tripBreaker(() => client.generate({ prompt: "x", model: "seedream" as PhotoModel }));
        try {
          await client.generate({ prompt: "x", model: "seedream" });
          expect.unreachable("breaker should be open");
        } catch (error) {
          expect(error).toBeInstanceOf(CircuitOpenError);
          expect((error as CircuitOpenError).service).toBe("photography");
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
