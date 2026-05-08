import { describe, it, expect, beforeEach } from "vitest";
import { PantryStore } from "./pantry-store.js";
import { makePantryItem } from "./__fixtures__/pantry.js";
import type { PantryItemUid } from "../paprika/types.js";

describe("PantryStore", () => {
  let store: PantryStore;

  beforeEach(() => {
    store = new PantryStore();
  });

  describe("pantry-read.AC2.1: load() populates store and sets hasSynced", () => {
    it("pantry-read.AC2.1: load() populates store and sets hasSynced to true", () => {
      const item1 = makePantryItem();
      const item2 = makePantryItem();

      store.load([item1, item2]);

      expect(store.get(item1.uid)).toBe(item1);
      expect(store.hasSynced).toBe(true);
    });
  });

  describe("pantry-read.AC2.2: load() with empty array sets hasSynced", () => {
    it("pantry-read.AC2.2: load([]) sets hasSynced to true with empty pantry", () => {
      store.load([]);

      expect(store.hasSynced).toBe(true);
      expect(store.size).toBe(0);
    });
  });

  describe("pantry-read.AC2.3: get() returns item or undefined", () => {
    it("pantry-read.AC2.3: get(uid) returns the item for known UID", () => {
      const item = makePantryItem();
      store.load([item]);

      const result = store.get(item.uid);

      expect(result).toBe(item);
    });

    it("pantry-read.AC2.3: get(uid) returns undefined for unknown UID", () => {
      store.load([]);

      const result = store.get("does-not-exist" as PantryItemUid);

      expect(result).toBeUndefined();
    });
  });

  describe("pantry-read.AC2.4: getAll() returns all items", () => {
    it("pantry-read.AC2.4: getAll() returns all loaded items", () => {
      const item1 = makePantryItem();
      const item2 = makePantryItem();
      const item3 = makePantryItem();
      store.load([item1, item2, item3]);

      const results = store.getAll();

      expect(results).toHaveLength(3);
      expect(results).toEqual(expect.arrayContaining([item1, item2, item3]));
    });
  });

  describe("pantry-read.AC2.5: set() upserts and delete() removes", () => {
    it("pantry-read.AC2.5: set() upserts and delete() removes items", () => {
      const item = makePantryItem();
      store.load([item]);

      const updated = makePantryItem({ uid: item.uid, ingredient: "Updated" });
      store.set(updated);

      expect(store.get(item.uid)?.ingredient).toBe("Updated");
      expect(store.size).toBe(1);

      store.delete(item.uid);

      expect(store.get(item.uid)).toBeUndefined();
      expect(store.size).toBe(0);
    });
  });

  describe("pantry-read.AC2.6: findByIngredient exact match priority", () => {
    it("pantry-read.AC2.6: findByIngredient returns only exact match, not prefix match", () => {
      const exact = makePantryItem({ ingredient: "Apple" });
      const prefix = makePantryItem({ ingredient: "Apple Pie Filling" });
      store.load([exact, prefix]);

      const results = store.findByIngredient("Apple");

      expect(results).toHaveLength(1);
      expect(results[0]?.ingredient).toBe("Apple");
    });
  });

  describe("pantry-read.AC2.7: findByIngredient prefix match priority", () => {
    it("pantry-read.AC2.7: findByIngredient returns prefix match, not substring match", () => {
      const prefix = makePantryItem({ ingredient: "Apple" });
      const substring = makePantryItem({ ingredient: "Pineapple" });
      store.load([prefix, substring]);

      const results = store.findByIngredient("App");

      expect(results).toHaveLength(1);
      expect(results[0]?.ingredient).toBe("Apple");
    });
  });

  describe("pantry-read.AC2.8: findByIngredient is case-insensitive", () => {
    it("pantry-read.AC2.8: findByIngredient is case-insensitive", () => {
      const item = makePantryItem({ ingredient: "Apple" });
      store.load([item]);

      expect(store.findByIngredient("APPLE")).toHaveLength(1);
      expect(store.findByIngredient("apple")).toHaveLength(1);
      expect(store.findByIngredient("ApPlE")).toHaveLength(1);
    });
  });

  describe("pantry-read.AC2.9: findByIngredient returns empty array on no match", () => {
    it("pantry-read.AC2.9: findByIngredient returns empty array when no match", () => {
      const item = makePantryItem({ ingredient: "Apple" });
      store.load([item]);

      const results = store.findByIngredient("Banana");

      expect(results).toHaveLength(0);
    });
  });

  describe("pantry-read.AC2.10: hasSynced starts false", () => {
    it("pantry-read.AC2.10: hasSynced is false before load()", () => {
      expect(store.hasSynced).toBe(false);
    });
  });

  describe("tombstone tracking (idempotent delete support)", () => {
    it("delete() of a present item records the UID in the tombstone set", () => {
      const item = makePantryItem({ uid: "uid-1" as PantryItemUid });
      store.load([item]);
      expect(store.isTombstone("uid-1" as PantryItemUid)).toBe(false);

      store.delete("uid-1" as PantryItemUid);

      expect(store.get("uid-1" as PantryItemUid)).toBeUndefined();
      expect(store.isTombstone("uid-1" as PantryItemUid)).toBe(true);
    });

    it("delete() of an absent UID does NOT add a spurious tombstone", () => {
      // Avoids treating "delete unknown UID" as if we'd successfully soft-deleted it.
      store.load([]);

      store.delete("uid-never-existed" as PantryItemUid);

      expect(store.isTombstone("uid-never-existed" as PantryItemUid)).toBe(false);
    });

    it("set() of a previously-tombstoned UID clears the tombstone (resurrection)", () => {
      const item = makePantryItem({ uid: "uid-1" as PantryItemUid });
      store.load([item]);
      store.delete("uid-1" as PantryItemUid);
      expect(store.isTombstone("uid-1" as PantryItemUid)).toBe(true);

      store.set(item);

      expect(store.isTombstone("uid-1" as PantryItemUid)).toBe(false);
      expect(store.get("uid-1" as PantryItemUid)).toEqual(item);
    });

    it("load() preserves tombstones for UIDs absent from the new items list", () => {
      // Codex P2 fix: tombstones must survive sync cycles so delayed retries
      // (e.g., after a transient transport error) still get the idempotent
      // "already deleted" signal. The server's listPantry filters out
      // tombstoned items, so an absent UID after sync = still server-side-deleted.
      const item = makePantryItem({ uid: "uid-1" as PantryItemUid });
      store.load([item]);
      store.delete("uid-1" as PantryItemUid);
      expect(store.isTombstone("uid-1" as PantryItemUid)).toBe(true);

      // Next sync arrives without uid-1 (server has it tombstoned too).
      store.load([]);

      // Tombstone must persist so retried delete still returns "already deleted".
      expect(store.isTombstone("uid-1" as PantryItemUid)).toBe(true);
    });

    it("load() clears tombstones for UIDs that resurrect in the new items list", () => {
      // If another client un-deletes the item, the server returns it as live;
      // our store should drop the tombstone so items and tombstones stay
      // disjoint and the resurrected item is visible.
      const item = makePantryItem({ uid: "uid-1" as PantryItemUid });
      store.load([item]);
      store.delete("uid-1" as PantryItemUid);
      expect(store.isTombstone("uid-1" as PantryItemUid)).toBe(true);

      store.load([item]);

      expect(store.isTombstone("uid-1" as PantryItemUid)).toBe(false);
      expect(store.get("uid-1" as PantryItemUid)).toEqual(item);
    });
  });
});
