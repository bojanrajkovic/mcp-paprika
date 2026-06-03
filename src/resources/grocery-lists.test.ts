import { describe, it, expect } from "vitest";
import { makeGroceryList } from "../cache/__fixtures__/grocery-lists.js";
import { makeGroceryItem } from "../cache/__fixtures__/grocery-items.js";
import { RecipeStore } from "../recipe/store.js";
import { makeTestServer, makeCtx, seed } from "../tools/tool-test-utils.js";
import { registerGroceryListResources } from "./grocery-lists.js";
import type { GroceryListUid, GroceryItemUid } from "../ids.js";

describe("grocery-surface.AC4: Grocery list MCP resource", () => {
  describe("grocery-surface.AC4.2: Resource list returns all non-deleted grocery lists", () => {
    it("returns 2 entries with correct name and uri format", async () => {
      const { server, callResourceList } = makeTestServer();

      const list1 = makeGroceryList({ uid: "gl-1" as GroceryListUid, name: "Weekly" });
      const list2 = makeGroceryList({ uid: "gl-2" as GroceryListUid, name: "Party" });
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        groceryLists: [list1, list2],
        groceryItems: [],
      });
      registerGroceryListResources(server, ctx);

      const result = (await callResourceList("grocery-lists")) as {
        resources: Array<{ uri: string; name: string; mimeType: string }>;
      };

      expect(result.resources).toHaveLength(2);
      expect(result.resources[0]).toEqual({
        uri: "paprika://grocery-list/gl-1",
        name: "Weekly",
        mimeType: "text/markdown",
      });
      expect(result.resources[1]).toEqual({
        uri: "paprika://grocery-list/gl-2",
        name: "Party",
        mimeType: "text/markdown",
      });
    });

    it("returns empty resources array when store is empty", async () => {
      const { server, callResourceList } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        groceryLists: [],
        groceryItems: [],
      });
      registerGroceryListResources(server, ctx);

      const result = (await callResourceList("grocery-lists")) as { resources: Array<unknown> };

      expect(result).toEqual({ resources: [] });
    });
  });

  describe("grocery-surface.AC4.1: Resource read renders metadata header and list content", () => {
    it("prepends UID and URI header lines to list markdown", async () => {
      const { server, callResource } = makeTestServer();

      const list = makeGroceryList({ uid: "gl-read-1" as GroceryListUid, name: "Weekly" });
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        groceryLists: [list],
        groceryItems: [],
      });
      registerGroceryListResources(server, ctx);

      const result = (await callResource("grocery-lists", "gl-read-1", "paprika://grocery-list/gl-read-1")) as {
        contents: Array<{ text: string; uri: string; mimeType: string }>;
      };

      const text = result.contents[0]?.text ?? "";
      expect(text).toMatch(/^\*\*UID:\*\*\s`gl-read-1`/);
      expect(text).toContain("**URI:** `paprika://grocery-list/gl-read-1`");
      expect(text).toContain("Weekly");
    });

    it("includes Last synced when store has been synced", async () => {
      const { server, callResource } = makeTestServer();

      const list = makeGroceryList({ uid: "gl-sync-1" as GroceryListUid, name: "Weekly" });
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        groceryLists: [list],
        groceryItems: [],
      });
      ctx.groceryListStore.setLastSyncedAt(new Date("2026-05-24T12:00:00Z"));
      registerGroceryListResources(server, ctx);

      const result = (await callResource("grocery-lists", "gl-sync-1", "paprika://grocery-list/gl-sync-1")) as {
        contents: Array<{ text: string }>;
      };

      expect(result.contents[0]?.text).toContain("**Last synced:** 2026-05-24T12:00:00.000Z");
    });

    it("omits Last synced when store has never been synced", async () => {
      const { server, callResource } = makeTestServer();

      const list = makeGroceryList({ uid: "gl-nosync-1" as GroceryListUid, name: "Weekly" });
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        groceryLists: [list],
        groceryItems: [],
      });
      registerGroceryListResources(server, ctx);

      const result = (await callResource("grocery-lists", "gl-nosync-1", "paprika://grocery-list/gl-nosync-1")) as {
        contents: Array<{ text: string }>;
      };

      expect(result.contents[0]?.text).not.toContain("**Last synced:**");
    });

    it("returns contents entry with text/markdown mimeType and correct uri.href", async () => {
      const { server, callResource } = makeTestServer();

      const list = makeGroceryList({ uid: "gl-mime-1" as GroceryListUid, name: "Weekly" });
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        groceryLists: [list],
        groceryItems: [],
      });
      registerGroceryListResources(server, ctx);

      const result = (await callResource("grocery-lists", "gl-mime-1", "paprika://grocery-list/gl-mime-1")) as {
        contents: Array<{ uri: string; mimeType: string; text: string }>;
      };

      expect(result.contents[0]).toMatchObject({
        mimeType: "text/markdown",
        uri: "paprika://grocery-list/gl-mime-1",
      });
      expect(result.contents[0]?.text).toBeDefined();
    });
  });

  describe("grocery-surface.AC4.3: Resource read output contains items table", () => {
    it("shows ingredient, quantity, aisle, and purchased status per item", async () => {
      const { server, callResource } = makeTestServer();

      const list = makeGroceryList({ uid: "gl-items-1" as GroceryListUid, name: "Weekly" });
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        groceryLists: [list],
        groceryItems: [
          makeGroceryItem({
            uid: "gi-1" as GroceryItemUid,
            listUid: "gl-items-1",
            ingredient: "Butter",
            quantity: "2 lbs",
            aisle: "Dairy",
            purchased: false,
          }),
          makeGroceryItem({
            uid: "gi-2" as GroceryItemUid,
            listUid: "gl-items-1",
            ingredient: "Milk",
            quantity: "1 gal",
            aisle: "Dairy",
            purchased: true,
          }),
        ],
      });
      registerGroceryListResources(server, ctx);

      const result = (await callResource("grocery-lists", "gl-items-1", "paprika://grocery-list/gl-items-1")) as {
        contents: Array<{ text: string }>;
      };

      const text = result.contents[0]?.text ?? "";
      expect(text).toContain("Butter");
      expect(text).toContain("2 lbs");
      expect(text).toContain("Dairy");
      expect(text).toContain("Milk");
      expect(text).toContain("1 gal");
      expect(text).toContain("Purchased");
      expect(text).toContain("| No |");
      expect(text).toContain("| Yes |");
    });
  });

  describe("grocery-surface.AC4.6: Resource read for unknown UID returns clear error", () => {
    it("throws error containing the unknown UID", async () => {
      const { server, callResource } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        groceryLists: [],
        groceryItems: [],
      });
      registerGroceryListResources(server, ctx);

      await expect(
        callResource("grocery-lists", "nonexistent-uid", "paprika://grocery-list/nonexistent-uid"),
      ).rejects.toThrow("nonexistent-uid");
    });
  });
});
