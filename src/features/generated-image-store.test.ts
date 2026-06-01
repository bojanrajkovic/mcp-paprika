import { describe, it, expect } from "vitest";
import { GeneratedImageStore, GENERATED_IMAGE_TTL_SECONDS, MAX_GENERATED_IMAGES } from "./generated-image-store.js";

function entry(overrides?: Partial<{ bytes: Buffer; mimeType: string; recipeUid: string; model: string }>) {
  return {
    bytes: Buffer.from([0xff, 0xd8, 0xff]),
    mimeType: "image/jpeg",
    recipeUid: "RECIPE-1",
    model: "seedream",
    ...overrides,
  };
}

describe("GeneratedImageStore", () => {
  it("put returns a gen_ token; consume returns the stashed entry", () => {
    const store = new GeneratedImageStore();
    const token = store.put(entry({ recipeUid: "RECIPE-7" }));
    expect(token).toMatch(/^gen_[A-Za-z0-9_-]+$/);

    const got = store.consume(token);
    expect(got?.recipeUid).toBe("RECIPE-7");
    expect(got?.bytes).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(got?.createdAt).toBeTypeOf("number");
  });

  it("consume is single-use — a second consume returns null", () => {
    const store = new GeneratedImageStore();
    const token = store.put(entry());
    expect(store.consume(token)).not.toBeNull();
    expect(store.consume(token)).toBeNull();
  });

  it("consume of an unknown token returns null", () => {
    expect(new GeneratedImageStore().consume("gen_nope")).toBeNull();
  });

  it("peek returns the entry without removing it; consume still works after", () => {
    const store = new GeneratedImageStore();
    const token = store.put(entry({ recipeUid: "R9" }));
    expect(store.peek(token)?.recipeUid).toBe("R9");
    expect(store.peek(token)?.recipeUid).toBe("R9"); // still there
    expect(store.size).toBe(1);
    expect(store.consume(token)).not.toBeNull(); // now spent
    expect(store.peek(token)).toBeNull();
  });

  it("peek of an expired token returns null and evicts it", () => {
    const clock = { value: 1_000_000_000 };
    const store = new GeneratedImageStore({ ttlMs: 3_600_000, now: () => clock.value });
    const token = store.put(entry());
    clock.value += 3_600_000 + 1_000;
    expect(store.peek(token)).toBeNull();
    expect(store.size).toBe(0);
  });

  it("mints distinct tokens for distinct puts", () => {
    const store = new GeneratedImageStore();
    const a = store.put(entry());
    const b = store.put(entry());
    expect(a).not.toBe(b);
  });

  it("expires an entry past its TTL", () => {
    const clock = { value: 1_000_000_000 };
    const store = new GeneratedImageStore({ ttlMs: 3_600_000, now: () => clock.value });
    const token = store.put(entry());
    clock.value += 3_600_000 + 1_000; // just past 1h
    expect(store.consume(token)).toBeNull();
  });

  it("evicts the oldest entry when at capacity (ring buffer)", () => {
    const store = new GeneratedImageStore({ maxEntries: 2 });
    const t1 = store.put(entry({ recipeUid: "R1" }));
    const t2 = store.put(entry({ recipeUid: "R2" }));
    const t3 = store.put(entry({ recipeUid: "R3" })); // evicts t1

    expect(store.size).toBe(2);
    expect(store.consume(t1)).toBeNull(); // oldest dropped
    expect(store.consume(t2)?.recipeUid).toBe("R2");
    expect(store.consume(t3)?.recipeUid).toBe("R3");
  });

  it("exposes sane defaults", () => {
    expect(GENERATED_IMAGE_TTL_SECONDS).toBe(60 * 60);
    expect(MAX_GENERATED_IMAGES).toBe(8);
  });
});
