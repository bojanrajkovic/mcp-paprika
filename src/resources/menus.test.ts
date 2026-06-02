import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeMenu, makeMenuItem } from "../cache/__fixtures__/menus.js";
import { makeMealType } from "../cache/__fixtures__/meals.js";
import { makeTestServer, makeCtx, seed } from "../tools/tool-test-utils.js";
import { registerMenuResources } from "./menus.js";
import type { MealTypeUid, MenuItemUid, MenuUid } from "../ids.js";

describe("menu MCP resource", () => {
  describe("list callback", () => {
    it("returns one entry per menu with name and uri format", async () => {
      const { server, callResourceList } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        menus: [
          makeMenu({ uid: "m-1" as MenuUid, name: "Weekly" }),
          makeMenu({ uid: "m-2" as MenuUid, name: "Party" }),
        ],
        menuItems: [],
      });
      registerMenuResources(server, ctx);

      const result = (await callResourceList("menus")) as {
        resources: Array<{ uri: string; name: string; mimeType: string }>;
      };

      expect(result.resources).toHaveLength(2);
      expect(result.resources[0]).toEqual({
        uri: "paprika://menu/m-1",
        name: "Weekly",
        mimeType: "text/markdown",
      });
    });

    it("returns an empty resources array when the store is empty", async () => {
      const { server, callResourceList } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        menus: [],
        menuItems: [],
      });
      registerMenuResources(server, ctx);

      const result = (await callResourceList("menus")) as { resources: Array<unknown> };
      expect(result).toEqual({ resources: [] });
    });
  });

  describe("read callback", () => {
    it("prepends UID and URI header lines to the menu markdown", async () => {
      const { server, callResource } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        menus: [makeMenu({ uid: "m-read" as MenuUid, name: "Weekly", days: 1 })],
        menuItems: [],
        mealTypes: [makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 })],
      });
      registerMenuResources(server, ctx);

      const result = (await callResource("menus", "m-read", "paprika://menu/m-read")) as {
        contents: Array<{ text: string; uri: string; mimeType: string }>;
      };

      const text = result.contents[0]?.text ?? "";
      expect(text).toContain("**UID:** `m-read`");
      expect(text).toContain("**URI:** `paprika://menu/m-read`");
      expect(text).toContain("# Weekly");
    });

    it("includes Last synced when the menu store has been synced", async () => {
      const { server, callResource } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        menus: [makeMenu({ uid: "m-sync" as MenuUid, name: "Weekly" })],
        menuItems: [],
        mealTypes: [makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 })],
      });
      ctx.menuStore.setLastSyncedAt(new Date("2026-05-30T12:00:00Z"));
      registerMenuResources(server, ctx);

      const result = (await callResource("menus", "m-sync", "paprika://menu/m-sync")) as {
        contents: Array<{ text: string }>;
      };
      expect(result.contents[0]?.text).toContain("**Last synced:** 2026-05-30T12:00:00.000Z");
    });

    it("renders items but omits child UIDs (includeItemUids false)", async () => {
      const { server, callResource } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
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
      registerMenuResources(server, ctx);

      const result = (await callResource("menus", "m-clean", "paprika://menu/m-clean")) as {
        contents: Array<{ text: string }>;
      };
      const text = result.contents[0]?.text ?? "";
      expect(text).toContain("- **Dinner:** Lasagna");
      expect(text).not.toContain("· item");
      expect(text).not.toContain("· recipe");
    });

    it("throws when the menu does not exist", async () => {
      const { server, callResource } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        menus: [],
        menuItems: [],
      });
      registerMenuResources(server, ctx);

      await expect(callResource("menus", "ghost", "paprika://menu/ghost")).rejects.toThrow("Menu not found: ghost");
    });
  });
});
