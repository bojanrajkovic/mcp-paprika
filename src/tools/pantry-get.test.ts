import { describe, expect, it } from "vitest";

import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { RecipeStore } from "../recipe/store.js";
import { registerGetPantryItemTool } from "./pantry-get.js";
import { getText, makeCtx, makeTestServer, seed } from "./tool-test-utils.js";

describe("pantry-get tool", () => {
  it("pantry-read.AC5.3: UID lookup returns full item details as markdown", async () => {
    const item = makePantryItem({ ingredient: "Olive Oil" });

    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), { pantry: [item] });
    registerGetPantryItemTool(server, ctx);

    const result = await callTool("get_pantry_item", { lookup: { uid: item.uid } });
    const text = getText(result);

    // Should contain the markdown heading with ingredient name
    expect(text).toContain(`# ${item.ingredient}`);
    // Should contain the UID
    expect(text).toContain(item.uid);
  });

  it("pantry-read.AC5.4: single fuzzy match returns item details", async () => {
    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), {
      pantry: [makePantryItem({ ingredient: "Brown Sugar" }), makePantryItem({ ingredient: "Flour" })],
    });
    registerGetPantryItemTool(server, ctx);

    const result = await callTool("get_pantry_item", { lookup: { ingredient: "Brown" } });
    const text = getText(result);

    // Single match should return full markdown details
    expect(text).toContain("# Brown Sugar");
  });

  it("pantry-read.AC5.5: multiple fuzzy matches return disambiguation list", async () => {
    const items = [
      makePantryItem({ ingredient: "Apple Pie Filling" }),
      makePantryItem({ ingredient: "Apple Cider" }),
      makePantryItem({ ingredient: "Apple Sauce" }),
    ];
    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), { pantry: items });
    registerGetPantryItemTool(server, ctx);

    const result = await callTool("get_pantry_item", { lookup: { ingredient: "Apple" } });
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
    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), { pantry: [item] });
    registerGetPantryItemTool(server, ctx);

    const result = await callTool("get_pantry_item", { lookup: { uid: "does-not-exist" } });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no pantry item found");
  });

  it("pantry-read.AC5.6: unknown ingredient returns not-found message", async () => {
    const item = makePantryItem();
    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), { pantry: [item] });
    registerGetPantryItemTool(server, ctx);

    const result = await callTool("get_pantry_item", { lookup: { ingredient: "Caviar" } });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no pantry items found matching");
  });

  it("pantry-read.AC5.7: cold-start (hasSynced false) returns guard error", async () => {
    // DO NOT seed pantry — hasSynced remains false
    const { server, callTool } = makeTestServer();
    registerGetPantryItemTool(server, makeCtx(new RecipeStore(), server));

    const result = await callTool("get_pantry_item", { lookup: { uid: "anything" } });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
  });
});
