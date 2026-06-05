import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MealTypeUid, MenuItemUid, MenuUid } from "../../../ids.js";
import type { MenuState } from "../module.js";

import { makeMealType } from "../../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { makeMenu, makeMenuItem } from "../../../../test/domains/menu/__fixtures__/menus.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";

describe("menu MCP resource", () => {
  const kh = useKernelHarness("menu");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  describe("list", () => {
    it("returns one entry per menu with name + uri", async () => {
      kh.seed({
        menus: [
          makeMenu({ uid: "m-1" as MenuUid, name: "Weekly" }),
          makeMenu({ uid: "m-2" as MenuUid, name: "Party" }),
        ],
        menuItems: [],
      });

      const result = (await kh.callResourceList("menus")) as {
        resources: Array<{ uri: string; name: string; mimeType: string }>;
      };

      expect(result.resources).toHaveLength(2);
      expect(result.resources[0]).toEqual({ uri: "paprika://menu/m-1", name: "Weekly", mimeType: "text/markdown" });
      expect(result.resources[1]).toEqual({ uri: "paprika://menu/m-2", name: "Party", mimeType: "text/markdown" });
    });

    it("returns an empty array when the store is empty", async () => {
      kh.seed({ menus: [], menuItems: [] });
      expect(await kh.callResourceList("menus")).toEqual({ resources: [] });
    });
  });

  describe("read", () => {
    it("prepends the UID + URI header lines and renders the menu title", async () => {
      kh.seed({
        menus: [makeMenu({ uid: "m-read" as MenuUid, name: "Weekly", days: 1 })],
        menuItems: [],
        mealTypes: [makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 })],
      });

      const result = (await kh.callResource("menus", "m-read", "paprika://menu/m-read")) as {
        contents: Array<{ text: string }>;
      };
      const text = result.contents[0]?.text ?? "";
      expect(text).toContain("**UID:** `m-read`");
      expect(text).toContain("**URI:** `paprika://menu/m-read`");
      expect(text).toContain("# Weekly");
    });

    it("includes Last synced when the menu store has been synced", async () => {
      kh.seed({
        menus: [makeMenu({ uid: "m-sync" as MenuUid, name: "Weekly" })],
        menuItems: [],
        mealTypes: [makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 })],
      });
      (kh.state() as MenuState).menus.store.setLastSyncedAt(new Date("2026-05-30T12:00:00Z"));

      const result = (await kh.callResource("menus", "m-sync", "paprika://menu/m-sync")) as {
        contents: Array<{ text: string }>;
      };
      expect(result.contents[0]?.text).toContain("**Last synced:** 2026-05-30T12:00:00.000Z");
    });

    it("returns text/markdown mimeType + the resource uri", async () => {
      kh.seed({
        menus: [makeMenu({ uid: "m-mime" as MenuUid, name: "Weekly" })],
        menuItems: [],
        mealTypes: [makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 })],
      });
      const result = (await kh.callResource("menus", "m-mime", "paprika://menu/m-mime")) as {
        contents: Array<{ uri: string; mimeType: string; text: string }>;
      };
      expect(result.contents[0]).toMatchObject({ mimeType: "text/markdown", uri: "paprika://menu/m-mime" });
      expect(result.contents[0]?.text).toBeDefined();
    });

    it("renders items but omits child item + recipe UIDs (includeItemUids false)", async () => {
      kh.seed({
        menus: [makeMenu({ uid: "m-clean" as MenuUid, name: "Weekly", days: 1 })],
        menuItems: [
          makeMenuItem({
            uid: "mi-clean" as MenuItemUid,
            menuUid: "m-clean",
            day: 1,
            typeUid: "dinner-uid",
            name: "Lasagna",
            recipeUid: "recipe-9",
          }),
        ],
        mealTypes: [makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 })],
      });

      const result = (await kh.callResource("menus", "m-clean", "paprika://menu/m-clean")) as {
        contents: Array<{ text: string }>;
      };
      const text = result.contents[0]?.text ?? "";
      expect(text).toContain("- **Dinner:** Lasagna");
      expect(text).not.toContain("· item");
      expect(text).not.toContain("· recipe");
    });

    it("throws when the menu does not exist", async () => {
      kh.seed({ menus: [], menuItems: [] });
      await expect(kh.callResource("menus", "ghost", "paprika://menu/ghost")).rejects.toThrow("Menu not found: ghost");
    });
  });
});
