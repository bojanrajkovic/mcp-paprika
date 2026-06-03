import { describe, expect, it } from "vitest";

import { makeAisle } from "../../test/cache/__fixtures__/aisles.js";
import { AisleStore } from "./store.js";

describe("aisle-store: AisleStore", () => {
  it("aisle-store.AC1.1: hasSynced is false before load()", () => {
    const store = new AisleStore();
    expect(store.hasSynced).toBe(false);
  });

  it("aisle-store.AC1.2: load([]) sets hasSynced = true", () => {
    const store = new AisleStore();
    store.load([]);
    expect(store.hasSynced).toBe(true);
  });

  it("aisle-store.AC1.3: load(items) populates store and sets hasSynced", () => {
    const store = new AisleStore();
    const a1 = makeAisle({ name: "Produce" });
    const a2 = makeAisle({ name: "Dairy" });
    store.load([a1, a2]);
    expect(store.hasSynced).toBe(true);
    expect(store.size).toBe(2);
    expect(store.getAll()).toHaveLength(2);
  });

  it("aisle-store.AC1.4: load() replaces previous contents", () => {
    const store = new AisleStore();
    const a1 = makeAisle({ name: "Old Aisle" });
    store.load([a1]);
    const a2 = makeAisle({ name: "New Aisle" });
    store.load([a2]);
    expect(store.size).toBe(1);
    expect(store.getAll()[0]?.name).toBe("New Aisle");
  });

  describe("resolveByName", () => {
    it("aisle-store.AC2.1: finds exact match", () => {
      const store = new AisleStore();
      const aisle = makeAisle({ name: "Produce" });
      store.load([aisle]);
      const found = store.resolveByName("Produce");
      expect(found).toBeDefined();
      expect(found?.uid).toBe(aisle.uid);
    });

    it("aisle-store.AC2.2: match is case-insensitive", () => {
      const store = new AisleStore();
      const aisle = makeAisle({ name: "Dairy" });
      store.load([aisle]);
      expect(store.resolveByName("dairy")).toBeDefined();
      expect(store.resolveByName("DAIRY")).toBeDefined();
      expect(store.resolveByName("DaIrY")).toBeDefined();
    });

    it("aisle-store.AC2.3: returns undefined when not found", () => {
      const store = new AisleStore();
      store.load([makeAisle({ name: "Produce" })]);
      expect(store.resolveByName("Frozen")).toBeUndefined();
    });

    it("aisle-store.AC2.4: returns undefined on empty store", () => {
      const store = new AisleStore();
      store.load([]);
      expect(store.resolveByName("Anything")).toBeUndefined();
    });
  });

  describe("pending-writes", () => {
    it("aisle-store.AC3.1: markPendingUpsert/isPendingUpsert round-trips", () => {
      const store = new AisleStore();
      const aisle = makeAisle();
      store.load([aisle]);
      expect(store.isPendingUpsert(aisle.uid)).toBe(false);
      store.markPendingUpsert(aisle.uid);
      expect(store.isPendingUpsert(aisle.uid)).toBe(true);
    });

    it("aisle-store.AC3.2: clearPending removes the pending flag", () => {
      const store = new AisleStore();
      const aisle = makeAisle();
      store.load([aisle]);
      store.markPendingUpsert(aisle.uid);
      store.clearPending(aisle.uid);
      expect(store.isPendingUpsert(aisle.uid)).toBe(false);
    });

    it("aisle-store.AC3.3: sweepPending evicts expired entries", () => {
      const store = new AisleStore({ pendingWriteTtlMs: 100 });
      const aisle = makeAisle();
      store.load([aisle]);
      store.markPendingUpsert(aisle.uid, Date.now() - 200);
      const swept = store.sweepPending();
      expect(swept).toBeGreaterThan(0);
      expect(store.isPendingUpsert(aisle.uid)).toBe(false);
    });

    it("aisle-store.AC3.4: sweepPending leaves non-expired entries", () => {
      const store = new AisleStore({ pendingWriteTtlMs: 60_000 });
      const aisle = makeAisle();
      store.load([aisle]);
      store.markPendingUpsert(aisle.uid);
      const swept = store.sweepPending();
      expect(swept).toBe(0);
      expect(store.isPendingUpsert(aisle.uid)).toBe(true);
    });

    it("aisle-store.AC3.5: set() after markPendingUpsert keeps the item", () => {
      const store = new AisleStore();
      const aisle = makeAisle({ name: "Bakery" });
      store.load([]);
      store.markPendingUpsert(aisle.uid);
      store.set(aisle);
      expect(store.resolveByName("Bakery")).toBeDefined();
      expect(store.isPendingUpsert(aisle.uid)).toBe(true);
    });
  });

  it("aisle-store.AC4.1: pendingWriteCount getter", () => {
    const store = new AisleStore();
    const a1 = makeAisle();
    const a2 = makeAisle();
    store.load([a1, a2]);
    expect(store.pendingWriteCount).toBe(0);
    store.markPendingUpsert(a1.uid);
    expect(store.pendingWriteCount).toBe(1);
    store.markPendingUpsert(a2.uid);
    expect(store.pendingWriteCount).toBe(2);
  });
});
