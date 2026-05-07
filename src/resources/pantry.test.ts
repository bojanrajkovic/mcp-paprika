import { describe, it, expect } from "vitest";
import { PantryStore } from "../cache/pantry-store.js";
import { makeTestServer, makeCtx } from "../tools/tool-test-utils.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { registerPantryResources } from "./pantry.js";
import type { PantryItemUid } from "../paprika/types.js";
import { RecipeStore } from "../cache/recipe-store.js";

describe("pantry-read.AC6: MCP Pantry Resources", () => {
  describe("pantry-read.AC6.1: List handler returns all pantry items with URI, name, and mimeType", () => {
    it("returns pantry items with uri, name, and mimeType for each", async () => {
      const { server, callResourceList } = makeTestServer();
      const recipeStore = new RecipeStore();
      const pantryStore = new PantryStore();

      const item1 = makePantryItem({ ingredient: "Flour" });
      const item2 = makePantryItem({ ingredient: "Sugar" });
      pantryStore.load([item1, item2]);

      const ctx = makeCtx(recipeStore, server, { pantryStore });
      registerPantryResources(server, ctx);

      const result = (await callResourceList("pantry")) as {
        resources: Array<{ uri: string; name: string; mimeType: string }>;
      };

      expect(result.resources).toHaveLength(2);
      expect(result.resources[0]).toEqual({
        uri: `paprika://pantry/${item1.uid}`,
        name: "Flour",
        mimeType: "text/markdown",
      });
      expect(result.resources[1]).toEqual({
        uri: `paprika://pantry/${item2.uid}`,
        name: "Sugar",
        mimeType: "text/markdown",
      });
    });
  });

  describe("pantry-read.AC6.2: Read handler returns pantry item formatted as markdown for known UID", () => {
    it("returns pantry item with markdown content and correct URI", async () => {
      const { server, callResource } = makeTestServer();
      const recipeStore = new RecipeStore();
      const pantryStore = new PantryStore();

      const testUid = "test-pantry-uid" as PantryItemUid;
      const item = makePantryItem({
        uid: testUid,
        ingredient: "Test Ingredient",
      });
      pantryStore.load([item]);

      const ctx = makeCtx(recipeStore, server, { pantryStore });
      registerPantryResources(server, ctx);

      const result = (await callResource("pantry", testUid, `paprika://pantry/${testUid}`)) as {
        contents: Array<{ uri: string; mimeType: string; text: string }>;
      };

      expect(result.contents[0]).toMatchObject({
        uri: `paprika://pantry/${testUid}`,
        mimeType: "text/markdown",
      });
      const text = result.contents[0]?.text ?? "";
      expect(text).toContain("# Test Ingredient");
    });
  });

  describe("pantry-read.AC6.3: Read handler throws for unknown UID", () => {
    it("throws error when pantry item UID does not exist", async () => {
      const { server, callResource } = makeTestServer();
      const recipeStore = new RecipeStore();
      const pantryStore = new PantryStore();

      pantryStore.load([]);

      const ctx = makeCtx(recipeStore, server, { pantryStore });
      registerPantryResources(server, ctx);

      const missingUid = "missing-uid" as PantryItemUid;

      await expect(callResource("pantry", missingUid, `paprika://pantry/${missingUid}`)).rejects.toThrow(
        /Pantry item not found/,
      );
    });
  });
});
