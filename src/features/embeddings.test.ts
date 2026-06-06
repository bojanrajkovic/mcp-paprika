import { BrokenCircuitError } from "cockatiel";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import type { EmbeddingConfig } from "../utils/config.js";

import { makeRecipe } from "../../test/domains/recipe/__fixtures__/recipes.js";
import { makePinoCapture, tripBreaker } from "../../test/support/tool-test-utils.js";
import { CircuitOpenError } from "../utils/errors.js";
import { toMessage } from "../utils/log.js";
import { EmbeddingAPIError, EmbeddingError } from "./embedding-errors.js";
import { EmbeddingClient } from "./embeddings.js";
import { recipeToEmbeddingText } from "./embeddings.js";

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
  describe("EmbeddingClient sends correct requests", () => {
    it("embedBatch sends POST with correct body and headers", async () => {
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
      (await client.embedBatch(["a", "b", "c"]))._unsafeUnwrap();

      expect(capturedMethod).toBe("POST");
      expect(capturedHeaders["authorization"]).toBe(`Bearer ${API_KEY}`);
      expect(capturedHeaders["contentType"]).toBe("application/json");
      expect(capturedBody).toEqual({
        model: MODEL,
        input: ["a", "b", "c"],
      });
    });

    it("embed returns single number array", async () => {
      server.use(
        http.post(`${BASE_URL}/embeddings`, () => {
          return HttpResponse.json(makeEmbeddingResponse([[0.1, 0.2, 0.3]]));
        }),
      );

      const client = new EmbeddingClient(makeEmbeddingConfig());
      const embedding = (await client.embed("hello"))._unsafeUnwrap();

      expect(Array.isArray(embedding)).toBe(true);
      expect(typeof embedding[0]).toBe("number");
      expect(embedding).toEqual([0.1, 0.2, 0.3]);
    });

    it("strips trailing slash from baseUrl", async () => {
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
      (await client.embedBatch(["test"]))._unsafeUnwrap();

      expect(capturedUrl).toBe("https://api.example.com/v1/embeddings");
      expect(capturedUrl).not.toContain("//embeddings");
    });

    it("validates response with Zod schema", async () => {
      server.use(
        http.post(`${BASE_URL}/embeddings`, () => {
          return HttpResponse.json(makeEmbeddingResponse([[0.1, 0.2, 0.3]]));
        }),
      );

      const client = new EmbeddingClient(makeEmbeddingConfig());
      const embeddings = (await client.embedBatch(["test"]))._unsafeUnwrap();

      expect(embeddings).toHaveLength(1);
      expect(embeddings[0]).toEqual([0.1, 0.2, 0.3]);
    });
  });

  describe("Resilience handles transient failures", () => {
    it("429 response retries and succeeds", async () => {
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
      const embedding = (await client.embed("test"))._unsafeUnwrap();

      expect(embedding).toEqual([0.1, 0.2]);
      expect(callCount).toBe(2);
    });

    it("500/502/503 responses retry and succeed", async () => {
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
        const embedding = (await client.embed("test"))._unsafeUnwrap();

        expect(embedding).toEqual([0.1, 0.2]);
        expect(callCount).toBe(2);

        server.resetHandlers();
      }
    });

    // Circuit breaker behavior is fully verified by the
    // structured-logging suite at the bottom of this file, which uses
    // fake timers to drive cockatiel's backoff and asserts the new
    // CircuitOpenError surface, the breaker-counts-calls semantics (5 calls ×
    // 4 attempts = 20 fetches), and the 6th-call short-circuit.
  });

  describe("Error handling for permanent failures", () => {
    it("400 throws EmbeddingAPIError without retry", async () => {
      let callCount = 0;

      server.use(
        http.post(`${BASE_URL}/embeddings`, () => {
          callCount++;
          return HttpResponse.json({}, { status: 400 });
        }),
      );

      const client = new EmbeddingClient(makeEmbeddingConfig());

      const error = (await client.embedBatch(["test"]))._unsafeUnwrapErr();
      expect(error).toBeInstanceOf(EmbeddingAPIError);
      const apiError = error as EmbeddingAPIError;
      expect(apiError.status).toBe(400);
      expect(apiError.endpoint).toBe(`${BASE_URL}/embeddings`);

      // Verify no retry (only called once)
      expect(callCount).toBe(1);
    });

    it("401 throws EmbeddingAPIError without retry", async () => {
      let callCount = 0;

      server.use(
        http.post(`${BASE_URL}/embeddings`, () => {
          callCount++;
          return HttpResponse.json({}, { status: 401 });
        }),
      );

      const client = new EmbeddingClient(makeEmbeddingConfig());

      const error = (await client.embedBatch(["test"]))._unsafeUnwrapErr();
      expect(error).toBeInstanceOf(EmbeddingAPIError);
      expect((error as EmbeddingAPIError).status).toBe(401);

      // Verify no retry
      expect(callCount).toBe(1);
    });

    it("malformed response errs with an EmbeddingError wrapping the ZodError", async () => {
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

      const error = (await client.embedBatch(["test"]))._unsafeUnwrapErr();
      expect(error).toBeInstanceOf(EmbeddingError);
      expect(error.cause).toBeInstanceOf(ZodError);
    });
  });

  describe("Dimensions getter", () => {
    it("dimensions returns correct vector length after embed", async () => {
      server.use(
        http.post(`${BASE_URL}/embeddings`, () => {
          return HttpResponse.json(makeEmbeddingResponse([[0.1, 0.2, 0.3, 0.4]]));
        }),
      );

      const client = new EmbeddingClient(makeEmbeddingConfig());
      (await client.embed("test"))._unsafeUnwrap();

      expect(client.dimensions).toBe(4);
    });

    it("dimensions is null before any embed call", () => {
      const client = new EmbeddingClient(makeEmbeddingConfig());

      expect(client.dimensions).toBeNull();
    });
  });
});

