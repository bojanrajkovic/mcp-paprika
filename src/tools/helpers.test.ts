import { fromAny } from "@total-typescript/shoehorn";
import { describe, it, expect, vi } from "vitest";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import {
  coldStartGuard,
  textResult,
  recipeToMarkdown,
  recipeMetadataLines,
  commitRecipe,
  resolveCategoryNames,
  uidOrTextLookupSchema,
  resolveLookup,
  formatLookupOutcome,
  type LookupOutcome,
} from "./helpers.js";
import { RecipeUidSchema } from "../paprika/types.js";
import { getText } from "./tool-test-utils.js";
import type { ServerContext } from "../types/server-context.js";
import { makeServerContext } from "../__fixtures__/app-context.js";

// Minimal ServerContext stub — only `store.hasSynced` matters for coldStartGuard
const makeCtx = (size: number) =>
  makeServerContext({
    store: fromAny({ size, hasSynced: size > 0 }),
    notifier: {
      resourceListChanged: () => {},
      loggingMessage: async () => {},
    },
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

    it("p2-u02-shared-helpers.AC3.4k: created field always appears in output", () => {
      const recipe = makeRecipe({ created: "2026-03-15T10:00:00Z" });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**Created:**");
      expect(output).toContain("2026-03-15T10:00:00Z");
    });

    it("p2-u02-shared-helpers.AC3.4l-pos: rating appears as X/5 when > 0", () => {
      const recipe = makeRecipe({ rating: 4 });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**Rating:** 4/5");
    });

    it("p2-u02-shared-helpers.AC3.4l-neg: rating section omitted when rating is 0", () => {
      const recipe = makeRecipe({ rating: 0 });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**Rating:**");
    });

    it("p2-u02-shared-helpers.AC3.4m-pos: isPinned appears when true", () => {
      const recipe = makeRecipe({ isPinned: true });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**Pinned:** Yes");
    });

    it("p2-u02-shared-helpers.AC3.4m-neg: isPinned section omitted when false", () => {
      const recipe = makeRecipe({ isPinned: false });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**Pinned:**");
    });

    it("p2-u02-shared-helpers.AC3.4n-pos: onGroceryList appears when true", () => {
      const recipe = makeRecipe({ onGroceryList: true });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**On Grocery List:** Yes");
    });

    it("p2-u02-shared-helpers.AC3.4n-neg: onGroceryList section omitted when false", () => {
      const recipe = makeRecipe({ onGroceryList: false });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**On Grocery List:**");
    });

    it("p2-u02-shared-helpers.AC3.4o-pos: onFavorites appears when true", () => {
      const recipe = makeRecipe({ onFavorites: true });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**On Favorites:** Yes");
    });

    it("p2-u02-shared-helpers.AC3.4o-neg: onFavorites section omitted when false", () => {
      const recipe = makeRecipe({ onFavorites: false });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**On Favorites:**");
    });
  });

  describe("lastCookedAt parameter", () => {
    it("recipeToMarkdown includes Last Cooked when provided", () => {
      const recipe = makeRecipe({ name: "Test" });
      const output = recipeToMarkdown(recipe, [], "2026-05-20 00:00:00");
      expect(output).toContain("**Last Cooked:** 2026-05-20");
    });

    it("recipeToMarkdown omits Last Cooked when null", () => {
      const recipe = makeRecipe({ name: "Test" });
      const output = recipeToMarkdown(recipe, [], null);
      expect(output).not.toContain("**Last Cooked:**");
    });

    it("recipeToMarkdown omits Last Cooked when omitted", () => {
      const recipe = makeRecipe({ name: "Test" });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**Last Cooked:**");
    });

    it("recipeMetadataLines includes Last Cooked when provided", () => {
      const recipe = makeRecipe({ rating: 0 });
      const lines = recipeMetadataLines(recipe, "2026-03-15 00:00:00");
      expect(lines).toContain("**Last Cooked:** 2026-03-15");
    });

    it("recipeMetadataLines omits Last Cooked when null", () => {
      const recipe = makeRecipe({ rating: 0 });
      const lines = recipeMetadataLines(recipe, null);
      expect(lines.some((l) => l.includes("Last Cooked"))).toBe(false);
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
    it("p2-recipe-crud.AC-helpers.7: calls putRecipe, flush, store.set, notifier.resourceListChanged, and notifySync exactly once each", async () => {
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockStoreSet = vi.fn();
      const mockResourceListChanged = vi.fn();

      const ctx = makeServerContext({
        cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        client: fromAny({ notifySync: mockNotifySync }),
        store: fromAny({
          set: mockStoreSet,
          markPendingUpsert: vi.fn(),
          markPendingDelete: vi.fn(),
        }),
        notifier: {
          resourceListChanged: mockResourceListChanged,
          loggingMessage: vi.fn().mockResolvedValue(undefined),
        },
      }) satisfies ServerContext;

      const saved = makeRecipe();
      await commitRecipe(ctx, saved);

      expect(mockPutRecipe).toHaveBeenCalledTimes(1);
      expect(mockFlush).toHaveBeenCalledTimes(1);
      expect(mockStoreSet).toHaveBeenCalledTimes(1);
      expect(mockResourceListChanged).toHaveBeenCalledTimes(1);
      expect(mockNotifySync).toHaveBeenCalledTimes(1);
    });

    it("p2-recipe-crud.AC-helpers.8: call order is putRecipe → flush → storeSet → resourceListChanged → notifySync", async () => {
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
      const mockResourceListChanged = vi.fn(() => {
        callOrder.push("resourceListChanged");
      });

      const ctx = makeServerContext({
        cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        client: fromAny({ notifySync: mockNotifySync }),
        store: fromAny({
          set: mockStoreSet,
          markPendingUpsert: vi.fn(),
          markPendingDelete: vi.fn(),
        }),
        notifier: {
          resourceListChanged: mockResourceListChanged,
          loggingMessage: vi.fn().mockResolvedValue(undefined),
        },
      }) satisfies ServerContext;

      const saved = makeRecipe();
      await commitRecipe(ctx, saved);

      expect(callOrder).toEqual(["putRecipe", "flush", "storeSet", "resourceListChanged", "notifySync"]);
    });

    it("p2-recipe-crud.AC-helpers.9: store.set is called with the saved recipe", async () => {
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockStoreSet = vi.fn();
      const mockResourceListChanged = vi.fn();

      const ctx = makeServerContext({
        cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        client: fromAny({ notifySync: mockNotifySync }),
        store: fromAny({
          set: mockStoreSet,
          markPendingUpsert: vi.fn(),
          markPendingDelete: vi.fn(),
        }),
        notifier: {
          resourceListChanged: mockResourceListChanged,
          loggingMessage: vi.fn().mockResolvedValue(undefined),
        },
      }) satisfies ServerContext;

      const saved = makeRecipe({ name: "Test Recipe" });
      await commitRecipe(ctx, saved);

      expect(mockStoreSet).toHaveBeenCalledWith(saved);
    });

    it("p2-recipe-crud.AC-helpers.10: clearPending fires and store.set is skipped when cache.putRecipe rejects", async () => {
      const mockPutRecipe = vi.fn().mockRejectedValue(new Error("disk full"));
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockStoreSet = vi.fn();
      const mockMarkPendingUpsert = vi.fn();
      const mockClearPending = vi.fn();
      const mockResourceListChanged = vi.fn();

      const ctx = makeServerContext({
        cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        client: fromAny({ notifySync: mockNotifySync }),
        store: fromAny({
          set: mockStoreSet,
          markPendingUpsert: mockMarkPendingUpsert,
          markPendingDelete: vi.fn(),
          clearPending: mockClearPending,
        }),
        notifier: {
          resourceListChanged: mockResourceListChanged,
          loggingMessage: vi.fn().mockResolvedValue(undefined),
        },
      }) satisfies ServerContext;

      const saved = makeRecipe({ name: "Test Recipe" });
      await expect(commitRecipe(ctx, saved)).rejects.toThrow("disk full");

      expect(mockMarkPendingUpsert).toHaveBeenCalledWith(saved.uid);
      expect(mockClearPending).toHaveBeenCalledWith(saved.uid);
      expect(mockStoreSet).not.toHaveBeenCalled();
      expect(mockResourceListChanged).not.toHaveBeenCalled();
      expect(mockNotifySync).not.toHaveBeenCalled();
    });
  });
});

