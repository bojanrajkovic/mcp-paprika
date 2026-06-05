import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useTempDir } from "../../test/support/disk-caches.js";
import { cosineScore, dotProduct, JsonVectorIndex, vectorNorm } from "./json-vector-index.js";

describe("cosine primitives", () => {
  it("vectorNorm computes the L2 norm", () => {
    expect(vectorNorm([3, 4])).toBe(5);
    expect(vectorNorm([0, 0, 0])).toBe(0);
    expect(vectorNorm([1])).toBe(1);
  });

  it("dotProduct sums elementwise products", () => {
    expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(dotProduct([1, 0], [0, 1])).toBe(0);
  });

  it("cosineScore is 1 for identical directions and 0 for orthogonal", () => {
    expect(cosineScore([1, 1], vectorNorm([1, 1]), [2, 2], vectorNorm([2, 2]))).toBeCloseTo(1, 12);
    expect(cosineScore([1, 0], 1, [0, 1], 1)).toBe(0);
    expect(cosineScore([1, 0], 1, [-1, 0], 1)).toBe(-1);
  });

  it("cosineScore returns NaN when either norm is zero (caller must filter)", () => {
    expect(Number.isNaN(cosineScore([0, 0], 0, [1, 0], 1))).toBe(true);
    expect(Number.isNaN(cosineScore([1, 0], 1, [0, 0], 0))).toBe(true);
  });
});

