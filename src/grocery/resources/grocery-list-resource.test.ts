import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GroceryItemUid, GroceryListUid } from "../../ids.js";
import type { GrocerySelf } from "../module.js";

import { makeGroceryItem } from "../../../test/cache/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../../../test/cache/__fixtures__/grocery-lists.js";
import { useKernelHarness } from "../../../test/support/kernel-harness.js";

describe("grocery-list MCP resource", () => {
  const kh = useKernelHarness("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  describe("list", () => {
    it("returns each non-deleted list with name + uri", async () => {
      kh.seed({
        groceryLists: [
          makeGroceryList({ uid: "gl-1" as GroceryListUid, name: "Weekly" }),
          makeGroceryList({ uid: "gl-2" as GroceryListUid, name: "Party" }),
        ],
        groceryItems: [],
      });

      const result = (await kh.callResourceList("grocery-lists")) as {
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

    it("returns an empty array when the store is empty", async () => {
      kh.seed({ groceryLists: [], groceryItems: [] });
      expect(await kh.callResourceList("grocery-lists")).toEqual({ resources: [] });
    });
  });

  describe("read", () => {
    it("prepends the UID + URI header to the list markdown", async () => {
      kh.seed({
        groceryLists: [makeGroceryList({ uid: "gl-read-1" as GroceryListUid, name: "Weekly" })],
        groceryItems: [],
      });

      const result = (await kh.callResource("grocery-lists", "gl-read-1", "paprika://grocery-list/gl-read-1")) as {
        contents: Array<{ text: string }>;
      };
      const text = result.contents[0]?.text ?? "";
      expect(text).toMatch(/^\*\*UID:\*\*\s`gl-read-1`/);
      expect(text).toContain("**URI:** `paprika://grocery-list/gl-read-1`");
      expect(text).toContain("Weekly");
    });

    it("includes Last synced when the store has been synced", async () => {
      kh.seed({
        groceryLists: [makeGroceryList({ uid: "gl-sync-1" as GroceryListUid, name: "Weekly" })],
        groceryItems: [],
      });
      (kh.self() as GrocerySelf).lists.store.setLastSyncedAt(new Date("2026-05-24T12:00:00Z"));

      const result = (await kh.callResource("grocery-lists", "gl-sync-1", "paprika://grocery-list/gl-sync-1")) as {
        contents: Array<{ text: string }>;
      };
      expect(result.contents[0]?.text).toContain("**Last synced:** 2026-05-24T12:00:00.000Z");
    });

    it("omits Last synced when the store has never been synced", async () => {
      kh.seed({
        groceryLists: [makeGroceryList({ uid: "gl-nosync-1" as GroceryListUid, name: "Weekly" })],
        groceryItems: [],
      });
      const result = (await kh.callResource("grocery-lists", "gl-nosync-1", "paprika://grocery-list/gl-nosync-1")) as {
        contents: Array<{ text: string }>;
      };
      expect(result.contents[0]?.text).not.toContain("**Last synced:**");
    });

    it("returns text/markdown mimeType + the resource uri", async () => {
      kh.seed({
        groceryLists: [makeGroceryList({ uid: "gl-mime-1" as GroceryListUid, name: "Weekly" })],
        groceryItems: [],
      });
      const result = (await kh.callResource("grocery-lists", "gl-mime-1", "paprika://grocery-list/gl-mime-1")) as {
        contents: Array<{ uri: string; mimeType: string; text: string }>;
      };
      expect(result.contents[0]).toMatchObject({ mimeType: "text/markdown", uri: "paprika://grocery-list/gl-mime-1" });
      expect(result.contents[0]?.text).toBeDefined();
    });

    it("renders an items table with ingredient, quantity, aisle, and purchased status", async () => {
      kh.seed({
        groceryLists: [makeGroceryList({ uid: "gl-items-1" as GroceryListUid, name: "Weekly" })],
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

      const result = (await kh.callResource("grocery-lists", "gl-items-1", "paprika://grocery-list/gl-items-1")) as {
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

    it("throws for an unknown UID", async () => {
      kh.seed({ groceryLists: [], groceryItems: [] });
      await expect(
        kh.callResource("grocery-lists", "nonexistent-uid", "paprika://grocery-list/nonexistent-uid"),
      ).rejects.toThrow("nonexistent-uid");
    });
  });
});
