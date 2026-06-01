import { describe, it, expect, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import { MealStore } from "../cache/meal-store.js";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeMeal, makeMealType } from "../cache/__fixtures__/meals.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import type { MealTypeUid, RecipeUid } from "../paprika/types.js";
import {
  commitMeal,
  commitMealsBatch,
  makeMealOrderFlagAssigner,
  mealStartGuard,
  mealToMarkdown,
  mealTypeSpecSchema,
  renderMealCard,
  resolveMealTypeSpec,
} from "./meal-helpers.js";
import { makeTestServer, makeCtx, makeStubNotifier, seed } from "./tool-test-utils.js";

// ---------------------------------------------------------------------------
// AC6.1: mealTypeSpecSchema is exported and correct
// ---------------------------------------------------------------------------

describe("meal-planner-writes.AC6.1: mealTypeSpecSchema is exported and parseable", () => {
  it("is a Zod schema (ZodTypeAny-duck)", () => {
    expect(typeof mealTypeSpecSchema.parse).toBe("function");
    expect(typeof mealTypeSpecSchema.safeParse).toBe("function");
  });

  it("parses {name} variant and trims whitespace", () => {
    expect(mealTypeSpecSchema.parse({ name: "  Dinner  " })).toEqual({ name: "Dinner" });
    expect(mealTypeSpecSchema.parse({ name: "Breakfast" })).toEqual({ name: "Breakfast" });
  });

  it("parses {uid} variant", () => {
    const uid = "meal-type-uid-123" as MealTypeUid;
    expect(mealTypeSpecSchema.parse({ uid })).toEqual({ uid });
  });

  it("parses {builtin} variant for values 0–3", () => {
    for (const v of [0, 1, 2, 3]) {
      expect(mealTypeSpecSchema.parse({ builtin: v })).toEqual({ builtin: v });
    }
  });

  it("rejects {name} with empty string", () => {
    expect(() => mealTypeSpecSchema.parse({ name: "" })).toThrow();
  });

  it("rejects {builtin: 4} (out of range)", () => {
    expect(() => mealTypeSpecSchema.parse({ builtin: 4 })).toThrow();
  });

  it("rejects {builtin: -1} (out of range)", () => {
    expect(() => mealTypeSpecSchema.parse({ builtin: -1 })).toThrow();
  });

  it("rejects ambiguous shape {name, uid}", () => {
    expect(() => mealTypeSpecSchema.parse({ name: "Dinner", uid: "some-uid" })).toThrow();
  });

  it("rejects unknown shape", () => {
    expect(() => mealTypeSpecSchema.parse({ kind: "builtin", value: 2 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// mealStartGuard
// ---------------------------------------------------------------------------

describe("mealStartGuard", () => {
  it("returns Err when mealStore has not yet synced", () => {
    const { server } = makeTestServer();
    // mealTypeStore seeded (synced), mealStore omitted (cold)
    const ctx = seed(makeCtx(new RecipeStore(), server), {
      mealTypes: [], // mealTypeStore synced but mealStore is not
    });

    const result = mealStartGuard(ctx);
    result.match(
      () => {
        throw new Error("Expected Err, got Ok");
      },
      (errVal) => {
        expect(errVal.content[0]?.type).toBe("text");
      },
    );
  });

  it("returns Err when mealTypeStore has not yet synced (Codex regression: cold-cache disguised as user error)", () => {
    // Without the dual-store check, write tools would happily call resolveMealTypeSpec
    // against an empty mealTypeStore and surface "Unknown meal type 'Dinner'" — looks
    // like a user input mistake but is actually a not-yet-synced state.
    const { server } = makeTestServer();
    // mealStore seeded (synced), mealTypeStore omitted (cold)
    const ctx = seed(makeCtx(new RecipeStore(), server), {
      meals: [], // mealStore synced
      // mealTypes key omitted → mealTypeStore NOT synced
    });

    const result = mealStartGuard(ctx);
    result.match(
      () => {
        throw new Error("Expected Err, got Ok");
      },
      (errVal) => {
        expect(errVal.content[0]?.type).toBe("text");
      },
    );
  });

  it("returns Ok when both stores have synced", () => {
    const { server } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), {
      meals: [],
      mealTypes: [],
    });

    const result = mealStartGuard(ctx);
    result.match(
      () => {},
      (errVal) => {
        throw new Error(`Expected Ok, got Err: ${JSON.stringify(errVal)}`);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// resolveMealTypeSpec — shared type-DU resolver (#141)
// ---------------------------------------------------------------------------

describe("resolveMealTypeSpec", () => {
  function makeResolverCtx() {
    const { server } = makeTestServer();
    return seed(makeCtx(new RecipeStore(), server), {
      meals: [],
      mealTypes: [
        makeMealType({ uid: "breakfast-uid" as MealTypeUid, name: "Breakfast", originalType: 0, orderFlag: 0 }),
        makeMealType({ uid: "lunch-uid" as MealTypeUid, name: "Lunch", originalType: 1, orderFlag: 1 }),
        makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", originalType: 2, orderFlag: 2 }),
        makeMealType({ uid: "custom-uid" as MealTypeUid, name: "Brunch", originalType: null, orderFlag: 4 }),
      ],
    });
  }

  it("resolves a known {name} (case-insensitive)", () => {
    const result = resolveMealTypeSpec(makeResolverCtx(), { name: "dinner" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resolved.uid).toBe("dinner-uid");
  });

  it("resolves a known {uid}", () => {
    const result = resolveMealTypeSpec(makeResolverCtx(), { uid: "custom-uid" as MealTypeUid });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resolved.name).toBe("Brunch");
  });

  it("resolves a {builtin} index to its meal type", () => {
    const result = resolveMealTypeSpec(makeResolverCtx(), { builtin: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resolved.uid).toBe("lunch-uid");
  });

  it("returns unknown_uid for an unknown UID", () => {
    const result = resolveMealTypeSpec(makeResolverCtx(), { uid: "nope" as MealTypeUid });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "unknown_uid") expect(result.uid).toBe("nope");
    else throw new Error(`Expected unknown_uid, got ${JSON.stringify(result)}`);
  });

  it("returns unknown_name with the known-names list for hinting", () => {
    const result = resolveMealTypeSpec(makeResolverCtx(), { name: "Supper" });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "unknown_name") {
      expect(result.name).toBe("Supper");
      expect(result.knownNames).toEqual(["Breakfast", "Lunch", "Dinner", "Brunch"]);
    } else throw new Error(`Expected unknown_name, got ${JSON.stringify(result)}`);
  });

  it("returns unknown_builtin when no loaded type carries that originalType", () => {
    // No Snacks(3) loaded.
    const result = resolveMealTypeSpec(makeResolverCtx(), { builtin: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "unknown_builtin") expect(result.index).toBe(3);
    else throw new Error(`Expected unknown_builtin, got ${JSON.stringify(result)}`);
  });
});

// ---------------------------------------------------------------------------
// makeMealOrderFlagAssigner — per-date batch order_flag sequencing
// ---------------------------------------------------------------------------

describe("makeMealOrderFlagAssigner", () => {
  const DATE = "2026-06-15 00:00:00";
  const OTHER_DATE = "2026-06-16 00:00:00";

  function makeAssignerCtx(mealStore: MealStore) {
    const { server } = makeTestServer();
    return makeCtx(new RecipeStore(), server, { mealStore });
  }

  it("seeds an empty date at 0 and increments within the batch", () => {
    const mealStore = new MealStore();
    mealStore.load([]);
    const assign = makeMealOrderFlagAssigner(makeAssignerCtx(mealStore));

    expect(assign(DATE)).toBe(0);
    expect(assign(DATE)).toBe(1);
    expect(assign(DATE)).toBe(2);
  });

  it("seeds from the store's existing per-date max + 1", () => {
    const mealStore = new MealStore();
    // Two existing meals on DATE; highest orderFlag is 4 (spanning types).
    mealStore.load([
      makeMeal({ date: DATE, typeUid: "breakfast-uid", orderFlag: 2 }),
      makeMeal({ date: DATE, typeUid: "dinner-uid", orderFlag: 4 }),
    ]);
    const assign = makeMealOrderFlagAssigner(makeAssignerCtx(mealStore));

    expect(assign(DATE)).toBe(5);
    expect(assign(DATE)).toBe(6);
  });

  it("tracks distinct dates independently", () => {
    const mealStore = new MealStore();
    mealStore.load([]);
    const assign = makeMealOrderFlagAssigner(makeAssignerCtx(mealStore));

    // Interleaved dates each keep their own running counter.
    expect(assign(DATE)).toBe(0);
    expect(assign(OTHER_DATE)).toBe(0);
    expect(assign(DATE)).toBe(1);
    expect(assign(OTHER_DATE)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC5: commitMeal — single-item commit pattern
// ---------------------------------------------------------------------------

describe("meal-planner-writes.AC5: commitMeal helper", () => {
  describe("AC5.1 (mark before cache I/O) — upsert branch", () => {
    it("markPendingUpsert is set before cache.meals.put is called", async () => {
      const saved = makeMeal({ deleted: false });
      const mealStore = new MealStore();

      let pendingWasSetBeforePut = false;
      const mockPut = vi.fn().mockImplementation(async () => {
        pendingWasSetBeforePut = mealStore.isPendingUpsert(saved.uid);
      });
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();
      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        mealStore,
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({ meals: { put: mockPut, remove: vi.fn() }, flush: mockFlush }),
        notifier: stub.notifier,
      });

      await commitMeal(ctx, saved);

      expect(pendingWasSetBeforePut).toBe(true);
      // AC5.5: no resourceListChanged
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
    });
  });

  describe("AC5.1 (mark before cache I/O) — delete branch", () => {
    it("markPendingDelete is set before cache.meals.remove is called", async () => {
      const base = makeMeal({ deleted: false });
      const saved = { ...base, deleted: true };
      const mealStore = new MealStore();
      mealStore.load([base]);

      let pendingWasSetBeforeRemove = false;
      const mockRemove = vi.fn().mockImplementation(async () => {
        pendingWasSetBeforeRemove = mealStore.isPendingDelete(saved.uid);
      });
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();
      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        mealStore,
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({ meals: { put: vi.fn(), remove: mockRemove }, flush: mockFlush }),
        notifier: stub.notifier,
      });

      await commitMeal(ctx, saved);

      expect(pendingWasSetBeforeRemove).toBe(true);
      // AC5.5: no resourceListChanged
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
    });
  });

  describe("ordering — upsert branch (put → flush → store.set → notifySync)", () => {
    it("calls operations in order via invocationCallOrder", async () => {
      const saved = makeMeal({ deleted: false });
      const mealStore = new MealStore();
      const setSpy = vi.spyOn(mealStore, "set");

      const mockPut = vi.fn().mockResolvedValue(undefined);
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();
      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        mealStore,
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({ meals: { put: mockPut, remove: vi.fn() }, flush: mockFlush }),
        notifier: stub.notifier,
      });

      await commitMeal(ctx, saved);

      expect(mockPut.mock.invocationCallOrder[0]).toBeLessThan(mockFlush.mock.invocationCallOrder[0]!);
      expect(mockFlush.mock.invocationCallOrder[0]).toBeLessThan(setSpy.mock.invocationCallOrder[0]!);
      expect(setSpy.mock.invocationCallOrder[0]).toBeLessThan(mockNotifySync.mock.invocationCallOrder[0]!);
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
    });
  });

  describe("ordering — delete branch (remove → flush → store.delete → notifySync)", () => {
    it("calls operations in order via invocationCallOrder", async () => {
      const base = makeMeal({ deleted: false });
      const saved = { ...base, deleted: true };
      const mealStore = new MealStore();
      mealStore.load([base]);
      const deleteSpy = vi.spyOn(mealStore, "delete");

      const mockRemove = vi.fn().mockResolvedValue(undefined);
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();
      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        mealStore,
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({ meals: { put: vi.fn(), remove: mockRemove }, flush: mockFlush }),
        notifier: stub.notifier,
      });

      await commitMeal(ctx, saved);

      expect(mockRemove.mock.invocationCallOrder[0]).toBeLessThan(mockFlush.mock.invocationCallOrder[0]!);
      expect(mockFlush.mock.invocationCallOrder[0]).toBeLessThan(deleteSpy.mock.invocationCallOrder[0]!);
      expect(deleteSpy.mock.invocationCallOrder[0]).toBeLessThan(mockNotifySync.mock.invocationCallOrder[0]!);
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
    });
  });

  describe("pending-mark rollback on cache put failure", () => {
    it("clears pending-upsert mark when cache.meals.put rejects", async () => {
      const saved = makeMeal({ deleted: false });
      const mealStore = new MealStore();

      const mockPut = vi.fn().mockRejectedValue(new Error("disk full"));
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();
      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        mealStore,
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({ meals: { put: mockPut, remove: vi.fn() }, flush: mockFlush }),
        notifier: stub.notifier,
      });

      await expect(commitMeal(ctx, saved)).rejects.toThrow("disk full");

      expect(mealStore.isPendingUpsert(saved.uid)).toBe(false);
      expect(mealStore.isPendingDelete(saved.uid)).toBe(false);
    });

    it("clears pending-delete mark when cache.meals.remove rejects", async () => {
      const base = makeMeal({ deleted: false });
      const saved = { ...base, deleted: true };
      const mealStore = new MealStore();
      mealStore.load([base]);

      const mockRemove = vi.fn().mockRejectedValue(new Error("disk full"));
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();
      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        mealStore,
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({ meals: { put: vi.fn(), remove: mockRemove }, flush: mockFlush }),
        notifier: stub.notifier,
      });

      await expect(commitMeal(ctx, saved)).rejects.toThrow("disk full");

      expect(mealStore.isPendingDelete(saved.uid)).toBe(false);
      expect(mealStore.isPendingUpsert(saved.uid)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// AC5: commitMealsBatch — batch commit pattern
// ---------------------------------------------------------------------------

describe("meal-planner-writes.AC5: commitMealsBatch helper", () => {
  it("no-ops when items array is empty", async () => {
    const mealStore = new MealStore();
    const mockFlush = vi.fn().mockResolvedValue(undefined);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();
    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      mealStore,
      client: fromAny({ notifySync: mockNotifySync }),
      cache: fromAny({ meals: {}, flush: mockFlush }),
      notifier: stub.notifier,
    });
    await commitMealsBatch(ctx, []);
    expect(mockFlush).not.toHaveBeenCalled();
    expect(mockNotifySync).not.toHaveBeenCalled();
    expect(stub.resourceListChanged).not.toHaveBeenCalled();
  });

  describe("AC5.1 (mark before cache I/O) in batch", () => {
    it("all marks are set before any cache.meals.put is called", async () => {
      const item1 = makeMeal({ deleted: false });
      const item2 = makeMeal({ deleted: false });
      const mealStore = new MealStore();

      const pendingStateAtPutTime: Array<boolean> = [];
      const mockPut = vi.fn().mockImplementation(async (meal: { uid: string }) => {
        // Both marks should be set by the time any put() call runs
        pendingStateAtPutTime.push(mealStore.isPendingUpsert(item1.uid) && mealStore.isPendingUpsert(item2.uid));
        void meal;
      });

      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        mealStore,
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({ meals: { put: mockPut, remove: vi.fn() }, flush: mockFlush }),
      });

      await commitMealsBatch(ctx, [item1, item2]);

      // Every put() invocation saw both marks already set
      expect(pendingStateAtPutTime.every(Boolean)).toBe(true);
    });
  });

  describe("AC5.2 (Promise.allSettled, not Promise.all)", () => {
    it("when second item's put rejects, first item's put was still awaited", async () => {
      const item1 = makeMeal({ deleted: false });
      const item2 = makeMeal({ deleted: false });
      const mealStore = new MealStore();

      const mockPutItem1 = vi.fn().mockResolvedValue(undefined);
      const mockPutItem2 = vi.fn().mockRejectedValue(new Error("disk full"));

      // Return different mocks per call by index
      let callCount = 0;
      const mockPut = vi.fn().mockImplementation(async (meal: typeof item1) => {
        callCount++;
        if (meal.uid === item1.uid) return mockPutItem1(meal);
        return mockPutItem2(meal);
      });

      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();
      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        mealStore,
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({ meals: { put: mockPut, remove: vi.fn() }, flush: mockFlush }),
        notifier: stub.notifier,
      });

      await expect(commitMealsBatch(ctx, [item1, item2])).rejects.toThrow("disk full");

      // Both puts were attempted (allSettled waits for all, not fail-fast)
      expect(mockPutItem1).toHaveBeenCalledTimes(1);
      expect(mockPutItem2).toHaveBeenCalledTimes(1);
      void callCount;
    });
  });

  describe("AC5.3 (clearPending on failure)", () => {
    it("on cache put failure, all marked UIDs are cleared before error re-throw", async () => {
      const item1 = makeMeal({ deleted: false });
      const item2 = makeMeal({ deleted: false });
      const mealStore = new MealStore();
      const clearPendingSpy = vi.spyOn(mealStore, "clearPending");

      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();
      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        mealStore,
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({
          meals: { put: vi.fn().mockRejectedValue(new Error("disk full")), remove: vi.fn() },
          flush: mockFlush,
        }),
        notifier: stub.notifier,
      });

      await expect(commitMealsBatch(ctx, [item1, item2])).rejects.toThrow("disk full");

      // All UIDs cleared
      expect(clearPendingSpy).toHaveBeenCalledWith(item1.uid);
      expect(clearPendingSpy).toHaveBeenCalledWith(item2.uid);
      expect(mealStore.isPendingUpsert(item1.uid)).toBe(false);
      expect(mealStore.isPendingUpsert(item2.uid)).toBe(false);

      // AC5.5: no resourceListChanged on failure path
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
    });

    it("on flush failure, all marked UIDs are cleared and error re-thrown", async () => {
      const item1 = makeMeal({ deleted: false });
      const item2 = makeMeal({ deleted: false });
      const mealStore = new MealStore();
      const clearPendingSpy = vi.spyOn(mealStore, "clearPending");

      const mockFlush = vi.fn().mockRejectedValue(new Error("flush failed"));
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();
      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        mealStore,
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({
          meals: { put: vi.fn().mockResolvedValue(undefined), remove: vi.fn() },
          flush: mockFlush,
        }),
        notifier: stub.notifier,
      });

      await expect(commitMealsBatch(ctx, [item1, item2])).rejects.toThrow("flush failed");

      expect(clearPendingSpy).toHaveBeenCalledWith(item1.uid);
      expect(clearPendingSpy).toHaveBeenCalledWith(item2.uid);
      expect(mealStore.isPendingUpsert(item1.uid)).toBe(false);
      expect(mealStore.isPendingUpsert(item2.uid)).toBe(false);
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
      expect(mockNotifySync).not.toHaveBeenCalled();
    });
  });

  describe("AC5.4 (single flush + single notifySync per invocation)", () => {
    it("3 items → exactly 1 flush, 1 notifySync", async () => {
      const item1 = makeMeal({ deleted: false });
      const item2 = makeMeal({ deleted: false });
      const item3 = makeMeal({ deleted: false });
      const mealStore = new MealStore();

      const mockPut = vi.fn().mockResolvedValue(undefined);
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();
      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        mealStore,
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({ meals: { put: mockPut, remove: vi.fn() }, flush: mockFlush }),
        notifier: stub.notifier,
      });

      await commitMealsBatch(ctx, [item1, item2, item3]);

      expect(mockPut).toHaveBeenCalledTimes(3);
      expect(mockFlush).toHaveBeenCalledTimes(1);
      expect(mockNotifySync).toHaveBeenCalledTimes(1);
      // AC5.5: negative assertion — no resourceListChanged
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
    });
  });

  describe("AC5.5 (no resourceListChanged — negative assertion)", () => {
    it("commitMeal upsert never calls resourceListChanged", async () => {
      const saved = makeMeal({ deleted: false });
      const mealStore = new MealStore();
      const stub = makeStubNotifier();
      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        mealStore,
        client: fromAny({ notifySync: vi.fn().mockResolvedValue(undefined) }),
        cache: fromAny({
          meals: { put: vi.fn().mockResolvedValue(undefined), remove: vi.fn() },
          flush: vi.fn().mockResolvedValue(undefined),
        }),
        notifier: stub.notifier,
      });

      await commitMeal(ctx, saved);
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
    });

    it("commitMealsBatch never calls resourceListChanged", async () => {
      const item1 = makeMeal({ deleted: false });
      const item2 = makeMeal({ deleted: false });
      const mealStore = new MealStore();
      const stub = makeStubNotifier();
      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        mealStore,
        client: fromAny({ notifySync: vi.fn().mockResolvedValue(undefined) }),
        cache: fromAny({
          meals: { put: vi.fn().mockResolvedValue(undefined), remove: vi.fn() },
          flush: vi.fn().mockResolvedValue(undefined),
        }),
        notifier: stub.notifier,
      });

      await commitMealsBatch(ctx, [item1, item2]);
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
    });
  });

  it("mixed upsert and delete in one batch", async () => {
    const upserted = makeMeal({ deleted: false });
    const base = makeMeal({ deleted: false });
    const deleted = { ...base, deleted: true };
    const mealStore = new MealStore();
    mealStore.load([base]);
    const setSpy = vi.spyOn(mealStore, "set");
    const deleteSpy = vi.spyOn(mealStore, "delete");

    const mockPut = vi.fn().mockResolvedValue(undefined);
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();
    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      mealStore,
      client: fromAny({ notifySync: mockNotifySync }),
      cache: fromAny({ meals: { put: mockPut, remove: mockRemove }, flush: mockFlush }),
      notifier: stub.notifier,
    });

    await commitMealsBatch(ctx, [upserted, deleted]);

    expect(mockPut).toHaveBeenCalledWith(upserted);
    expect(mockRemove).toHaveBeenCalledWith(deleted.uid);
    expect(setSpy).toHaveBeenCalledWith(upserted);
    expect(deleteSpy).toHaveBeenCalledWith(deleted.uid);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(stub.resourceListChanged).not.toHaveBeenCalled();
    expect(mockNotifySync).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// mealToMarkdown renderer
