import { beforeEach, describe, expect, it } from "vitest";

import type { CategoryUid } from "../ids.js";

import { makeCategory } from "../cache/__fixtures__/recipes.js";
import { CategoryStore } from "./store.js";

describe("CategoryStore", () => {
  let store: CategoryStore;

  beforeEach(() => {
    store = new CategoryStore();
  });

  describe("load / get / getAll", () => {
    it("hydrates from a snapshot and flips hasSynced", () => {
      const a = makeCategory();
      const b = makeCategory();
      store.load([a, b]);

      expect(store.hasSynced).toBe(true);
      expect(store.get(a.uid)).toBe(a);
      expect(store.getAll()).toEqual([a, b]);
    });

    it("load([]) still flips hasSynced", () => {
      store.load([]);
      expect(store.hasSynced).toBe(true);
      expect(store.getAll()).toEqual([]);
    });
  });

  describe("resolveNames", () => {
    it("returns names for existing UIDs in input order", () => {
      const a = makeCategory({ uid: "uid-1" as CategoryUid, name: "Name1" });
      const b = makeCategory({ uid: "uid-2" as CategoryUid, name: "Name2" });
      store.load([a, b]);

      expect(store.resolveNames(["uid-2" as CategoryUid, "uid-1" as CategoryUid])).toEqual(["Name2", "Name1"]);
    });

    it("drops unknown UIDs", () => {
      const a = makeCategory({ uid: "uid-1" as CategoryUid, name: "Name1" });
      store.load([a]);

      expect(store.resolveNames(["uid-1" as CategoryUid, "unknown" as CategoryUid])).toEqual(["Name1"]);
    });

    it("returns [] for empty input", () => {
      store.load([makeCategory()]);
      expect(store.resolveNames([])).toEqual([]);
    });
  });

  describe("resolveByName", () => {
    it("is case-insensitive and exact", () => {
      const a = makeCategory({ name: "Thai Curries" });
      store.load([a]);

      expect(store.resolveByName("thai curries")).toBe(a);
      expect(store.resolveByName("Thai")).toBeUndefined();
    });
  });

  describe("getChildren", () => {
    it("returns only the direct children of a parent", () => {
      const parent = makeCategory({ uid: "p" as CategoryUid });
      const child1 = makeCategory({ uid: "c1" as CategoryUid, parentUid: "p" });
      const child2 = makeCategory({ uid: "c2" as CategoryUid, parentUid: "p" });
      const grandchild = makeCategory({ uid: "gc" as CategoryUid, parentUid: "c1" });
      const unrelated = makeCategory({ uid: "u" as CategoryUid, parentUid: null });
      store.load([parent, child1, child2, grandchild, unrelated]);

      const children = store.getChildren("p" as CategoryUid);
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.uid).sort()).toEqual(["c1", "c2"]);
    });

    it("returns [] for a leaf category", () => {
      const leaf = makeCategory({ uid: "leaf" as CategoryUid });
      store.load([leaf]);
      expect(store.getChildren("leaf" as CategoryUid)).toEqual([]);
    });
  });

  describe("tombstone semantics", () => {
    it("delete() tombstones the UID; set() resurrects it", () => {
      const a = makeCategory({ uid: "a" as CategoryUid });
      store.load([a]);

      store.delete("a" as CategoryUid);
      expect(store.get("a" as CategoryUid)).toBeUndefined();
      expect(store.isTombstone("a" as CategoryUid)).toBe(true);

      store.set(a);
      expect(store.get("a" as CategoryUid)).toBe(a);
      expect(store.isTombstone("a" as CategoryUid)).toBe(false);
    });
  });

  describe("pending-writes (inherited)", () => {
    it("tracks pending upsert and delete marks", () => {
      const a = makeCategory({ uid: "a" as CategoryUid });
      store.markPendingUpsert(a.uid);
      expect(store.isPendingUpsert(a.uid)).toBe(true);

      store.markPendingDelete(a.uid);
      expect(store.isPendingDelete(a.uid)).toBe(true);

      store.clearPending(a.uid);
      expect(store.isPendingUpsert(a.uid)).toBe(false);
      expect(store.isPendingDelete(a.uid)).toBe(false);
    });
  });
});
