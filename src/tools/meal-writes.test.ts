// pattern: Imperative Shell tests
import { fromAny } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MealTypeUid, MealUid, RecipeUid } from "../ids.js";
import type { Meal } from "../meal/types.js";
import type { SeedData } from "./tool-test-utils.js";

import { makeMeal, makeMealType } from "../cache/__fixtures__/meals.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { RecipeStore } from "../recipe/store.js";
import { mealToMarkdown } from "./meal-helpers.js";
import {
  addMealsInputSchema,
  registerAddMealsTool,
  registerDeleteMealTool,
  registerUpdateMealTool,
  updateMealInputSchema,
} from "./meal-writes.js";
import { getText, makeCtx, makeTestServer, seed } from "./tool-test-utils.js";

// Stable UIDs used across both describe blocks so tests don't depend on
// the module-level counters in the fixture factories.
const BREAKFAST_UID = "breakfast-uid" as MealTypeUid;
const LUNCH_UID = "lunch-uid" as MealTypeUid;
const DINNER_UID = "dinner-uid" as MealTypeUid;
const SNACKS_UID = "snacks-uid" as MealTypeUid;
// Custom meal type — `originalType: null` (user-created, not one of the 4
// built-ins). `orderFlag: 4` mirrors the wire capture for "[mcp-cap] Brunch"
// (docs/wire-captures/mealtypes.har.json). `Meal.type` is vestigial when
// `type_uid` is set, so the wire integer defaults to `0` regardless of the
// mealtype's orderFlag (verified via direct API experiment 2026-05-29).
const BRUNCH_UID = "brunch-uid" as MealTypeUid;
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
  let mockSaveMeals: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockPut: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSaveMeals = vi.fn().mockImplementation(async (items: ReadonlyArray<Meal>) => items);
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockPut = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);
  });

  // Builds an add_meals ctx with mocked client + cache. `seedOverrides` merges
  // over the synced baseline (empty meals, builtin meal types, Tacos recipe).
  function makeAddCtx(seedOverrides?: SeedData) {
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ saveMeals: mockSaveMeals, notifySync: mockNotifySync }),
      cache: fromAny({ meals: { put: mockPut, remove: vi.fn() }, flush: mockFlush }),
    });
    seed(ctx, {
      meals: [],
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
      ...seedOverrides,
    });
    registerAddMealsTool(server, ctx);
    return { callTool, ctx };
  }

  it("AC1.1: recipe_uid + date + type → auto-resolved recipe name in markdown and MealStore", async () => {
    const { callTool, ctx } = makeAddCtx();

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
    const storedMeal = ctx.mealStore.get(wireMeal.uid as MealUid);
    expect(storedMeal).toBeDefined();
    expect(storedMeal?.name).toBe("Tacos");
    expect(storedMeal?.recipeUid).toBe(TACOS_UID);
  });

  it("AC1.2: name only (no recipe_uid) → freeform meal with recipeUid: null", async () => {
    const { callTool, ctx } = makeAddCtx();

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

    const storedMeal = ctx.mealStore.get(wireMeal.uid as MealUid);
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

  it("AC1.4: schema rejects {recipe_uid, name} together at the item shape (structural union)", () => {
    // `mealItemInputSchema` is a z.union of two strict variants: recipe-linked (no
    // name allowed; auto-resolved from recipe) and freeform (no recipe_uid allowed).
    // Codex flagged that a stored custom name on a recipe-linked meal is dead data
    // (Paprika.app dispatches display off recipe_uid). Wire experiment 2026-05-29
    // confirmed the server preserves the name but the UI never renders it, so we
    // shut the door at the schema level. Use a freeform meal (omit recipe_uid) for
    // custom labels.
    const result = addMealsInputSchema.safeParse({
      items: [{ recipe_uid: TACOS_UID, name: "Custom Taco Night", date: "2026-06-15", type: { builtin: 2 } }],
    });
    expect(result.success).toBe(false);
  });

  it("AC1.5: scale flows through to wire payload and MealStore", async () => {
    const { callTool, ctx } = makeAddCtx();

    await callTool("add_meals", {
      items: [{ name: "Big Batch Soup", date: "2026-06-15", type: { builtin: 1 }, scale: "2" }],
    });

    const savedPayload: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[0]?.[0] ?? [];
    expect(savedPayload[0]?.scale).toBe("2");

    const storedMeal = ctx.mealStore.get(savedPayload[0]!.uid as MealUid);
    expect(storedMeal?.scale).toBe("2");
  });

  it("date with time-of-day → normalized to midnight; date-only + datetime on same day share a date sequence", async () => {
    // Codex regression (PR #143): without midnight normalization, two items posted
    // with `"2026-06-15"` and `"2026-06-15T18:30:00Z"` would land as distinct date
    // strings ("...00:00:00" vs "...18:30:00") and form separate per-date sequences
    // in `getMaxOrderFlagOn`, so both would get order_flag: 0 — but Paprika.app stores
    // meals at midnight (per docs/wire-captures/meals.har.json) and list_meal_history
    // groups by `date.slice(0, 10)`. Drop time-of-day so the wire and the planner stay
    // in sync.
    const { callTool } = makeAddCtx();

    await callTool("add_meals", {
      items: [
        { name: "Day-only Dinner", date: "2026-06-15", type: { builtin: 2 } },
        { name: "Datetime Dinner", date: "2026-06-15T18:30:00Z", type: { builtin: 2 } },
      ],
    });

    const savedPayload: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[0]?.[0] ?? [];
    expect(savedPayload).toHaveLength(2);
    expect(savedPayload[0]?.date).toBe("2026-06-15 00:00:00");
    expect(savedPayload[1]?.date).toBe("2026-06-15 00:00:00");
    // Same bucket → adjacent order_flags, not both 0
    expect(savedPayload[0]?.orderFlag).toBe(0);
    expect(savedPayload[1]?.orderFlag).toBe(1);
  });

  it("offset-bearing date input → stored at the input's local calendar day, not UTC-shifted", async () => {
    // Code-review regression: `parseInstant` + `.startOf("day")` operating in UTC
    // would shift "2026-06-15T22:00:00-08:00" (June 15 10pm US-Pacific) to
    // June 16 06:00Z → "2026-06-16 00:00:00" stored. The user typed June 15;
    // `parseCalendarDayWire` now honors the input's embedded offset so the stored
    // day matches the user's intent.
    const { callTool } = makeAddCtx();

    await callTool("add_meals", {
      items: [{ name: "US-Pacific Late Dinner", date: "2026-06-15T22:00:00-08:00", type: { builtin: 2 } }],
    });

    const savedPayload: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[0]?.[0] ?? [];
    expect(savedPayload[0]?.date).toBe("2026-06-15 00:00:00");
  });

  it("AC1.6: two items on the same date → orderFlag 0 and 1", async () => {
    // Empty date sequence: no existing meals on this date.
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

  it("two items on the same date but DIFFERENT meal types → orderFlag 0 and 1 (per-date, not per-type)", async () => {
    // The decisive per-date assertion, grounded in the wire capture: a Breakfast
    // and a Lunch on 2026-05-26 posted as order_flag 0 and 1, NOT 0 and 0 — the
    // sequence spans all types on a day (docs/wire-captures/meals.har.json entries
    // 0 and 1). A per-(date, type) bucket would give each type its own 0.
    const { callTool } = makeAddCtx();

    await callTool("add_meals", {
      items: [
        { name: "Morning Oats", date: "2026-05-26", type: { builtin: 0 } },
        { name: "Lunch Sandwich", date: "2026-05-26", type: { builtin: 1 } },
      ],
    });

    const savedPayload: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[0]?.[0] ?? [];
    expect(savedPayload).toHaveLength(2);
    expect(savedPayload[0]?.typeUid).toBe(BREAKFAST_UID);
    expect(savedPayload[1]?.typeUid).toBe(LUNCH_UID);
    expect(savedPayload[0]?.orderFlag).toBe(0);
    expect(savedPayload[1]?.orderFlag).toBe(1);
  });

  it("AC1.7: adding to an empty date → orderFlag: 0", async () => {
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
    const { callTool } = makeAddCtx({
      meals: [
        makeMeal({
          uid: "existing-dinner-uid" as MealUid,
          date: "2026-06-25 00:00:00",
          typeUid: DINNER_UID,
          type: 2,
          orderFlag: 5,
        }),
      ],
    });

    await callTool("add_meals", {
      items: [{ name: "Late Addition", date: "2026-06-25", type: { builtin: 2 } }],
    });

    const savedPayload: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[0]?.[0] ?? [];
    expect(savedPayload[0]?.orderFlag).toBe(6);
  });

  it("custom meal type → wire payload sets type_uid + sends vestigial type:0", async () => {
    // Custom (user-created) meal types carry `originalType: null`. Paprika.app
    // dispatches rendering off `type_uid` when set, and Paprika's server preserves
    // whatever integer we POST in `type` verbatim (verified via direct API +
    // UI eyeball, 2026-05-29). So `type: 0` is the correct vestigial value —
    // `mealsEqual` round-trips cleanly and the UI still shows the meal under the
    // custom type. Regression guards against re-introducing speculative remappings.
    const { callTool } = makeAddCtx({
      mealTypes: [
        ...makeBuiltins(),
        makeMealType({ uid: BRUNCH_UID, name: "Brunch", originalType: null, orderFlag: 4 }),
      ],
    });

    await callTool("add_meals", {
      items: [{ name: "Sunday Brunch", date: "2026-07-04", type: { uid: BRUNCH_UID } }],
    });

    const savedPayload: ReadonlyArray<Meal> = mockSaveMeals.mock.calls[0]?.[0] ?? [];
    expect(savedPayload[0]?.typeUid).toBe(BRUNCH_UID);
    expect(savedPayload[0]?.type).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

describe("add_meals tool — failure paths", () => {
  let mockSaveMeals: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockPut: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSaveMeals = vi.fn().mockImplementation(async (items: ReadonlyArray<Meal>) => items);
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockPut = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);
  });

  // Builds a failure-paths add_meals ctx. Baseline: empty meals, builtin meal
  // types, empty recipe store (no TACOS_UID). Pass `seedOverrides` to adjust.
  function makeFailCtx(seedOverrides?: SeedData) {
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ saveMeals: mockSaveMeals, notifySync: mockNotifySync }),
      cache: fromAny({ meals: { put: mockPut, remove: vi.fn() }, flush: mockFlush }),
    });
    seed(ctx, {
      meals: [],
      mealTypes: makeBuiltins(),
      recipes: [],
      ...seedOverrides,
    });
    registerAddMealsTool(server, ctx);
    return { callTool, ctx };
  }

  it("AC2.1: unparseable date → error text names index and bad date value", async () => {
    const { callTool, ctx } = makeFailCtx();
    const initialSize = ctx.mealStore.size;

    const result = await callTool("add_meals", {
      items: [{ recipe_uid: TACOS_UID, date: "not-a-date", type: { builtin: 2 } }],
    });
    const text = getText(result);

    expect(text).toContain('Item 0: could not parse date "not-a-date"');
    expect(mockSaveMeals).not.toHaveBeenCalled();
    expect(ctx.mealStore.size).toBe(initialSize);
  });

  it("AC2.2: unknown type name 'Brunch' → exact error string with known types list", async () => {
    const { callTool, ctx } = makeFailCtx();
    const initialSize = ctx.mealStore.size;

    const result = await callTool("add_meals", {
      items: [{ name: "Weekend Brunch", date: "2026-06-15", type: { name: "Brunch" } }],
    });
    const text = getText(result);

    // Exact format from the implementation: Item <i> (type {name: "<input>"}): ...
    expect(text).toContain(
      'Item 0 (type {name: "Brunch"}): unknown meal type "Brunch". ' +
        "Known types: Breakfast, Lunch, Dinner, Snacks. " +
        "Use the {uid} or {builtin} discriminator to reference a custom meal type.",
    );
    expect(mockSaveMeals).not.toHaveBeenCalled();
    expect(ctx.mealStore.size).toBe(initialSize);
  });

  it("AC2.3: schema rejects items missing both recipe_uid and name (structural union)", () => {
    // Per-item shape is z.union([recipeMealItemSchema, freeformMealItemSchema]) with
    // both variants strict. An item with neither recipe_uid nor name matches no
    // variant. The previous .refine()-style belt-and-suspenders branch in the
    // handler is gone — the schema is now the single enforcement layer.
    const result = addMealsInputSchema.safeParse({ items: [{ date: "2026-06-15", type: { builtin: 0 } }] });
    expect(result.success).toBe(false);
  });

  it("AC2.3b: unknown recipe_uid (not in local store) → per-index error, saveMeals NOT called", async () => {
    // The failure-paths makeFailCtx seeds store with recipes: [], so TACOS_UID
    // is not present. Supplying only recipe_uid (no name) hits the lookup branch that
    // emits the actionable "not known to the local recipe store" error.
    const { callTool, ctx } = makeFailCtx();
    const initialSize = ctx.mealStore.size;

    const result = await callTool("add_meals", {
      items: [{ recipe_uid: TACOS_UID, date: "2026-06-15", type: { builtin: 2 } }],
    });
    const text = getText(result);

    expect(text).toContain("is not known to the local recipe store");
    expect(text).toContain("wait for the next sync and retry");
    expect(mockSaveMeals).not.toHaveBeenCalled();
    expect(ctx.mealStore.size).toBe(initialSize);
  });

  it("AC2.4: multiple invalid items → all errors enumerated, header 'Could not add 3 meals:'", async () => {
    const { callTool, ctx } = makeFailCtx();
    const initialSize = ctx.mealStore.size;

    const result = await callTool("add_meals", {
      items: [
        // Item 0: bad date (no type needed — date parse fails first)
        { name: "Bad Date Item", date: "bad", type: { builtin: 2 } },
        // Item 1: unknown meal type name
        { name: "Good Date Bad Type", date: "2026-06-15", type: { name: "Brunch" } },
        // Item 2: also bad date
        { name: "Also Bad Date", date: "also-bad", type: { builtin: 0 } },
      ],
    });
    const text = getText(result);

    // Header names the total count
    expect(text).toContain("Could not add 3 meals:");
    // Items 0 and 2 are date-parse errors (format: "Item N: could not parse...").
    // Item 1 is a type-name error (format: "Item N (type {name: ...}): ...").
    // Check for each error by its unique content rather than a bare "Item N:" prefix.
    expect(text).toContain('could not parse date "bad"');
    expect(text).toContain('unknown meal type "Brunch"');
    expect(text).toContain('could not parse date "also-bad"');
    // Each index must appear somewhere in the text
    expect(text).toContain("Item 0:");
    expect(text).toContain("Item 1 (");
    expect(text).toContain("Item 2:");
    expect(mockSaveMeals).not.toHaveBeenCalled();
    expect(ctx.mealStore.size).toBe(initialSize);
  });

  it("AC2.5: empty items array → Zod .min(1) rejects before the handler runs", () => {
    // callTool bypasses Zod validation, so this AC must be tested via the
    // exported schema's .safeParse() method rather than through callTool.
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
// update_meal — success paths (AC3.1-3.6)
// ---------------------------------------------------------------------------

const TEST_MEAL_UID = "test-meal-uid-update-1" as MealUid;

describe("update_meal — success paths (AC3.1-3.6)", () => {
  let mockSaveMeals: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockPut: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSaveMeals = vi.fn().mockImplementation(async (items: ReadonlyArray<Meal>) => items);
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockPut = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);
  });

  // Builds an update_meal ctx with mocked client + cache. `seedOverrides` merges
  // over the synced baseline (builtin meal types, Tacos recipe, no meals).
  function makeUpdateCtx(seedOverrides?: SeedData) {
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ saveMeals: mockSaveMeals, notifySync: mockNotifySync }),
      cache: fromAny({ meals: { put: mockPut, remove: vi.fn() }, flush: mockFlush }),
    });
    seed(ctx, {
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
      // meals key omitted → individual tests seed their own meal via seedOverrides
      ...seedOverrides,
    });
    registerUpdateMealTool(server, ctx);
    return { callTool, ctx };
  }

  it("AC3.1: date-only update → date field updated, non-bucket fields preserved", async () => {
    // Seed a dinner meal with all fields set; only date will change.
    const original = makeMeal({
      uid: TEST_MEAL_UID,
      typeUid: DINNER_UID,
      type: 2,
      name: "Original Name",
      date: "2026-01-01 00:00:00",
      scale: "1.5",
      recipeUid: null,
      orderFlag: 3,
    });
    const { callTool, ctx } = makeUpdateCtx({ meals: [original] });

    await callTool("update_meal", { uid: TEST_MEAL_UID, update: { date: "2026-06-15" } });

    const stored = ctx.mealStore.get(TEST_MEAL_UID);
    expect(stored?.date).toBe("2026-06-15 00:00:00");
    // Date change moves the meal to the destination date's order sequence, so
    // orderFlag is reassigned (max+1 in the destination, which is empty here = 0).
    // All other non-date-derived fields are preserved.
    expect(stored).toEqual({ ...original, date: "2026-06-15 00:00:00", orderFlag: 0 });
  });

  it("AC3.2: type update → typeUid becomes LUNCH_UID and type integer becomes 1", async () => {
    const original = makeMeal({ uid: TEST_MEAL_UID, typeUid: DINNER_UID, type: 2 });
    const { callTool, ctx } = makeUpdateCtx({ meals: [original] });

    await callTool("update_meal", { uid: TEST_MEAL_UID, update: { type: { name: "Lunch" } } });

    const stored = ctx.mealStore.get(TEST_MEAL_UID);
    expect(stored?.typeUid).toBe(LUNCH_UID);
    expect(stored?.type).toBe(1);
  });

  it("AC3.3: freeform meal + recipe_uid → auto-resolved name from store, recipeUid set", async () => {
    // A freeform meal (no recipe); promoting it by supplying a recipe_uid.
    const original = makeMeal({ uid: TEST_MEAL_UID, recipeUid: null, name: "Some Freeform Meal" });
    const { callTool, ctx } = makeUpdateCtx({ meals: [original] });

    await callTool("update_meal", { uid: TEST_MEAL_UID, update: { recipe_uid: TACOS_UID } });

    const stored = ctx.mealStore.get(TEST_MEAL_UID);
    expect(stored?.recipeUid).toBe(TACOS_UID);
    // Name auto-resolved from RecipeStore — caller didn't supply one
    expect(stored?.name).toBe("Tacos");
  });

  it("AC3.4: schema rejects update with {recipe_uid: <UID>, name: <X>} (structural union)", () => {
    // Same rationale as AC1.4: a stored custom name on a recipe-linked meal is dead
    // data in Paprika.app's UI. The update payload union enforces this — only the
    // demote variant (recipe_uid: null + optional name) accepts name alongside a
    // recipe_uid key.
    const result = updateMealInputSchema.safeParse({
      uid: TEST_MEAL_UID,
      update: { recipe_uid: TACOS_UID, name: "Custom Name" },
    });
    expect(result.success).toBe(false);
  });

  it("AC3.5: recipe meal + recipe_uid: null + name → demoted to freeform, new name set", async () => {
    const original = makeMeal({ uid: TEST_MEAL_UID, recipeUid: TACOS_UID, name: "Tacos" });
    const { callTool, ctx } = makeUpdateCtx({ meals: [original] });

    await callTool("update_meal", { uid: TEST_MEAL_UID, update: { recipe_uid: null, name: "Leftover Chili" } });

    const stored = ctx.mealStore.get(TEST_MEAL_UID);
    expect(stored?.recipeUid).toBeNull();
    expect(stored?.name).toBe("Leftover Chili");
  });

  it("AC3.6: scale: null → clears scale in MealStore AND on wire payload", async () => {
    const original = makeMeal({ uid: TEST_MEAL_UID, scale: "2", recipeUid: null });
    const { callTool, ctx } = makeUpdateCtx({ meals: [original] });

    await callTool("update_meal", { uid: TEST_MEAL_UID, update: { scale: null } });

    // Store reflects cleared scale
    const stored = ctx.mealStore.get(TEST_MEAL_UID);
    expect(stored?.scale).toBeNull();

    // Wire payload also carried scale: null to the API
    const payload = mockSaveMeals.mock.calls[0]?.[0] as ReadonlyArray<Meal>;
    expect(payload[0]?.scale).toBeNull();
  });

  it("update_meal to a custom meal type → wire payload sets type_uid + sends vestigial type:0", async () => {
    // Mirrors the add_meals custom-type test: when the new type is custom
    // (`originalType: null`), the update path sets `type_uid` and sends the
    // vestigial `type: 0` integer. Paprika.app's UI dispatches off `type_uid`;
    // the server preserves the integer verbatim.
    const original = makeMeal({ uid: TEST_MEAL_UID, typeUid: DINNER_UID, type: 2 });
    const { callTool, ctx } = makeUpdateCtx({
      mealTypes: [
        ...makeBuiltins(),
        makeMealType({ uid: BRUNCH_UID, name: "Brunch", originalType: null, orderFlag: 4 }),
      ],
      meals: [original],
    });

    await callTool("update_meal", { uid: TEST_MEAL_UID, update: { type: { uid: BRUNCH_UID } } });

    const stored = ctx.mealStore.get(TEST_MEAL_UID);
    expect(stored?.typeUid).toBe(BRUNCH_UID);
    expect(stored?.type).toBe(0);

    const payload = mockSaveMeals.mock.calls[0]?.[0] as ReadonlyArray<Meal>;
    expect(payload[0]?.typeUid).toBe(BRUNCH_UID);
    expect(payload[0]?.type).toBe(0);
  });

  it("moving a meal to a different date → orderFlag becomes max+1 in the destination date", async () => {
    // Codex regression (PR #143): the spread-merge previously preserved the
    // source orderFlag when moving a meal, which could collide with an existing
    // meal at the same flag on the destination date. add_meals avoids this via
    // getMaxOrderFlagOn + 1; update_meal must do the same when `date` changes.
    // (order_flag sequences per DATE — see makeMealOrderFlagAssigner.)
    const moving = makeMeal({
      uid: TEST_MEAL_UID,
      typeUid: LUNCH_UID,
      type: 1,
      date: "2026-06-10 00:00:00",
      orderFlag: 0, // would collide with the destination date's existing flag-0 meal
    });
    const destDateExisting = makeMeal({
      uid: "existing-dinner-uid" as MealUid,
      typeUid: DINNER_UID,
      type: 2,
      date: "2026-06-15 00:00:00",
      orderFlag: 0,
    });
    const { callTool, ctx } = makeUpdateCtx({ meals: [moving, destDateExisting] });

    await callTool("update_meal", {
      uid: TEST_MEAL_UID,
      update: { date: "2026-06-15", type: { name: "Dinner" } },
    });

    const stored = ctx.mealStore.get(TEST_MEAL_UID);
    expect(stored?.date).toBe("2026-06-15 00:00:00");
    expect(stored?.typeUid).toBe(DINNER_UID);
    expect(stored?.orderFlag).toBe(1); // max+1 on the destination date, not preserved 0

    const payload = mockSaveMeals.mock.calls[0]?.[0] as ReadonlyArray<Meal>;
    expect(payload[0]?.orderFlag).toBe(1);
  });

  it("changing ONLY the meal type (same date) → orderFlag preserved (per-date, not per-type)", async () => {
    // Per-date order_flag regression guard: a type change that keeps the date does
    // NOT move the meal to a new order sequence, so the flag must be preserved.
    // Under the old per-(date, type) logic this would have re-sequenced to max+1
    // of the destination type bucket; per-date keeps the position.
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
    const { callTool, ctx } = makeUpdateCtx({ meals: [sameDateExisting, original] });

    await callTool("update_meal", { uid: TEST_MEAL_UID, update: { type: { name: "Dinner" } } });

    const stored = ctx.mealStore.get(TEST_MEAL_UID);
    expect(stored?.typeUid).toBe(DINNER_UID);
    expect(stored?.orderFlag).toBe(1); // unchanged — same date, no re-sequence
  });

  it("update without changing date → orderFlag preserved (keep-the-position)", async () => {
    // Counter-test to the date-move test above. Same-date updates should leave
    // the flag alone, otherwise we'd churn position on every edit.
    const original = makeMeal({
      uid: TEST_MEAL_UID,
      typeUid: DINNER_UID,
      type: 2,
      date: "2026-06-15 00:00:00",
      orderFlag: 7,
      scale: "1",
    });
    const { callTool, ctx } = makeUpdateCtx({ meals: [original] });

    await callTool("update_meal", { uid: TEST_MEAL_UID, update: { scale: "2" } });

    const stored = ctx.mealStore.get(TEST_MEAL_UID);
    expect(stored?.orderFlag).toBe(7); // unchanged
    expect(stored?.scale).toBe("2");
  });

  it("AC3.11: name-only update on a recipe-linked meal → runtime rejection ('demote first'); no POST", async () => {
    // Code-review regression: the runtime guard in update_meal rejects name-only
    // updates on recipe-linked meals because Paprika.app dispatches display off
    // recipe_uid and would never render a stored custom name. Schema permits the
    // shape (nameUpdateVariant doesn't know about the existing meal); runtime
    // enforces the freeform-only semantic. Without this test, a future refactor
    // could quietly drop the guard.
    const recipeLinked = makeMeal({
      uid: TEST_MEAL_UID,
      recipeUid: TACOS_UID,
      name: "Tacos",
    });
    const { callTool, ctx } = makeUpdateCtx({ meals: [recipeLinked] });

    const result = await callTool("update_meal", {
      uid: TEST_MEAL_UID,
      update: { name: "Mom's Tacos" },
    });
    const text = getText(result);

    expect(text).toContain("Cannot set name on the recipe-linked meal");
    expect(text).toContain("demote first");
    expect(mockSaveMeals).not.toHaveBeenCalled();
    // Stored name is unchanged.
    expect(ctx.mealStore.get(TEST_MEAL_UID)?.name).toBe("Tacos");
  });

  it("no-effective-change update_meal call → short-circuits without POST or notifySync", async () => {
    // Code-review regression: `update_meal({uid, update: {}})` parses as
    // recipeUpdateVariant (all fields optional). Without a short-circuit the
    // handler would build `updated = {...existing}` and POST a wasted round-
    // trip + trigger notifySync. The short-circuit detects field-wise equality
    // and returns the existing meal markdown instead.
    const original = makeMeal({
      uid: TEST_MEAL_UID,
      typeUid: DINNER_UID,
      type: 2,
      date: "2026-06-15 00:00:00",
      name: "Existing",
      orderFlag: 3,
      scale: null,
    });
    const { callTool } = makeUpdateCtx({ meals: [original] });

    const result = await callTool("update_meal", { uid: TEST_MEAL_UID, update: {} });

    expect(mockSaveMeals).not.toHaveBeenCalled();
    expect(mockNotifySync).not.toHaveBeenCalled();
    // Response still renders the meal so the caller sees the current state.
    const text = getText(result);
    expect(text).toContain("Existing");
  });
});

