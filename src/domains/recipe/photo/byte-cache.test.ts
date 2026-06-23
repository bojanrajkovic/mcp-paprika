import { describe, expect, it } from "vitest";

import { PhotoByteCache } from "./byte-cache.js";

const buf = (s: string): Buffer => Buffer.from(s);

describe("PhotoByteCache", () => {
  it("stores and returns bytes by key", () => {
    const cache = new PhotoByteCache(4);
    cache.set("a", buf("alpha"));
    expect(cache.get("a")?.toString()).toBe("alpha");
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts the least-recently-used entry past the cap", () => {
    const cache = new PhotoByteCache(2);
    cache.set("a", buf("1"));
    cache.set("b", buf("2"));
    cache.set("c", buf("3")); // evicts "a"
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")?.toString()).toBe("2");
    expect(cache.get("c")?.toString()).toBe("3");
    expect(cache.size).toBe(2);
  });

  it("a get bumps recency so the bumped key survives the next eviction", () => {
    const cache = new PhotoByteCache(2);
    cache.set("a", buf("1"));
    cache.set("b", buf("2"));
    cache.get("a"); // "a" is now most-recently-used
    cache.set("c", buf("3")); // evicts "b", not "a"
    expect(cache.get("a")?.toString()).toBe("1");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")?.toString()).toBe("3");
  });

  it("overwrites an existing key without growing", () => {
    const cache = new PhotoByteCache(2);
    cache.set("a", buf("1"));
    cache.set("a", buf("2"));
    expect(cache.get("a")?.toString()).toBe("2");
    expect(cache.size).toBe(1);
  });
});
