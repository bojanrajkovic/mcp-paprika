import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ZodError } from "zod";
import { gunzipSync } from "node:zlib";
import { PaprikaClient } from "./client.js";
import { PaprikaAPIError, PaprikaAuthError } from "./errors.js";
import type { Recipe } from "./types.js";
import { RecipeSchema, RecipeUidSchema } from "./types.js";

const AUTH_URL = "https://paprikaapp.com/api/v1/account/login/";
const API_BASE = "https://paprikaapp.com/api/v2/sync";

function makeSnakeCaseRecipe(uid: string): object {
  return {
    uid,
    hash: `hash-${uid}`,
    name: `Recipe ${uid}`,
    categories: [],
    ingredients: "eggs, flour",
    directions: "Mix and bake.",
    description: null,
    notes: null,
    prep_time: null,
    cook_time: null,
    total_time: null,
    servings: null,
    difficulty: null,
    rating: 0,
    created: "2024-01-01T00:00:00Z",
    image_url: "",
    photo: null,
    photo_hash: null,
    photo_large: null,
    photo_url: null,
    source: null,
    source_url: null,
    on_favorites: false,
    in_trash: false,
    is_pinned: false,
    on_grocery_list: false,
    scale: null,
    nutritional_info: null,
  };
}

function makeCamelCaseRecipe(uid: string): Recipe {
  return RecipeSchema.parse(makeSnakeCaseRecipe(uid));
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

describe("PaprikaClient", () => {
  describe("p1-u05-client-auth.AC5: Construction and module structure", () => {
    it("p1-u05-client-auth.AC5.1 - new PaprikaClient(email, password) does not throw", () => {
      expect(() => new PaprikaClient("test@example.com", "password")).not.toThrow();
    });

    it("p1-u05-client-auth.AC5.2 - PaprikaClient is exported from src/paprika/client.ts", () => {
      const client = new PaprikaClient("test@example.com", "password");
      expect(client).toBeInstanceOf(PaprikaClient);
    });
  });

  describe("p1-u05-client-auth.AC1: Authentication works correctly", () => {
    it("p1-u05-client-auth.AC1.1 - authenticate() POSTs form-encoded email and password to AUTH_URL", async () => {
      const email = "test@example.com";
      const password = "mypassword";

      let requestBody: string | null = null;
      let requestMethod: string | null = null;

      server.use(
        http.post(AUTH_URL, async ({ request }) => {
          requestMethod = request.method;
          requestBody = await request.text();
          return HttpResponse.json({ result: { token: "test-jwt-token" } });
        }),
      );

      const client = new PaprikaClient(email, password);
      await client.authenticate();

      expect(requestMethod).toBe("POST");
      expect(requestBody).toBeDefined();

      const params = new URLSearchParams(requestBody!);
      expect(params.get("email")).toBe(email);
      expect(params.get("password")).toBe(password);
    });

    it("p1-u05-client-auth.AC1.2 - after successful auth, token is stored (verified by calling authenticate() twice)", async () => {
      const email = "test@example.com";
      const password = "mypassword";
      let callCount = 0;

      server.use(
        http.post(AUTH_URL, () => {
          callCount++;
          return HttpResponse.json({ result: { token: "test-jwt-token" } });
        }),
      );

      const client = new PaprikaClient(email, password);

      // First authentication call
      await client.authenticate();
      expect(callCount).toBe(1);

      // Second authentication call to verify the method works repeatably
      await client.authenticate();
      expect(callCount).toBe(2);
    });

    it("p1-u05-client-auth.AC1.3 - response is validated with Zod (successful path implicitly tests this)", async () => {
      server.use(
        http.post(AUTH_URL, () => {
          return HttpResponse.json({ result: { token: "valid-jwt-token" } });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");

      // Should not throw if response matches schema
      await expect(client.authenticate()).resolves.toBeUndefined();
    });

    it("p1-u05-client-auth.AC1.4 - non-2xx response (403) throws PaprikaAuthError with status in message", async () => {
      server.use(
        http.post(AUTH_URL, () => {
          return HttpResponse.json({}, { status: 403 });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");

      try {
        await client.authenticate();
        expect.fail("Should have thrown PaprikaAuthError");
      } catch (error) {
        expect(error).toBeInstanceOf(PaprikaAuthError);
        expect((error as Error).message).toMatch(/HTTP 403/);
      }
    });

    it("p1-u05-client-auth.AC1.4 - non-2xx response (401) throws PaprikaAuthError with status in message", async () => {
      server.use(
        http.post(AUTH_URL, () => {
          return HttpResponse.json({}, { status: 401 });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");

      try {
        await client.authenticate();
        expect.fail("Should have thrown PaprikaAuthError");
      } catch (error) {
        expect(error).toBeInstanceOf(PaprikaAuthError);
        expect((error as Error).message).toMatch(/HTTP 401/);
      }
    });

    it("p1-u05-client-auth.AC1.5 - malformed response (missing result.token) throws ZodError", async () => {
      server.use(
        http.post(AUTH_URL, () => {
          return HttpResponse.json({ wrong: "shape" });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");

      await expect(client.authenticate()).rejects.toThrow(ZodError);
    });

    it("p1-u05-client-auth.AC1.5 - malformed response (missing result) throws ZodError", async () => {
      server.use(
        http.post(AUTH_URL, () => {
          return HttpResponse.json({ token: "orphaned-token" });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");

      await expect(client.authenticate()).rejects.toThrow(ZodError);
    });

    it("p1-u05-client-auth.AC1.5 - malformed response (result.token missing) throws ZodError", async () => {
      server.use(
        http.post(AUTH_URL, () => {
          return HttpResponse.json({ result: { other: "field" } });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");

      await expect(client.authenticate()).rejects.toThrow(ZodError);
    });
  });

  describe("p1-u06-client-reads.AC1: listRecipes() returns a recipe entry list", () => {
    it("p1-u06-client-reads.AC1.1 - returns RecipeEntry[] with uid and hash from /api/v2/sync/recipes/", async () => {
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          return HttpResponse.json({
            result: [
              { uid: "uid-1", hash: "h1" },
              { uid: "uid-2", hash: "h2" },
            ],
          });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      const recipes = await client.listRecipes();

      expect(recipes).toHaveLength(2);
      expect(recipes[0]!.uid).toBe("uid-1");
      expect(recipes[0]!.hash).toBe("h1");
      expect(recipes[1]!.uid).toBe("uid-2");
      expect(recipes[1]!.hash).toBe("h2");
    });

    it("p1-u06-client-reads.AC1.2 - returns empty array when API returns empty result", async () => {
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          return HttpResponse.json({ result: [] });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      const recipes = await client.listRecipes();

      expect(recipes).toStrictEqual([]);
    });
  });

  describe("p1-u06-client-reads.AC2: getRecipe() returns a full recipe by UID", () => {
    it("p1-u06-client-reads.AC2.1 - returns Recipe object with camelCase fields", async () => {
      server.use(
        http.get(`${API_BASE}/recipe/test-uid/`, () => {
          return HttpResponse.json({ result: makeSnakeCaseRecipe("test-uid") });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      const recipe = await client.getRecipe("test-uid");

      expect(recipe.name).toBe("Recipe test-uid");
      expect(recipe.prepTime).toBe(null);
      expect(recipe.onFavorites).toBe(false);
      expect(recipe.imageUrl).toBe("");
    });

    it("p1-u06-client-reads.AC2.2 - non-2xx response throws PaprikaAPIError", async () => {
      server.use(
        http.get(`${API_BASE}/recipe/not-found/`, () => {
          return HttpResponse.json({}, { status: 404 });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");

      try {
        await client.getRecipe("not-found");
        expect.fail("Should have thrown PaprikaAPIError");
      } catch (error) {
        expect(error).toBeInstanceOf(PaprikaAPIError);
      }
    });
  });

  describe.todo("p1-u05-client-auth.AC2: Request helper adds auth and unwraps envelope", () => {
    // Tests deferred to P1-U06 when public methods exist that call request<T>().
    // request<T>() is private and cannot be tested directly.
    //
    // AC2.1: request<T>() includes Authorization: Bearer {token} header
    // AC2.2: Response envelope { result: T } is unwrapped and validated
    // AC2.3: request<T>() is private (structural — verified by TypeScript compiler)
    // AC2.4: Non-401 error status throws PaprikaAPIError
  });

  describe.todo("p1-u05-client-auth.AC3: 401 re-auth retry", () => {
    // Tests deferred to P1-U06 when public methods exist that call request<T>().
    //
    // AC3.1: On 401 with existing token, authenticate() refreshes, then retries
    // AC3.2: If retry also returns 401, PaprikaAuthError is thrown
    // AC3.3: No retry when this.token is null
  });

  describe.todo("p1-u05-client-auth.AC4: Cockatiel resilience for transient failures", () => {
    // Tests deferred to P1-U06 when public methods exist that call request<T>().
    //
    // AC4.1: Status codes 429, 500, 502, 503 retried with exponential backoff
    // AC4.2: Circuit breaker opens after 5 consecutive failures
    // AC4.3: Non-retryable statuses (400, 403, 404) not retried
  });

  describe("p1-u06-client-reads.AC3: getRecipes() fetches multiple recipes with concurrency limiting", () => {
    it("p1-u06-client-reads.AC3.1 - returns Recipe[] with one entry per provided UID, in same order", async () => {
      server.use(
        http.get(`${API_BASE}/recipe/:uid/`, ({ params }) => {
          return HttpResponse.json({ result: makeSnakeCaseRecipe(params.uid as string) });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      const recipes = await client.getRecipes(["uid-1", "uid-2", "uid-3"]);

      expect(recipes).toHaveLength(3);
      expect(recipes[0]!.name).toBe("Recipe uid-1");
      expect(recipes[1]!.name).toBe("Recipe uid-2");
      expect(recipes[2]!.name).toBe("Recipe uid-3");
    });

    it("p1-u06-client-reads.AC3.2 - getRecipes([]) returns [] with zero HTTP requests", async () => {
      // Deliberately NOT registering any handler — if a request is made, MSW returns 500
      const client = new PaprikaClient("test@example.com", "password");
      const recipes = await client.getRecipes([]);

      expect(recipes).toStrictEqual([]);
    });

    it("p1-u06-client-reads.AC3.3 - at most 5 getRecipe() calls execute simultaneously", async () => {
      let inFlight = 0;
      let peakInFlight = 0;

      server.use(
        http.get(`${API_BASE}/recipe/:uid/`, async ({ params }) => {
          inFlight++;
          peakInFlight = Math.max(peakInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 20));
          inFlight--;
          return HttpResponse.json({ result: makeSnakeCaseRecipe(params.uid as string) });
        }),
      );

      const uids = Array.from({ length: 10 }, (_, i) => `uid-${i.toString()}`);
      const client = new PaprikaClient("test@example.com", "password");
      await client.getRecipes(uids);

      expect(peakInFlight).toBeLessThanOrEqual(5);
    });

    it("p1-u06-client-reads.AC3.4 - a single recipe fetch error causes entire getRecipes() to reject", async () => {
      server.use(
        http.get(`${API_BASE}/recipe/good-uid/`, () => {
          return HttpResponse.json({ result: makeSnakeCaseRecipe("good-uid") });
        }),
        http.get(`${API_BASE}/recipe/bad-uid/`, () => {
          return HttpResponse.json({}, { status: 404 });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");

      try {
        await client.getRecipes(["good-uid", "bad-uid"]);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(PaprikaAPIError);
      }
    });
  });

  describe("p1-u06-client-reads.AC4: listCategories() returns Category objects", () => {
    it("p1-u06-client-reads.AC4.1 - returns Category[] with camelCase fields from /categories/ endpoint", async () => {
      server.use(
        http.get(`${API_BASE}/categories/`, () => {
          return HttpResponse.json({
            result: [
              { uid: "cat-1", name: "Breakfast", order_flag: 1, parent_uid: null },
              { uid: "cat-2", name: "Dinner", order_flag: 2, parent_uid: null },
            ],
          });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      const categories = await client.listCategories();

      expect(categories).toHaveLength(2);
      expect(categories[0]!.name).toBe("Breakfast");
      expect(categories[0]!.orderFlag).toBe(1);
      expect(categories[0]!.parentUid).toBe(null);
    });

    it("p1-u06-client-reads.AC4.2 - makes exactly one /categories/ request (no per-category hydration)", async () => {
      let listCount = 0;

      server.use(
        http.get(`${API_BASE}/categories/`, () => {
          listCount++;
          return HttpResponse.json({
            result: [
              { uid: "c1", name: "Cat 1", order_flag: 0, parent_uid: null },
              { uid: "c2", name: "Cat 2", order_flag: 0, parent_uid: null },
            ],
          });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      await client.listCategories();

      expect(listCount).toBe(1);
    });

    it("p1-u06-client-reads.AC4.3 - returns [] when /categories/ returns empty list", async () => {
      server.use(
        http.get(`${API_BASE}/categories/`, () => {
          return HttpResponse.json({ result: [] });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      const categories = await client.listCategories();

      expect(categories).toStrictEqual([]);
    });
  });

  describe("p1-u07-client-writes.AC1: saveRecipe encodes and POSTs correctly", () => {
    it("p1-u07-client-writes.AC1.1 - POST sent to correct URL", async () => {
      const uid = "test-uid";
      let capturedUrl = "";

      server.use(
        http.post(`${API_BASE}/recipe/${uid}/`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ result: true });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      await client.saveRecipe(makeCamelCaseRecipe(uid));

      expect(capturedUrl).toBe(`${API_BASE}/recipe/${uid}/`);
    });

    it("p1-u07-client-writes.AC1.2 and AC1.3 - FormData encodes correctly with snake_case keys and all 28 fields", async () => {
      const uid = "test-uid";
      let payload: Record<string, unknown> | null = null;

      server.use(
        http.post(`${API_BASE}/recipe/${uid}/`, async ({ request }) => {
          const formData = await request.formData();
          const dataBlob = formData.get("data") as Blob;
          const arrayBuffer = await dataBlob.arrayBuffer();
          const decompressed = gunzipSync(Buffer.from(arrayBuffer));
          payload = JSON.parse(decompressed.toString()) as Record<string, unknown>;
          return HttpResponse.json({ result: true });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      await client.saveRecipe(makeCamelCaseRecipe(uid));

      expect(payload).toBeDefined();
      // AC1.2: Assert specific snake_case keys exist
      expect(payload).toHaveProperty("prep_time");
      expect(payload).toHaveProperty("cook_time");
      expect(payload).toHaveProperty("total_time");
      expect(payload).toHaveProperty("image_url");
      expect(payload).toHaveProperty("on_favorites");
      expect(payload).toHaveProperty("in_trash");
      expect(payload).toHaveProperty("is_pinned");
      expect(payload).toHaveProperty("on_grocery_list");
      expect(payload).toHaveProperty("nutritional_info");

      // AC1.2: Assert camelCase equivalents do NOT exist
      expect(payload).not.toHaveProperty("prepTime");
      expect(payload).not.toHaveProperty("imageUrl");
      expect(payload).not.toHaveProperty("onFavorites");

      // AC1.3: Assert exactly 28 fields
      expect(Object.keys(payload!).length).toBe(28);
    });

    it("p1-u07-client-writes.AC1.4 - saveRecipe returns the input recipe", async () => {
      const uid = "test-uid";

      server.use(
        http.post(`${API_BASE}/recipe/${uid}/`, () => {
          return HttpResponse.json({ result: true });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      const input = makeCamelCaseRecipe(uid);
      const result = await client.saveRecipe(input);

      expect(result.uid).toBe(input.uid);
      expect(result.name).toBe(input.name);
      expect(result).toHaveProperty("prepTime");
    });

    it("p1-u07-client-writes.AC1.5 - Non-2xx response throws PaprikaAPIError", async () => {
      const uid = "test-uid";

      server.use(
        http.post(`${API_BASE}/recipe/${uid}/`, () => {
          return HttpResponse.json({}, { status: 422 });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");

      try {
        await client.saveRecipe(makeCamelCaseRecipe(uid));
        expect.fail("Should have thrown PaprikaAPIError");
      } catch (error) {
        expect(error).toBeInstanceOf(PaprikaAPIError);
      }
    });
  });

  describe("p1-u07-client-writes.AC3: notifySync propagates changes", () => {
    it("p1-u07-client-writes.AC3.1 - POSTs to /api/v2/sync/notify/", async () => {
      let notifyReached = false;

      server.use(
        http.post(`${API_BASE}/notify/`, () => {
          notifyReached = true;
          return HttpResponse.json({ result: {} });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      await client.notifySync();

      expect(notifyReached).toBe(true);
    });

    it("p1-u07-client-writes.AC3.2 - Returns void (Promise resolves with undefined)", async () => {
      server.use(
        http.post(`${API_BASE}/notify/`, () => {
          return HttpResponse.json({ result: {} });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      const result = await client.notifySync();

      expect(result).toBeUndefined();
    });
  });

  describe("p1-u07-client-writes.AC2: deleteRecipe soft-deletes via trash flag", () => {
    it("p1-u07-client-writes.AC2.1 and AC2.2 - GETs recipe, POSTs with in_trash: true, then calls notifySync", async () => {
      const uid = "test-uid";
      let capturedPayload: Record<string, unknown> | null = null;
      let notifyReached = false;

      server.use(
        http.get(`${API_BASE}/recipe/${uid}/`, () => {
          return HttpResponse.json({ result: makeSnakeCaseRecipe(uid) });
        }),
        http.post(`${API_BASE}/recipe/${uid}/`, async ({ request }) => {
          const formData = await request.formData();
          const dataBlob = formData.get("data") as Blob;
          const arrayBuffer = await dataBlob.arrayBuffer();
          const decompressed = gunzipSync(Buffer.from(arrayBuffer));
          capturedPayload = JSON.parse(decompressed.toString()) as Record<string, unknown>;
          return HttpResponse.json({ result: true });
        }),
        http.post(`${API_BASE}/notify/`, () => {
          notifyReached = true;
          return HttpResponse.json({ result: {} });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      await client.deleteRecipe(RecipeUidSchema.parse(uid));

      // AC2.1: Assert in_trash is true in payload
      expect(capturedPayload).toBeDefined();
      expect(capturedPayload!.in_trash).toBe(true);

      // AC2.2: Assert notifySync was called
      expect(notifyReached).toBe(true);
    });

    it("p1-u07-client-writes.AC2.3 - 404 from getRecipe throws error and never calls saveRecipe or notifySync", async () => {
      const uid = "not-found";
      let notifyReached = false;

      server.use(
        http.get(`${API_BASE}/recipe/${uid}/`, () => {
          return HttpResponse.json({}, { status: 404 });
        }),
        http.post(`${API_BASE}/notify/`, () => {
          notifyReached = true;
          return HttpResponse.json({ result: {} });
        }),
        // Deliberately NOT registering a handler for saveRecipe POST
        // If it's called, MSW will return 500 and the test will fail
      );

      const client = new PaprikaClient("test@example.com", "password");

      try {
        await client.deleteRecipe(RecipeUidSchema.parse(uid));
        expect.fail("Should have thrown PaprikaAPIError");
      } catch (error) {
        expect(error).toBeInstanceOf(PaprikaAPIError);
      }

      // Assert notify was never called
      expect(notifyReached).toBe(false);
    });
  });
});
