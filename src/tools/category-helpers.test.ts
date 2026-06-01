import { describe, it, expect, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { makeServerContext } from "../__fixtures__/app-context.js";
import {
  commitCategoryUpsert,
  commitCategoryDelete,
  maxCategoryOrderFlag,
  recipesReferencing,
  wouldCreateCycle,
} from "./category-helpers.js";
import { seed } from "./tool-test-utils.js";
import type { CategoryUid } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";

function makeCtx(overrides?: {
  recipes?: Parameters<RecipeStore["load"]>[0];
  categories?: ReturnType<typeof makeCategory>[];
  cache?: unknown;
  notifySync?: ReturnType<typeof vi.fn>;
}): { ctx: ServerContext; notifySync: ReturnType<typeof vi.fn> } {
  const store = new RecipeStore();
  const notifySync = overrides?.notifySync ?? vi.fn().mockResolvedValue(undefined);

  const ctx = makeServerContext({
    store,
    client: fromAny({ notifySync }),
    cache: fromAny(
      overrides?.cache ?? {
        categories: { put: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
        flush: vi.fn().mockResolvedValue(undefined),
      },
    ),
  });
  seed(ctx, {
    recipes: overrides?.recipes ?? [makeRecipe()],
    categories: overrides?.categories ?? [],
  });
  return { ctx, notifySync };
}

describe("category-helpers", () => {
  describe("commitCategoryUpsert", () => {
    it("marks pending, persists, sets the store, and notifies", async () => {
      const category = makeCategory({ uid: "c" as CategoryUid });
      const { ctx, notifySync } = makeCtx();

      await commitCategoryUpsert(ctx, category);

      expect(ctx.categoryStore.get("c" as CategoryUid)).toBe(category);
      expect(ctx.categoryStore.isPendingUpsert("c" as CategoryUid)).toBe(true);
      expect(notifySync).toHaveBeenCalledTimes(1);
    });

    it("clears the pending mark and rethrows when the cache write fails", async () => {
      const category = makeCategory({ uid: "c" as CategoryUid });
      const boom = new Error("disk full");
      const { ctx, notifySync } = makeCtx({
        cache: {
          categories: { put: vi.fn().mockRejectedValue(boom), remove: vi.fn() },
          flush: vi.fn().mockResolvedValue(undefined),
        },
      });

      await expect(commitCategoryUpsert(ctx, category)).rejects.toThrow("disk full");
      expect(ctx.categoryStore.isPendingUpsert("c" as CategoryUid)).toBe(false);
      expect(ctx.categoryStore.get("c" as CategoryUid)).toBeUndefined();
      expect(notifySync).not.toHaveBeenCalled();
    });
  });

  describe("commitCategoryDelete", () => {
    it("marks pending-delete, removes, and notifies", async () => {
      const category = makeCategory({ uid: "c" as CategoryUid });
      const { ctx, notifySync } = makeCtx({ categories: [category] });

      await commitCategoryDelete(ctx, category);

      expect(ctx.categoryStore.get("c" as CategoryUid)).toBeUndefined();
      expect(ctx.categoryStore.isTombstone("c" as CategoryUid)).toBe(true);
      expect(notifySync).toHaveBeenCalledTimes(1);
    });

    it("clears the pending mark and rethrows when the cache remove fails", async () => {
      const category = makeCategory({ uid: "c" as CategoryUid });
      const boom = new Error("io error");
      const { ctx, notifySync } = makeCtx({
        categories: [category],
        cache: {
          categories: { put: vi.fn(), remove: vi.fn().mockRejectedValue(boom) },
          flush: vi.fn().mockResolvedValue(undefined),
        },
      });

      await expect(commitCategoryDelete(ctx, category)).rejects.toThrow("io error");
      expect(ctx.categoryStore.isPendingDelete("c" as CategoryUid)).toBe(false);
      // Still present — the store delete never ran.
      expect(ctx.categoryStore.get("c" as CategoryUid)).toBe(category);
      expect(notifySync).not.toHaveBeenCalled();
    });
  });

  describe("maxCategoryOrderFlag", () => {
    it("returns -1 for an empty store", () => {
      const { ctx } = makeCtx({ categories: [] });
      expect(maxCategoryOrderFlag(ctx)).toBe(-1);
    });

    it("returns the highest orderFlag present", () => {
      const { ctx } = makeCtx({
        categories: [
          makeCategory({ uid: "a" as CategoryUid, orderFlag: 2 }),
          makeCategory({ uid: "b" as CategoryUid, orderFlag: 7 }),
          makeCategory({ uid: "c" as CategoryUid, orderFlag: 4 }),
        ],
      });
      expect(maxCategoryOrderFlag(ctx)).toBe(7);
    });
  });

  describe("recipesReferencing", () => {
    it("returns referencing recipes INCLUDING trashed ones (so delete can't orphan a restorable recipe)", () => {
      const { ctx } = makeCtx({
        recipes: [
          makeRecipe({ uid: "r1" as never, categories: ["c" as CategoryUid] }),
          makeRecipe({ uid: "r2" as never, categories: [] as Array<CategoryUid> }),
          makeRecipe({ uid: "r3" as never, categories: ["c" as CategoryUid], inTrash: true }),
        ],
      });
      const refs = recipesReferencing(ctx, "c" as CategoryUid);
      expect(refs.map((r) => r.uid).sort()).toEqual(["r1", "r3"]);
    });
  });

  describe("wouldCreateCycle", () => {
    it("is true when the proposed parent is a descendant (deep chain)", () => {
      // a -> b -> c ; moving a under c closes a loop
      const { ctx } = makeCtx({
        categories: [
          makeCategory({ uid: "a" as CategoryUid, parentUid: null }),
          makeCategory({ uid: "b" as CategoryUid, parentUid: "a" }),
          makeCategory({ uid: "c" as CategoryUid, parentUid: "b" }),
        ],
      });
      expect(wouldCreateCycle(ctx, "a" as CategoryUid, "c")).toBe(true);
    });

    it("is false for a legal re-parent that does not close a loop", () => {
      const { ctx } = makeCtx({
        categories: [
          makeCategory({ uid: "a" as CategoryUid, parentUid: null }),
          makeCategory({ uid: "b" as CategoryUid, parentUid: null }),
        ],
      });
      expect(wouldCreateCycle(ctx, "a" as CategoryUid, "b")).toBe(false);
    });

    it("terminates on a pre-corrupt parent chain", () => {
      // x -> y -> x is already a loop in the data; the seen-set must bound the walk.
      const { ctx } = makeCtx({
        categories: [
          makeCategory({ uid: "x" as CategoryUid, parentUid: "y" }),
          makeCategory({ uid: "y" as CategoryUid, parentUid: "x" }),
        ],
      });
      expect(wouldCreateCycle(ctx, "z" as CategoryUid, "x")).toBe(false);
    });
  });
});
