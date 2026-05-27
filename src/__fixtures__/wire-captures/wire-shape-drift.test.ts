import { describe, it, expect } from "vitest";
import { gunzipSync } from "node:zlib";
import { http, HttpResponse } from "msw";
import { fixture as refFixture } from "./reference.js";
import { fixture as writeFixture } from "./writes.js";
import { useMswServer } from "../msw.js";
import { PaprikaClient } from "../../paprika/client.js";
import {
  RecipeSchema,
  PantryItemSchema,
  PantryItemUidSchema,
  GroceryListSchema,
  GroceryListUidSchema,
  GroceryItemSchema,
  GroceryItemUidSchema,
  GroceryIngredientSchema,
  GroceryIngredientUidSchema,
  CategorySchema,
} from "../../paprika/types.js";
import type { Recipe, PantryItem, GroceryList, GroceryItem, GroceryIngredient } from "../../paprika/types.js";
import { makeSnakeCaseRecipe } from "../../cache/__fixtures__/recipes.js";
import { makeSnakeCasePantryItem } from "../../cache/__fixtures__/pantry.js";

/**
 * Wire-shape drift detection tests.
 *
 * These compare our **implementations** (Zod schemas, PaprikaClient POST
 * serialization, hand-rolled fixture factories) against real Paprika API
 * traffic captured via mitmproxy. A test breaking means our code diverged
 * from the real API — either Paprika changed their schema (re-capture) or
 * we introduced a regression.
 */

const AUTH_URL = "https://paprikaapp.com/api/v1/account/login/";
const API_BASE = "https://paprikaapp.com/api/v2/sync";

function wireKeys(entry: { requestBody: unknown; responseBody: unknown }, source: "request" | "response"): string[] {
  const body = source === "request" ? entry.requestBody : entry.responseBody;
  if (!body || typeof body !== "object") return [];

  let items: Array<Record<string, unknown>> = [];
  const result = (body as Record<string, unknown>)["result"];
  if (Array.isArray(result) && result.length > 0) {
    items = result as Array<Record<string, unknown>>;
  } else if (Array.isArray(body)) {
    const inner = Array.isArray(body[0])
      ? (body[0] as Array<Record<string, unknown>>)
      : (body as Array<Record<string, unknown>>);
    items = inner;
  }

  const keySet = new Set<string>();
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    for (const key of Object.keys(item)) {
      keySet.add(key);
    }
  }
  return [...keySet].sort();
}

function schemaInputKeys(schema: { innerType: () => { shape: Record<string, unknown> } }): string[] {
  return Object.keys(schema.innerType().shape).sort();
}

async function capturePostBody(
  server: ReturnType<typeof useMswServer>,
  url: string,
  doPost: (client: PaprikaClient) => Promise<unknown>,
): Promise<Record<string, unknown>> {
  let body: Array<Record<string, unknown>> | null = null;

  server.use(
    http.post(AUTH_URL, () => HttpResponse.json({ result: { token: "fake" } })),
    http.post(url, async ({ request }) => {
      const formData = await request.formData();
      const dataBlob = formData.get("data") as Blob;
      const arrayBuffer = await dataBlob.arrayBuffer();
      const decompressed = gunzipSync(Buffer.from(arrayBuffer));
      body = JSON.parse(decompressed.toString()) as Array<Record<string, unknown>>;
      return HttpResponse.json({ result: true });
    }),
  );

  const client = new PaprikaClient("test@example.com", "password");
  await doPost(client);

  return body![0]!;
}

