import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MealTypeUid, MealUid, RecipeUid } from "../../../ids.js";
import type { MealState } from "../module.js";

import { makeMealType } from "../../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { makeMeal } from "../../../../test/domains/meal/__fixtures__/meals.js";
import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { mealToMarkdown } from "../meal-helpers.js";
import { addMealsInputSchema, updateMealInputSchema } from "./meal-writes.js";

// Stable UIDs used across all describe blocks so tests don't depend on
// the module-level counters in the fixture factories.
const BREAKFAST_UID = "breakfast-uid" as MealTypeUid;
const LUNCH_UID = "lunch-uid" as MealTypeUid;
const DINNER_UID = "dinner-uid" as MealTypeUid;
const SNACKS_UID = "snacks-uid" as MealTypeUid;
const BRUNCH_UID = "brunch-uid" as MealTypeUid;
const TACOS_UID = "tacos-recipe-uid" as RecipeUid;

function makeBuiltins() {
  return [
    makeMealType({ uid: BREAKFAST_UID, name: "Breakfast", originalType: 0, orderFlag: 0 }),
    makeMealType({ uid: LUNCH_UID, name: "Lunch", originalType: 1, orderFlag: 1 }),
    makeMealType({ uid: DINNER_UID, name: "Dinner", originalType: 2, orderFlag: 2 }),
    makeMealType({ uid: SNACKS_UID, name: "Snacks", originalType: 3, orderFlag: 3 }),
  ];
}

// ---------------------------------------------------------------------------
// plan_meals — success paths
// ---------------------------------------------------------------------------

