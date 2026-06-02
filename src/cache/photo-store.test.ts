import { describe, it, expect, beforeEach } from "vitest";
import { PhotoStore } from "./photo-store.js";
import { makePhoto } from "./__fixtures__/photos.js";
import type { PhotoUid, RecipeUid } from "../ids.js";

describe("PhotoStore", () => {
  let store: PhotoStore;

  beforeEach(() => {
    store = new PhotoStore();
  });

  describe("getByRecipeUid", () => {
    it("returns all non-deleted photos for the given recipe", () => {
      const a1 = makePhoto({ recipeUid: "recipe-A", orderFlag: 0 });
      const a2 = makePhoto({ recipeUid: "recipe-A", orderFlag: 1 });
      const b1 = makePhoto({ recipeUid: "recipe-B", orderFlag: 0 });
      store.load([a1, a2, b1]);

      const results = store.getByRecipeUid("recipe-A" as RecipeUid);

      expect(results).toHaveLength(2);
      const uids = results.map((r) => r.uid);
      expect(uids).toContain(a1.uid);
      expect(uids).toContain(a2.uid);
      expect(uids).not.toContain(b1.uid);
    });

    it("returns an empty array when no photos match", () => {
      store.load([makePhoto({ recipeUid: "recipe-A" })]);
      expect(store.getByRecipeUid("recipe-X" as RecipeUid)).toHaveLength(0);
    });

    it("sorts results ascending by orderFlag (gallery order)", () => {
      const third = makePhoto({ uid: "p-third" as PhotoUid, recipeUid: "recipe-A", orderFlag: 2 });
      const first = makePhoto({ uid: "p-first" as PhotoUid, recipeUid: "recipe-A", orderFlag: 0 });
      const second = makePhoto({ uid: "p-second" as PhotoUid, recipeUid: "recipe-A", orderFlag: 1 });
      // Load out of order to prove the sort isn't relying on insertion order.
      store.load([third, first, second]);

      const results = store.getByRecipeUid("recipe-A" as RecipeUid);

      expect(results.map((p) => p.orderFlag)).toEqual([0, 1, 2]);
      expect(results.map((p) => p.uid)).toEqual(["p-first", "p-second", "p-third"]);
      // The name invariant tracks orderFlag 1-indexed.
      expect(results.map((p) => p.name)).toEqual(["1", "2", "3"]);
    });

    it("excludes photos carrying deleted: true", () => {
      const live = makePhoto({ recipeUid: "recipe-A", orderFlag: 0 });
      const tombstoned = makePhoto({ recipeUid: "recipe-A", orderFlag: 1, deleted: true });
      store.load([live, tombstoned]);

      const results = store.getByRecipeUid("recipe-A" as RecipeUid);

      expect(results).toHaveLength(1);
      expect(results[0]?.uid).toBe(live.uid);
    });

    it("excludes photos soft-deleted via delete() since the last load()", () => {
      const photo = makePhoto({ uid: "p-1" as PhotoUid, recipeUid: "recipe-A" });
      store.load([photo]);
      store.delete("p-1" as PhotoUid);

      expect(store.getByRecipeUid("recipe-A" as RecipeUid)).toHaveLength(0);
    });
  });

  describe("CRUD and tombstone basics (inherited from TombstoneEntityStore)", () => {
    it("set() upserts and clears any tombstone for the UID", () => {
      const photo = makePhoto({ uid: "p-1" as PhotoUid, recipeUid: "recipe-A" });
      store.load([photo]);
      store.delete("p-1" as PhotoUid);
      expect(store.isTombstone("p-1" as PhotoUid)).toBe(true);

      store.set(makePhoto({ uid: "p-1" as PhotoUid, recipeUid: "recipe-A" }));

      expect(store.isTombstone("p-1" as PhotoUid)).toBe(false);
      expect(store.getByRecipeUid("recipe-A" as RecipeUid)).toHaveLength(1);
    });

    it("delete() tombstones unconditionally, even for an absent UID", () => {
      store.delete("never-loaded" as PhotoUid);
      expect(store.isTombstone("never-loaded" as PhotoUid)).toBe(true);
    });

    it("load([]) flips hasSynced to true (an empty gallery is a valid synced state)", () => {
      expect(store.hasSynced).toBe(false);
      store.load([]);
      expect(store.hasSynced).toBe(true);
    });

    it("load() resurrects a previously tombstoned UID that reappears in the snapshot", () => {
      const photo = makePhoto({ uid: "p-1" as PhotoUid, recipeUid: "recipe-A" });
      store.load([photo]);
      store.delete("p-1" as PhotoUid);
      expect(store.isTombstone("p-1" as PhotoUid)).toBe(true);

      store.load([makePhoto({ uid: "p-1" as PhotoUid, recipeUid: "recipe-A" })]);

      expect(store.isTombstone("p-1" as PhotoUid)).toBe(false);
    });
  });
});
