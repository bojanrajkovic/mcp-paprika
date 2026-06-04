import { beforeEach, describe, expect, it } from "vitest";

import type { GroceryItemUid, GroceryListUid } from "../../../ids.js";

import { makeGroceryItem } from "../../../../test/cache/__fixtures__/grocery-items.js";
import { GroceryItemStore } from "./store.js";

describe("GroceryItemStore", () => {
  let store: GroceryItemStore;

  beforeEach(() => {
    store = new GroceryItemStore();
  });

  describe("grocery-infra.AC1.5: getByListUid returns only items matching listUid", () => {
    it("grocery-infra.AC1.5: getByListUid returns all items matching the given listUid", () => {
      const itemA1 = makeGroceryItem({ listUid: "list-A" });
      const itemA2 = makeGroceryItem({ listUid: "list-A" });
      const itemB1 = makeGroceryItem({ listUid: "list-B" });
      store.load([itemA1, itemA2, itemB1]);

      const results = store.getByListUid("list-A" as GroceryListUid);

      expect(results).toHaveLength(2);
      const uids = results.map((r) => r.uid);
      expect(uids).toContain(itemA1.uid);
      expect(uids).toContain(itemA2.uid);
      expect(uids).not.toContain(itemB1.uid);
    });

    it("grocery-infra.AC1.5: getByListUid returns empty array when no items match", () => {
      const item = makeGroceryItem({ listUid: "list-A" });
      store.load([item]);

      const results = store.getByListUid("list-X" as GroceryListUid);

      expect(results).toHaveLength(0);
    });

    it("grocery-infra.AC1.5: getByListUid does not return tombstoned items", () => {
      const item = makeGroceryItem({ uid: "uid-1" as GroceryItemUid, listUid: "list-A" });
      store.load([item]);
      store.delete("uid-1" as GroceryItemUid);

      const results = store.getByListUid("list-A" as GroceryListUid);

      expect(results).toHaveLength(0);
    });
  });

  describe("grocery-infra.AC1.6: getPurchasedByList returns only purchased items for the given list", () => {
    it("grocery-infra.AC1.6: getPurchasedByList returns only purchased items for the given list", () => {
      const purchased = makeGroceryItem({ listUid: "list-A", purchased: true });
      const notPurchased = makeGroceryItem({ listUid: "list-A", purchased: false });
      store.load([purchased, notPurchased]);

      const results = store.getPurchasedByList("list-A" as GroceryListUid);

      expect(results).toHaveLength(1);
      expect(results[0]?.uid).toBe(purchased.uid);
    });

    it("grocery-infra.AC1.6: getPurchasedByList does not return purchased items from other lists", () => {
      const purchasedA = makeGroceryItem({ listUid: "list-A", purchased: true });
      const purchasedB = makeGroceryItem({ listUid: "list-B", purchased: true });
      store.load([purchasedA, purchasedB]);

      const results = store.getPurchasedByList("list-A" as GroceryListUid);

      expect(results).toHaveLength(1);
      expect(results[0]?.uid).toBe(purchasedA.uid);
    });

    it("grocery-infra.AC1.6: getPurchasedByList returns empty array when no purchased items", () => {
      const item = makeGroceryItem({ listUid: "list-A", purchased: false });
      store.load([item]);

      const results = store.getPurchasedByList("list-A" as GroceryListUid);

      expect(results).toHaveLength(0);
    });

    it("grocery-infra.AC1.6: getPurchasedByList returns empty when list has no items at all", () => {
      const item = makeGroceryItem({ listUid: "list-B", purchased: true });
      store.load([item]);

      const results = store.getPurchasedByList("list-A" as GroceryListUid);

      expect(results).toHaveLength(0);
    });
  });

  describe("CRUD and tombstone basics", () => {
    it("load() populates store and sets hasSynced to true", () => {
      const item1 = makeGroceryItem();
      const item2 = makeGroceryItem();

      store.load([item1, item2]);

      expect(store.get(item1.uid)).toBe(item1);
      expect(store.get(item2.uid)).toBe(item2);
      expect(store.hasSynced).toBe(true);
    });

    it("hasSynced is false before load()", () => {
      expect(store.hasSynced).toBe(false);
    });

    it("get(uid) returns undefined for unknown uid", () => {
      store.load([]);

      const result = store.get("does-not-exist" as GroceryItemUid);

      expect(result).toBeUndefined();
    });
  });
});
