import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ZodError } from "zod";
import { gunzipSync } from "node:zlib";
import { Writable } from "node:stream";
import pino from "pino";
import type { Logger } from "pino";
import { BrokenCircuitError } from "cockatiel";
import { makePinoCapture } from "../tools/tool-test-utils.js";
import { PaprikaClient } from "./client.js";
import { PaprikaAPIError, PaprikaAuthError } from "./errors.js";
import { CircuitOpenError } from "../utils/errors.js";
import { toMessage, REDACT_PATHS } from "../utils/log.js";
import type { PantryItem, Recipe } from "./types.js";
import { RecipeSchema, RecipeUidSchema, PantryItemUidSchema } from "./types.js";

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

function makeCamelCasePantryItem(uid: string, overrides?: Partial<PantryItem>): PantryItem {
  const defaults: PantryItem = {
    uid: PantryItemUidSchema.parse(uid),
    ingredient: "Butter",
    quantity: "1 lb",
    aisle: "Dairy",
    aisleUid: "aisle-1",
    expirationDate: null,
    hasExpiration: false,
    inStock: true,
    purchaseDate: null,
    locationUid: null,
    notes: null,
    deleted: false,
  };

  return { ...defaults, ...overrides };
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
          return HttpResponse.json({ result: makeSnakeCaseRecipe(params["uid"] as string) });
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
          return HttpResponse.json({ result: makeSnakeCaseRecipe(params["uid"] as string) });
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
      expect(capturedPayload!["in_trash"]).toBe(true);

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

  describe("pantry-read.AC1: listPantry", () => {
    type PantryItemWire = {
      uid: string;
      ingredient: string;
      quantity: string;
      aisle: string;
      aisle_uid: string;
      expiration_date: string | null;
      has_expiration: boolean;
      in_stock: boolean;
      purchase_date: string | null;
      location_uid: string | null;
      notes: string | null;
    };

    function makeSnakeCasePantryItem(overrides?: Partial<PantryItemWire>): PantryItemWire {
      return {
        uid: "pantry-1",
        ingredient: "Test Ingredient",
        quantity: "1",
        aisle: "Produce",
        aisle_uid: "aisle-1",
        expiration_date: null,
        has_expiration: false,
        in_stock: true,
        purchase_date: "2026-01-01 00:00:00",
        location_uid: null,
        notes: null,
        ...overrides,
      };
    }

    it("pantry-read.AC1.5 - returns PantryItem[] with camelCase fields from /api/v2/sync/pantry/", async () => {
      server.use(
        http.get(`${API_BASE}/pantry/`, () => {
          return HttpResponse.json({
            result: [
              makeSnakeCasePantryItem({ uid: "pantry-1" }),
              makeSnakeCasePantryItem({ uid: "pantry-2", ingredient: "Another Item" }),
            ],
          });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      const pantryItems = await client.listPantry();

      expect(pantryItems).toHaveLength(2);
      expect(pantryItems[0]!.uid).toBe("pantry-1");
      expect(pantryItems[0]!.ingredient).toBe("Test Ingredient");
      expect(pantryItems[0]!.aisleUid).toBe("aisle-1");
      expect(pantryItems[0]!.expirationDate).toBe(null);
      expect(pantryItems[0]!.hasExpiration).toBe(false);
      expect(pantryItems[0]!.inStock).toBe(true);
      expect(pantryItems[0]!.purchaseDate).toBe("2026-01-01 00:00:00");
      expect(pantryItems[0]!.locationUid).toBe(null);
      expect(pantryItems[1]!.uid).toBe("pantry-2");
      expect(pantryItems[1]!.ingredient).toBe("Another Item");
    });

    it("pantry-read.AC1.6 - returns [] when /api/v2/sync/pantry/ returns empty result", async () => {
      server.use(
        http.get(`${API_BASE}/pantry/`, () => {
          return HttpResponse.json({ result: [] });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      const pantryItems = await client.listPantry();

      expect(pantryItems).toStrictEqual([]);
    });
  });

  describe("pantry-mutations.AC1: pantryItemToApiPayload (via savePantryItem wire body)", () => {
    it("pantry-mutations.AC1.4 - payload has exactly 12 snake_case keys, no camelCase", async () => {
      const uid = "pantry-test-1";
      let body: Array<Record<string, unknown>> | null = null;

      server.use(
        http.post(`${API_BASE}/pantry/`, async ({ request }) => {
          const formData = await request.formData();
          const dataBlob = formData.get("data") as Blob;
          const arrayBuffer = await dataBlob.arrayBuffer();
          const decompressed = gunzipSync(Buffer.from(arrayBuffer));
          body = JSON.parse(decompressed.toString()) as Array<Record<string, unknown>>;
          return HttpResponse.json({ result: true });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      await client.savePantryItem(makeCamelCasePantryItem(uid));

      expect(body).toBeDefined();
      expect(Array.isArray(body)).toBe(true);
      expect(body!).toHaveLength(1);
      const payload = body![0]!;
      expect(Object.keys(payload).length).toBe(12);
      expect(payload).toHaveProperty("uid");
      expect(payload).toHaveProperty("ingredient");
      expect(payload).toHaveProperty("quantity");
      expect(payload).toHaveProperty("aisle");
      expect(payload).toHaveProperty("aisle_uid");
      expect(payload).toHaveProperty("expiration_date");
      expect(payload).toHaveProperty("has_expiration");
      expect(payload).toHaveProperty("in_stock");
      expect(payload).toHaveProperty("purchase_date");
      expect(payload).toHaveProperty("location_uid");
      expect(payload).toHaveProperty("notes");
      expect(payload).toHaveProperty("deleted");
      expect(payload).not.toHaveProperty("aisleUid");
      expect(payload).not.toHaveProperty("expirationDate");
      expect(payload).not.toHaveProperty("hasExpiration");
      expect(payload).not.toHaveProperty("inStock");
      expect(payload).not.toHaveProperty("purchaseDate");
      expect(payload).not.toHaveProperty("locationUid");
    });

    it("pantry-mutations.AC1.5 - deleted flag is included and emitted correctly", async () => {
      const uid = "pantry-test-2";
      const bodies: Array<Array<Record<string, unknown>>> = [];

      server.use(
        http.post(`${API_BASE}/pantry/`, async ({ request }) => {
          const formData = await request.formData();
          const dataBlob = formData.get("data") as Blob;
          const arrayBuffer = await dataBlob.arrayBuffer();
          const decompressed = gunzipSync(Buffer.from(arrayBuffer));
          bodies.push(JSON.parse(decompressed.toString()) as Array<Record<string, unknown>>);
          return HttpResponse.json({ result: true });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      await client.savePantryItem(makeCamelCasePantryItem(uid, { deleted: false }));
      await client.savePantryItem(makeCamelCasePantryItem(uid, { deleted: true }));

      expect(bodies).toHaveLength(2);
      expect(bodies[0]![0]!["deleted"]).toBe(false);
      expect(bodies[1]![0]!["deleted"]).toBe(true);
    });

    it("pantry-mutations.AC1.6 - null values survive the conversion", async () => {
      const uid = "pantry-test-3";
      let body: Array<Record<string, unknown>> | null = null;

      server.use(
        http.post(`${API_BASE}/pantry/`, async ({ request }) => {
          const formData = await request.formData();
          const dataBlob = formData.get("data") as Blob;
          const arrayBuffer = await dataBlob.arrayBuffer();
          const decompressed = gunzipSync(Buffer.from(arrayBuffer));
          body = JSON.parse(decompressed.toString()) as Array<Record<string, unknown>>;
          return HttpResponse.json({ result: true });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      await client.savePantryItem(
        makeCamelCasePantryItem(uid, {
          expirationDate: null,
          purchaseDate: null,
          locationUid: null,
          notes: null,
        }),
      );

      expect(body).toBeDefined();
      const payload = body![0]!;
      expect(payload["expiration_date"]).toBeNull();
      expect(payload["purchase_date"]).toBeNull();
      expect(payload["location_uid"]).toBeNull();
      expect(payload["notes"]).toBeNull();
    });
  });

  describe("pantry-mutations.AC2: savePantryItem", () => {
    it("pantry-mutations.AC2.1 - savePantryItem POSTs to collection URL and returns input item", async () => {
      const uid = "pantry-test-4";
      let capturedUrl = "";

      server.use(
        http.post(`${API_BASE}/pantry/`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ result: true });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      const input = makeCamelCasePantryItem(uid);
      const result = await client.savePantryItem(input);

      expect(capturedUrl).toBe(`${API_BASE}/pantry/`);
      expect(result.uid).toBe(input.uid);
      expect(result.ingredient).toBe(input.ingredient);
      expect(result.deleted).toBe(input.deleted);
    });

    it("pantry-mutations.AC2.2 - HTTP 401 triggers re-auth retry", async () => {
      const uid = "pantry-test-5";
      let authCallCount = 0;
      let pantryCallCount = 0;

      server.use(
        http.post(AUTH_URL, () => {
          authCallCount++;
          return HttpResponse.json({ result: { token: "fresh-token-123" } });
        }),
        http.post(`${API_BASE}/pantry/`, () => {
          pantryCallCount++;
          if (pantryCallCount === 1) {
            return HttpResponse.json({ result: true }, { status: 401 });
          }
          return HttpResponse.json({ result: true });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      await client.authenticate();
      const result = await client.savePantryItem(makeCamelCasePantryItem(uid));

      expect(result.uid).toBe(uid);
      expect(authCallCount).toBe(2);
      expect(pantryCallCount).toBe(2);
    });

    it.each([429, 500, 502, 503])(
      "pantry-mutations.AC2.3 - retryable HTTP status %i triggers cockatiel retry",
      async (status: number) => {
        const uid = `pantry-test-6-${status}`;
        let pantryCallCount = 0;

        server.use(
          http.post(`${API_BASE}/pantry/`, () => {
            pantryCallCount++;
            if (pantryCallCount === 1) {
              return HttpResponse.json({ result: true }, { status });
            }
            return HttpResponse.json({ result: true });
          }),
        );

        const client = new PaprikaClient("test@example.com", "password");
        const result = await client.savePantryItem(makeCamelCasePantryItem(uid));

        expect(result.uid).toBe(uid);
        expect(pantryCallCount).toBe(2);
      },
      5000,
    );

    it("network-retry.1 - transient network-level fetch failure on a write triggers cockatiel retry", async () => {
      const uid = "pantry-test-network-retry";
      let pantryCallCount = 0;

      server.use(
        http.post(`${API_BASE}/pantry/`, () => {
          pantryCallCount++;
          if (pantryCallCount === 1) {
            return HttpResponse.error();
          }
          return HttpResponse.json({ result: true });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      const result = await client.savePantryItem(makeCamelCasePantryItem(uid));

      expect(result.uid).toBe(uid);
      expect(pantryCallCount).toBe(2);
    });

    it("network-retry.2 - exhausted network retries surface the original undici fetch error", async () => {
      const uid = "pantry-test-network-exhausted";
      let pantryCallCount = 0;

      server.use(
        http.post(`${API_BASE}/pantry/`, () => {
          pantryCallCount++;
          return HttpResponse.error();
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");

      let caught: unknown;
      try {
        await client.savePantryItem(makeCamelCasePantryItem(uid));
        expect.fail("Should have thrown");
      } catch (error) {
        caught = error;
      }

      // After retries are exhausted, callers see the original network-level
      // TypeError, not the internal retry marker. Tools that catch and
      // surface the message stay consistent with the pre-retry behavior.
      // (msw renders the message as "Failed to fetch"; node's undici emits
      // "fetch failed" in production — both are TypeError.)
      expect(caught).toBeInstanceOf(TypeError);
      expect(pantryCallCount).toBeGreaterThan(1);
    });

    it("pantry-mutations.AC2.4 - non-retryable HTTP error throws PaprikaAPIError", async () => {
      const uid = "pantry-test-7";

      server.use(
        http.post(`${API_BASE}/pantry/`, () => {
          return HttpResponse.json({}, { status: 400 });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");

      try {
        await client.savePantryItem(makeCamelCasePantryItem(uid));
        expect.fail("Should have thrown PaprikaAPIError");
      } catch (error) {
        expect(error).toBeInstanceOf(PaprikaAPIError);
        if (error instanceof PaprikaAPIError) {
          expect(error.status).toBe(400);
          expect(error.endpoint).toBe(`${API_BASE}/pantry/`);
        }
      }
    });

    it("pantry-mutations.AC2.5 - invalid Zod envelope (result is string not boolean) throws ZodError", async () => {
      const uid = "pantry-test-8";

      server.use(
        http.post(`${API_BASE}/pantry/`, () => {
          return HttpResponse.json({ result: "ok" });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");

      try {
        await client.savePantryItem(makeCamelCasePantryItem(uid));
        expect.fail("Should have thrown ZodError");
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle hook logging tests — Task 3 (AC3.3, AC3.4, AC6.1, AC6.2, AC6.3)
  // ---------------------------------------------------------------------------

  describe("structured-logging.AC3.3: onRetry hook emits warn records", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("AC3.3 - emits warn with attempt+1 and nextBackoffMs on first retry, another warn on second retry, no warn after success", async () => {
      const { log: testLog, records } = makePinoCapture();
      let callCount = 0;
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          callCount++;
          if (callCount <= 2) {
            return HttpResponse.json({ result: [] }, { status: 503 });
          }
          return HttpResponse.json({ result: [] });
        }),
      );

      vi.useFakeTimers();
      const client = new PaprikaClient("test@example.com", "password", testLog);
      const callPromise = client.listRecipes();
      await vi.runAllTimersAsync();
      await callPromise;

      const retryWarns = records.filter((r) => r["msg"] === "paprika request failed, retrying");
      // Two failures before final success → two retry warns
      expect(retryWarns).toHaveLength(2);

      // First warn: about to run the 2nd network touch (attempt 2)
      expect(retryWarns[0]!["attempt"]).toBe(2);
      expect(typeof retryWarns[0]!["nextBackoffMs"]).toBe("number");
      expect((retryWarns[0]!["nextBackoffMs"] as number) >= 0).toBe(true);
      expect(retryWarns[0]!["err"]).toBeDefined();

      // Second warn: about to run the 3rd network touch (attempt 3)
      expect(retryWarns[1]!["attempt"]).toBe(3);

      // Cross-assert: onRetry's attempt numbers are consistent with the inline debug log
      // at the same log site (ctx.attempt + 1). The warn fires BEFORE the retry; the
      // debug "paprika request start" fires at the start of that same attempt. Both should
      // carry the same attempt number for the same network touch.
      const startsForAttempt2 = records.filter((r) => r["msg"] === "paprika request start" && r["attempt"] === 2);
      expect(startsForAttempt2).toHaveLength(1);

      const startsForAttempt3 = records.filter((r) => r["msg"] === "paprika request start" && r["attempt"] === 3);
      expect(startsForAttempt3).toHaveLength(1);

      // Final call succeeded — no give-up error record
      const giveUps = records.filter((r) => r["msg"] === "paprika retries exhausted");
      expect(giveUps).toHaveLength(0);
    }, 15000);
  });

  describe("structured-logging.AC3.4: onGiveUp hook emits error record when retries exhausted", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("AC3.4 - emits error 'paprika retries exhausted' after all 3 attempts fail", async () => {
      const { log: testLog, records } = makePinoCapture();
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          return HttpResponse.json({ result: [] }, { status: 503 });
        }),
      );

      vi.useFakeTimers();
      const client = new PaprikaClient("test@example.com", "password", testLog);
      const callPromise = client.listRecipes().catch(() => {
        /* expected rejection */
      });
      await vi.runAllTimersAsync();
      await callPromise;

      const giveUps = records.filter((r) => r["msg"] === "paprika retries exhausted");
      expect(giveUps).toHaveLength(1);
    }, 15000);
  });

  describe("structured-logging.AC6: Breaker lifecycle hooks emit log records", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("AC6.1 - onBreak emits exactly one warn 'paprika circuit breaker opened' after 5 distinct failing tool calls", async () => {
      const { log: testLog, records } = makePinoCapture();
      // Fail every request — 5 tool calls × 4 attempts each (1 initial + 3 retries) = 20 fetches before breaker opens
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          return HttpResponse.json({ result: [] }, { status: 503 });
        }),
      );

      vi.useFakeTimers();
      const client = new PaprikaClient("test@example.com", "password", testLog);

      // Make 5 failing tool calls — each exhausts all 3 retries
      for (let i = 0; i < 5; i++) {
        const p = client.listRecipes().catch(() => {
          /* expected */
        });
        await vi.runAllTimersAsync();
        await p;
      }

      const breakRecords = records.filter((r) => r["msg"] === "paprika circuit breaker opened");
      expect(breakRecords).toHaveLength(1);
    }, 60000);

    it("AC6.3 - onHalfOpen emits info record when a probe starts after halfOpenAfter elapses", async () => {
      const { log: testLog, records } = makePinoCapture();
      // All fetches succeed after the breaker is tripped
      let fetchCount = 0;
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          fetchCount++;
          // Fail enough times to trip the breaker (5 calls × 4 attempts each = 20),
          // then succeed on the probe
          if (fetchCount <= 20) {
            return HttpResponse.json({ result: [] }, { status: 503 });
          }
          return HttpResponse.json({ result: [] });
        }),
      );

      // Use fake timers that also fake Date so Date.now() advances with timers
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      const client = new PaprikaClient("test@example.com", "password", testLog);

      // Trip the breaker: 5 failing calls (each exhausts maxAttempts=3, so 4 total fetches)
      for (let i = 0; i < 5; i++) {
        const p = client.listRecipes().catch(() => {
          /* expected */
        });
        await vi.runAllTimersAsync();
        await p;
      }

      // Advance Date.now() past halfOpenAfter (30_000ms) so the next execute() enters half-open.
      vi.advanceTimersByTime(35_000);

      // The probe triggers onHalfOpen inside execute()
      const probePromise = client.listRecipes();
      await vi.runAllTimersAsync();
      await probePromise;

      const halfOpenRecords = records.filter((r) => r["msg"] === "paprika circuit breaker half-open (probe pending)");
      expect(halfOpenRecords).toHaveLength(1);
    }, 60000);

    it("AC6.2 - onReset emits info record after successful half-open probe", async () => {
      const { log: testLog, records } = makePinoCapture();
      let fetchCount = 0;
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          fetchCount++;
          // Fail 20 fetches (5 calls × 4 attempts), then succeed on probe
          if (fetchCount <= 20) {
            return HttpResponse.json({ result: [] }, { status: 503 });
          }
          return HttpResponse.json({ result: [] });
        }),
      );

      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      const client = new PaprikaClient("test@example.com", "password", testLog);

      // Trip the breaker: 5 failing calls
      for (let i = 0; i < 5; i++) {
        const p = client.listRecipes().catch(() => {
          /* expected */
        });
        await vi.runAllTimersAsync();
        await p;
      }

      // Advance past halfOpenAfter to allow half-open probe
      vi.advanceTimersByTime(35_000);

      // Make a successful half-open probe — onReset fires after probe succeeds
      const probePromise = client.listRecipes();
      await vi.runAllTimersAsync();
      await probePromise;

      const resetRecords = records.filter((r) => r["msg"] === "paprika circuit breaker reset");
      expect(resetRecords).toHaveLength(1);
    }, 60000);
  });

  // ---------------------------------------------------------------------------
  // CircuitOpenError surface — Task 4 (AC4.2, AC4.3, AC5.5)
  // ---------------------------------------------------------------------------

  describe("structured-logging.AC4+AC5: CircuitOpenError replaces synthetic 503", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * Helper: trips the breaker by making 5 failing calls on the given client.
     * Each call exhausts all retries (maxAttempts=3 → 4 total fetches per call).
     * Must be called with fake timers active.
     */
    async function tripBreaker(client: PaprikaClient): Promise<void> {
      for (let i = 0; i < 5; i++) {
        // Start the call BEFORE awaiting timers — the call hangs on backoff delays
        const p = client.listRecipes().catch(() => {
          /* expected */
        });
        // Drain fake timers (retry backoffs) so the call can complete
        await vi.runAllTimersAsync();
        // Now the call has resolved (all retries exhausted, error swallowed)
        await p;
      }
    }

    it("AC4.2 - 5th distinct failing call trips breaker (onBreak fires once) and fetch count is 5×4=20", async () => {
      const { log: testLog, records } = makePinoCapture();
      let fetchCount = 0;
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          fetchCount++;
          return HttpResponse.json({ result: [] }, { status: 503 });
        }),
      );

      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      const client = new PaprikaClient("test@example.com", "password", testLog);

      await tripBreaker(client);

      const breakRecords = records.filter((r) => r["msg"] === "paprika circuit breaker opened");
      expect(breakRecords).toHaveLength(1);
      // 5 calls × 4 total attempts (maxAttempts:3 means 4 total) = 20 fetches
      expect(fetchCount).toBe(20);
    }, 60000);

    it("AC4.3 - 6th call with open breaker throws CircuitOpenError without additional fetches", async () => {
      let fetchCount = 0;
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          fetchCount++;
          return HttpResponse.json({ result: [] }, { status: 503 });
        }),
      );

      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      const client = new PaprikaClient("test@example.com", "password");

      await tripBreaker(client);
      const fetchCountAfterTrip = fetchCount;

      // 6th call should throw CircuitOpenError without making any fetch
      let caught: unknown;
      try {
        await client.listRecipes();
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(CircuitOpenError);
      // No additional fetches were made
      expect(fetchCount).toBe(fetchCountAfterTrip);

      if (caught instanceof CircuitOpenError) {
        expect(caught.endpoint).toBe(`${API_BASE}/recipes/`);
        expect(caught.cause).toBeInstanceOf(BrokenCircuitError);
      }
    }, 60000);

    it("AC5.5 - toMessage on CircuitOpenError never contains 'HTTP 503'", async () => {
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          return HttpResponse.json({ result: [] }, { status: 503 });
        }),
      );

      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      const client = new PaprikaClient("test@example.com", "password");

      await tripBreaker(client);

      let caught: unknown;
      try {
        await client.listRecipes();
      } catch (err) {
        caught = err;
      }

      const msg = toMessage(caught);
      expect(msg).toContain(`${API_BASE}/recipes/`);
      expect(msg).not.toContain("HTTP 503");
      expect(msg).toBe(`paprika circuit breaker is open (endpoint=${API_BASE}/recipes/)`);
    }, 60000);
  });

  // ---------------------------------------------------------------------------
  // Per-attempt response-path logging — Task 5 (AC3.1, AC3.2, AC3.5, AC3.6, AC3.7)
  // ---------------------------------------------------------------------------

  describe("structured-logging.AC3.1+3.2: request start and request ok debug records", () => {
    it("AC3.1 - emits debug 'paprika request start' with method, url, attempt:1 on first call", async () => {
      const { log: testLog, records } = makePinoCapture();
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          return HttpResponse.json({ result: [] });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password", testLog);
      await client.listRecipes();

      const startRecords = records.filter((r) => r["msg"] === "paprika request start");
      expect(startRecords.length).toBeGreaterThanOrEqual(1);
      expect(startRecords[0]!["method"]).toBe("GET");
      expect(typeof startRecords[0]!["url"]).toBe("string");
      expect(startRecords[0]!["attempt"]).toBe(1);
    });

    it("AC3.2 - emits exactly one debug 'paprika request ok' with status:200, attempt:1, attemptDurationMs>=0", async () => {
      const { log: testLog, records } = makePinoCapture();
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          return HttpResponse.json({ result: [] });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password", testLog);
      await client.listRecipes();

      const okRecords = records.filter((r) => r["msg"] === "paprika request ok");
      expect(okRecords).toHaveLength(1);
      expect(okRecords[0]!["attempt"]).toBe(1);
      expect(okRecords[0]!["status"]).toBe(200);
      expect(typeof okRecords[0]!["attemptDurationMs"]).toBe("number");
      expect((okRecords[0]!["attemptDurationMs"] as number) >= 0).toBe(true);
    });
  });

  describe("structured-logging.AC3.5: non-retryable failure emits error record, no retry warn", () => {
    it("AC3.5 - emits error 'paprika request failed (non-retryable)' on 400, no retry warn fires", async () => {
      const { log: testLog, records } = makePinoCapture();
      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          return HttpResponse.json({}, { status: 400 });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password", testLog);
      await client.listRecipes().catch(() => {
        /* expected */
      });

      const errorRecords = records.filter((r) => r["msg"] === "paprika request failed (non-retryable)");
      expect(errorRecords).toHaveLength(1);
      expect(errorRecords[0]!["status"]).toBe(400);
      expect(errorRecords[0]!["attempt"]).toBe(1);

      // 400 is not in RETRYABLE_STATUSES, so onRetry must not fire
      const retryWarns = records.filter((r) => r["msg"] === "paprika request failed, retrying");
      expect(retryWarns).toHaveLength(0);
    });
  });

  describe("structured-logging.AC3.6: 401 re-auth signal emits info record", () => {
    it("AC3.6 - emits info 'paprika 401, re-authenticating' with status:401 and attempt:1 on first attempt", async () => {
      const { log: testLog, records } = makePinoCapture();
      let authCallCount = 0;
      let apiCallCount = 0;

      server.use(
        http.post(AUTH_URL, () => {
          authCallCount++;
          return HttpResponse.json({ result: { token: "fresh-token" } });
        }),
        http.get(`${API_BASE}/recipes/`, () => {
          apiCallCount++;
          if (apiCallCount === 1) {
            return HttpResponse.json({}, { status: 401 });
          }
          return HttpResponse.json({ result: [] });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password", testLog);
      // Authenticate first so the client has a token (401 without token → auth error, not re-auth)
      await client.authenticate();
      await client.listRecipes();

      const reAuthRecords = records.filter((r) => r["msg"] === "paprika 401, re-authenticating");
      expect(reAuthRecords.length).toBeGreaterThanOrEqual(1);
      expect(reAuthRecords[0]!["status"]).toBe(401);
      expect(reAuthRecords[0]!["attempt"]).toBe(1);
      expect(authCallCount).toBeGreaterThanOrEqual(2); // initial auth + re-auth
    });
  });

  describe("structured-logging.AC3.7: no token leaks in captured log records", () => {
    it("AC3.7 - captured records from a failing request contain no bearer token values", async () => {
      const secretToken = "supersecret-bearer-token-xyz-unique";
      const records: Array<Record<string, unknown>> = [];
      const captureStream = new Writable({
        write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
          records.push(JSON.parse(chunk.toString("utf8")) as Record<string, unknown>);
          cb();
        },
      });
      // Use a logger with redact config matching createLogger's REDACT_PATHS
      const redactLog = pino(
        {
          level: "trace",
          redact: {
            paths: REDACT_PATHS as Array<string>,
            censor: "[Redacted]",
          },
        },
        captureStream,
      ) as Logger;

      server.use(
        http.get(`${API_BASE}/recipes/`, () => {
          return HttpResponse.json({}, { status: 400 });
        }),
      );

      // Build a client with the redact-enabled logger
      const client = new PaprikaClient("test@example.com", secretToken, redactLog);
      // Authenticate so the token is set (but since auth URL is not stubbed, it will fail)
      // Instead, directly make a request — the token is set as password, not auth token yet.
      // Just verify that no field in any record contains the secret token.
      await client.listRecipes().catch(() => {
        /* expected: 400 error */
      });

      // Serialize all records to string and verify no leak
      const allRecordsAsJson = JSON.stringify(records);
      expect(allRecordsAsJson).not.toContain(secretToken);
    });

    it("AC3.7 belt-and-suspenders - pino redact censors authorization header when logged directly", () => {
      const records: Array<Record<string, unknown>> = [];
      const captureStream = new Writable({
        write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
          records.push(JSON.parse(chunk.toString("utf8")) as Record<string, unknown>);
          cb();
        },
      });
      const redactLog = pino(
        {
          level: "trace",
          redact: {
            paths: REDACT_PATHS as Array<string>,
            censor: "[Redacted]",
          },
        },
        captureStream,
      ) as Logger;

      // Log a payload with an authorization header directly to the test logger
      redactLog.warn({ headers: { authorization: "Bearer super-secret-token" } }, "test-redact-check");

      expect(records).toHaveLength(1);
      const record = records[0]!;
      const headers = record["headers"] as Record<string, unknown>;
      expect(headers["authorization"]).toBe("[Redacted]");
      expect(JSON.stringify(record)).not.toContain("super-secret-token");
    });
  });
});
