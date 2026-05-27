import { describe, it, expect } from "vitest";
import { setupServer } from "msw/node";
import { fixture as mealFixture, handlers as mealHandlers } from "./meals.js";
import { fixture as menuFixture, handlers as menuHandlers } from "./menus.js";

describe("wire capture fixtures", () => {
  describe("typed fixture access", () => {
    it("returns a meal fixture by comment key", () => {
      const f = mealFixture("add recipe meal: (Not) Butter Chicken as Breakfast on 2026-05-26");
      expect(f.method).toBe("POST");
      expect(f.url).toContain("/sync/meals/");
      expect(f.status).toBe(200);
      expect(f.requestBody).toBeDefined();
      expect(f.responseBody).toEqual({ result: true });
    });

    it("returns a freeform meal fixture", () => {
      const f = mealFixture("add freeform meal: [mcp-cap] sandwich as Lunch on 2026-05-26");
      const body = f.requestBody as Array<Array<Record<string, unknown>>>;
      expect(body[0]![0]!["recipe_uid"]).toBeNull();
      expect(body[0]![0]!["name"]).toBe("[mcp-cap] sandwich");
    });

    it("returns a menu fixture by comment key", () => {
      const f = menuFixture("create 1-day menu ([mcp-cap] Test Menu 1)");
      expect(f.method).toBe("POST");
      expect(f.url).toContain("/sync/menus/");
      const body = f.requestBody as Array<Array<Record<string, unknown>>>;
      expect(body[0]![0]!["name"]).toBe("[mcp-cap] Test Menu 1");
      expect(body[0]![0]!["days"]).toBe(1);
    });

    it("returns a multi-day menu item fixture with day offset", () => {
      const f = menuFixture("add menuitem: Dinner recipe (20 Minute Honey Mustard Chicken) to multi-day menu day 3");
      const body = f.requestBody as Array<Array<Record<string, unknown>>>;
      expect(body[0]![0]!["day"]).toBe(3);
    });
  });

  describe("MSW handler generation", () => {
    it("generates handlers from meal HAR", () => {
      expect(mealHandlers.length).toBeGreaterThan(0);
      expect(mealHandlers.length).toBe(8);
    });

    it("generates handlers from menu HAR", () => {
      expect(menuHandlers.length).toBeGreaterThan(0);
      expect(menuHandlers.length).toBe(14);
    });

    it("handlers replay recorded responses", async () => {
      const server = setupServer(...mealHandlers);
      server.listen({ onUnhandledRequest: "error" });

      try {
        const response = await fetch("https://paprikaapp.com/api/v2/sync/meals/", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
        });
        expect(response.ok).toBe(true);
        const body = (await response.json()) as Record<string, unknown>;
        expect(body).toEqual({ result: true });
      } finally {
        server.close();
      }
    });
  });
});
