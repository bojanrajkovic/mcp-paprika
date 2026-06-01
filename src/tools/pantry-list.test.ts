import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { makeTestServer, makeCtx, getText, seed } from "./tool-test-utils.js";
import { registerListPantryTool } from "./pantry-list.js";

describe("pantry-list tool", () => {
  it("pantry-read.AC5.1: returns sorted listing with ingredient names and UIDs", async () => {
    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), {
      pantry: [
        makePantryItem({ ingredient: "Sugar" }),
        makePantryItem({ ingredient: "Apples" }),
        makePantryItem({ ingredient: "Milk" }),
      ],
    });
    registerListPantryTool(server, ctx);

    const result = await callTool("list_pantry", {});
    const text = getText(result);

    // Assert header mentions 3 items
    expect(text).toContain("You have 3 pantry items");

    // Assert alphabetical ordering: Apples before Milk before Sugar
    const applesIdx = text.indexOf("Apples");
    const milkIdx = text.indexOf("Milk");
    const sugarIdx = text.indexOf("Sugar");

    expect(applesIdx).toBeGreaterThan(-1);
    expect(milkIdx).toBeGreaterThan(-1);
    expect(sugarIdx).toBeGreaterThan(-1);
    expect(applesIdx).toBeLessThan(milkIdx);
    expect(milkIdx).toBeLessThan(sugarIdx);

    // Assert UIDs are present
    const items = ctx.pantryStore.getAll();
    for (const item of items) {
      expect(text).toContain(item.uid);
    }
  });

  it("pantry-read.AC5.2: returns friendly message for empty pantry", async () => {
    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), { pantry: [] });
    registerListPantryTool(server, ctx);

    const result = await callTool("list_pantry", {});
    const text = getText(result);

    expect(text).toBe("Your pantry is empty.");
  });

  it("pantry-read.AC5.7: cold-start (hasSynced false) returns guard error", async () => {
    // DO NOT seed pantry — hasSynced remains false
    const { server, callTool } = makeTestServer();
    registerListPantryTool(server, makeCtx(new RecipeStore(), server));

    const result = await callTool("list_pantry", {});
    const text = getText(result);

    // Case-insensitive substring match for guard message
    expect(text.toLowerCase()).toContain("not yet synced");
  });
});
