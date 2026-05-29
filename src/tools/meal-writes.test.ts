// pattern: Imperative Shell tests
import { fromAny } from "@total-typescript/shoehorn";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { MealStore } from "../cache/meal-store.js";
import { MealTypeStore } from "../cache/meal-type-store.js";
import { makeMeal, makeMealType } from "../cache/__fixtures__/meals.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { registerAddMealsTool } from "./meal-writes.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import type { MealTypeUid, RecipeUid, MealUid, Meal } from "../paprika/types.js";

// Stable UIDs used across both describe blocks so tests don't depend on
// the module-level counters in the fixture factories.
const BREAKFAST_UID = "breakfast-uid" as MealTypeUid;
const LUNCH_UID = "lunch-uid" as MealTypeUid;
const DINNER_UID = "dinner-uid" as MealTypeUid;
const SNACKS_UID = "snacks-uid" as MealTypeUid;
const TACOS_UID = "tacos-recipe-uid" as RecipeUid;

/**
 * Builds the four canonical built-in meal types. Passed to
 * `mealTypeStore.load()` in every beforeEach; keeps test bodies slim.
 */
function makeBuiltins() {
  return [
    makeMealType({ uid: BREAKFAST_UID, name: "Breakfast", originalType: 0, orderFlag: 0 }),
    makeMealType({ uid: LUNCH_UID, name: "Lunch", originalType: 1, orderFlag: 1 }),
    makeMealType({ uid: DINNER_UID, name: "Dinner", originalType: 2, orderFlag: 2 }),
    makeMealType({ uid: SNACKS_UID, name: "Snacks", originalType: 3, orderFlag: 3 }),
  ];
}

// ---------------------------------------------------------------------------
// Success paths
// ---------------------------------------------------------------------------