// ---------------------------------------------------------------------------

describe("mealToMarkdown renderer", () => {
  it("freeform meal (recipeUid: null) renders _(freeform)_ and no scale line", () => {
    const meal = makeMeal({ name: "My Meal", recipeUid: null, scale: null });
    const result = mealToMarkdown(meal, "Dinner", null);
    expect(result).toContain("# My Meal");
    expect(result).toContain("**Recipe:** _(freeform)_");
    expect(result).not.toContain("**Scale:**");
    expect(result).not.toContain("**Recipe:** null");
  });

  it("recipe-linked meal renders name and UID", () => {
    const meal = makeMeal({ name: "Taco Night", recipeUid: "recipe-uid-abc", scale: null });
    const result = mealToMarkdown(meal, "Dinner", "Tacos");
    expect(result).toContain("**Recipe:** Tacos (`recipe-uid-abc`)");
    expect(result).not.toContain("_(freeform)_");
  });

  it("meal with non-null non-empty scale renders scale line", () => {
    const meal = makeMeal({ name: "Scaled", recipeUid: null, scale: "2x" });
    const result = mealToMarkdown(meal, "Lunch", null);
    expect(result).toContain("**Scale:** 2x");
  });

  it("meal with scale: null omits scale line", () => {
    const meal = makeMeal({ name: "No Scale", recipeUid: null, scale: null });
    const result = mealToMarkdown(meal, "Breakfast", null);
    expect(result).not.toContain("**Scale:**");
  });

  it("meal with scale: '' omits scale line", () => {
    const meal = makeMeal({ name: "Empty Scale", recipeUid: null, scale: "" });
    const result = mealToMarkdown(meal, "Snacks", null);
    expect(result).not.toContain("**Scale:**");
  });

  it("includes UID, date, and type fields", () => {
    const meal = makeMeal({ name: "Complete", date: "2026-03-15 12:00:00", recipeUid: null, scale: null });
    const result = mealToMarkdown(meal, "Dinner", null);
    expect(result).toContain(`**UID:** \`${meal.uid}\``);
    expect(result).toContain("**Date:** 2026-03-15 12:00:00");
    expect(result).toContain("**Type:** Dinner");
  });
});