describe("plan_meals tool — success paths", () => {
  const kh = useKernelHarness<MealState>("meal");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("recipe_uid + date + type → auto-resolved recipe name in markdown and MealStore", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    kh.seed({
      meals: [],
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
    });

    const result = await kh.callTool("plan_meals", {
      items: [{ recipe_uid: TACOS_UID, date: "2026-06-15", type: { name: "Dinner" } }],
    });
    const text = getText(result);

    // Markdown card contains the recipe name and a Recipe line linking back
    expect(text).toContain("# Tacos");
    expect(text).toContain("**Recipe:** Tacos");
    // UID is minted and appears in the card
    expect(text).toMatch(/\*\*UID:\*\* `[0-9A-F-]{36}`/);

    // Meal landed in MealStore with correct fields
    const savedPayload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<{
      uid: string;
      name: string;
      recipeUid: string | null;
    }>;
    expect(savedPayload).toHaveLength(1);
    const wireMeal = savedPayload[0]!;
    expect(wireMeal.name).toBe("Tacos");
    expect(wireMeal.recipeUid).toBe(TACOS_UID);

    // Also persisted to local store
    const store = kh.state().store;
    const storedMeal = store.get(wireMeal.uid as MealUid);
    expect(storedMeal).toBeDefined();
    expect(storedMeal?.name).toBe("Tacos");
    expect(storedMeal?.recipeUid).toBe(TACOS_UID);
  });

  it("name only (no recipe_uid) → freeform meal with recipeUid: null", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    kh.seed({
      meals: [],
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
    });

    const result = await kh.callTool("plan_meals", {
      items: [{ name: "Avocado Toast", date: "2026-06-15", type: { builtin: 0 } }],
    });
    const text = getText(result);

    expect(text).toContain("# Avocado Toast");
    expect(text).toContain("**Recipe:** _(freeform)_");

    const savedPayload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<{
      uid: string;
      recipeUid: string | null;
      name: string;
    }>;
    const wireMeal = savedPayload[0]!;
    expect(wireMeal.recipeUid).toBeNull();
    expect(wireMeal.name).toBe("Avocado Toast");

    const store = kh.state().store;
    const storedMeal = store.get(wireMeal.uid as MealUid);
    expect(storedMeal?.recipeUid).toBeNull();
  });

  it("5-item batch → single saveMeals call, 5 cards", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });

    const result = await kh.callTool("plan_meals", {
      items: [
        { name: "Sunday Dinner", date: "2026-06-15", type: { builtin: 2 } },
        { name: "Monday Dinner", date: "2026-06-16", type: { builtin: 2 } },
        { name: "Tuesday Dinner", date: "2026-06-17", type: { builtin: 2 } },
        { name: "Wednesday Dinner", date: "2026-06-18", type: { builtin: 2 } },
        { name: "Thursday Dinner", date: "2026-06-19", type: { builtin: 2 } },
      ],
    });
    const text = getText(result);

    // Single batch POST
    expect(kh.client().saveMeals).toHaveBeenCalledOnce();
    const savedPayload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<unknown>;
    expect(savedPayload).toHaveLength(5);

    // 5 markdown cards separated by ---
    expect(text).toContain("Added 5 meal(s)");
    const cardCount = (text.match(/^# /gm) ?? []).length;
    expect(cardCount).toBe(5);
    const separatorCount = (text.match(/^---$/gm) ?? []).length;
    expect(separatorCount).toBe(4);
  });

  it("schema rejects {recipe_uid, name} together at the item shape (structural union)", () => {
    const result = addMealsInputSchema.safeParse({
      items: [{ recipe_uid: TACOS_UID, name: "Custom Taco Night", date: "2026-06-15", type: { builtin: 2 } }],
    });
    expect(result.success).toBe(false);
  });

  it("scale flows through to wire payload and MealStore", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });

    await kh.callTool("plan_meals", {
      items: [{ name: "Big Batch Soup", date: "2026-06-15", type: { builtin: 1 }, scale: "2" }],
    });

    const savedPayload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<{
      uid: string;
      scale: string | null;
    }>;
    expect(savedPayload[0]?.scale).toBe("2");

    const store = kh.state().store;
    const storedMeal = store.get(savedPayload[0]!.uid as MealUid);
    expect(storedMeal?.scale).toBe("2");
  });

  it("date with time-of-day → normalized to midnight; date-only + datetime on same day share a date sequence", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });

    await kh.callTool("plan_meals", {
      items: [
        { name: "Day-only Dinner", date: "2026-06-15", type: { builtin: 2 } },
        { name: "Datetime Dinner", date: "2026-06-15T18:30:00Z", type: { builtin: 2 } },
      ],
    });

    const savedPayload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<{
      date: string;
      orderFlag: number;
    }>;
    expect(savedPayload).toHaveLength(2);
    expect(savedPayload[0]?.date).toBe("2026-06-15 00:00:00");
    expect(savedPayload[1]?.date).toBe("2026-06-15 00:00:00");
    // Same bucket → adjacent order_flags, not both 0
    expect(savedPayload[0]?.orderFlag).toBe(0);
    expect(savedPayload[1]?.orderFlag).toBe(1);
  });

  it("offset-bearing date input → stored at the input's local calendar day, not UTC-shifted", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });

    await kh.callTool("plan_meals", {
      items: [{ name: "US-Pacific Late Dinner", date: "2026-06-15T22:00:00-08:00", type: { builtin: 2 } }],
    });

    const savedPayload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<{ date: string }>;
    expect(savedPayload[0]?.date).toBe("2026-06-15 00:00:00");
  });

  it("two items on the same date → orderFlag 0 and 1", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });

    await kh.callTool("plan_meals", {
      items: [
        { name: "First Dinner", date: "2026-06-15", type: { builtin: 2 } },
        { name: "Second Dinner", date: "2026-06-15", type: { builtin: 2 } },
      ],
    });

    const savedPayload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<{ orderFlag: number }>;
    expect(savedPayload).toHaveLength(2);
    expect(savedPayload[0]?.orderFlag).toBe(0);
    expect(savedPayload[1]?.orderFlag).toBe(1);
  });

  it("two items on the same date but different meal types → orderFlag 0 and 1 (per-date, not per-type)", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });

    await kh.callTool("plan_meals", {
      items: [
        { name: "Morning Oats", date: "2026-05-26", type: { builtin: 0 } },
        { name: "Lunch Sandwich", date: "2026-05-26", type: { builtin: 1 } },
      ],
    });

    const savedPayload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<{
      typeUid: string;
      orderFlag: number;
    }>;
    expect(savedPayload).toHaveLength(2);
    expect(savedPayload[0]?.typeUid).toBe(BREAKFAST_UID);
    expect(savedPayload[1]?.typeUid).toBe(LUNCH_UID);
    expect(savedPayload[0]?.orderFlag).toBe(0);
    expect(savedPayload[1]?.orderFlag).toBe(1);
  });

  it("adding to an empty date → orderFlag: 0", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });

    await kh.callTool("plan_meals", {
      items: [{ name: "Solo Breakfast", date: "2026-07-01", type: { builtin: 0 } }],
    });

    const savedPayload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<{ orderFlag: number }>;
    expect(savedPayload[0]?.orderFlag).toBe(0);
  });

  it("{name: 'Dinner'}, {uid: <Dinner UID>}, {builtin: 2} all produce the same wire type and typeUid", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });

    await kh.callTool("plan_meals", {
      items: [{ name: "Dinner by Name", date: "2026-06-20", type: { name: "Dinner" } }],
    });
    await kh.callTool("plan_meals", {
      items: [{ name: "Dinner by UID", date: "2026-06-20", type: { uid: DINNER_UID } }],
    });
    await kh.callTool("plan_meals", {
      items: [{ name: "Dinner by Builtin", date: "2026-06-20", type: { builtin: 2 } }],
    });

    const payloadByName = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<{
      type: number;
      typeUid: string;
    }>;
    const payloadByUid = vi.mocked(kh.client().saveMeals).mock.calls[1]?.[0] as ReadonlyArray<{
      type: number;
      typeUid: string;
    }>;
    const payloadByBuiltin = vi.mocked(kh.client().saveMeals).mock.calls[2]?.[0] as ReadonlyArray<{
      type: number;
      typeUid: string;
    }>;

    const mealByName = payloadByName[0]!;
    const mealByUid = payloadByUid[0]!;
    const mealByBuiltin = payloadByBuiltin[0]!;

    expect(mealByUid.type).toBe(mealByName.type);
    expect(mealByBuiltin.type).toBe(mealByName.type);
    expect(mealByName.type).toBe(2);

    expect(mealByUid.typeUid).toBe(mealByName.typeUid);
    expect(mealByBuiltin.typeUid).toBe(mealByName.typeUid);
    expect(mealByName.typeUid).toBe(DINNER_UID);
  });

  it("existing meal with orderFlag 5 in bucket → new meal gets orderFlag 6", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    kh.seed({
      meals: [
        makeMeal({
          uid: "existing-dinner-uid" as MealUid,
          date: "2026-06-25 00:00:00",
          typeUid: DINNER_UID,
          type: 2,
          orderFlag: 5,
        }),
      ],
      mealTypes: makeBuiltins(),
      recipes: [],
    });

    await kh.callTool("plan_meals", {
      items: [{ name: "Late Addition", date: "2026-06-25", type: { builtin: 2 } }],
    });

    const savedPayload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<{ orderFlag: number }>;
    expect(savedPayload[0]?.orderFlag).toBe(6);
  });

  it("custom meal type → wire payload sets type_uid + sends vestigial type:0", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    kh.seed({
      meals: [],
      mealTypes: [
        ...makeBuiltins(),
        makeMealType({ uid: BRUNCH_UID, name: "Brunch", originalType: null, orderFlag: 4 }),
      ],
      recipes: [],
    });

    await kh.callTool("plan_meals", {
      items: [{ name: "Sunday Brunch", date: "2026-07-04", type: { uid: BRUNCH_UID } }],
    });

    const savedPayload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<{
      typeUid: string;
      type: number;
    }>;
    expect(savedPayload[0]?.typeUid).toBe(BRUNCH_UID);
    expect(savedPayload[0]?.type).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// plan_meals — failure paths
// ---------------------------------------------------------------------------

describe("plan_meals tool — failure paths", () => {
  const kh = useKernelHarness<MealState>("meal");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("unparseable date → error text names index and bad date value", async () => {
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });
    const storeBefore = kh.state().store.size;

    const result = await kh.callTool("plan_meals", {
      items: [{ recipe_uid: TACOS_UID, date: "not-a-date", type: { builtin: 2 } }],
    });
    const text = getText(result);

    expect(text).toContain('Item 0: could not parse date "not-a-date"');
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
    expect(kh.state().store.size).toBe(storeBefore);
  });

  it("schema rejects items missing both recipe_uid and name (structural union)", () => {
    const result = addMealsInputSchema.safeParse({ items: [{ date: "2026-06-15", type: { builtin: 0 } }] });
    expect(result.success).toBe(false);
  });

  it("unknown recipe_uid (not in local store) → per-index error, saveMeals NOT called", async () => {
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });
    const storeBefore = kh.state().store.size;

    const result = await kh.callTool("plan_meals", {
      items: [{ recipe_uid: TACOS_UID, date: "2026-06-15", type: { builtin: 2 } }],
    });
    const text = getText(result);

    expect(text).toContain("is not known to the local recipe store");
    expect(text).toContain("wait for the next sync and retry");
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
    expect(kh.state().store.size).toBe(storeBefore);
  });

  it("multiple invalid items → all errors enumerated, header 'Could not add 3 meals:'", async () => {
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });
    const storeBefore = kh.state().store.size;

    const result = await kh.callTool("plan_meals", {
      items: [
        { name: "Bad Date Item", date: "bad", type: { builtin: 2 } },
        { name: "Good Date Bad Type", date: "2026-06-15", type: { uid: "NOPE" as MealTypeUid } },
        { name: "Also Bad Date", date: "also-bad", type: { builtin: 0 } },
      ],
    });
    const text = getText(result);

    expect(text).toContain("Could not add 3 meals:");
    expect(text).toContain('could not parse date "bad"');
    expect(text).toContain('unknown meal type UID "NOPE"');
    expect(text).toContain('could not parse date "also-bad"');
    expect(text).toContain("Item 0:");
    expect(text).toContain("Item 1:");
    expect(text).toContain("Item 2:");
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
    expect(kh.state().store.size).toBe(storeBefore);
  });

  it("empty items array → Zod .min(1) rejects before the handler runs", () => {
    const result = addMealsInputSchema.safeParse({ items: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      const hasMinError = messages.some((m) => m.toLowerCase().includes("at least one meal item"));
      expect(hasMinError).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// update_meal — success paths
// ---------------------------------------------------------------------------

const TEST_MEAL_UID = "test-meal-uid-update-1" as MealUid;

describe("update_meal — success paths", () => {
  const kh = useKernelHarness<MealState>("meal");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("date is rejected on the update payload — rescheduling is promoted to reschedule_meal", () => {
    expect(updateMealInputSchema.safeParse({ uid: TEST_MEAL_UID, update: { date: "2026-06-15" } }).success).toBe(false);
  });

  it("type update → typeUid becomes LUNCH_UID and type integer becomes 1", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    const original = makeMeal({ uid: TEST_MEAL_UID, typeUid: DINNER_UID, type: 2 });
    kh.seed({ meals: [original], mealTypes: makeBuiltins(), recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })] });

    await kh.callTool("update_meal", { uid: TEST_MEAL_UID, update: { type: { name: "Lunch" } } });

    const store = kh.state().store;
    const stored = store.get(TEST_MEAL_UID);
    expect(stored?.typeUid).toBe(LUNCH_UID);
    expect(stored?.type).toBe(1);
  });

  it("freeform meal + recipe_uid → auto-resolved name from store, recipeUid set", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    const original = makeMeal({ uid: TEST_MEAL_UID, recipeUid: null, name: "Some Freeform Meal" });
    kh.seed({ meals: [original], mealTypes: makeBuiltins(), recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })] });

    await kh.callTool("update_meal", { uid: TEST_MEAL_UID, update: { recipe_uid: TACOS_UID } });

    const store = kh.state().store;
    const stored = store.get(TEST_MEAL_UID);
    expect(stored?.recipeUid).toBe(TACOS_UID);
    expect(stored?.name).toBe("Tacos");
  });

  it("schema rejects update with {recipe_uid: <UID>, name: <X>} (structural union)", () => {
    const result = updateMealInputSchema.safeParse({
      uid: TEST_MEAL_UID,
      update: { recipe_uid: TACOS_UID, name: "Custom Name" },
    });
    expect(result.success).toBe(false);
  });

  it("recipe meal + recipe_uid: null + name → demoted to freeform, new name set", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    const original = makeMeal({ uid: TEST_MEAL_UID, recipeUid: TACOS_UID, name: "Tacos" });
    kh.seed({ meals: [original], mealTypes: makeBuiltins(), recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })] });

    await kh.callTool("update_meal", { uid: TEST_MEAL_UID, update: { recipe_uid: null, name: "Leftover Chili" } });

    const store = kh.state().store;
    const stored = store.get(TEST_MEAL_UID);
    expect(stored?.recipeUid).toBeNull();
    expect(stored?.name).toBe("Leftover Chili");
  });

  it("scale: null → clears scale in MealStore AND on wire payload", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    const original = makeMeal({ uid: TEST_MEAL_UID, scale: "2", recipeUid: null });
    kh.seed({ meals: [original], mealTypes: makeBuiltins(), recipes: [] });

    await kh.callTool("update_meal", { uid: TEST_MEAL_UID, update: { scale: null } });

    const store = kh.state().store;
    const stored = store.get(TEST_MEAL_UID);
    expect(stored?.scale).toBeNull();

    const payload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<{ scale: string | null }>;
    expect(payload[0]?.scale).toBeNull();
  });

  it("update to a custom meal type → wire payload sets type_uid + sends vestigial type:0", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    const original = makeMeal({ uid: TEST_MEAL_UID, typeUid: DINNER_UID, type: 2 });
    kh.seed({
      meals: [original],
      mealTypes: [
        ...makeBuiltins(),
        makeMealType({ uid: BRUNCH_UID, name: "Brunch", originalType: null, orderFlag: 4 }),
      ],
      recipes: [],
    });

    await kh.callTool("update_meal", { uid: TEST_MEAL_UID, update: { type: { uid: BRUNCH_UID } } });

    const store = kh.state().store;
    const stored = store.get(TEST_MEAL_UID);
    expect(stored?.typeUid).toBe(BRUNCH_UID);
    expect(stored?.type).toBe(0);

    const payload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<{
      typeUid: string;
      type: number;
    }>;
    expect(payload[0]?.typeUid).toBe(BRUNCH_UID);
    expect(payload[0]?.type).toBe(0);
  });

  it("changing only the meal type (same date) → orderFlag preserved (per-date, not per-type)", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    const sameDateExisting = makeMeal({
      uid: "existing-breakfast-uid" as MealUid,
      typeUid: BREAKFAST_UID,
      type: 0,
      date: "2026-06-15 00:00:00",
      orderFlag: 0,
    });
    const original = makeMeal({
      uid: TEST_MEAL_UID,
      typeUid: LUNCH_UID,
      type: 1,
      date: "2026-06-15 00:00:00",
      orderFlag: 1,
    });
    kh.seed({ meals: [sameDateExisting, original], mealTypes: makeBuiltins(), recipes: [] });

    await kh.callTool("update_meal", { uid: TEST_MEAL_UID, update: { type: { name: "Dinner" } } });

    const store = kh.state().store;
    const stored = store.get(TEST_MEAL_UID);
    expect(stored?.typeUid).toBe(DINNER_UID);
    expect(stored?.orderFlag).toBe(1); // unchanged — same date, no re-sequence
  });

  it("update without changing date → orderFlag preserved (keep-the-position)", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    const original = makeMeal({
      uid: TEST_MEAL_UID,
      typeUid: DINNER_UID,
      type: 2,
      date: "2026-06-15 00:00:00",
      orderFlag: 7,
      scale: "1",
    });
    kh.seed({ meals: [original], mealTypes: makeBuiltins(), recipes: [] });

    await kh.callTool("update_meal", { uid: TEST_MEAL_UID, update: { scale: "2" } });

    const store = kh.state().store;
    const stored = store.get(TEST_MEAL_UID);
    expect(stored?.orderFlag).toBe(7); // unchanged
    expect(stored?.scale).toBe("2");
  });

  it("name-only update on a recipe-linked meal → runtime rejection ('demote first'); no POST", async () => {
    const recipeLinked = makeMeal({
      uid: TEST_MEAL_UID,
      recipeUid: TACOS_UID,
      name: "Tacos",
    });
    kh.seed({
      meals: [recipeLinked],
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
    });

    const result = await kh.callTool("update_meal", {
      uid: TEST_MEAL_UID,
      update: { name: "Mom's Tacos" },
    });
    const text = getText(result);

    expect(text).toContain("Cannot set name on the recipe-linked meal");
    expect(text).toContain("demote first");
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
    const store = kh.state().store;
    expect(store.get(TEST_MEAL_UID)?.name).toBe("Tacos");
  });

  it("no-effective-change update_meal call → short-circuits without POST or notifySync", async () => {
    const original = makeMeal({
      uid: TEST_MEAL_UID,
      typeUid: DINNER_UID,
      type: 2,
      date: "2026-06-15 00:00:00",
      name: "Existing",
      orderFlag: 3,
      scale: null,
    });
    kh.seed({ meals: [original], mealTypes: makeBuiltins(), recipes: [] });

    const result = await kh.callTool("update_meal", { uid: TEST_MEAL_UID, update: {} });

    expect(kh.client().saveMeals).not.toHaveBeenCalled();
    expect(kh.client().notifySync).not.toHaveBeenCalled();
    const text = getText(result);
    expect(text).toContain("Existing");
  });
});

