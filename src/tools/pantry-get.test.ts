import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { PantryStore } from "../cache/pantry-store.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import { registerGetPantryItemTool } from "./pantry-get.js";

describe("pantry-get tool", () => {
  it("pantry-read.AC5.3: UID lookup returns full item details as markdown", async () => {
    const item = makePantryItem({ ingredient: "Olive Oil" });
    const pantryStore = new PantryStore();
    pantryStore.load([item]);

    const { server, callTool } = makeTestServer();
    const recipeStore = new RecipeStore();
    registerGetPantryItemTool(server, makeCtx(recipeStore, server, { pantryStore }));

    const result = await callTool("get_pantry_item", { uid: item.uid });
    const text = getText(result);

    // Should contain the markdown heading with ingredient name
    expect(text).toContain(`# ${item.ingredient}`);
    // Should contain the UID
    expect(text).toContain(item.uid);
  });

  it("pantry-read.AC5.4: single fuzzy match returns item details", async () => {
    const pantryStore = new PantryStore();
    pantryStore.load([makePantryItem({ ingredient: "Brown Sugar" }), makePantryItem({ ingredient: "Flour" })]);

    const { server, callTool } = makeTestServer();
    const recipeStore = new RecipeStore();
    registerGetPantryItemTool(server, makeCtx(recipeStore, server, { pantryStore }));

    const result = await callTool("get_pantry_item", { ingredient: "Brown" });
    const text = getText(result);

    // Single match should return full markdown details
    expect(text).toContain("# Brown Sugar");
  });

  it("pantry-read.AC5.5: multiple fuzzy matches return disambiguation list", async () => {
    const pantryStore = new PantryStore();
    const items = [
      makePantryItem({ ingredient: "Apple Pie Filling" }),
      makePantryItem({ ingredient: "Apple Cider" }),
      makePantryItem({ ingredient: "Apple Sauce" }),
    ];
    pantryStore.load(items);

    const { server, callTool } = makeTestServer();
    const recipeStore = new RecipeStore();
    registerGetPantryItemTool(server, makeCtx(recipeStore, server, { pantryStore }));

    const result = await callTool("get_pantry_item", { ingredient: "Apple" });
    const text = getText(result);

    // All three ingredient names must be present
    expect(text).toContain("Apple Pie Filling");
    expect(text).toContain("Apple Cider");
    expect(text).toContain("Apple Sauce");

    // All UIDs must be present
    for (const item of items) {
      expect(text).toContain(item.uid);
    }

    // Disambiguation message
    expect(text).toContain("Multiple pantry items match");
    expect(text).toContain("re-invoke with a specific uid");
  });

  it("pantry-read.AC5.6: unknown UID returns not-found message", async () => {
    const item = makePantryItem();
    const pantryStore = new PantryStore();
    pantryStore.load([item]);

    const { server, callTool } = makeTestServer();
    const recipeStore = new RecipeStore();
    registerGetPantryItemTool(server, makeCtx(recipeStore, server, { pantryStore }));

    const result = await callTool("get_pantry_item", { uid: "does-not-exist" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no pantry item found");
  });

  it("pantry-read.AC5.6: unknown ingredient returns not-found message", async () => {
    const item = makePantryItem();
    const pantryStore = new PantryStore();
    pantryStore.load([item]);

    const { server, callTool } = makeTestServer();
    const recipeStore = new RecipeStore();
    registerGetPantryItemTool(server, makeCtx(recipeStore, server, { pantryStore }));

    const result = await callTool("get_pantry_item", { ingredient: "Caviar" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no pantry items found matching");
  });

  it("pantry-read.AC5.7: cold-start (hasSynced false) returns guard error", async () => {
    const pantryStore = new PantryStore();
    // DO NOT call load() — hasSynced remains false

    const { server, callTool } = makeTestServer();
    const recipeStore = new RecipeStore();
    registerGetPantryItemTool(server, makeCtx(recipeStore, server, { pantryStore }));

    const result = await callTool("get_pantry_item", { uid: "anything" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("pantry-read.AC5.8: neither uid nor ingredient provided is rejected", async () => {
    const item = makePantryItem();
    const pantryStore = new PantryStore();
    pantryStore.load([item]);

    const { server, callTool } = makeTestServer();
    const recipeStore = new RecipeStore();
    registerGetPantryItemTool(server, makeCtx(recipeStore, server, { pantryStore }));

    const result = await callTool("get_pantry_item", {});
    const text = getText(result);

    expect(text.toLowerCase()).toContain("either a uid");
  });

  it("UID precedence: when both uid and ingredient provided, uid takes precedence", async () => {
    const item1 = makePantryItem({ ingredient: "Salt" });
    const item2 = makePantryItem({ ingredient: "Match" });
    const pantryStore = new PantryStore();
    pantryStore.load([item1, item2]);

    const { server, callTool } = makeTestServer();
    const recipeStore = new RecipeStore();
    registerGetPantryItemTool(server, makeCtx(recipeStore, server, { pantryStore }));

    // Call with both uid (item1) and ingredient that would match item2
    const result = await callTool("get_pantry_item", {
      uid: item1.uid,
      ingredient: "Match",
    });
    const text = getText(result);

    // Should return item1's details, not item2
    expect(text).toContain("# Salt");
    expect(text).not.toContain("# Match");
  });
});