// Shared uid-or-text lookup helpers (#142). Tested generically with a toy
// entity so the contract is independent of any one store/tool.
interface ToyEntity {
  readonly id: string;
  readonly label: string;
}

describe("uidOrTextLookupSchema", () => {
  const schema = uidOrTextLookupSchema({
    uidSchema: RecipeUidSchema,
    textKey: "title",
    entityLabel: "recipe",
    textExample: "Chocolate Cake",
  });

  it("accepts the {uid} shape", () => {
    expect(schema.parse({ uid: "ABC-123" })).toEqual({ uid: "ABC-123" });
  });

  it("accepts the {textKey} shape", () => {
    expect(schema.parse({ title: "Cake" })).toEqual({ title: "Cake" });
  });

  it("rejects supplying both keys at once (strict union, no overlap)", () => {
    expect(() => schema.parse({ uid: "ABC-123", title: "Cake" })).toThrow();
  });

  it("rejects an unknown key (strict objects)", () => {
    expect(() => schema.parse({ uid: "ABC-123", extra: "x" })).toThrow();
  });

  it("rejects an empty text value (min(1) survives the brand swap)", () => {
    expect(() => schema.parse({ title: "" })).toThrow();
  });

  it("rejects an empty uid (branded schema enforces .min(1))", () => {
    // #142 regression guard: the branded uid member must keep the non-empty
    // constraint the pre-refactor inline z.string().min(1) enforced.
    expect(() => schema.parse({ uid: "" })).toThrow();
  });

  it("templates per-entity describe text from the config", () => {
    // The union-level description names the alternate shapes; the text key is
    // interpolated so each entity reads naturally.
    expect(schema.description).toBe('Pick exactly one shape: {"uid": "..."} or {"title": "..."}.');
  });
});