describe("JsonVectorIndex", () => {
  const tmp = useTempDir("json-vector-index-");

  beforeEach(tmp.setup);
  afterEach(tmp.teardown);

  async function freshIndex(): Promise<JsonVectorIndex> {
    const idx = new JsonVectorIndex(tmp.dir());
    await idx.createIndex();
    return idx;
  }

  describe("lifecycle", () => {
    it("isIndexCreated reflects whether the file exists", async () => {
      const idx = new JsonVectorIndex(tmp.dir());
      expect(await idx.isIndexCreated()).toBe(false);
      await idx.createIndex();
      expect(await idx.isIndexCreated()).toBe(true);
    });

    it("createIndex throws if an index already exists", async () => {
      const idx = await freshIndex();
      await expect(idx.createIndex()).rejects.toThrow(/already exists/i);
    });

    it("createIndex({ deleteIfExists }) replaces an existing index", async () => {
      const idx = await freshIndex();
      await idx.upsertItem({ id: "a", vector: [1, 0] });
      const reset = new JsonVectorIndex(tmp.dir());
      await reset.createIndex({ deleteIfExists: true });
      expect(await reset.queryItems([1, 0], 10)).toHaveLength(0);
    });
  });

  describe("query ranking", () => {
    it("ranks by cosine similarity, highest first", async () => {
      const idx = await freshIndex();
      await idx.upsertItem({ id: "same", vector: [1, 0], metadata: { recipeName: "Same" } });
      await idx.upsertItem({ id: "diag", vector: [1, 1] });
      await idx.upsertItem({ id: "ortho", vector: [0, 1] });

      const res = await idx.queryItems([1, 0], 10);
      expect(res.map((r) => r.item.id)).toEqual(["same", "diag", "ortho"]);
      expect(res[0]!.score).toBeCloseTo(1, 12);
      expect(res[2]!.score).toBeCloseTo(0, 12);
      expect(res[0]!.item.metadata).toEqual({ recipeName: "Same" });
    });

    it("returns [] for topK <= 0 and clamps topK above item count", async () => {
      const idx = await freshIndex();
      await idx.upsertItem({ id: "a", vector: [1, 0] });
      await idx.upsertItem({ id: "b", vector: [0, 1] });
      expect(await idx.queryItems([1, 0], 0)).toHaveLength(0);
      expect(await idx.queryItems([1, 0], -3)).toHaveLength(0);
      expect(await idx.queryItems([1, 0], 99)).toHaveLength(2);
    });

    it("breaks score ties deterministically by id (ascending)", async () => {
      const idx = await freshIndex();
      // Three vectors equidistant from the query — all score identically.
      await idx.upsertItem({ id: "c", vector: [1, 0] });
      await idx.upsertItem({ id: "a", vector: [1, 0] });
      await idx.upsertItem({ id: "b", vector: [1, 0] });
      const res = await idx.queryItems([1, 0], 10);
      expect(res.map((r) => r.item.id)).toEqual(["a", "b", "c"]);
    });

    it("returns no results for a zero-norm query rather than NaN scores", async () => {
      const idx = await freshIndex();
      await idx.upsertItem({ id: "a", vector: [1, 0] });
      const res = await idx.queryItems([0, 0], 10);
      expect(res).toHaveLength(0);
    });

    it("drops results below minScore before the top-K cut", async () => {
      const idx = await freshIndex();
      await idx.upsertItem({ id: "match", vector: [1, 0] }); // cosine 1.0
      await idx.upsertItem({ id: "weak", vector: [1, 8] }); // cosine ~0.124
      expect((await idx.queryItems([1, 0], 10)).map((r) => r.item.id)).toEqual(["match", "weak"]);
      expect((await idx.queryItems([1, 0], 10, 0.5)).map((r) => r.item.id)).toEqual(["match"]);
    });
  });

  describe("norm is a cache, not source of truth (vectra stale-norm bug fix)", () => {
    it("recomputes the norm when an item's vector is replaced via upsert", async () => {
      const idx = await freshIndex();
      // First vector has norm 5; replace with a unit vector pointing elsewhere.
      await idx.upsertItem({ id: "x", vector: [3, 4] });
      await idx.upsertItem({ id: "x", vector: [0, 1] });
      const res = await idx.queryItems([0, 1], 10);
      expect(res).toHaveLength(1);
      // Score must reflect the NEW unit vector (cosine 1), not the stale [3,4] norm.
      expect(res[0]!.score).toBeCloseTo(1, 12);
    });

    it("ignores a wrong persisted norm and recomputes on load", async () => {
      // Hand-write an index whose stored norm is deliberately wrong.
      await writeFile(
        join(tmp.dir(), "index.json"),
        JSON.stringify({ version: 1, items: [{ id: "x", vector: [3, 4], norm: 999, metadata: {} }] }),
      );
      const idx = new JsonVectorIndex(tmp.dir());
      const res = await idx.queryItems([3, 4], 10);
      // With the correct norm (5), self-cosine is 1; the bogus 999 would crush it.
      expect(res[0]!.score).toBeCloseTo(1, 12);
    });
  });

  describe("boundary validation", () => {
    it("rejects a zero-norm vector on upsert", async () => {
      const idx = await freshIndex();
      await expect(idx.upsertItem({ id: "z", vector: [0, 0] })).rejects.toThrow(/zero-norm/i);
    });

    it("rejects an empty vector", async () => {
      const idx = await freshIndex();
      await expect(idx.upsertItem({ id: "e", vector: [] })).rejects.toThrow(/non-empty/i);
    });

    it("rejects non-finite values", async () => {
      const idx = await freshIndex();
      await expect(idx.upsertItem({ id: "n", vector: [1, Number.NaN] })).rejects.toThrow(/non-finite/i);
      await expect(idx.upsertItem({ id: "i", vector: [Number.POSITIVE_INFINITY, 1] })).rejects.toThrow(/non-finite/i);
    });

    it("rejects a vector whose dimension disagrees with the index", async () => {
      const idx = await freshIndex();
      await idx.upsertItem({ id: "a", vector: [1, 0, 0] });
      await expect(idx.upsertItem({ id: "b", vector: [1, 0] })).rejects.toThrow(/dimension/i);
      await expect(idx.queryItems([1, 0], 10)).rejects.toThrow(/dimension/i);
    });

    it("throws on load when the persisted file contains a non-finite vector", async () => {
      await writeFile(
        join(tmp.dir(), "index.json"),
        JSON.stringify({ version: 1, items: [{ id: "x", vector: [1, null], metadata: {} }] }),
      );
      const idx = new JsonVectorIndex(tmp.dir());
      await expect(idx.loadIndexData()).rejects.toThrow();
    });

    it("throws on load when the persisted file contains a zero-norm vector", async () => {
      await writeFile(
        join(tmp.dir(), "index.json"),
        JSON.stringify({ version: 1, items: [{ id: "x", vector: [0, 0], metadata: {} }] }),
      );
      const idx = new JsonVectorIndex(tmp.dir());
      await expect(idx.loadIndexData()).rejects.toThrow(/zero-norm/i);
    });
  });

  describe("transactions", () => {
    it("cancelUpdate discards in-flight changes", async () => {
      const idx = await freshIndex();
      await idx.upsertItem({ id: "a", vector: [1, 0] });
      await idx.beginUpdate();
      await idx.upsertItem({ id: "b", vector: [0, 1] });
      idx.cancelUpdate();
      // 'b' was only in the cancelled transaction; a fresh load must not see it.
      const reloaded = new JsonVectorIndex(tmp.dir());
      expect(await reloaded.queryItems([0, 1], 10).then((r) => r.map((x) => x.item.id))).toEqual(["a"]);
    });

    it("throws if a second update begins while one is in progress", async () => {
      const idx = await freshIndex();
      await idx.beginUpdate();
      await expect(idx.beginUpdate()).rejects.toThrow(/in progress/i);
    });

    it("does not pin the dimension from a transaction that is cancelled", async () => {
      const idx = await freshIndex(); // empty: dimension not yet pinned
      await idx.beginUpdate();
      await idx.upsertItem({ id: "a", vector: [1, 0] }); // stages a 2-dim item
      // A mismatched item fails against the in-transaction dimension, not a
      // committed one.
      await expect(idx.upsertItem({ id: "b", vector: [1, 0, 0] })).rejects.toThrow(/dimension/i);
      idx.cancelUpdate();
      // The cancelled transaction must NOT have pinned dimension=2 — a fresh
      // index at a different dimension has to still work (it would throw before
      // the fix, deadlocking re-indexing until restart).
      await idx.upsertItem({ id: "c", vector: [1, 0, 0] });
      const res = await idx.queryItems([1, 0, 0], 10);
      expect(res.map((r) => r.item.id)).toEqual(["c"]);
      expect(res[0]!.score).toBeCloseTo(1, 12);
    });

    it("endUpdate persists a batch atomically", async () => {
      const idx = await freshIndex();
      await idx.beginUpdate();
      await idx.upsertItem({ id: "a", vector: [1, 0] });
      await idx.upsertItem({ id: "b", vector: [0, 1] });
      await idx.endUpdate();
      const reloaded = new JsonVectorIndex(tmp.dir());
      const res = await reloaded.queryItems([1, 0], 10);
      expect(res.map((r) => r.item.id).sort()).toEqual(["a", "b"]);
    });
  });

  describe("delete", () => {
    it("removes an item; missing ids are a no-op", async () => {
      const idx = await freshIndex();
      await idx.upsertItem({ id: "a", vector: [1, 0] });
      await idx.upsertItem({ id: "b", vector: [0, 1] });
      await idx.deleteItem("a");
      await idx.deleteItem("does-not-exist");
      const res = await idx.queryItems([1, 0], 10);
      expect(res.map((r) => r.item.id)).toEqual(["b"]);
    });
  });

  describe("persistence + format compatibility", () => {
    it("round-trips items across instances", async () => {
      const idx = await freshIndex();
      await idx.upsertItem({ id: "a", vector: [2, 0], metadata: { recipeName: "A", text: "alpha" } });
      const reloaded = new JsonVectorIndex(tmp.dir());
      const res = await reloaded.queryItems([1, 0], 10);
      expect(res[0]!.item.metadata).toEqual({ recipeName: "A", text: "alpha" });
    });

    it("loads a vectra-shaped index.json (extra metadata_config ignored)", async () => {
      await writeFile(
        join(tmp.dir(), "index.json"),
        JSON.stringify({
          version: 1,
          metadata_config: { indexed: ["recipeName"] },
          items: [
            { id: "a", vector: [1, 0], norm: 1, metadata: { recipeName: "Vectra A" } },
            { id: "b", vector: [0, 1], norm: 1, metadata: { recipeName: "Vectra B" } },
          ],
        }),
      );
      const idx = new JsonVectorIndex(tmp.dir());
      const res = await idx.queryItems([1, 0], 10);
      expect(res[0]!.item.id).toBe("a");
      expect(res[0]!.item.metadata).toEqual({ recipeName: "Vectra A" });
    });

    it("writes durably via a temp file then rename (no leftover temp files)", async () => {
      const idx = await freshIndex();
      await idx.upsertItem({ id: "a", vector: [1, 0] });
      const entries = await readFile(join(tmp.dir(), "index.json"), "utf-8");
      expect(JSON.parse(entries).items).toHaveLength(1);
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(tmp.dir());
      expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
    });
  });
});

// Guard for the corruption-recovery path the VectorStore relies on: a structurally
// broken file must surface as a thrown error so init() can back up and rebuild.
describe("JsonVectorIndex corruption surfaces to caller", () => {
  const tmp = useTempDir("json-vector-index-corrupt-");
  beforeEach(tmp.setup);
  afterEach(tmp.teardown);

  it("throws on unparseable JSON", async () => {
    await mkdir(tmp.dir(), { recursive: true });
    await writeFile(join(tmp.dir(), "index.json"), "{ not valid json");
    const idx = new JsonVectorIndex(tmp.dir());
    await expect(idx.loadIndexData()).rejects.toThrow();
  });
});
