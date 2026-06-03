import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";

import { makeCategory, makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import { registerUpdateTool, updateRecipeInputSchema } from "./update.js";

describe("p2-recipe-crud: update_recipe tool", () => {
  describe("p2-recipe-crud.AC3: update_recipe applies partial updates", () => {
    it("p2-recipe-crud.AC3.1: provided fields are updated, omitted fields retain existing values", async () => {
      const recipe = makeRecipe({ name: "Old Name", servings: "2" });

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const updated = makeRecipe({ name: "New Name", servings: "2" });
      mockSaveRecipe.mockResolvedValue(updated);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [recipe] },
      );
      registerUpdateTool(server, ctx);

      await callTool("update_recipe", { uid: recipe.uid, name: "New Name" });

      const callArgs = mockSaveRecipe.mock.calls[0]?.[0];
      expect(callArgs?.name).toBe("New Name");
      expect(callArgs?.servings).toBe("2"); // unchanged from existing
    });

    it("p2-recipe-crud.AC3.3: update_recipe preserves the recipe's existing categories untouched", async () => {
      const catA = makeCategory({ name: "Category A" });
      const recipe = makeRecipe({ categories: [catA.uid] });

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const updated = makeRecipe({ name: "New Name", categories: [catA.uid] });
      mockSaveRecipe.mockResolvedValue(updated);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [recipe] },
      );
      registerUpdateTool(server, ctx);

      await callTool("update_recipe", { uid: recipe.uid, name: "New Name" });

      const callArgs = mockSaveRecipe.mock.calls[0]?.[0];
      expect(callArgs?.categories).toEqual([catA.uid]); // categories are not touched by update_recipe
    });

    it("p2-recipe-crud.AC3.4: saveRecipe and notifySync called exactly once with merged recipe", async () => {
      const recipe = makeRecipe({ name: "Old", servings: "4" });

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const updated = makeRecipe({ name: "New", servings: "4" });
      mockSaveRecipe.mockResolvedValue(updated);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [recipe] },
      );
      registerUpdateTool(server, ctx);

      await callTool("update_recipe", { uid: recipe.uid, name: "New" });

      expect(mockSaveRecipe).toHaveBeenCalledOnce();
      expect(mockNotifySync).toHaveBeenCalledOnce();
      const callArgs = mockSaveRecipe.mock.calls[0]?.[0];
      expect(callArgs?.name).toBe("New");
      expect(callArgs?.servings).toBe("4");
    });

    it("p2-recipe-crud.AC3.5: UID not found returns not-found message", async () => {
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
      registerUpdateTool(server, ctx);

      const result = await callTool("update_recipe", { uid: "nonexistent-uid", name: "New" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("no recipe found");
      expect(mockSaveRecipe).not.toHaveBeenCalled();
    });

    it("p2-recipe-crud.AC3.6: saveRecipe throws — returns error message, store not updated", async () => {
      const recipe = makeRecipe();

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      mockSaveRecipe.mockRejectedValue(new Error("Conflict"));

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [recipe] },
      );
      registerUpdateTool(server, ctx);

      const result = await callTool("update_recipe", { uid: recipe.uid, name: "New" });
      const text = getText(result);

      expect(text).toContain("Failed to update");
      expect(text).toContain("Conflict");
      expect(mockPutRecipe).not.toHaveBeenCalled();
    });

    it("p2-recipe-crud.AC3.7: cold-start guard fires before store lookup", async () => {
      // store not loaded — size === 0

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
        cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
      });
      registerUpdateTool(server, ctx);

      const result = await callTool("update_recipe", { uid: "any-uid", name: "New" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("try again");
      expect(mockSaveRecipe).not.toHaveBeenCalled();
    });

    it("p2-recipe-crud.AC3.9: notes provided — saveRecipe called with that value", async () => {
      const recipe = makeRecipe({ notes: null });

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const updated = makeRecipe({ notes: "test note" });
      mockSaveRecipe.mockResolvedValue(updated);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [recipe] },
      );
      registerUpdateTool(server, ctx);

      await callTool("update_recipe", { uid: recipe.uid, notes: "test note" });

      const callArgs = mockSaveRecipe.mock.calls[0]?.[0];
      expect(callArgs?.notes).toBe("test note");
    });
  });

  // The promoted state fields left update_recipe for their own intent verbs. The
  // schema is `.strict()`, so passing one is a hard rejection (the SDK surfaces it
  // as an isError) rather than a silently dropped key — the model can't "win" by
  // patching the field on the generic editor.
  describe("update_recipe input schema rejects promoted fields", () => {
    it("rejects rating (promoted to rate_recipe)", () => {
      expect(updateRecipeInputSchema.safeParse({ uid: "recipe-1", rating: 5 }).success).toBe(false);
    });

    it("rejects categories (promoted to categorize_recipe)", () => {
      expect(updateRecipeInputSchema.safeParse({ uid: "recipe-1", categories: ["Dinner"] }).success).toBe(false);
    });

    it("rejects inTrash (promoted to trash_recipe / restore_recipe)", () => {
      expect(updateRecipeInputSchema.safeParse({ uid: "recipe-1", inTrash: true }).success).toBe(false);
    });

    it("accepts a content-only update", () => {
      expect(updateRecipeInputSchema.safeParse({ uid: "recipe-1", name: "New", notes: "n" }).success).toBe(true);
    });
  });
});