describe("resolveLookup", () => {
  const alpha: ToyEntity = { id: "A", label: "Alpha" };
  const beta: ToyEntity = { id: "B", label: "Alphabet" };

  const ops = {
    get: (uid: string) => (uid === "A" ? alpha : undefined),
    findByText: (text: string) => [alpha, beta].filter((e) => e.label.toLowerCase().includes(text.toLowerCase())),
  };

  it("uid present and found → uid_hit with the entity", () => {
    expect(resolveLookup({ uid: "A" }, ops)).toEqual({ kind: "uid_hit", entity: alpha });
  });

  it("uid present and missing → uid_miss carrying the uid", () => {
    expect(resolveLookup({ uid: "Z" }, ops)).toEqual({ kind: "uid_miss", uid: "Z" });
  });

  it("text with no matches → text_none carrying the query", () => {
    expect(resolveLookup({ text: "zzz" }, ops)).toEqual({ kind: "text_none", text: "zzz" });
  });

  it("text with exactly one match → text_one with the entity", () => {
    expect(resolveLookup({ text: "Alphabet" }, ops)).toEqual({ kind: "text_one", entity: beta });
  });

  it("text with multiple matches → text_many with all matches", () => {
    const outcome = resolveLookup({ text: "Alpha" }, ops);
    expect(outcome).toEqual({ kind: "text_many", text: "Alpha", matches: [alpha, beta] });
  });
});

describe("formatLookupOutcome", () => {
  const entity: ToyEntity = { id: "A", label: "Alpha" };
  const config = {
    entityNoun: "recipe",
    renderOne: (e: ToyEntity) => `# ${e.label}`,
    disambiguationLine: (e: ToyEntity) => `- ${e.label} (UID: ${e.id})`,
  };
  const text = (outcome: LookupOutcome<ToyEntity>) => getText(formatLookupOutcome(outcome, config));

  it("uid_hit and text_one both render via renderOne", () => {
    expect(text({ kind: "uid_hit", entity })).toBe("# Alpha");
    expect(text({ kind: "text_one", entity })).toBe("# Alpha");
  });

  it("uid_miss uses the singular noun", () => {
    expect(text({ kind: "uid_miss", uid: "Z" })).toBe('No recipe found with UID "Z".');
  });

  it("text_none uses the pluralized noun", () => {
    expect(text({ kind: "text_none", text: "zzz" })).toBe('No recipes found matching "zzz".');
  });

  it("text_many lists each match and prompts for a specific uid", () => {
    const beta: ToyEntity = { id: "B", label: "Alphabet" };
    const result = text({ kind: "text_many", text: "Alpha", matches: [entity, beta] });
    expect(result).toContain('Multiple recipes match "Alpha":');
    expect(result).toContain("- Alpha (UID: A)");
    expect(result).toContain("- Alphabet (UID: B)");
    expect(result).toContain("Please re-invoke with a specific uid");
  });
});
