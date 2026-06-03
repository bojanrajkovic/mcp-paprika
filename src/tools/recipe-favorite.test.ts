import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";

import { makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import {
  favoriteRecipeInputSchema,
  registerFavoriteRecipeTool,
  registerUnfavoriteRecipeTool,
  unfavoriteRecipeInputSchema,
} from "./recipe-favorite.js";

describe("favorite_recipe tool", () => {
  it("happy path: sets onFavorites true and renders markdown with On Favorites", async () => {
    const recipe = makeRecipe({ onFavorites: false });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: true });

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
    registerFavoriteRecipeTool(server, ctx);

    const result = await callTool("favorite_recipe", { uid: recipe.uid });
    const text = getText(result);

    expect(text).toContain("**On Favorites:** Yes");
    expect(mockSaveRecipe).toHaveBeenCalledWith(expect.objectContaining({ onFavorites: true }));
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
    registerFavoriteRecipeTool(server, ctx);

    const result = await callTool("favorite_recipe", { uid: "nonexistent-uid" });
    const text = getText(result);

    expect(text).toContain('No recipe found with UID "nonexistent-uid".');
    expect(mockSaveRecipe).not.toHaveBeenCalled();
  });

  it("schema: rejects unknown keys (.strict())", () => {
    expect(favoriteRecipeInputSchema.safeParse({ uid: "abc-123", bogus: 1 }).success).toBe(false);
  });
});

describe("unfavorite_recipe tool", () => {
  it("happy path: sets onFavorites false and renders markdown without On Favorites", async () => {
    const recipe = makeRecipe({ onFavorites: true });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: false });

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
    registerUnfavoriteRecipeTool(server, ctx);

    const result = await callTool("unfavorite_recipe", { uid: recipe.uid });
    const text = getText(result);

    expect(text).not.toContain("**On Favorites:** Yes");
    expect(mockSaveRecipe).toHaveBeenCalledWith(expect.objectContaining({ onFavorites: false }));
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
    registerUnfavoriteRecipeTool(server, ctx);

    const result = await callTool("unfavorite_recipe", { uid: "nonexistent-uid" });
    const text = getText(result);

    expect(text).toContain('No recipe found with UID "nonexistent-uid".');
    expect(mockSaveRecipe).not.toHaveBeenCalled();
  });

  it("schema: rejects unknown keys (.strict())", () => {
    expect(unfavoriteRecipeInputSchema.safeParse({ uid: "abc-123", bogus: 1 }).success).toBe(false);
  });
});