// ---------------------------------------------------------------------------
// renderMealCard — ctx-aware display-name resolution + render (#141 follow-on)
// ---------------------------------------------------------------------------

describe("renderMealCard", () => {
  function makeCardCtx() {
    const { server } = makeTestServer();
    return seed(makeCtx(new RecipeStore(), server), {
      recipes: [makeRecipe({ uid: "tacos-uid" as RecipeUid, name: "Tacos" })],
      meals: [],
      mealTypes: [makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", originalType: 2, orderFlag: 2 })],
    });
  }

  it("resolves typeName from mealTypeStore and recipeName from the recipe store", () => {
    const meal = makeMeal({ name: "Taco Night", recipeUid: "tacos-uid", type: 2, typeUid: "dinner-uid" });
    const result = renderMealCard(makeCardCtx(), meal);
    expect(result).toContain("**Type:** Dinner");
    expect(result).toContain("**Recipe:** Tacos (`tacos-uid`)");
  });

  it("falls back to `Type N` when typeUid is unknown", () => {
    const meal = makeMeal({ name: "Mystery", recipeUid: null, type: 7, typeUid: "unknown-uid" });
    const result = renderMealCard(makeCardCtx(), meal);
    expect(result).toContain("**Type:** Type 7");
  });

  it("renders _(freeform)_ for a null recipeUid and `Type N` for a null typeUid", () => {
    const meal = makeMeal({ name: "Leftovers", recipeUid: null, type: 1, typeUid: null });
    const result = renderMealCard(makeCardCtx(), meal);
    expect(result).toContain("**Recipe:** _(freeform)_");
    expect(result).toContain("**Type:** Type 1");
  });
});
