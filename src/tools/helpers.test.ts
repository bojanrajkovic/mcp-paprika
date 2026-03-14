import { describe, it, expect, vi } from "vitest";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { coldStartGuard, textResult, recipeToMarkdown, commitRecipe, resolveCategoryNames } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";
import type { DiskCache } from "../cache/disk-cache.js";
import type { PaprikaClient } from "../paprika/client.js";

// Minimal ServerContext stub — only `store.size` matters for coldStartGuard
const makeCtx = (size: number) =>
  ({
    store: { size } as unknown as ServerContext["store"],
    client: {} as unknown as ServerContext["client"],
    cache: {} as unknown as ServerContext["cache"],
    server: {} as unknown as ServerContext["server"],
  }) satisfies ServerContext;

describe("p2-u02-shared-helpers: shared helper functions", () => {
  describe("p2-u02-shared-helpers.AC1: textResult wraps a string in the MCP wire envelope", () => {
    it("p2-u02-shared-helpers.AC1.1: textResult('hello') returns { content: [{ type: 'text', text: 'hello' }] }", () => {
      const result = textResult("hello");
      expect(result).toEqual({ content: [{ type: "text", text: "hello" }] });
    });

    it("p2-u02-shared-helpers.AC1.2: textResult('') returns { content: [{ type: 'text', text: '' }] } (empty string is valid)", () => {
      const result = textResult("");
      expect(result).toEqual({ content: [{ type: "text", text: "" }] });
    });
  });

  describe("p2-u02-shared-helpers.AC2: coldStartGuard gatekeeps tool invocations against an empty store", () => {
    it("p2-u02-shared-helpers.AC2.1: returns Ok<void> when store.size > 0", () => {
      const result = coldStartGuard(makeCtx(1)).match(
        () => true,
        () => false,
      );
      expect(result).toBe(true);
    });

    it("p2-u02-shared-helpers.AC2.1b: returns Ok<void> when store.size = 5", () => {
      const result = coldStartGuard(makeCtx(5)).match(
        () => true,
        () => false,
      );
      expect(result).toBe(true);
    });

    it("p2-u02-shared-helpers.AC2.2: returns Err when store.size === 0", () => {
      const result = coldStartGuard(makeCtx(0)).match(
        () => false,
        () => true,
      );
      expect(result).toBe(true);
    });

    it("p2-u02-shared-helpers.AC2.3: the Err payload has the shape { content: [{ type: 'text', text: string }] } — a ready-to-return CallToolResult", () => {
      const errPayload = coldStartGuard(makeCtx(0)).match(
        () => null,
        (guard) => guard,
      );
      expect(errPayload).toMatchObject({
        content: [{ type: "text", text: expect.any(String) }],
      });
    });

    it("p2-u02-shared-helpers.AC2.4: the Err message instructs the user to retry (e.g., 'Try again in a few seconds')", () => {
      const errPayload = coldStartGuard(makeCtx(0)).match(
        () => null,
        (guard) => guard,
      );
      expect(errPayload).not.toBeNull();
      if (errPayload) {
        const text = errPayload.content[0].text;
        expect(text.toLowerCase()).toContain("try again");
      }
    });

    it("p2-u02-shared-helpers.AC2.5: Usage pattern - ok branch returns textResult-compatible value", () => {
      const result = coldStartGuard(makeCtx(1)).match(
        () => "ok",
        (guard) => guard.content[0].text,
      );
      expect(result).toBe("ok");
    });

    it("p2-u02-shared-helpers.AC2.5b: Usage pattern - err branch returns the retry message", () => {
      const result = coldStartGuard(makeCtx(0)).match(
        () => "ok",
        (guard) => guard.content[0].text,
      );
      expect(result).not.toBe("ok");
      expect(result.toLowerCase()).toContain("try again");
    });
  });

  describe("p2-u02-shared-helpers.AC3: recipeToMarkdown renders a recipe as human-readable markdown", () => {
    it("p2-u02-shared-helpers.AC3.1: output starts with # {recipe.name}", () => {
      const recipe = makeRecipe({ name: "Chocolate Cake" });
      const output = recipeToMarkdown(recipe, []);
      expect(output.startsWith("# Chocolate Cake")).toBe(true);
    });

    it("p2-u02-shared-helpers.AC3.2: output always contains ## Ingredients section", () => {
      const recipe = makeRecipe();
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("## Ingredients");
    });

    it("p2-u02-shared-helpers.AC3.3: output always contains ## Directions section", () => {
      const recipe = makeRecipe();
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("## Directions");
    });

    it("p2-u02-shared-helpers.AC3.4a: description field is included when non-empty", () => {
      const recipe = makeRecipe({ description: "Tasty cake with frosting" });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("Tasty cake with frosting");
    });

    it("p2-u02-shared-helpers.AC3.4b: description field is omitted when null", () => {
      const recipe = makeRecipe({ description: null });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("## Description");
    });

    it("p2-u02-shared-helpers.AC3.5a: non-empty categoryNames appear in output", () => {
      const recipe = makeRecipe();
      const output = recipeToMarkdown(recipe, ["Dessert", "Chocolate"]);
      expect(output).toContain("Dessert");
      expect(output).toContain("Chocolate");
    });

    it("p2-u02-shared-helpers.AC3.6: empty categoryNames array results in no categories section", () => {
      const recipe = makeRecipe();
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**Categories:**");
    });

    it("p2-u02-shared-helpers.AC3.4c: notes field is included when non-empty", () => {
      const recipe = makeRecipe({ notes: "My personal note" });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("## Notes");
      expect(output).toContain("My personal note");
    });

    it("p2-u02-shared-helpers.AC3.4d: notes field is omitted when null", () => {
      const recipe = makeRecipe({ notes: null });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("## Notes");
    });

    it("p2-u02-shared-helpers.AC3.4e: nutritionalInfo field is included when non-empty", () => {
      const recipe = makeRecipe({ nutritionalInfo: "200 cal" });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("## Nutritional Info");
      expect(output).toContain("200 cal");
    });

    it("p2-u02-shared-helpers.AC3.4f: nutritionalInfo field is omitted when null", () => {
      const recipe = makeRecipe({ nutritionalInfo: null });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("## Nutritional Info");
    });

    it("p2-u02-shared-helpers.AC3.4g: source with sourceUrl is rendered as markdown link", () => {
      const recipe = makeRecipe({
        source: "Food Network",
        sourceUrl: "https://example.com",
      });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("[Food Network](https://example.com)");
    });

    it("p2-u02-shared-helpers.AC3.4h: source without sourceUrl is plain text", () => {
      const recipe = makeRecipe({
        source: "Food Network",
        sourceUrl: null,
      });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**Source:** Food Network");
      expect(output).not.toContain("[Food Network]");
    });

    it("p2-u02-shared-helpers.AC3.4i: sourceUrl without source is plain link", () => {
      const recipe = makeRecipe({
        source: null,
        sourceUrl: "https://example.com",
      });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**Source:** https://example.com");
    });

    it("p2-u02-shared-helpers.AC3.4j: when source and sourceUrl are both null/empty, no source section appears", () => {
      const recipe = makeRecipe({
        source: null,
        sourceUrl: null,
      });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**Source:**");
    });
  });

  describe("p2-recipe-crud.AC-helpers: resolveCategoryNames", () => {
    it("p2-recipe-crud.AC-helpers.1: exact name match returns the category's UID in uids and empty unknown array", () => {
      const cat = makeCategory({ name: "Desserts" });
      const result = resolveCategoryNames([cat], ["Desserts"]);
      expect(result.uids).toHaveLength(1);
      expect(result.uids[0]).toBe(cat.uid);
      expect(result.unknown).toEqual([]);
    });

    it("p2-recipe-crud.AC-helpers.2: case-insensitive match (desserts matches Desserts) returns the UID, not in unknown", () => {
      const cat = makeCategory({ name: "Desserts" });
      const result = resolveCategoryNames([cat], ["desserts"]);
      expect(result.uids).toHaveLength(1);
      expect(result.uids[0]).toBe(cat.uid);
      expect(result.unknown).toEqual([]);
    });

    it("p2-recipe-crud.AC-helpers.3: unrecognized name appears in unknown, not in uids", () => {
      const cat = makeCategory({ name: "Desserts" });
      const result = resolveCategoryNames([cat], ["Breakfast"]);
      expect(result.uids).toEqual([]);
      expect(result.unknown).toEqual(["Breakfast"]);
    });

    it("p2-recipe-crud.AC-helpers.4: mix of known and unknown — known go to uids, unknown go to unknown, both in input order", () => {
      const cat1 = makeCategory({ name: "Desserts" });
      const cat2 = makeCategory({ name: "Breakfast" });
      const result = resolveCategoryNames([cat1, cat2], ["Breakfast", "Unknown", "Desserts", "Other"]);
      expect(result.uids).toEqual([cat2.uid, cat1.uid]);
      expect(result.unknown).toEqual(["Unknown", "Other"]);
    });

    it("p2-recipe-crud.AC-helpers.5: empty names array returns uids: [], unknown: []", () => {
      const cat = makeCategory({ name: "Desserts" });
      const result = resolveCategoryNames([cat], []);
      expect(result.uids).toEqual([]);
      expect(result.unknown).toEqual([]);
    });

    it("p2-recipe-crud.AC-helpers.6: empty all categories array with non-empty names returns all names in unknown", () => {
      const result = resolveCategoryNames([], ["Desserts", "Breakfast"]);
      expect(result.uids).toEqual([]);
      expect(result.unknown).toEqual(["Desserts", "Breakfast"]);
    });
  });

  describe("p2-recipe-crud.AC-helpers: commitRecipe", () => {
    it("p2-recipe-crud.AC-helpers.7: calls putRecipe, flush, store.set, and notifySync exactly once each", async () => {
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockStoreSet = vi.fn();

      const ctx = {
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
        client: { notifySync: mockNotifySync } as unknown as PaprikaClient,
        store: { set: mockStoreSet } as unknown as ServerContext["store"],
        server: {} as unknown as ServerContext["server"],
      } satisfies ServerContext;

      const saved = makeRecipe();
      await commitRecipe(ctx, saved);

      expect(mockPutRecipe).toHaveBeenCalledTimes(1);
      expect(mockFlush).toHaveBeenCalledTimes(1);
      expect(mockStoreSet).toHaveBeenCalledTimes(1);
      expect(mockNotifySync).toHaveBeenCalledTimes(1);
    });

    it("p2-recipe-crud.AC-helpers.8: putRecipe is called before flush (verify call order)", async () => {
      const callOrder: Array<string> = [];

      const mockPutRecipe = vi.fn(() => {
        callOrder.push("putRecipe");
      });
      const mockFlush = vi.fn(async () => {
        callOrder.push("flush");
      });
      const mockNotifySync = vi.fn(async () => {
        callOrder.push("notifySync");
      });
      const mockStoreSet = vi.fn(() => {
        callOrder.push("storeSet");
      });

      const ctx = {
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
        client: { notifySync: mockNotifySync } as unknown as PaprikaClient,
        store: { set: mockStoreSet } as unknown as ServerContext["store"],
        server: {} as unknown as ServerContext["server"],
      } satisfies ServerContext;

      const saved = makeRecipe();
      await commitRecipe(ctx, saved);

      expect(callOrder).toEqual(["putRecipe", "flush", "storeSet", "notifySync"]);
    });

    it("p2-recipe-crud.AC-helpers.9: store.set is called with the saved recipe", async () => {
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockStoreSet = vi.fn();

      const ctx = {
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
        client: { notifySync: mockNotifySync } as unknown as PaprikaClient,
        store: { set: mockStoreSet } as unknown as ServerContext["store"],
        server: {} as unknown as ServerContext["server"],
      } satisfies ServerContext;

      const saved = makeRecipe({ name: "Test Recipe" });
      await commitRecipe(ctx, saved);

      expect(mockStoreSet).toHaveBeenCalledWith(saved);
    });
  });
});
