import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ZodError } from "zod";
import { EmbeddingClient } from "./embeddings.js";
import { EmbeddingError, EmbeddingAPIError } from "./embedding-errors.js";
import { recipeToEmbeddingText } from "./embeddings.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import type { EmbeddingConfig } from "../utils/config.js";

const BASE_URL = "https://api.example.com/v1";
const API_KEY = "test-api-key";
const MODEL = "text-embedding-3-small";

function makeEmbeddingConfig(): EmbeddingConfig {
  return { apiKey: API_KEY, baseUrl: BASE_URL, model: MODEL };
}

function makeEmbeddingResponse(embeddings: Array<Array<number>>): object {
  return {
    data: embeddings.map((embedding, index) => ({ index, embedding, object: "embedding" })),
    model: MODEL,
    object: "list",
    usage: { prompt_tokens: 10, total_tokens: 10 },
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

describe("EmbeddingClient", () => {
  describe("p3-u03-embeddings.AC1: EmbeddingClient sends correct requests", () => {
    it("p3-u03-embeddings.AC1.1 - embedBatch sends POST with correct body and headers", async () => {
      let capturedBody: unknown = null;
      let capturedHeaders: Record<string, string> = {};
      let capturedMethod: string | null = null;

      server.use(
        http.post(`${BASE_URL}/embeddings`, async ({ request }) => {
          capturedMethod = request.method;
          capturedBody = await request.json();
          capturedHeaders = {
            authorization: request.headers.get("Authorization") ?? "",
            contentType: request.headers.get("Content-Type") ?? "",
          };
          return HttpResponse.json(makeEmbeddingResponse([[0.1, 0.2, 0.3]]));
        }),
      );

      const client = new EmbeddingClient(makeEmbeddingConfig());
      await client.embedBatch(["a", "b", "c"]);

      expect(capturedMethod).toBe("POST");
      expect(capturedHeaders.authorization).toBe(`Bearer ${API_KEY}`);
      expect(capturedHeaders.contentType).toBe("application/json");
      expect(capturedBody).toEqual({
        model: MODEL,
        input: ["a", "b", "c"],
      });
    });

    it("p3-u03-embeddings.AC1.2 - embed returns single number array", async () => {
      server.use(
        http.post(`${BASE_URL}/embeddings`, () => {
          return HttpResponse.json(makeEmbeddingResponse([[0.1, 0.2, 0.3]]));
        }),
      );

      const client = new EmbeddingClient(makeEmbeddingConfig());
      const embedding = await client.embed("hello");

      expect(Array.isArray(embedding)).toBe(true);
      expect(typeof embedding[0]).toBe("number");
      expect(embedding).toEqual([0.1, 0.2, 0.3]);
    });

    it("p3-u03-embeddings.AC1.3 - strips trailing slash from baseUrl", async () => {
      let capturedUrl: string | null = null;

      server.use(
        http.post("https://api.example.com/v1/embeddings", async ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(makeEmbeddingResponse([[0.1, 0.2]]));
        }),
      );

      const config: EmbeddingConfig = {
        apiKey: API_KEY,
        baseUrl: "https://api.example.com/v1/",
        model: MODEL,
      };
      const client = new EmbeddingClient(config);
      await client.embedBatch(["test"]);

      expect(capturedUrl).toBe("https://api.example.com/v1/embeddings");
      expect(capturedUrl).not.toContain("//embeddings");
    });

    it("p3-u03-embeddings.AC1.4 - validates response with Zod schema", async () => {
      server.use(
        http.post(`${BASE_URL}/embeddings`, () => {
          return HttpResponse.json(makeEmbeddingResponse([[0.1, 0.2, 0.3]]));
        }),
      );

      const client = new EmbeddingClient(makeEmbeddingConfig());
      const embeddings = await client.embedBatch(["test"]);

      expect(embeddings).toHaveLength(1);
      expect(embeddings[0]).toEqual([0.1, 0.2, 0.3]);
    });
  });

  describe("p3-u03-embeddings.AC2: Resilience handles transient failures", () => {
    it("p3-u03-embeddings.AC2.1 - 429 response retries and succeeds", async () => {
      let callCount = 0;

      server.use(
        http.post(`${BASE_URL}/embeddings`, () => {
          callCount++;
          if (callCount === 1) {
            return HttpResponse.json({}, { status: 429 });
          }
          return HttpResponse.json(makeEmbeddingResponse([[0.1, 0.2]]));
        }),
      );

      const client = new EmbeddingClient(makeEmbeddingConfig());
      const embedding = await client.embed("test");

      expect(embedding).toEqual([0.1, 0.2]);
      expect(callCount).toBe(2);
    });

    it("p3-u03-embeddings.AC2.2 - 500/502/503 responses retry and succeed", async () => {
      for (const status of [500, 502, 503]) {
        let callCount = 0;

        server.use(
          http.post(`${BASE_URL}/embeddings`, () => {
            callCount++;
            if (callCount === 1) {
              return HttpResponse.json({}, { status });
            }
            return HttpResponse.json(makeEmbeddingResponse([[0.1, 0.2]]));
          }),
        );

        const client = new EmbeddingClient(makeEmbeddingConfig());
        const embedding = await client.embed("test");

        expect(embedding).toEqual([0.1, 0.2]);
        expect(callCount).toBe(2);

        server.resetHandlers();
      }
    });

    it("p3-u03-embeddings.AC2.3 - circuit breaker opens after 5 consecutive failures", async () => {
      let callCount = 0;

      server.use(
        http.post(`${BASE_URL}/embeddings`, () => {
          callCount++;
          return HttpResponse.json({}, { status: 429 });
        }),
      );

      // Use a dedicated client instance for this test to isolate circuit breaker state
      const client = new EmbeddingClient(makeEmbeddingConfig());

      // Make 5+ calls that all fail with retries exhausted
      for (let i = 0; i < 6; i++) {
        try {
          await client.embedBatch(["test"]);
        } catch (error) {
          // Swallow errors to continue testing circuit breaker
          void error;
        }
      }

      // After exhausting retries on the 5th failure, the circuit should be open
      // The 6th call should fail with "circuit open" without hitting the network
      const networkCallsBeforeCircuit = callCount;

      // Try one more call to verify circuit is open
      try {
        await client.embedBatch(["test"]);
        expect.fail("Should have thrown EmbeddingAPIError for circuit open");
      } catch (error) {
        expect(error).toBeInstanceOf(EmbeddingAPIError);
        expect((error as EmbeddingAPIError).message).toContain("circuit open");
      }

      // Verify the circuit call didn't hit the network
      // (callCount stays the same because the request never executed)
      expect(callCount).toBe(networkCallsBeforeCircuit);
    });
  });

  describe("p3-u03-embeddings.AC3: Error handling for permanent failures", () => {
    it("p3-u03-embeddings.AC3.1 - 400 throws EmbeddingAPIError without retry", async () => {
      let callCount = 0;

      server.use(
        http.post(`${BASE_URL}/embeddings`, () => {
          callCount++;
          return HttpResponse.json({}, { status: 400 });
        }),
      );

      const client = new EmbeddingClient(makeEmbeddingConfig());

      try {
        await client.embedBatch(["test"]);
        expect.fail("Should have thrown EmbeddingAPIError");
      } catch (error) {
        expect(error).toBeInstanceOf(EmbeddingAPIError);
        const apiError = error as EmbeddingAPIError;
        expect(apiError.status).toBe(400);
        expect(apiError.endpoint).toBe(`${BASE_URL}/embeddings`);
      }

      // Verify no retry (only called once)
      expect(callCount).toBe(1);
    });

    it("p3-u03-embeddings.AC3.2 - 401 throws EmbeddingAPIError without retry", async () => {
      let callCount = 0;

      server.use(
        http.post(`${BASE_URL}/embeddings`, () => {
          callCount++;
          return HttpResponse.json({}, { status: 401 });
        }),
      );

      const client = new EmbeddingClient(makeEmbeddingConfig());

      try {
        await client.embedBatch(["test"]);
        expect.fail("Should have thrown EmbeddingAPIError");
      } catch (error) {
        expect(error).toBeInstanceOf(EmbeddingAPIError);
        const apiError = error as EmbeddingAPIError;
        expect(apiError.status).toBe(401);
      }

      // Verify no retry
      expect(callCount).toBe(1);
    });

    it("p3-u03-embeddings.AC3.3 - malformed response throws ZodError", async () => {
      server.use(
        http.post(`${BASE_URL}/embeddings`, () => {
          // Missing 'data' field
          return HttpResponse.json({
            model: MODEL,
            usage: { prompt_tokens: 10, total_tokens: 10 },
          });
        }),
      );

      const client = new EmbeddingClient(makeEmbeddingConfig());

      try {
        await client.embedBatch(["test"]);
        expect.fail("Should have thrown ZodError");
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
      }
    });
  });

  describe("p3-u03-embeddings.AC4: Dimensions getter", () => {
    it("p3-u03-embeddings.AC4.1 - dimensions returns correct vector length after embed", async () => {
      server.use(
        http.post(`${BASE_URL}/embeddings`, () => {
          return HttpResponse.json(makeEmbeddingResponse([[0.1, 0.2, 0.3, 0.4]]));
        }),
      );

      const client = new EmbeddingClient(makeEmbeddingConfig());
      await client.embed("test");

      expect(client.dimensions).toBe(4);
    });

    it("p3-u03-embeddings.AC4.2 - dimensions throws EmbeddingError before any embed call", async () => {
      const client = new EmbeddingClient(makeEmbeddingConfig());

      try {
        const _ = client.dimensions;
        expect.fail("Should have thrown EmbeddingError");
      } catch (error) {
        expect(error).toBeInstanceOf(EmbeddingError);
        expect((error as EmbeddingError).message).toContain("no embedding call has been made yet");
      }
    });
  });
});

describe("p3-u03-embeddings.AC5: recipeToEmbeddingText", () => {
  it("p3-u03-embeddings.AC5.1 - includes name, description, categories, ingredients, notes", () => {
    const recipe = makeRecipe({
      name: "Pasta Carbonara",
      description: "Classic Italian pasta",
      ingredients: "spaghetti, eggs, pancetta",
      notes: "Use fresh eggs",
    });
    const categoryNames = ["Italian", "Pasta"];

    const text = recipeToEmbeddingText(recipe, categoryNames);

    expect(text).toContain("Pasta Carbonara");
    expect(text).toContain("Description: Classic Italian pasta");
    expect(text).toContain("Categories: Italian, Pasta");
    expect(text).toContain("Ingredients: spaghetti, eggs, pancetta");
    expect(text).toContain("Notes: Use fresh eggs");
  });

  it("p3-u03-embeddings.AC5.2 - excludes directions", () => {
    const recipe = makeRecipe({
      name: "Test Recipe",
      directions: "Boil water, cook pasta",
      ingredients: "pasta",
    });
    const text = recipeToEmbeddingText(recipe, []);

    expect(text).not.toContain("directions");
    expect(text).not.toContain("Boil water");
  });

  it("p3-u03-embeddings.AC5.3 - omits null/empty fields", () => {
    const recipe = makeRecipe({
      name: "Simple Recipe",
      description: null,
      notes: null,
      ingredients: "",
    });
    const text = recipeToEmbeddingText(recipe, []);

    expect(text).toBe("Simple Recipe");
    expect(text).not.toContain("Description:");
    expect(text).not.toContain("Categories:");
    expect(text).not.toContain("Ingredients:");
    expect(text).not.toContain("Notes:");
  });

  it("p3-u03-embeddings.AC5.4 - empty category array produces no Categories line", () => {
    const recipe = makeRecipe({
      name: "Test",
      ingredients: "flour",
    });
    const text = recipeToEmbeddingText(recipe, []);

    expect(text).not.toContain("Categories:");
    expect(text).toContain("Ingredients: flour");
  });
});
