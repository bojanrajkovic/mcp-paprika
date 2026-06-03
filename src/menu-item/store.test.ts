import { describe, it, expect, beforeEach } from "vitest";
import { MenuItemStore } from "./store.js";
import { makeMenuItem } from "../cache/__fixtures__/menus.js";
import type { MenuItemUid, MenuUid } from "../ids.js";

describe("MenuItemStore", () => {
  let store: MenuItemStore;

  beforeEach(() => {
    store = new MenuItemStore();
  });

  describe("getByMenuUid", () => {
    it("returns all items matching the given menuUid", () => {
      const itemA1 = makeMenuItem({ menuUid: "menu-A" });
      const itemA2 = makeMenuItem({ menuUid: "menu-A" });
      const itemB1 = makeMenuItem({ menuUid: "menu-B" });
      store.load([itemA1, itemA2, itemB1]);

      const results = store.getByMenuUid("menu-A" as MenuUid);

      expect(results).toHaveLength(2);
      const uids = results.map((r) => r.uid);
      expect(uids).toContain(itemA1.uid);
      expect(uids).toContain(itemA2.uid);
      expect(uids).not.toContain(itemB1.uid);
    });

    it("returns empty array when no items match", () => {
      const item = makeMenuItem({ menuUid: "menu-A" });
      store.load([item]);

      const results = store.getByMenuUid("menu-X" as MenuUid);

      expect(results).toHaveLength(0);
    });

    it("does not return tombstoned items", () => {
      const item = makeMenuItem({ uid: "uid-1" as MenuItemUid, menuUid: "menu-A" });
      store.load([item]);
      store.delete("uid-1" as MenuItemUid);

      const results = store.getByMenuUid("menu-A" as MenuUid);

      expect(results).toHaveLength(0);
    });

    it("does not return items whose menuUid was nulled by a cascade delete", () => {
      const live = makeMenuItem({ menuUid: "menu-A" });
      const orphaned = makeMenuItem({ menuUid: null });
      store.load([live, orphaned]);

      const results = store.getByMenuUid("menu-A" as MenuUid);

      expect(results).toHaveLength(1);
      expect(results[0]?.uid).toBe(live.uid);
    });
  });

  describe("CRUD and tombstone basics", () => {
    it("load() populates store and sets hasSynced to true", () => {
      const item1 = makeMenuItem();
      const item2 = makeMenuItem();

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

      const result = store.get("does-not-exist" as MenuItemUid);

      expect(result).toBeUndefined();
    });
  });
});