// ---------------------------------------------------------------------------
// update_meal — failure/edge paths (AC3.7-3.10)
// ---------------------------------------------------------------------------

describe("update_meal — failure/edge paths (AC3.7-3.10)", () => {
  let mockSaveMeals: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockPut: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // No meals seeded; individual tests seed what they need.
    mockSaveMeals = vi.fn().mockImplementation(async (items: ReadonlyArray<Meal>) => items);
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockPut = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);
  });

  // Builds a failure-paths update_meal ctx. Baseline: empty meals, builtin meal
  // types, empty recipe store. Pass `seedOverrides` to stage per-test data.
  function makeUpdateCtx(seedOverrides?: SeedData) {
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ saveMeals: mockSaveMeals, notifySync: mockNotifySync }),
      cache: fromAny({ meals: { put: mockPut, remove: vi.fn() }, flush: mockFlush }),
    });
    seed(ctx, {
      meals: [],
      mealTypes: makeBuiltins(),
      recipes: [],
      ...seedOverrides,
    });
    registerUpdateMealTool(server, ctx);
    return { callTool, ctx };
  }

  it("AC3.7: unknown UID → 'No meal found...' error, no POST", async () => {
    const { callTool } = makeUpdateCtx();

    const result = await callTool("update_meal", { uid: "UNKNOWN-UID" as MealUid, update: { name: "Anything" } });
    const text = getText(result);

    expect(text).toBe('No meal found with UID "UNKNOWN-UID".');
    expect(mockSaveMeals).not.toHaveBeenCalled();
  });

  it("AC3.8 tombstone: deleted via mealStore.delete() → tombstone error string, no POST", async () => {
    // Seed then delete to create a tombstone entry.
    const meal = makeMeal({ uid: TEST_MEAL_UID });
    const { callTool, ctx } = makeUpdateCtx({ meals: [meal] });
    ctx.mealStore.delete(TEST_MEAL_UID);

    const result = await callTool("update_meal", { uid: TEST_MEAL_UID, update: { name: "Anything" } });
    const text = getText(result);

    expect(text).toBe(`Meal with UID "${TEST_MEAL_UID}" is already deleted.`);
    expect(mockSaveMeals).not.toHaveBeenCalled();
  });

  it("AC3.8 defense-in-depth: meal.deleted === true in store → name-based error string, no POST", async () => {
    // Simulate a deleted meal still present in the items map (defense-in-depth branch).
    const meal = makeMeal({ uid: TEST_MEAL_UID, name: "Ghost Meal", deleted: true });
    const { callTool } = makeUpdateCtx({ meals: [meal] });

    const result = await callTool("update_meal", { uid: TEST_MEAL_UID, update: { name: "Anything" } });
    const text = getText(result);

    expect(text).toBe(`Meal "Ghost Meal" is already deleted.`);
    expect(mockSaveMeals).not.toHaveBeenCalled();
  });

  it("AC3.9: freeform meal + recipe_uid: null + no other fields → no POST, returns existing card", async () => {
    // Meal already freeform; passing recipe_uid: null with nothing else is a no-op.
    const meal = makeMeal({ uid: TEST_MEAL_UID, recipeUid: null, typeUid: DINNER_UID, type: 2 });
    const { callTool } = makeUpdateCtx({ meals: [meal] });

    const result = await callTool("update_meal", { uid: TEST_MEAL_UID, update: { recipe_uid: null } });
    const text = getText(result);

    // No POST should have been issued
    expect(mockSaveMeals).not.toHaveBeenCalled();
    // Returned text must be exactly the existing meal's markdown card
    const expectedCard = mealToMarkdown(meal, "Dinner", null);
    expect(text).toBe(expectedCard);
  });

  it("AC3.10: recipe meal + recipe_uid: null + no name → demotion error, no POST", async () => {
    // Has a recipe link but caller did not supply an explicit name for the demotion.
    const meal = makeMeal({ uid: TEST_MEAL_UID, recipeUid: TACOS_UID, name: "Tacos" });
    const { callTool } = makeUpdateCtx({ meals: [meal] });

    const result = await callTool("update_meal", { uid: TEST_MEAL_UID, update: { recipe_uid: null } });
    const text = getText(result);

    expect(text).toBe(
      `Demoting a recipe meal to freeform requires an explicit name. Add 'name: "<your label>"' to the call.`,
    );
    expect(mockSaveMeals).not.toHaveBeenCalled();
  });

  it("AC3.9 extended: already-freeform meal + recipe_uid: null + scale: '2' → scale updates, no demotion error", async () => {
    // Regression: an already-freeform meal supplying recipe_uid: null alongside
    // another field (scale) must NOT hit the demotion-requires-name guard.
    // The guard should only fire when existing.recipeUid !== null.
    const meal = makeMeal({ uid: TEST_MEAL_UID, recipeUid: null, name: "Cereal", scale: null });
    const { callTool, ctx } = makeUpdateCtx({ meals: [meal] });

    const result = await callTool("update_meal", { uid: TEST_MEAL_UID, update: { recipe_uid: null, scale: "2" } });
    const text = getText(result);

    // Must NOT return the demotion error
    expect(text).not.toContain("Demoting a recipe meal to freeform requires an explicit name");
    // saveMeals IS called — the scale update is persisted
    expect(mockSaveMeals).toHaveBeenCalledTimes(1);
    // The updated meal in the store reflects the new scale, preserved name and recipeUid
    expect(ctx.mealStore.get(TEST_MEAL_UID)?.scale).toBe("2");
    expect(ctx.mealStore.get(TEST_MEAL_UID)?.recipeUid).toBeNull();
    expect(ctx.mealStore.get(TEST_MEAL_UID)?.name).toBe("Cereal");
  });
});

