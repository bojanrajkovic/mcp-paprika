import { describe, it, expect } from "vitest";
import { fixture as refFixture } from "./reference.js";
import { fixture as mealFixture } from "./meals.js";
import { fixture as menuFixture } from "./menus.js";

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
  const result = (body as Record<string, unknown>)["result"];
  if (Array.isArray(result) && result.length > 0) {
    return Object.keys(result[0] as Record<string, unknown>).sort();
  }
  if (Array.isArray(body)) {
    const inner = Array.isArray(body[0]) ? body[0] : body;
    if (inner.length > 0) {
      return Object.keys(inner[0] as Record<string, unknown>).sort();
    }
  }
  return [];
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
});
