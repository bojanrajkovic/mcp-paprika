import { err, ok } from "neverthrow";
import { describe, expect, it } from "vitest";

import { getText } from "../../test/support/tool-test-utils.js";
import { RecipeUidSchema } from "../ids.js";
import {
  commitFailure,
  formatLookupOutcome,
  type LookupOutcome,
  resolveLookup,
  textResult,
  uidOrTextLookupSchema,
} from "./tools.js";

describe("shared helper functions", () => {
  describe("textResult wraps a string in the MCP wire envelope", () => {
    it("textResult('hello') returns { content: [{ type: 'text', text: 'hello' }] }", () => {
      const result = textResult("hello");
      expect(result).toEqual({ content: [{ type: "text", text: "hello" }] });
    });

    it("textResult('') returns { content: [{ type: 'text', text: '' }] } (empty string is valid)", () => {
      const result = textResult("");
      expect(result).toEqual({ content: [{ type: "text", text: "" }] });
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

describe("commitFailure", () => {
  it("returns undefined when the commit succeeded", () => {
    expect(commitFailure("recipe", ok(undefined))).toBeUndefined();
  });

  it("renders the persisted-but-local-commit-failed response on err", () => {
    const result = commitFailure("grocery list", err({ message: "disk full" }));
    expect(result).toBeDefined();
    const text = getText(result!);
    expect(text).toContain("saved to Paprika");
    expect(text).toContain("local grocery list cache failed (disk full)");
    expect(text).toContain("next sync");
  });

  it("drops the self-heal promise for diff-synced entities", () => {
    const result = commitFailure("recipe", err({ message: "disk full" }), { selfHealing: false });
    const text = getText(result!);
    expect(text).toContain("may remain stale");
    expect(text).toContain("do not re-submit");
    expect(text).not.toContain("next sync.");
  });
});