// ---------------------------------------------------------------------------
// delete_meal — AC4.1-AC4.4
// ---------------------------------------------------------------------------

const DELETE_MEAL_UID = "delete-meal-uid-1" as MealUid;

describe("delete_meal — AC4.1-AC4.4", () => {
  let mockSaveMeals: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockPut: ReturnType<typeof vi.fn>;
  let mockRemove: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSaveMeals = vi.fn().mockImplementation(async (items: ReadonlyArray<Meal>) => items);
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockPut = vi.fn().mockResolvedValue(undefined);
    mockRemove = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);
  });

  // Builds a delete_meal ctx with mocked client + cache. `seedOverrides` merges
  // over the synced baseline (builtin meal types, empty recipe store, no meals).
  function makeDeleteCtx(seedOverrides?: SeedData) {
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ saveMeals: mockSaveMeals, notifySync: mockNotifySync }),
      cache: fromAny({ meals: { put: mockPut, remove: mockRemove }, flush: mockFlush }),
    });
    seed(ctx, {
      mealTypes: makeBuiltins(),
      recipes: [],
      // meals key omitted by default; tests supply via seedOverrides
      ...seedOverrides,
    });
    registerDeleteMealTool(server, ctx);
    return { callTool, ctx };
  }

  it("AC4.1: happy path — wire payload has deleted: true, store tombstones UID, returns success message", async () => {
    const meal = makeMeal({ uid: DELETE_MEAL_UID, name: "Tacos", date: "2026-06-15 18:00:00", deleted: false });
    const { callTool, ctx } = makeDeleteCtx({ meals: [meal] });

    const result = await callTool("delete_meal", { uid: DELETE_MEAL_UID });
    const text = getText(result);

    // Exact success message format
    expect(text).toBe(`Meal "Tacos" on 2026-06-15 18:00:00 deleted.`);

    // Wire payload carried deleted: true
    const payload = mockSaveMeals.mock.calls[0]?.[0] as ReadonlyArray<Meal>;
    expect(payload).toHaveLength(1);
    expect(payload[0]?.deleted).toBe(true);

    // commitMeal delete branch removes from _items and tombstones the UID
    expect(ctx.mealStore.get(DELETE_MEAL_UID)).toBeUndefined();
    expect(ctx.mealStore.isTombstone(DELETE_MEAL_UID)).toBe(true);
  });

  it("AC4.2: tombstone retry — second call returns 'already deleted', saveMeals NOT called again", async () => {
    const meal = makeMeal({ uid: DELETE_MEAL_UID, name: "Tacos", date: "2026-06-15 18:00:00", deleted: false });
    const { callTool } = makeDeleteCtx({ meals: [meal] });

    // First delete — succeeds and tombstones
    await callTool("delete_meal", { uid: DELETE_MEAL_UID });

    // Second delete — tombstone short-circuit
    const result = await callTool("delete_meal", { uid: DELETE_MEAL_UID });
    const text = getText(result);

    expect(text).toBe(`Meal with UID "${DELETE_MEAL_UID}" is already deleted.`);
    // Measured AFTER the second call: saveMeals was only ever called once
    expect(mockSaveMeals.mock.calls.length).toBe(1);
  });

  it("AC4.3: unknown UID — 'No meal found...' error, saveMeals NOT called", async () => {
    // Empty meals seeded → no meals, no tombstones
    const { callTool } = makeDeleteCtx({ meals: [] });

    const result = await callTool("delete_meal", { uid: "UNKNOWN" as MealUid });
    const text = getText(result);

    expect(text).toBe(`No meal found with UID "UNKNOWN".`);
    expect(mockSaveMeals).not.toHaveBeenCalled();
  });

  it("AC4.4: defense-in-depth — meal.deleted already true in store, no re-POST", async () => {
    // Bypass normal commit path: set() directly to place a deleted meal in the items map
    // (simulates a rare race where a deleted=true record ends up in the store).
    const { callTool, ctx } = makeDeleteCtx({ meals: [] });
    const deletedMeal = makeMeal({ uid: DELETE_MEAL_UID, name: "Stale", date: "2026-06-15 00:00:00", deleted: true });
    // Use set() directly — NOT load() or mealStore.delete() — to seed the defense-in-depth state
    ctx.mealStore.set(deletedMeal);

    const result = await callTool("delete_meal", { uid: DELETE_MEAL_UID });
    const text = getText(result);

    expect(text).toBe(`Meal "Stale" is already deleted.`);
    expect(mockSaveMeals).not.toHaveBeenCalled();
  });
});
