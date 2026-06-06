import { beforeEach, describe, expect, it } from "vitest";

import type { MenuUid } from "./ids.js";

import { makeMenu } from "../../../test/domains/menu/__fixtures__/menus.js";
import { MenuStore } from "./store.js";

describe("MenuStore", () => {
  let store: MenuStore;

  beforeEach(() => {
    store = new MenuStore();
  });

  describe("findByName tiered priority", () => {
    it("returns exact match only, not starts-with or contains", () => {
      const exact = makeMenu({ name: "Thanksgiving Dinner" });
      const prefix = makeMenu({ name: "Thanksgiving Dinner Extended" });
      const contains = makeMenu({ name: "My Thanksgiving Dinner Plan" });
      store.load([exact, prefix, contains]);

      const results = store.findByName("Thanksgiving Dinner");

      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe("Thanksgiving Dinner");
    });

    it("is case-insensitive for exact match", () => {
      const menu = makeMenu({ name: "Thanksgiving Dinner" });
      store.load([menu]);

      const results = store.findByName("thanksgiving dinner");

      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe("Thanksgiving Dinner");
    });

    it("returns starts-with tier when no exact match", () => {
      const prefix1 = makeMenu({ name: "Weekly Plan" });
      const prefix2 = makeMenu({ name: "Weekly Staples" });
      const contains = makeMenu({ name: "My Weekly Menu" });
      store.load([prefix1, prefix2, contains]);

      const results = store.findByName("Weekly");

      expect(results).toHaveLength(2);
      const names = results.map((r) => r.name);
      expect(names).toContain("Weekly Plan");
      expect(names).toContain("Weekly Staples");
      expect(names).not.toContain("My Weekly Menu");
    });

    it("returns contains tier when no exact or starts-with match", () => {
      const contains1 = makeMenu({ name: "My Holiday Menu" });
      const contains2 = makeMenu({ name: "All Holiday Plans" });
      store.load([contains1, contains2]);

      const results = store.findByName("oliday");

      expect(results).toHaveLength(2);
      const names = results.map((r) => r.name);
      expect(names).toContain("My Holiday Menu");
      expect(names).toContain("All Holiday Plans");
    });

    it("returns empty array when no match", () => {
      const menu = makeMenu({ name: "Thanksgiving Dinner" });
      store.load([menu]);

      const results = store.findByName("nonexistent");

      expect(results).toHaveLength(0);
    });

    it("excludes deleted menus", () => {
      const menu = makeMenu({ uid: "uid-1" as MenuUid, name: "Thanksgiving Dinner" });
      store.load([menu]);
      store.delete("uid-1" as MenuUid);

      const results = store.findByName("Thanksgiving Dinner");

      expect(results).toHaveLength(0);
    });
  });

  describe("CRUD basics", () => {
    it("load() populates store and sets hasSynced to true", () => {
      const menu1 = makeMenu();
      const menu2 = makeMenu();

      store.load([menu1, menu2]);

      expect(store.get(menu1.uid)).toBe(menu1);
      expect(store.get(menu2.uid)).toBe(menu2);
      expect(store.hasSynced).toBe(true);
    });

    it("hasSynced is false before load()", () => {
      expect(store.hasSynced).toBe(false);
    });

    it("get(uid) returns undefined for unknown uid", () => {
      store.load([]);

      const result = store.get("does-not-exist" as MenuUid);

      expect(result).toBeUndefined();
    });
  });

  describe("lastSyncedAt", () => {
    it("returns null before setLastSyncedAt()", () => {
      expect(store.lastSyncedAt).toBeNull();
    });

    it("returns the provided Date after setLastSyncedAt()", () => {
      const now = new Date();
      store.setLastSyncedAt(now);

      expect(store.lastSyncedAt).toBe(now);
    });

    it("defaults to current date when called without argument", () => {
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
