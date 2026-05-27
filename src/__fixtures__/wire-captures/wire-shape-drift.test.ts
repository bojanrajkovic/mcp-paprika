import { describe, it, expect } from "vitest";
import { fixture as refFixture } from "./reference.js";
import { fixture as mealFixture } from "./meals.js";
import { fixture as menuFixture } from "./menus.js";
import { fixture as writeFixture } from "./writes.js";

/**
 * Wire-shape drift detection tests.
 *
 * These compare the field names in our hand-rolled test fixtures and Zod
 * schemas against real Paprika API responses captured via mitmproxy. If
 * Paprika adds, removes, or renames a field, these tests surface the change.
 *
 * Note: GET responses omit `deleted` for live items (server filters them).
 * POST bodies include `deleted` because the client sends it explicitly.
 */

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

describe("wire-shape drift detection", () => {
  describe("reference endpoint GET response shapes", () => {
    it("grocery list GET fields match expected schema", () => {
      const keys = wireKeys(refFixture("GET grocery lists (startup sync)"), "response");
      expect(keys).toEqual(["is_default", "name", "order_flag", "reminders_list", "uid"]);
    });

    it("grocery aisle GET fields match expected schema", () => {
      const keys = wireKeys(refFixture("GET grocery aisles (startup sync)"), "response");
      expect(keys).toEqual(["name", "order_flag", "uid"]);
    });

    it("pantry item GET fields include all expected fields", () => {
      const keys = wireKeys(refFixture("GET pantry items (startup sync)"), "response");
      expect(keys).toContain("uid");
      expect(keys).toContain("ingredient");
      expect(keys).toContain("quantity");
      expect(keys).toContain("aisle");
      expect(keys).toContain("aisle_uid");
      expect(keys).toContain("in_stock");
      expect(keys).toContain("has_expiration");
      expect(keys).toContain("expiration_date");
      expect(keys).toContain("purchase_date");
      expect(keys).toContain("notes");
      // location_uid is present on the wire but not yet in our PantryItemSchema
      expect(keys).toContain("location_uid");
    });

    it("mealtype catalog fields match expected schema", () => {
      const keys = wireKeys(refFixture("GET meal types catalog (user-customizable, like aisles)"), "response");
      expect(keys).toEqual(["color", "export_all_day", "export_time", "name", "order_flag", "original_type", "uid"]);
    });

    it("meal GET fields include is_ingredient and scale", () => {
      const keys = wireKeys(
        refFixture("GET meals (full history, unpaginated — shows is_ingredient + scale fields)"),
        "response",
      );
      expect(keys).toEqual([
        "date",
        "is_ingredient",
        "name",
        "order_flag",
        "recipe_uid",
        "scale",
        "type",
        "type_uid",
        "uid",
      ]);
    });

    it("recipe entry list returns uid+hash pairs (not full recipes)", () => {
      const f = refFixture("GET recipe entries (uid+hash list, not full recipes)");
      const body = f.responseBody as { result: Array<Record<string, unknown>> };
      expect(Object.keys(body.result[0]!).sort()).toEqual(["hash", "uid"]);
    });

    it("individual recipe has all 28 fields", () => {
      const f = refFixture("GET individual recipe (full 28-field shape)");
      const body = f.responseBody as { result: Record<string, unknown> };
      const keys = Object.keys(body.result).sort();
      expect(keys).toEqual([
        "categories",
        "cook_time",
        "created",
        "description",
        "difficulty",
        "directions",
        "hash",
        "image_url",
        "in_trash",
        "ingredients",
        "is_pinned",
        "name",
        "notes",
        "nutritional_info",
        "on_favorites",
        "on_grocery_list",
        "photo",
        "photo_hash",
        "photo_large",
        "photo_url",
        "prep_time",
        "rating",
        "scale",
        "servings",
        "source",
        "source_url",
        "total_time",
        "uid",
      ]);
      expect(keys.length).toBe(28);
    });

    it("category GET fields match expected schema", () => {
      const keys = wireKeys(refFixture("GET categories (fully hydrated)"), "response");
      expect(keys).toEqual(["name", "order_flag", "parent_uid", "uid"]);
    });

    it("grocery ingredient GET fields match expected schema", () => {
      const keys = wireKeys(refFixture("GET grocery ingredients (aisle mapping catalog)"), "response");
      expect(keys).toEqual(["aisle_uid", "name", "uid"]);
    });

    it("photo metadata has expected fields", () => {
      const keys = wireKeys(refFixture("GET photos (recipe photo metadata)"), "response");
      expect(keys).toEqual(["filename", "hash", "name", "order_flag", "recipe_uid", "uid"]);
    });

    it("pantry locations endpoint returns 404", () => {
      const f = refFixture("GET pantry locations (404 — endpoint not implemented)");
      expect(f.status).toBe(404);
    });
  });

  describe("meal POST body shapes", () => {
    it("recipe meal has expected fields", () => {
      const keys = wireKeys(mealFixture("add recipe meal: (Not) Butter Chicken as Breakfast on 2026-05-26"), "request");
      expect(keys).toEqual(["date", "deleted", "name", "order_flag", "recipe_uid", "type", "type_uid", "uid"]);
    });

    it("freeform meal has recipe_uid as null", () => {
      const f = mealFixture("add freeform meal: [mcp-cap] sandwich as Lunch on 2026-05-26");
      const body = f.requestBody as Array<Array<Record<string, unknown>>>;
      expect(body[0]![0]!["recipe_uid"]).toBeNull();
    });
  });

  describe("menu and menuitem POST body shapes", () => {
    it("menu has expected fields", () => {
      const keys = wireKeys(menuFixture("create 1-day menu ([mcp-cap] Test Menu 1)"), "request");
      expect(keys).toEqual(["days", "deleted", "name", "notes", "order_flag", "uid"]);
    });

    it("menuitem has expected fields", () => {
      const keys = wireKeys(
        menuFixture("add menuitem: Breakfast recipe (Bacon Broccoli Cheddar Crustless Quiche) to day 1"),
        "request",
      );
      expect(keys).toEqual(["day", "deleted", "menu_uid", "name", "order_flag", "recipe_uid", "type_uid", "uid"]);
    });

    it("multi-day menuitem uses day offset (not date)", () => {
      const f = menuFixture("add menuitem: Dinner recipe (20 Minute Honey Mustard Chicken) to multi-day menu day 3");
      const body = f.requestBody as Array<Array<Record<string, unknown>>>;
      expect(body[0]![0]!["day"]).toBe(3);
      expect(body[0]![0]!).not.toHaveProperty("date");
    });
  });

  describe("sync status catalog shape", () => {
    it("contains all known entity types", () => {
      const f = refFixture("GET sync status (entity count catalog)");
      const result = (f.responseBody as { result: Record<string, number> }).result;
      expect(Object.keys(result).sort()).toEqual([
        "bookmarks",
        "categories",
        "groceries",
        "groceryaisles",
        "groceryingredients",
        "grocerylists",
        "meals",
        "mealtypes",
        "menuitems",
        "menus",
        "pantry",
        "pantrylocations",
        "photos",
        "recipes",
      ]);
    });
  });

  describe("write POST body shapes (writes.har.json)", () => {
    describe("recipe writes", () => {
      it("recipe POST body has 27 fields (omits on_grocery_list + photo_url from GET shape, adds deleted)", () => {
        const keys = wireKeys(writeFixture("create recipe ([mcp-cap] Test Recipe)"), "request");
        expect(keys).toEqual([
          "categories",
          "cook_time",
          "created",
          "deleted",
          "description",
          "difficulty",
          "directions",
          "hash",
          "image_url",
          "in_trash",
          "ingredients",
          "is_pinned",
          "name",
          "notes",
          "nutritional_info",
          "on_favorites",
          "photo",
          "photo_hash",
          "photo_large",
          "prep_time",
          "rating",
          "scale",
          "servings",
          "source",
          "source_url",
          "total_time",
          "uid",
        ]);
        expect(keys.length).toBe(27);
      });

      it("recipe edit has same shape as create", () => {
        const createKeys = wireKeys(writeFixture("create recipe ([mcp-cap] Test Recipe)"), "request");
        const editKeys = wireKeys(writeFixture("edit recipe: rating and difficulty"), "request");
        expect(editKeys).toEqual(createKeys);
      });

      it("recipe trash sets in_trash: true", () => {
        const f = writeFixture("trash recipe ([mcp-cap] Test Recipe)");
        const body = f.requestBody as Array<Record<string, unknown>>;
        expect(body[0]!["in_trash"]).toBe(true);
      });

      it("recipe POST uses singular URL (/recipe/{uid}/, not /recipes/)", () => {
        const f = writeFixture("create recipe ([mcp-cap] Test Recipe)");
        expect(f.url).toMatch(/\/sync\/recipe\/[A-F0-9-]+\/$/);
        expect(f.url).not.toContain("/recipes/");
      });
    });

    describe("photo writes", () => {
      it("photo upload has expected fields", () => {
        const keys = wireKeys(writeFixture("upload photo to recipe"), "request");
        expect(keys).toEqual(["deleted", "filename", "hash", "name", "order_flag", "recipe_uid", "uid"]);
      });

      it("photo delete is a tombstone with same shape", () => {
        const f = writeFixture("delete photo from recipe (tombstone)");
        const keys = wireKeys(f, "request");
        expect(keys).toEqual(["deleted", "filename", "hash", "name", "order_flag", "recipe_uid", "uid"]);
        const body = f.requestBody as Array<Record<string, unknown>>;
        expect(body[0]!["deleted"]).toBe(true);
      });
    });

    describe("category writes", () => {
      it("category POST body matches GET shape plus deleted", () => {
        const keys = wireKeys(writeFixture("create category ([mcp-cap] Test Category)"), "request");
        expect(keys).toEqual(["deleted", "name", "order_flag", "parent_uid", "uid"]);
      });

      it("category delete uses same shape with deleted: true", () => {
        const f = writeFixture("delete category ([mcp-cap] Renamed Category)");
        const body = f.requestBody as Array<Array<Record<string, unknown>>>;
        expect(body[0]![0]!["deleted"]).toBe(true);
      });
    });

    describe("pantry writes", () => {
      it("pantry POST body has 10 fields (omits notes + location_uid from GET shape, adds deleted)", () => {
        const keys = wireKeys(writeFixture("create pantry item (mcp-cap Test Flour)"), "request");
        expect(keys).toEqual([
          "aisle",
          "aisle_uid",
          "deleted",
          "expiration_date",
          "has_expiration",
          "in_stock",
          "ingredient",
          "purchase_date",
          "quantity",
          "uid",
        ]);
      });

      it("pantry edit/delete have same shape as create", () => {
        const createKeys = wireKeys(writeFixture("create pantry item (mcp-cap Test Flour)"), "request");
        const editKeys = wireKeys(writeFixture("edit pantry item: rename to [mcp-cap] Edited Flour"), "request");
        const deleteKeys = wireKeys(writeFixture("delete pantry item ([mcp-cap] Edited Flour)"), "request");
        expect(editKeys).toEqual(createKeys);
        expect(deleteKeys).toEqual(createKeys);
      });

      it("pantry delete uses deleted: true (soft-delete on collection URL)", () => {
        const f = writeFixture("delete pantry item ([mcp-cap] Edited Flour)");
        const body = f.requestBody as Array<Array<Record<string, unknown>>>;
        expect(body[0]![0]!["deleted"]).toBe(true);
        expect(f.url).toContain("/sync/pantry/");
      });
    });

    describe("grocery list writes", () => {
      it("grocery list POST body matches GET shape plus deleted", () => {
        const keys = wireKeys(writeFixture("create grocery list ([mcp-cap] Test List)"), "request");
        expect(keys).toEqual(["deleted", "is_default", "name", "order_flag", "reminders_list", "uid"]);
      });

      it("grocery list delete uses deleted: true", () => {
        const f = writeFixture("delete grocery list ([mcp-cap] Renamed List)");
        const body = f.requestBody as Array<Array<Record<string, unknown>>>;
        expect(body[0]![0]!["deleted"]).toBe(true);
      });
    });

    describe("grocery item writes", () => {
      it("grocery item POST body has 13 fields", () => {
        const keys = wireKeys(writeFixture("add grocery item: [mcp-cap] Milk"), "request");
        expect(keys).toEqual([
          "aisle",
          "aisle_uid",
          "deleted",
          "ingredient",
          "instruction",
          "list_uid",
          "name",
          "order_flag",
          "purchased",
          "quantity",
          "recipe",
          "separate",
          "uid",
        ]);
      });

      it("purchased update has same shape as add", () => {
        const addKeys = wireKeys(writeFixture("add grocery item: [mcp-cap] Milk"), "request");
        const purchasedKeys = wireKeys(writeFixture("mark grocery item purchased ([mcp-cap] Milk)"), "request");
        expect(purchasedKeys).toEqual(addKeys);
      });

      it("mark purchased sets purchased: true", () => {
        const f = writeFixture("mark grocery item purchased ([mcp-cap] Milk)");
        const body = f.requestBody as Array<Array<Record<string, unknown>>>;
        expect(body[0]![0]!["purchased"]).toBe(true);
      });

      it("grocery item delete uses deleted: true", () => {
        const f = writeFixture("delete grocery item ([mcp-cap] Bread)");
        const body = f.requestBody as Array<Array<Record<string, unknown>>>;
        expect(body[0]![0]!["deleted"]).toBe(true);
      });
    });

    describe("grocery ingredient writes", () => {
      it("grocery ingredient POST body has 4 fields (GET shape plus deleted)", () => {
        const keys = wireKeys(writeFixture("auto-create grocery ingredient (mcp-cap milk)"), "request");
        expect(keys).toEqual(["aisle_uid", "deleted", "name", "uid"]);
      });
    });
  });
});