describe("add_meals tool — success paths", () => {
  let mealStore: MealStore;
  let mealTypeStore: MealTypeStore;
  let store: RecipeStore;

  let mockSaveMeals: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockPut: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mealStore = new MealStore();
    mealTypeStore = new MealTypeStore();
    store = new RecipeStore();

    // Mark stores as synced with their initial state.
    mealStore.load([]);
    mealTypeStore.load(makeBuiltins());
    store.load([makeRecipe({ uid: TACOS_UID, name: "Tacos" })], []);

    mockSaveMeals = vi.fn().mockImplementation(async (items: ReadonlyArray<Meal>) => items);
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockPut = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);
  });

  function makeAddCtx() {
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      mealStore,
      mealTypeStore,
      client: fromAny({ saveMeals: mockSaveMeals, notifySync: mockNotifySync }),
      cache: fromAny({ meals: { put: mockPut, remove: vi.fn() }, flush: mockFlush }),
    });
    registerAddMealsTool(server, ctx);
    return { callTool, ctx };
  }

  it("AC1.1: recipe_uid + date + type → auto-resolved recipe name in markdown and MealStore", async () => {
    const { callTool } = makeAddCtx();

    const result = await callTool("add_meals", {
      items: [{ recipe_uid: TACOS_UID, date: "2026-06-15", type: { name: "Dinner" } }],
    });
    const text = getText(result);

    // Markdown card contains the recipe name and a Recipe line linking back
    expect(text).toContain("# Tacos");
    expect(text).toContain("**Recipe:** Tacos");
    // UID is minted and appears in the card
    expect(text).toMatch(/\*\*UID:\*\* `[0-9A-F-]{36}`/);

    // Meal landed in MealStore with correct fields
    const savedPayload: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[0]?.[0] ?? [];
    expect(savedPayload).toHaveLength(1);
    const wireMeal = savedPayload[0]!;
    expect(wireMeal.name).toBe("Tacos");
    expect(wireMeal.recipeUid).toBe(TACOS_UID);

    // Also persisted to local store
    const storedMeal = mealStore.get(wireMeal.uid as MealUid);
    expect(storedMeal).toBeDefined();
    expect(storedMeal?.name).toBe("Tacos");
    expect(storedMeal?.recipeUid).toBe(TACOS_UID);
  });

  it("AC1.2: name only (no recipe_uid) → freeform meal with recipeUid: null", async () => {
    const { callTool } = makeAddCtx();

    const result = await callTool("add_meals", {
      items: [{ name: "Avocado Toast", date: "2026-06-15", type: { builtin: 0 } }],
    });
    const text = getText(result);

    expect(text).toContain("# Avocado Toast");
    expect(text).toContain("**Recipe:** _(freeform)_");

    const savedPayload: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[0]?.[0] ?? [];
    const wireMeal = savedPayload[0]!;
    expect(wireMeal.recipeUid).toBeNull();
    expect(wireMeal.name).toBe("Avocado Toast");

    const storedMeal = mealStore.get(wireMeal.uid as MealUid);
    expect(storedMeal?.recipeUid).toBeNull();
  });

  it("AC1.3: 5-item batch → single saveMeals call, single flush, 5 cards", async () => {
    const { callTool } = makeAddCtx();

    const result = await callTool("add_meals", {
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
    expect(mockSaveMeals).toHaveBeenCalledOnce();
    const savedPayload: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[0]?.[0] ?? [];
    expect(savedPayload).toHaveLength(5);

    // Single flush (commitMealsBatch batches all cache writes before one flush)
    expect(mockFlush).toHaveBeenCalledOnce();

    // 5 markdown cards separated by ---
    expect(text).toContain("Added 5 meal(s)");
    const cardCount = (text.match(/^# /gm) ?? []).length;
    expect(cardCount).toBe(5);
    const separatorCount = (text.match(/^---$/gm) ?? []).length;
    expect(separatorCount).toBe(4);
  });

  it("AC1.4: recipe_uid AND explicit name → caller-supplied name wins over recipe name", async () => {
    const { callTool } = makeAddCtx();

    await callTool("add_meals", {
      items: [{ recipe_uid: TACOS_UID, name: "Custom Taco Night", date: "2026-06-15", type: { builtin: 2 } }],
    });

    const savedPayload: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[0]?.[0] ?? [];
    const wireMeal = savedPayload[0]!;
    expect(wireMeal.name).toBe("Custom Taco Night");
    // recipe link is still preserved
    expect(wireMeal.recipeUid).toBe(TACOS_UID);

    const storedMeal = mealStore.get(wireMeal.uid as MealUid);
    expect(storedMeal?.name).toBe("Custom Taco Night");
  });

  it("AC1.5: scale flows through to wire payload and MealStore", async () => {
    const { callTool } = makeAddCtx();

    await callTool("add_meals", {
      items: [{ name: "Big Batch Soup", date: "2026-06-15", type: { builtin: 1 }, scale: "2" }],
    });

    const savedPayload: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[0]?.[0] ?? [];
    expect(savedPayload[0]?.scale).toBe("2");

    const storedMeal = mealStore.get(savedPayload[0]!.uid as MealUid);
    expect(storedMeal?.scale).toBe("2");
  });

  it("AC1.6: two items in same (date, typeUid) bucket → orderFlag 0 and 1", async () => {
    // Empty bucket: no existing meals for this date/type combination.
    const { callTool } = makeAddCtx();

    await callTool("add_meals", {
      items: [
        { name: "First Dinner", date: "2026-06-15", type: { builtin: 2 } },
        { name: "Second Dinner", date: "2026-06-15", type: { builtin: 2 } },
      ],
    });

    const savedPayload: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[0]?.[0] ?? [];
    expect(savedPayload).toHaveLength(2);
    expect(savedPayload[0]?.orderFlag).toBe(0);
    expect(savedPayload[1]?.orderFlag).toBe(1);
  });

  it("AC1.7: adding to empty (date, typeUid) bucket → orderFlag: 0", async () => {
    const { callTool } = makeAddCtx();

    await callTool("add_meals", {
      items: [{ name: "Solo Breakfast", date: "2026-07-01", type: { builtin: 0 } }],
    });

    const savedPayload: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[0]?.[0] ?? [];
    expect(savedPayload[0]?.orderFlag).toBe(0);
  });

  it("AC1.8: {name: 'Dinner'}, {uid: <Dinner UID>}, {builtin: 2} all produce the same wire type and typeUid", async () => {
    // Three separate tool calls; only assert on type integer and typeUid — not orderFlag
    // since they all target the same bucket and the flags will accumulate across calls.

    const { callTool } = makeAddCtx();

    await callTool("add_meals", {
      items: [{ name: "Dinner by Name", date: "2026-06-20", type: { name: "Dinner" } }],
    });
    await callTool("add_meals", {
      items: [{ name: "Dinner by UID", date: "2026-06-20", type: { uid: DINNER_UID } }],
    });
    await callTool("add_meals", {
      items: [{ name: "Dinner by Builtin", date: "2026-06-20", type: { builtin: 2 } }],
    });

    const payloadByName: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[0]?.[0] ?? [];
    const payloadByUid: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[1]?.[0] ?? [];
    const payloadByBuiltin: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[2]?.[0] ?? [];

    const mealByName = payloadByName[0]!;
    const mealByUid = payloadByUid[0]!;
    const mealByBuiltin = payloadByBuiltin[0]!;

    // All three must resolve to the same wire type integer (2 = Dinner) and typeUid
    expect(mealByUid.type).toBe(mealByName.type);
    expect(mealByBuiltin.type).toBe(mealByName.type);
    expect(mealByName.type).toBe(2);

    expect(mealByUid.typeUid).toBe(mealByName.typeUid);
    expect(mealByBuiltin.typeUid).toBe(mealByName.typeUid);
    expect(mealByName.typeUid).toBe(DINNER_UID);
  });

  it("Regression: existing meal with orderFlag 5 in bucket → new meal gets orderFlag 6", async () => {
    // Seed the store with an existing dinner on 2026-06-25 that already has orderFlag 5.
    mealStore.load([
      makeMeal({
        uid: "existing-dinner-uid" as MealUid,
        date: "2026-06-25 00:00:00",
        typeUid: DINNER_UID,
        type: 2,
        orderFlag: 5,
      }),
    ]);

    const { callTool } = makeAddCtx();

    await callTool("add_meals", {
      items: [{ name: "Late Addition", date: "2026-06-25", type: { builtin: 2 } }],
    });

    const savedPayload: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[0]?.[0] ?? [];
    expect(savedPayload[0]?.orderFlag).toBe(6);
  });
});