describe("recipeToEmbeddingText", () => {
  it("includes name, description, categories, ingredients, notes", () => {
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

  it("excludes directions", () => {
    const recipe = makeRecipe({
      name: "Test Recipe",
      directions: "Boil water, cook pasta",
      ingredients: "pasta",
    });
    const text = recipeToEmbeddingText(recipe, []);

    expect(text).not.toContain("directions");
    expect(text).not.toContain("Boil water");
  });

  it("omits null/empty fields", () => {
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

  it("empty category array produces no Categories line", () => {
    const recipe = makeRecipe({
      name: "Test",
      ingredients: "flour",
    });
    const text = recipeToEmbeddingText(recipe, []);

    expect(text).not.toContain("Categories:");
    expect(text).toContain("Ingredients: flour");
  });
});

describe("Per-attempt logging in EmbeddingClient.embedBatch", () => {
  it("retry path: emits debug start×2, warn retry×1, debug ok×1 on 500-then-success", async () => {
    let callCount = 0;
    server.use(
      http.post(`${BASE_URL}/embeddings`, () => {
        callCount++;
        if (callCount === 1) return HttpResponse.json({}, { status: 500 });
        return HttpResponse.json(makeEmbeddingResponse([[0.1, 0.2]]));
      }),
    );

    const { log, records } = makePinoCapture();
    const client = new EmbeddingClient(makeEmbeddingConfig(), log);
    (await client.embedBatch(["hello"]))._unsafeUnwrap();

    const startRecords = records.filter((r) => r["msg"] === "embedding request start");
    expect(startRecords).toHaveLength(2);

    const retryRecords = records.filter((r) => r["msg"] === "embedding request failed, retrying");
    expect(retryRecords).toHaveLength(1);
    expect(retryRecords[0]!["status"]).toBe(500);
    // attempt is 1-indexed network-touch: first retry = 2nd network touch → attempt 2
    expect(retryRecords[0]!["attempt"]).toBe(2);
    expect(typeof retryRecords[0]!["nextBackoffMs"]).toBe("number");

    // Cross-assert: the second start debug record also reports attempt 2 — inline
    // and onRetry-hook attempt fields must agree.
    expect(startRecords[1]!["attempt"]).toBe(2);

    const okRecords = records.filter((r) => r["msg"] === "embedding request ok");
    expect(okRecords).toHaveLength(1);
  });

  it("non-retryable path: emits error with status:400 attempt:1, no retry warn", async () => {
    server.use(
      http.post(`${BASE_URL}/embeddings`, () => {
        return HttpResponse.json({}, { status: 400 });
      }),
    );

    const { log, records } = makePinoCapture();
    const client = new EmbeddingClient(makeEmbeddingConfig(), log);
    try {
      (await client.embedBatch(["hello"]))._unsafeUnwrap();
    } catch {
      // expected — non-retryable error
    }

    const errorRecords = records.filter((r) => r["msg"] === "embedding request failed (non-retryable)");
    expect(errorRecords).toHaveLength(1);
    expect(errorRecords[0]!["status"]).toBe(400);
    expect(errorRecords[0]!["attempt"]).toBe(1);

    const retryRecords = records.filter((r) => r["msg"] === "embedding request failed, retrying");
    expect(retryRecords).toHaveLength(0);
  });
});

describe("CircuitOpenError surface and breaker-counts-calls semantics", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("5 failing embed calls trip the breaker and produce exactly 20 fetches (5 × 4)", async () => {
    let fetchCount = 0;
    server.use(
      http.post(`${BASE_URL}/embeddings`, () => {
        fetchCount++;
        return HttpResponse.json({}, { status: 503 });
      }),
    );

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const client = new EmbeddingClient(makeEmbeddingConfig());

    await tripBreaker(() => client.embedBatch(["test"]));

    // With breaker outside retry, each tool call counts as ONE breaker
    // failure regardless of internal retries. 5 calls × 4 attempts each = 20.
    expect(fetchCount).toBe(20);
  }, 60000);

  it("6th call with open breaker throws CircuitOpenError without additional fetches", async () => {
    let fetchCount = 0;
    server.use(
      http.post(`${BASE_URL}/embeddings`, () => {
        fetchCount++;
        return HttpResponse.json({}, { status: 503 });
      }),
    );

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const client = new EmbeddingClient(makeEmbeddingConfig());

    await tripBreaker(() => client.embedBatch(["test"]));
    const fetchCountAfterTrip = fetchCount;

    const caught: unknown = (await client.embedBatch(["test"]))._unsafeUnwrapErr();

    expect(caught).toBeInstanceOf(CircuitOpenError);
    expect(fetchCount).toBe(fetchCountAfterTrip);

    if (caught instanceof CircuitOpenError) {
      expect(caught.service).toBe("embeddings");
      expect(caught.endpoint).toBe(`${BASE_URL}/embeddings`);
      expect(caught.cause).toBeInstanceOf(BrokenCircuitError);
    }
  }, 60000);

  it("CircuitOpenError surface has no fabricated HTTP 503", async () => {
    server.use(
      http.post(`${BASE_URL}/embeddings`, () => {
        return HttpResponse.json({}, { status: 503 });
      }),
    );

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const client = new EmbeddingClient(makeEmbeddingConfig());

    await tripBreaker(() => client.embedBatch(["test"]));

    const caught: unknown = (await client.embedBatch(["test"]))._unsafeUnwrapErr();

    const msg = toMessage(caught);
    expect(msg).toContain(`${BASE_URL}/embeddings`);
    expect(msg).not.toContain("HTTP 503");
    expect(msg).not.toContain("503");
    expect(msg).toBe(`embeddings circuit breaker is open (endpoint=${BASE_URL}/embeddings)`);

    // No EmbeddingAPIError surface — the breaker-open error is distinct.
    expect(caught).not.toBeInstanceOf(EmbeddingAPIError);
    if (caught instanceof CircuitOpenError) {
      expect("status" in caught).toBe(false);
    }
  }, 60000);
});