// ---------------------------------------------------------------------------
// update_meal — failure/edge paths
// ---------------------------------------------------------------------------

describe("update_meal — failure/edge paths", () => {
  const kh = useKernelHarness<MealState>("meal");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("unknown UID → 'No meal found...' error, no POST", async () => {
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });

    const result = await kh.callTool("update_meal", { uid: "UNKNOWN-UID" as MealUid, update: { name: "Anything" } });
    const text = getText(result);

    expect(text).toBe('No meal found with UID "UNKNOWN-UID" (it may not exist or was already deleted).');
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });

  it("miss after store.delete() → widened miss message, no POST", async () => {
    const meal = makeMeal({ uid: TEST_MEAL_UID });
    kh.seed({ meals: [meal], mealTypes: makeBuiltins(), recipes: [] });
    kh.state().store.delete(TEST_MEAL_UID);

    const result = await kh.callTool("update_meal", { uid: TEST_MEAL_UID, update: { name: "Anything" } });
    const text = getText(result);

    expect(text).toBe(`No meal found with UID "${TEST_MEAL_UID}" (it may not exist or was already deleted).`);
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });

  it("freeform meal + recipe_uid: null + no other fields → no POST, returns existing card", async () => {
    const meal = makeMeal({ uid: TEST_MEAL_UID, recipeUid: null, typeUid: DINNER_UID, type: 2 });
    kh.seed({ meals: [meal], mealTypes: makeBuiltins(), recipes: [] });

    const result = await kh.callTool("update_meal", { uid: TEST_MEAL_UID, update: { recipe_uid: null } });
    const text = getText(result);

    expect(kh.client().saveMeals).not.toHaveBeenCalled();
    const expectedCard = mealToMarkdown(meal, "Dinner", null);
    expect(text).toBe(expectedCard);
  });

  it("recipe meal + recipe_uid: null + no name → demotion error, no POST", async () => {
    const meal = makeMeal({ uid: TEST_MEAL_UID, recipeUid: TACOS_UID, name: "Tacos" });
    kh.seed({ meals: [meal], mealTypes: makeBuiltins(), recipes: [] });

    const result = await kh.callTool("update_meal", { uid: TEST_MEAL_UID, update: { recipe_uid: null } });
    const text = getText(result);

    expect(text).toBe(
      `Demoting a recipe meal to freeform requires an explicit name. Add 'name: "<your label>"' to the call.`,
    );
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });

  it("already-freeform meal + recipe_uid: null + scale: '2' → scale updates, no demotion error", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    const meal = makeMeal({ uid: TEST_MEAL_UID, recipeUid: null, name: "Cereal", scale: null });
    kh.seed({ meals: [meal], mealTypes: makeBuiltins(), recipes: [] });

    const result = await kh.callTool("update_meal", { uid: TEST_MEAL_UID, update: { recipe_uid: null, scale: "2" } });
    const text = getText(result);

    expect(text).not.toContain("Demoting a recipe meal to freeform requires an explicit name");
    expect(kh.client().saveMeals).toHaveBeenCalledTimes(1);
    const store = kh.state().store;
    expect(store.get(TEST_MEAL_UID)?.scale).toBe("2");
    expect(store.get(TEST_MEAL_UID)?.recipeUid).toBeNull();
    expect(store.get(TEST_MEAL_UID)?.name).toBe("Cereal");
  });
});

