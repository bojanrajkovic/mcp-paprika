import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";

import { makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import { rateRecipeInputSchema, registerRateRecipeTool } from "./recipe-rating.js";

describe("rate_recipe tool", () => {
  it("happy path: sets rating and renders markdown with updated star rating", async () => {
    const recipe = makeRecipe({ rating: 0 });
    const updated = makeRecipe({ uid: recipe.uid, rating: 4 });

    const mockSaveRecipe = vi.fn().mockResolvedValue(updated);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutRecipe = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
        cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
      }),
      { recipes: [recipe] },
    );
    registerRateRecipeTool(server, ctx);

    const result = await callTool("rate_recipe", { uid: recipe.uid, rating: 4 });
    const text = getText(result);

    expect(text).toContain("**Rating:** 4/5");
    expect(mockSaveRecipe).toHaveBeenCalledWith(expect.objectContaining({ rating: 4 }));
  });

  it("not-found: unknown uid returns not-found message", async () => {
    const recipe = makeRecipe();

    const mockSaveRecipe = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutRecipe = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
        cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
      }),
      { recipes: [recipe] },
    );
    registerRateRecipeTool(server, ctx);

    const result = await callTool("rate_recipe", { uid: "nonexistent-uid", rating: 3 });
    const text = getText(result);

    expect(text).toContain('No recipe found with UID "nonexistent-uid".');
    expect(mockSaveRecipe).not.toHaveBeenCalled();
  });

  it("schema: rejects unknown keys (.strict())", () => {
    expect(rateRecipeInputSchema.safeParse({ uid: "abc-123", rating: 3, bogus: 1 }).success).toBe(false);
  });

  it("schema: rejects out-of-range rating", () => {
    expect(rateRecipeInputSchema.safeParse({ uid: "abc-123", rating: 9 }).success).toBe(false);
  });

  it("schema: rejects rating below 0", () => {
    expect(rateRecipeInputSchema.safeParse({ uid: "abc-123", rating: -1 }).success).toBe(false);
  });

  it("schema: accepts rating 0 (clear)", () => {
    expect(rateRecipeInputSchema.safeParse({ uid: "abc-123", rating: 0 }).success).toBe(true);
  });

  it("schema: accepts rating 5 (max)", () => {
    expect(rateRecipeInputSchema.safeParse({ uid: "abc-123", rating: 5 }).success).toBe(true);
  });
});
