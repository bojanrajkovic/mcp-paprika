import type { ClientCapabilities, ElicitRequestFormParams, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { ElicitationServer } from "./elicit.js";

import { getText } from "../../test/support/tool-test-utils.js";
import { RecipeUidSchema } from "../domains/recipe/ids.js";
import {
  commitFailure,
  confirmOrCancel,
  formatLookupOutcome,
  imageResult,
  type LookupOutcome,
  resolveLookup,
  resolveOrPick,
  toolResult,
  uidOrTextLookupSchema,
} from "./tools.js";

/**
 * A stub {@link ElicitationServer}: a responder marks the client form-capable and
 * answers the pick; omitting it models a client that never advertised elicitation
 * (so the gate is unsupported and the lookup falls back to prose).
 */
function elicitServer(respond?: (params: ElicitRequestFormParams) => ElicitResult): ElicitationServer {
  return {
    getClientCapabilities: () =>
      respond ? ({ elicitation: { form: {} } } as unknown as ClientCapabilities) : undefined,
    elicitInput: (params) =>
      respond ? Promise.resolve(respond(params)) : Promise.reject(new Error("unreachable: no responder")),
  };
}

describe("shared helper functions", () => {
  describe("toolResult wraps a string in the MCP wire envelope", () => {
    it("toolResult('hello') returns { content: [{ type: 'text', text: 'hello' }] }", () => {
      const result = toolResult("hello");
      expect(result).toEqual({ content: [{ type: "text", text: "hello" }] });
    });

    it("toolResult('') returns { content: [{ type: 'text', text: '' }] } (empty string is valid)", () => {
      const result = toolResult("");
      expect(result).toEqual({ content: [{ type: "text", text: "" }] });
    });

    it("the two-argument form carries structuredContent alongside the text block", () => {
      const result = toolResult("Pasta", { uid: "abc", name: "Pasta" });
      expect(result).toEqual({
        content: [{ type: "text", text: "Pasta" }],
        structuredContent: { uid: "abc", name: "Pasta" },
      });
    });
  });

  describe("imageResult carries a text block plus a JPEG image content block (R2)", () => {
    it("inlines the bytes as base64 with mimeType image/jpeg, no isError", () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
      const result = imageResult("attached", jpeg);
      expect(result).toEqual({
        content: [
          { type: "text", text: "attached" },
          { type: "image", data: jpeg.toString("base64"), mimeType: "image/jpeg" },
        ],
      });
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

describe("formatLookupOutcome (no elicitation → prose for every non-happy arm)", () => {
  const entity: ToyEntity = { id: "A", label: "Alpha" };
  const config = {
    entityNoun: "recipe",
    describe: (e: ToyEntity) => ({ uid: e.id, label: e.label }),
    renderOne: (e: ToyEntity) => `# ${e.label}`,
  };
  const noElicit = elicitServer();
  const text = async (outcome: LookupOutcome<ToyEntity>) =>
    getText(await formatLookupOutcome(noElicit, outcome, config));

  it("uid_hit and text_one both render via renderOne", async () => {
    expect(await text({ kind: "uid_hit", entity })).toBe("# Alpha");
    expect(await text({ kind: "text_one", entity })).toBe("# Alpha");
  });

  it("uid_miss uses the singular noun", async () => {
    expect(await text({ kind: "uid_miss", uid: "Z" })).toBe('No recipe found with UID "Z".');
  });

  it("text_none uses the pluralized noun", async () => {
    expect(await text({ kind: "text_none", text: "zzz" })).toBe('No recipes found matching "zzz".');
  });

  it("text_many lists each match and prompts for a specific uid", async () => {
    const beta: ToyEntity = { id: "B", label: "Alphabet" };
    const result = await text({ kind: "text_many", text: "Alpha", matches: [entity, beta] });
    expect(result).toContain('Multiple recipes match "Alpha":');
    expect(result).toContain("- **Alpha** (uid: `A`)");
    expect(result).toContain("- **Alphabet** (uid: `B`)");
    expect(result).toContain("Please re-invoke with a specific uid");
  });
});

describe("resolveOrPick (text_many → disambiguation PICK, ADR-0020)", () => {
  const alpha: ToyEntity = { id: "A", label: "Alpha" };
  const beta: ToyEntity = { id: "B", label: "Alphabet" };
  const config = { entityNoun: "recipe", describe: (e: ToyEntity) => ({ uid: e.id, label: e.label }) };
  const many: LookupOutcome<ToyEntity> = { kind: "text_many", text: "Alpha", matches: [alpha, beta] };

  it("the happy arms pass straight through as { entity }", async () => {
    expect(await resolveOrPick(elicitServer(), { kind: "uid_hit", entity: alpha }, config)).toEqual({ entity: alpha });
    expect(await resolveOrPick(elicitServer(), { kind: "text_one", entity: beta }, config)).toEqual({ entity: beta });
  });

  it("returns the chosen entity when the user picks from text_many", async () => {
    const server = elicitServer(() => ({ action: "accept", content: { choice: "B" } }));
    expect(await resolveOrPick(server, many, config)).toEqual({ entity: beta });
  });

  it("falls back to the disambiguation prose when the user declines", async () => {
    const resolved = await resolveOrPick(
      elicitServer(() => ({ action: "decline" })),
      many,
      config,
    );
    expect("result" in resolved ? getText(resolved.result) : "").toContain('Multiple recipes match "Alpha":');
  });

  it("falls back to prose without eliciting when the client cannot be asked", async () => {
    const resolved = await resolveOrPick(elicitServer(), many, config);
    expect("result" in resolved ? getText(resolved.result) : "").toContain("Please re-invoke with a specific uid");
  });

  it("skips the pick and lists when the match set exceeds the cap", async () => {
    const matches: ToyEntity[] = Array.from({ length: 9 }, (_, i) => ({ id: `U${i}`, label: `Item ${i}` }));
    let asked = false;
    const server = elicitServer(() => {
      asked = true;
      return { action: "accept", content: { choice: "U0" } };
    });
    const resolved = await resolveOrPick(server, { kind: "text_many", text: "Item", matches }, config);
    expect(asked).toBe(false);
    expect("result" in resolved).toBe(true);
  });
});

describe("confirmOrCancel (destructive-tool confirm gate, ADR-0020)", () => {
  const opts = { message: "Permanently delete X?", cancelled: "Cancelled — X was not deleted." };

  it("returns the plain cancel result (not isError) when the user declines", async () => {
    const stop = await confirmOrCancel(
      elicitServer(() => ({ action: "decline" })),
      opts,
    );
    expect(stop ? getText(stop) : "").toBe("Cancelled — X was not deleted.");
    expect(stop?.isError).toBeUndefined();
  });

  it("returns undefined (proceed) when the user accepts", async () => {
    expect(
      await confirmOrCancel(
        elicitServer(() => ({ action: "accept" })),
        opts,
      ),
    ).toBeUndefined();
  });

  it("returns undefined (fail-open) when the client cannot be elicited", async () => {
    expect(await confirmOrCancel(elicitServer(), opts)).toBeUndefined();
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