// ---------------------------------------------------------------------------
// delete_meal
// ---------------------------------------------------------------------------

const DELETE_MEAL_UID = "delete-meal-uid-1" as MealUid;

describe("delete_meal", () => {
  const kh = useKernelHarness<MealState>("meal");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("happy path — wire payload has deleted: true, store removes UID, returns success message", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    const meal = makeMeal({ uid: DELETE_MEAL_UID, name: "Tacos", date: "2026-06-15 18:00:00", deleted: false });
    kh.seed({ meals: [meal], mealTypes: makeBuiltins(), recipes: [] });

    const result = await kh.callTool("delete_meal", { uid: DELETE_MEAL_UID });
    const text = getText(result);

    expect(text).toBe(`Meal "Tacos" on 2026-06-15 18:00:00 deleted.`);

    const payload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<{ deleted: boolean }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]?.deleted).toBe(true);

    const store = kh.state().store;
    expect(store.get(DELETE_MEAL_UID)).toBeUndefined();
  });

  it("retry after delete returns miss message, saveMeals NOT called again", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    const meal = makeMeal({ uid: DELETE_MEAL_UID, name: "Tacos", date: "2026-06-15 18:00:00", deleted: false });
    kh.seed({ meals: [meal], mealTypes: makeBuiltins(), recipes: [] });

    await kh.callTool("delete_meal", { uid: DELETE_MEAL_UID });

    const result = await kh.callTool("delete_meal", { uid: DELETE_MEAL_UID });
    const text = getText(result);

    expect(text).toBe(`No meal found with UID "${DELETE_MEAL_UID}" (it may not exist or was already deleted).`);
    expect(vi.mocked(kh.client().saveMeals).mock.calls.length).toBe(1);
  });

  it("unknown UID — 'No meal found...' error, saveMeals NOT called", async () => {
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });

    const result = await kh.callTool("delete_meal", { uid: "UNKNOWN" as MealUid });
    const text = getText(result);

    expect(text).toBe(`No meal found with UID "UNKNOWN" (it may not exist or was already deleted).`);
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// meal-type auto-create — plan_meals (batch) + update_meal (single)
// ---------------------------------------------------------------------------

