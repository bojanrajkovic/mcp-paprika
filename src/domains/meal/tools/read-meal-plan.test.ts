import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MealTypeUid, MealUid } from "../../../ids.js";

import { makeMeal, makeMealType } from "../../../../test/cache/__fixtures__/meals.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";

const BREAKFAST_UID = "breakfast-uid" as MealTypeUid;
const DINNER_UID = "dinner-uid" as MealTypeUid;

/** Wire-format ("yyyy-MM-dd HH:mm:ss") date `offsetDays` from the start of today (UTC). */
function wireDay(offsetDays: number): string {
  return DateTime.utc().startOf("day").plus({ days: offsetDays }).toFormat("yyyy-MM-dd HH:mm:ss");
}

describe("read_meal_plan tool", () => {
  const kh = useKernelHarness("meal");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("renders upcoming meals grouped by day in ascending date order, today included", async () => {
    // Seeded out of chronological order; the plan must render today → +N ascending
    // (the store sorts DESC, so this proves the tool re-sorts ascending).
    kh.seed({
      mealTypes: [
        makeMealType({ uid: BREAKFAST_UID, name: "Breakfast", originalType: 0, orderFlag: 0 }),
        makeMealType({ uid: DINNER_UID, name: "Dinner", originalType: 2, orderFlag: 2 }),
      ],
      meals: [
        makeMeal({ uid: "m-3" as MealUid, name: "DayPlus3", date: wireDay(3), typeUid: DINNER_UID, type: 2 }),
        makeMeal({ uid: "m-0" as MealUid, name: "TodayMeal", date: wireDay(0), typeUid: DINNER_UID, type: 2 }),
        makeMeal({ uid: "m-1" as MealUid, name: "DayPlus1", date: wireDay(1), typeUid: DINNER_UID, type: 2 }),
      ],
    });

    const text = getText(await kh.callTool("read_meal_plan", {}));

    expect(text).toContain("TodayMeal");
    expect(text).toContain("DayPlus1");
    expect(text).toContain("DayPlus3");
    expect(text.indexOf("TodayMeal")).toBeLessThan(text.indexOf("DayPlus1"));
    expect(text.indexOf("DayPlus1")).toBeLessThan(text.indexOf("DayPlus3"));
  });

  it("excludes past meals and meals beyond the default 7-day window", async () => {
    kh.seed({
      mealTypes: [makeMealType({ uid: DINNER_UID, name: "Dinner", originalType: 2, orderFlag: 2 })],
      meals: [
        makeMeal({ uid: "past" as MealUid, name: "PastMeal", date: wireDay(-5), typeUid: DINNER_UID, type: 2 }),
        makeMeal({ uid: "soon" as MealUid, name: "SoonMeal", date: wireDay(1), typeUid: DINNER_UID, type: 2 }),
        makeMeal({ uid: "far" as MealUid, name: "FarMeal", date: wireDay(20), typeUid: DINNER_UID, type: 2 }),
      ],
    });

    const text = getText(await kh.callTool("read_meal_plan", {}));

    expect(text).toContain("SoonMeal");
    expect(text).not.toContain("PastMeal");
    expect(text).not.toContain("FarMeal");
  });

  it("widens the window with `days`", async () => {
    kh.seed({
      mealTypes: [makeMealType({ uid: DINNER_UID, name: "Dinner", originalType: 2, orderFlag: 2 })],
      meals: [makeMeal({ uid: "far" as MealUid, name: "DayPlus10", date: wireDay(10), typeUid: DINNER_UID, type: 2 })],
    });

    expect(getText(await kh.callTool("read_meal_plan", { days: 14 }))).toContain("DayPlus10");
    expect(getText(await kh.callTool("read_meal_plan", { days: 7 }))).not.toContain("DayPlus10");
  });

  it("reports an empty plan", async () => {
    kh.seed({
      mealTypes: [makeMealType({ uid: DINNER_UID, name: "Dinner", originalType: 2, orderFlag: 2 })],
      meals: [],
    });
    expect(getText(await kh.callTool("read_meal_plan", {}))).toContain("No meals planned");
  });
});
