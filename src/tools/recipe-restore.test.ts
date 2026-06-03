import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";

import { makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import { registerRestoreRecipeTool, restoreRecipeInputSchema } from "./recipe-restore.js";

describe("restore_recipe tool", () => {
  it("happy path: restores trashed recipe and calls saveRecipe with inTrash: false", async () => {
    const recipe = makeRecipe({ inTrash: true });
    const updated = makeRecipe({ uid: recipe.uid, inTrash: false });

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
    registerRestoreRecipeTool(server, ctx);

    const result = await callTool("restore_recipe", { uid: recipe.uid });
    const text = getText(result);

    // Should return the recipe markdown (not an error)
    expect(text).toContain(updated.name);
    expect(mockSaveRecipe).toHaveBeenCalledWith(expect.objectContaining({ inTrash: false }));
  });

  it("not-found: unknown uid returns not-found message", async () => {
    const recipe = makeRecipe({ inTrash: true });

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
    registerRestoreRecipeTool(server, ctx);

    const result = await callTool("restore_recipe", { uid: "nonexistent-uid" });
    const text = getText(result);

    expect(text).toContain('No recipe found with UID "nonexistent-uid".');
    expect(mockSaveRecipe).not.toHaveBeenCalled();
  });

  it("idempotent: already-active recipe returns already-in-library message without saving", async () => {
    const recipe = makeRecipe({ inTrash: false, name: "Active Recipe" });

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
    registerRestoreRecipeTool(server, ctx);

    const result = await callTool("restore_recipe", { uid: recipe.uid });
    const text = getText(result);

    expect(text).toContain("already in your active library");
    expect(mockSaveRecipe).not.toHaveBeenCalled();
  });

  it("schema: rejects unknown keys (.strict())", () => {
    expect(restoreRecipeInputSchema.safeParse({ uid: "abc-123", bogus: 1 }).success).toBe(false);
  });
});
