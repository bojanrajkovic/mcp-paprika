import { beforeEach, describe, expect, it } from "vitest";

import type { MealTypeUid } from "../ids.js";
import type { ServerContext } from "../types/server-context.js";

import { makeMeal, makeMealType } from "../cache/__fixtures__/meals.js";
import { RecipeStore } from "../recipe/store.js";
import { registerMealHistoryTool } from "./meal-history.js";
import { getText, makeCtx, makeTestServer, seed } from "./tool-test-utils.js";

describe("list_meal_history tool", () => {
  let ctx: ServerContext;
  let callTool: ReturnType<typeof makeTestServer>["callTool"];

  beforeEach(() => {
    const { server, callTool: ct } = makeTestServer();
    callTool = ct;
    ctx = seed(makeCtx(new RecipeStore(), server), {
      // Recipe store is synced (markSynced equivalent: pass empty recipes array)
      recipes: [],
      mealTypes: [
        makeMealType({ uid: "breakfast-uid" as MealTypeUid, name: "Breakfast", originalType: 0, orderFlag: 0 }),
        makeMealType({ uid: "lunch-uid" as MealTypeUid, name: "Lunch", originalType: 1, orderFlag: 1 }),
        makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", originalType: 2, orderFlag: 2 }),
      ],
      // meals key omitted → mealStore stays cold (hasSynced === false) until individual tests seed it
    });
    registerMealHistoryTool(server, ctx);
  });

  it("returns cold-start guard when not synced", async () => {
    const result = await callTool("list_meal_history", {});
    expect(getText(result)).toContain("not yet synced");
  });

  it("returns no meals message when empty", async () => {
    seed(ctx, { meals: [] });
    const result = await callTool("list_meal_history", {
      since: "2026-01-01",
      until: "2026-12-31",
    });
    expect(getText(result)).toContain("No meals found");
  });

  it("renders calendar-style grouped output", async () => {
    seed(ctx, {
      meals: [
        makeMeal({
          recipeUid: "recipe-1",
          name: "Chicken Soup",
          date: "2026-05-20 00:00:00",
          type: 2,
          typeUid: "dinner-uid",
        }),
        makeMeal({
          recipeUid: null,
          name: "Leftovers",
          date: "2026-05-20 00:00:00",
          type: 1,
          typeUid: "lunch-uid",
        }),
      ],
    });

    const result = await callTool("list_meal_history", {
      since: "2026-05-19",
      until: "2026-05-21",
    });
    const text = getText(result);
    expect(text).toContain("Showing 2 meals");
    expect(text).toContain("### Wed 20");
    expect(text).toContain("**Lunch** · Leftovers *(freeform)*");
    expect(text).toContain("**Dinner** · Chicken Soup");
  });

  it("filters by recipe_uid across all time", async () => {
    seed(ctx, {
      meals: [
        makeMeal({ recipeUid: "recipe-1", name: "Chicken", date: "2020-01-01 00:00:00" }),
        makeMeal({ recipeUid: "recipe-2", name: "Pasta", date: "2026-05-20 00:00:00" }),
      ],
    });

    const result = await callTool("list_meal_history", { recipe_uid: "recipe-1" });
    const text = getText(result);
    expect(text).toContain("Chicken");
    expect(text).not.toContain("Pasta");
  });

  it("filters by type name", async () => {
    seed(ctx, {
      meals: [
        makeMeal({ name: "Eggs", date: "2026-05-20 00:00:00", type: 0, typeUid: "breakfast-uid" }),
        makeMeal({ name: "Steak", date: "2026-05-20 00:00:00", type: 2, typeUid: "dinner-uid" }),
      ],
    });

    const result = await callTool("list_meal_history", { type: { name: "Breakfast" } });
    const text = getText(result);
    expect(text).toContain("Eggs");
    expect(text).not.toContain("Steak");
  });

  it("returns error for unknown type name with rich remediation hint", async () => {
    seed(ctx, { meals: [] });
    const result = await callTool("list_meal_history", { type: { name: "Brunch" } });
    const text = getText(result);
    // Rich error texture back-ported from the write tools (#141): name the bad
    // input, list the known types, and point at the alternate discriminators.
    expect(text).toContain('Unknown meal type "Brunch"');
    expect(text).toContain("Known types: Breakfast, Lunch, Dinner");
    expect(text).toContain("Use the {uid} or {builtin} discriminator to reference a custom meal type.");
  });

  it("returns error for unknown type uid", async () => {
    // Convergence (#141): an unknown {uid} filter now errors instead of silently
    // filtering by the literal uid and returning "No meals found" — matching the
    // {name}/{builtin} branches and the write side.
    seed(ctx, {
      meals: [makeMeal({ name: "Steak", date: "2026-05-20 00:00:00", type: 2, typeUid: "dinner-uid" })],
    });
    const result = await callTool("list_meal_history", { type: { uid: "nonexistent-uid" } });
    expect(getText(result)).toContain('Unknown meal type UID "nonexistent-uid"');
  });

  it("returns error for unknown builtin index", async () => {
    // mealTypeStore is seeded with Breakfast(0), Lunch(1), Dinner(2) but no
    // Snacks(3), so builtin: 3 resolves to nothing.
    seed(ctx, { meals: [] });
    const result = await callTool("list_meal_history", { type: { builtin: 3 } });
    const text = getText(result);
    expect(text).toContain("No built-in meal type found with index 3");
    expect(text).toContain("0=Breakfast, 1=Lunch, 2=Dinner, 3=Snacks");
  });

  it("filters by uid directly", async () => {
    seed(ctx, {
      meals: [
        makeMeal({ name: "Eggs", date: "2026-05-20 00:00:00", type: 0, typeUid: "breakfast-uid" }),
        makeMeal({ name: "Steak", date: "2026-05-20 00:00:00", type: 2, typeUid: "dinner-uid" }),
      ],
    });

    const result = await callTool("list_meal_history", { type: { uid: "dinner-uid" } });
    const text = getText(result);
    expect(text).toContain("Steak");
    expect(text).not.toContain("Eggs");
  });

  it("resolves type by builtin integer", async () => {
    seed(ctx, {
      meals: [
        makeMeal({ name: "Eggs", date: "2026-05-20 00:00:00", type: 0, typeUid: "breakfast-uid" }),
        makeMeal({ name: "Steak", date: "2026-05-20 00:00:00", type: 2, typeUid: "dinner-uid" }),
      ],
    });

    const result = await callTool("list_meal_history", { type: { builtin: 0 } });
    const text = getText(result);
    expect(text).toContain("Eggs");
    expect(text).not.toContain("Steak");
  });

  it("annotates freeform meals", async () => {
    seed(ctx, {
      meals: [
        makeMeal({ recipeUid: null, name: "Quick sandwich", date: "2026-05-20 00:00:00" }),
        makeMeal({ recipeUid: "recipe-1", name: "Chicken Soup", date: "2026-05-20 00:00:00" }),
      ],
    });

    const result = await callTool("list_meal_history", {
      since: "2026-05-19",
      until: "2026-05-21",
    });
    const text = getText(result);
    expect(text).toContain("Quick sandwich *(freeform)*");
    expect(text).not.toContain("Chicken Soup *(freeform)*");
  });

  it("shows pagination header when total exceeds limit", async () => {
    const meals = Array.from({ length: 5 }, (_, i) =>
      makeMeal({
        name: `Meal ${String(i)}`,
        date: `2026-05-${String(20 + i).padStart(2, "0")} 00:00:00`,
      }),
    );
    seed(ctx, { meals });

    const result = await callTool("list_meal_history", {
      since: "2026-05-19",
      until: "2026-05-30",
      limit: 2,
    });
    const text = getText(result);
    expect(text).toContain("1–2 of 5");
  });

  it("parses since/until date errors", async () => {
    seed(ctx, { meals: [] });

    const result = await callTool("list_meal_history", { since: "not-a-date" });
    expect(getText(result)).toContain("Could not parse since date");
  });

  it("renders correct header when nonzero offset and total <= limit", async () => {
    // 3 meals, offset 1, default limit 50 — header must reflect the actual
    // sliced subset (entries 2–3 of 3), not "Showing 3 meals" matching the
    // total.
    const meals = Array.from({ length: 3 }, (_, i) =>
      makeMeal({
        name: `Meal ${String(i)}`,
        date: `2026-05-${String(20 + i).padStart(2, "0")} 00:00:00`,
      }),
    );
    seed(ctx, { meals });

    const result = await callTool("list_meal_history", {
      since: "2026-05-19",
      until: "2026-05-30",
      offset: 1,
    });
    const text = getText(result);
    expect(text).toContain("2–3 of 3");
    expect(text).not.toMatch(/Showing 3 meals \(/);
  });

  it("returns empty-page message when offset is past the end", async () => {
    seed(ctx, { meals: [makeMeal({ name: "Only Meal", date: "2026-05-20 00:00:00" })] });

    const result = await callTool("list_meal_history", {
      since: "2026-05-19",
      until: "2026-05-30",
      offset: 5,
    });
    expect(getText(result)).toContain("No meals at offset 5 of 1 total");
  });
});