describe("plan_meals / update_meal — meal-type auto-create", () => {
  const kh = useKernelHarness<MealState>("meal");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("plan_meals: unknown type {name} auto-creates a custom type and schedules the meal with it", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    vi.mocked(kh.client().saveMealType).mockImplementation((mt) => okAsync(mt));
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })] });

    await kh.callTool("plan_meals", {
      items: [{ recipe_uid: TACOS_UID, date: "2026-06-15", type: { name: "Brunch" } }],
    });

    // The custom type was POSTed as a custom type (originalType null), defaults applied,
    // order_flag = max(builtins 0..3) + 1 = 4.
    expect(kh.client().saveMealType).toHaveBeenCalledOnce();
    const createdType = vi.mocked(kh.client().saveMealType).mock.calls[0]![0];
    expect(createdType.name).toBe("Brunch");
    expect(createdType.originalType).toBeNull();
    expect(createdType.color).toBe("#000000");
    expect(createdType.orderFlag).toBe(4);

    // The scheduled meal references the created type's uid.
    const savedMeal = vi.mocked(kh.client().saveMeals).mock.calls[0]![0][0]!;
    expect(savedMeal.typeUid).toBe(createdType.uid);
  });

  it("plan_meals: same new {name} across items (case-insensitive) creates the type once", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    vi.mocked(kh.client().saveMealType).mockImplementation((mt) => okAsync(mt));
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });

    await kh.callTool("plan_meals", {
      items: [
        { name: "Toast", date: "2026-06-15", type: { name: "Brunch" } },
        { name: "Eggs", date: "2026-06-16", type: { name: "brunch" } },
      ],
    });

    expect(kh.client().saveMealType).toHaveBeenCalledOnce();
  });

  it("plan_meals: a batch rejected in validation creates NO meal type (pure-validate-first)", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    vi.mocked(kh.client().saveMealType).mockImplementation((mt) => okAsync(mt));
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });

    const result = await kh.callTool("plan_meals", {
      items: [
        { name: "Toast", date: "2026-06-15", type: { name: "Brunch" } },
        { name: "Eggs", date: "not-a-date", type: { builtin: 0 } },
      ],
    });
    const text = getText(result);

    // Validation rejects the whole batch BEFORE any create — no orphan type, no meals.
    expect(text).toContain("Could not add");
    expect(kh.client().saveMealType).not.toHaveBeenCalled();
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });

  it("plan_meals: unknown {uid} still errors (auto-create is name-only)", async () => {
    vi.mocked(kh.client().saveMealType).mockImplementation((mt) => okAsync(mt));
    kh.seed({ meals: [], mealTypes: makeBuiltins(), recipes: [] });

    const result = await kh.callTool("plan_meals", {
      items: [{ name: "Toast", date: "2026-06-15", type: { uid: "NOPE" as MealTypeUid } }],
    });
    const text = getText(result);

    expect(text).toContain("unknown meal type UID");
    expect(kh.client().saveMealType).not.toHaveBeenCalled();
  });

  it("update_meal: unknown type {name} auto-creates it", async () => {
    const mealUid = "meal-update-brunch" as MealUid;
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    vi.mocked(kh.client().saveMealType).mockImplementation((mt) => okAsync(mt));
    kh.seed({
      meals: [makeMeal({ uid: mealUid, typeUid: DINNER_UID, type: 2 })],
      mealTypes: makeBuiltins(),
      recipes: [],
    });

    await kh.callTool("update_meal", { uid: mealUid, update: { type: { name: "Brunch" } } });

    expect(kh.client().saveMealType).toHaveBeenCalledOnce();
    expect(vi.mocked(kh.client().saveMealType).mock.calls[0]![0].name).toBe("Brunch");
  });

  it("update_meal: a rejected update (unknown recipe) with a new type {name} creates NO type", async () => {
    const mealUid = "meal-reject-orphan" as MealUid;
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    vi.mocked(kh.client().saveMealType).mockImplementation((mt) => okAsync(mt));
    kh.seed({
      meals: [makeMeal({ uid: mealUid, typeUid: DINNER_UID, type: 2 })],
      mealTypes: makeBuiltins(),
      recipes: [],
    });

    const result = await kh.callTool("update_meal", {
      uid: mealUid,
      update: { recipe_uid: "ghost-recipe" as RecipeUid, type: { name: "Brunch" } },
    });
    const text = getText(result);

    // Validation rejects before the type is created → no orphan type.
    expect(text).toContain("is not known to the local recipe store");
    expect(kh.client().saveMealType).not.toHaveBeenCalled();
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });
});
