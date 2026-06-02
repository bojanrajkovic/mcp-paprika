import { describe, it, expect, beforeEach } from "vitest";
import { GroceryListStore } from "./grocery-list-store.js";
import { makeGroceryList } from "./__fixtures__/grocery-lists.js";
import type { GroceryListUid } from "../ids.js";

describe("GroceryListStore", () => {
  let store: GroceryListStore;

  beforeEach(() => {
    store = new GroceryListStore();
  });

  describe("grocery-infra.AC1.8: findByName tiered priority", () => {
    it("grocery-infra.AC1.8: findByName returns exact match only, not starts-with or contains", () => {
      const exact = makeGroceryList({ name: "Weekly Groceries" });
      const prefix = makeGroceryList({ name: "Weekly Groceries Extended" });
      const contains = makeGroceryList({ name: "My Weekly Groceries List" });
      store.load([exact, prefix, contains]);

      const results = store.findByName("Weekly Groceries");

      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe("Weekly Groceries");
    });

    it("grocery-infra.AC1.8: findByName is case-insensitive for exact match", () => {
      const list = makeGroceryList({ name: "Weekly Groceries" });
      store.load([list]);

      const results = store.findByName("weekly groceries");

      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe("Weekly Groceries");
    });

    it("grocery-infra.AC1.8: findByName returns starts-with tier when no exact match", () => {
      const prefix1 = makeGroceryList({ name: "Weekly Groceries" });
      const prefix2 = makeGroceryList({ name: "Weekly Staples" });
      const contains = makeGroceryList({ name: "My Weekly List" });
      store.load([prefix1, prefix2, contains]);

      const results = store.findByName("Week");

      expect(results).toHaveLength(2);
      const names = results.map((r) => r.name);
      expect(names).toContain("Weekly Groceries");
      expect(names).toContain("Weekly Staples");
      expect(names).not.toContain("My Weekly List");
    });

    it("grocery-infra.AC1.8: findByName returns contains tier when no exact or starts-with match", () => {
      const contains1 = makeGroceryList({ name: "My Groceries" });
      const contains2 = makeGroceryList({ name: "All Groceries Here" });
      store.load([contains1, contains2]);

      const results = store.findByName("oceri");

      expect(results).toHaveLength(2);
      const names = results.map((r) => r.name);
      expect(names).toContain("My Groceries");
      expect(names).toContain("All Groceries Here");
    });

    it("grocery-infra.AC1.8: findByName returns empty array when no match", () => {
      const list = makeGroceryList({ name: "Weekly Groceries" });
      store.load([list]);

      const results = store.findByName("nonexistent");

      expect(results).toHaveLength(0);
    });

    it("grocery-infra.AC1.8: findByName priority — starts-with wins over contains", () => {
      const startsWithList1 = makeGroceryList({ name: "Weekly Groceries" });
      const startsWithList2 = makeGroceryList({ name: "Weekly Staples" });
      const containsList = makeGroceryList({ name: "My Weekly List" });
      store.load([startsWithList1, startsWithList2, containsList]);

      const results = store.findByName("Weekly");

      expect(results).toHaveLength(2);
      const names = results.map((r) => r.name);
      expect(names).toContain("Weekly Groceries");
      expect(names).toContain("Weekly Staples");
      expect(names).not.toContain("My Weekly List");
    });
  });

  describe("CRUD and tombstone basics", () => {
    it("load() populates store and sets hasSynced to true", () => {
      const list1 = makeGroceryList();
      const list2 = makeGroceryList();

      store.load([list1, list2]);

      expect(store.get(list1.uid)).toBe(list1);
      expect(store.get(list2.uid)).toBe(list2);
      expect(store.hasSynced).toBe(true);
    });

    it("get(uid) returns undefined for unknown uid", () => {
      store.load([]);

      const result = store.get("does-not-exist" as GroceryListUid);

      expect(result).toBeUndefined();
    });

    it("findByName excludes deleted (tombstoned) lists", () => {
      const list = makeGroceryList({ uid: "uid-1" as GroceryListUid, name: "Weekly Groceries" });
      store.load([list]);
      store.delete("uid-1" as GroceryListUid);

      const results = store.findByName("Weekly Groceries");

      expect(results).toHaveLength(0);
    });

    it("lastSyncedAt returns null before setLastSyncedAt()", () => {
      expect(store.lastSyncedAt).toBeNull();
    });

    it("lastSyncedAt returns Date after setLastSyncedAt()", () => {
      const now = new Date();
      store.setLastSyncedAt(now);

      expect(store.lastSyncedAt).toBe(now);
    });

    it("setLastSyncedAt() defaults to current date when called without argument", () => {
      const before = new Date();
      store.setLastSyncedAt();
      const after = new Date();

      const at = store.lastSyncedAt;
      expect(at).not.toBeNull();
      expect(at!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(at!.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });
});