describe("wire-shape drift detection", () => {
  describe("Zod GET schema input fields vs wire captures", () => {
    it("RecipeSchema accepts all fields from GET individual recipe", () => {
      const f = refFixture("GET individual recipe (full 28-field shape)");
      const wireGetKeys = Object.keys((f.responseBody as { result: Record<string, unknown> }).result).sort();
      const schemaKeys = schemaInputKeys(RecipeSchema);
      expect(schemaKeys).toEqual(wireGetKeys);
    });

    it("CategorySchema accepts all fields from GET categories", () => {
      const wireGetKeys = wireKeys(refFixture("GET categories (fully hydrated)"), "response");
      const schemaKeys = schemaInputKeys(CategorySchema);
      expect(schemaKeys).toEqual(wireGetKeys);
    });

    it("PantryItemSchema accepts GET fields with known divergences", () => {
      const wireGetKeys = wireKeys(refFixture("GET pantry items (startup sync)"), "response");
      const schemaKeys = schemaInputKeys(PantryItemSchema);
      // Schema has deleted (optional, default false) — GET wire omits it for live items
      // Schema lacks location_uid — present on wire but not yet modeled
      const schemaExtra = schemaKeys.filter((k) => !wireGetKeys.includes(k));
      const wireMissing = wireGetKeys.filter((k) => !schemaKeys.includes(k));
      expect(schemaExtra).toEqual(["deleted"]);
      expect(wireMissing).toEqual(["location_uid"]);
    });

    it("GroceryListSchema accepts all fields from GET grocery lists (plus deleted)", () => {
      const wireGetKeys = wireKeys(refFixture("GET grocery lists (startup sync)"), "response");
      const schemaKeys = schemaInputKeys(GroceryListSchema);
      // GET responses omit deleted for live items; schema has it with optional().default(false)
      expect(schemaKeys).toEqual([...wireGetKeys, "deleted"].sort());
    });

    it("GroceryItemSchema fields are a superset of GET response (empty GET array)", () => {
      const wirePostKeys = wireKeys(writeFixture("add grocery item: [mcp-cap] Milk"), "request");
      const schemaKeys = schemaInputKeys(GroceryItemSchema);
      expect(schemaKeys).toEqual(wirePostKeys);
    });

    it("GroceryIngredientSchema accepts all fields from GET grocery ingredients (plus deleted)", () => {
      const wireGetKeys = wireKeys(refFixture("GET grocery ingredients (aisle mapping catalog)"), "response");
      const schemaKeys = schemaInputKeys(GroceryIngredientSchema);
      // GET responses omit deleted for live items; schema has it with optional().default(false)
      expect(schemaKeys).toEqual([...wireGetKeys, "deleted"].sort());
    });
  });

  describe("PaprikaClient POST serialization vs wire captures", () => {
    const server = useMswServer([], { onUnhandledRequest: "bypass" });

    it("saveRecipe sends wire POST keys plus on_grocery_list + photo_url, minus deleted (#125, #127)", async () => {
      const wirePostKeys = wireKeys(writeFixture("create recipe ([mcp-cap] Test Recipe)"), "request");
      const recipe = RecipeSchema.parse(makeSnakeCaseRecipe("FEA35DA4-FAKE")) as Recipe;

      let body: Record<string, unknown> | null = null;
      server.use(
        http.post(AUTH_URL, () => HttpResponse.json({ result: { token: "fake" } })),
        http.post(`${API_BASE}/recipe/:uid/`, async ({ request }) => {
          const formData = await request.formData();
          const dataBlob = formData.get("data") as Blob;
          const arrayBuffer = await dataBlob.arrayBuffer();
          const decompressed = gunzipSync(Buffer.from(arrayBuffer));
          body = JSON.parse(decompressed.toString()) as Record<string, unknown>;
          return HttpResponse.json({ result: true });
        }),
      );

      const client = new PaprikaClient("test@example.com", "password");
      await client.saveRecipe(recipe);

      const payloadKeys = Object.keys(body!).sort();
      // #127: we send on_grocery_list + photo_url (server-computed, app omits)
      // #125: we omit deleted (app sends deleted: false on all recipe POSTs)
      expect(payloadKeys).toEqual(
        [...wirePostKeys, "on_grocery_list", "photo_url"].filter((k) => k !== "deleted").sort(),
      );
    });

    it("savePantryItems sends wire POST keys plus notes (#126)", async () => {
      const wirePostKeys = wireKeys(writeFixture("create pantry item (mcp-cap Test Flour)"), "request");
      const pantryItem: PantryItem = {
        uid: PantryItemUidSchema.parse("PT-TEST-1"),
        ingredient: "Test",
        quantity: "1",
        aisle: "",
        aisleUid: "",
        expirationDate: null,
        hasExpiration: false,
        inStock: true,
        purchaseDate: null,
        notes: null,
        deleted: false,
      };

      const payload = await capturePostBody(server, `${API_BASE}/pantry/`, (c) => c.savePantryItems([pantryItem]));
      const payloadKeys = Object.keys(payload).sort();
      // #126: we send notes (app omits it when null)
      expect(payloadKeys).toEqual([...wirePostKeys, "notes"].sort());
    });

    it("saveGroceryList sends exact wire POST keys", async () => {
      const wirePostKeys = wireKeys(writeFixture("create grocery list ([mcp-cap] Test List)"), "request");
      const list: GroceryList = {
        uid: GroceryListUidSchema.parse("GL-TEST-1"),
        name: "Test",
        orderFlag: 0,
        isDefault: false,
        remindersList: "",
        deleted: false,
      };

      const payload = await capturePostBody(server, `${API_BASE}/grocerylists/`, (c) => c.saveGroceryList(list));
      expect(Object.keys(payload).sort()).toEqual(wirePostKeys);
    });

    it("saveGroceryItems sends exact wire POST keys", async () => {
      const wirePostKeys = wireKeys(writeFixture("add grocery item: [mcp-cap] Milk"), "request");
      const item: GroceryItem = {
        uid: GroceryItemUidSchema.parse("GI-TEST-1"),
        name: "Test",
        ingredient: "Test",
        aisle: "",
        aisleUid: "",
        listUid: "GL-1",
        purchased: false,
        deleted: false,
        orderFlag: 0,
        quantity: "1",
        instruction: "",
        recipe: null,
        separate: false,
      };

      const payload = await capturePostBody(server, `${API_BASE}/groceries/`, (c) => c.saveGroceryItems([item]));
      expect(Object.keys(payload).sort()).toEqual(wirePostKeys);
    });

    it("saveGroceryIngredient sends exact wire POST keys", async () => {
      const wirePostKeys = wireKeys(writeFixture("auto-create grocery ingredient (mcp-cap milk)"), "request");
      const ingredient: GroceryIngredient = {
        uid: GroceryIngredientUidSchema.parse("GN-TEST-1"),
        name: "Test",
        aisleUid: "",
        deleted: false,
      };

      const payload = await capturePostBody(server, `${API_BASE}/groceryingredients/`, (c) =>
        c.saveGroceryIngredient(ingredient),
      );
      expect(Object.keys(payload).sort()).toEqual(wirePostKeys);
    });
  });

  describe("hand-rolled fixture factories vs wire captures", () => {
    it("makeSnakeCaseRecipe matches GET individual recipe fields", () => {
      const f = refFixture("GET individual recipe (full 28-field shape)");
      const wireGetKeys = Object.keys((f.responseBody as { result: Record<string, unknown> }).result).sort();
      const factoryKeys = Object.keys(makeSnakeCaseRecipe("test")).sort();
      expect(factoryKeys).toEqual(wireGetKeys);
    });

    it("makeSnakeCasePantryItem matches GET pantry fields exactly", () => {
      const wireGetKeys = wireKeys(refFixture("GET pantry items (startup sync)"), "response");
      const factoryKeys = Object.keys(makeSnakeCasePantryItem("test")).sort();
      expect(factoryKeys).toEqual(wireGetKeys);
    });
  });
});
