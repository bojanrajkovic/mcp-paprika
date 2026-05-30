import { describe, it, expect, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import { MenuStore } from "../cache/menu-store.js";
import { MenuItemStore } from "../cache/menu-item-store.js";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeMenu, makeMenuItem } from "../cache/__fixtures__/menus.js";
import { makeMealType } from "../cache/__fixtures__/meals.js";
import { commitMenu, commitMenuItem, commitMenuItemsBatch, menuStartGuard, menuToMarkdown } from "./menu-helpers.js";
import { makeCtx, makeStubNotifier, makeTestServer, getText } from "./tool-test-utils.js";
import type { MealTypeUid, MenuItemUid, MenuUid } from "../paprika/types.js";

const breakfast = makeMealType({
  uid: "breakfast-uid" as MealTypeUid,
  name: "Breakfast",
  orderFlag: 0,
  originalType: 0,
});
const dinner = makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 });

describe("menuStartGuard", () => {
  it("returns Err when neither store is synced", () => {
    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      menuStore: new MenuStore(),
      menuItemStore: new MenuItemStore(),
    });

    menuStartGuard(ctx).match(
      () => {
        throw new Error("expected Err");
      },
      (guard) => {
        expect(getText(guard)).toContain("not yet synced");
      },
    );
  });

  it("returns Err when only menuStore is synced", () => {
    const { server } = makeTestServer();
    const menuStore = new MenuStore();
    menuStore.load([]);
    const ctx = makeCtx(new RecipeStore(), server, { menuStore, menuItemStore: new MenuItemStore() });

    menuStartGuard(ctx).match(
      () => {
        throw new Error("expected Err");
      },
      (guard) => {
        expect(getText(guard)).toContain("not yet synced");
      },
    );
  });

  it("returns Ok when both stores are synced", () => {
    const { server } = makeTestServer();
    const menuStore = new MenuStore();
    const menuItemStore = new MenuItemStore();
    menuStore.load([]);
    menuItemStore.load([]);
    const ctx = makeCtx(new RecipeStore(), server, { menuStore, menuItemStore });

    let reachedOk = false;
    menuStartGuard(ctx).match(
      () => {
        reachedOk = true;
      },
      () => {
        throw new Error("expected Ok");
      },
    );
    expect(reachedOk).toBe(true);
  });
});

describe("menuToMarkdown", () => {
  it("renders header with name, days, and notes when notes non-empty", () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Weeknight Plan", days: 2, notes: "low carb" });
    const md = menuToMarkdown(menu, [], [breakfast, dinner]);
    expect(md).toContain("# Weeknight Plan");
    expect(md).toContain("**UID:** `m-1`");
    expect(md).toContain("**Days:** 2");
    expect(md).toContain("**Notes:** low carb");
  });

  it("omits the Notes line when notes is empty", () => {
    const menu = makeMenu({ name: "No Notes", days: 1, notes: "" });
    const md = menuToMarkdown(menu, [], [dinner]);
    expect(md).not.toContain("**Notes:**");
  });

  it("renders the full day span with explicit empty days", () => {
    const menu = makeMenu({ uid: "m-2" as MenuUid, days: 3 });
    const item = makeMenuItem({ menuUid: "m-2", day: 2, typeUid: "dinner-uid", name: "Chili" });
    const md = menuToMarkdown(menu, [item], [dinner]);
    expect(md).toContain("## Day 1");
    expect(md).toContain("## Day 2");
    expect(md).toContain("## Day 3");
    // Day 1 and Day 3 have no items
    const day1Block = md.slice(md.indexOf("## Day 1"), md.indexOf("## Day 2"));
    const day3Block = md.slice(md.indexOf("## Day 3"));
    expect(day1Block).toContain("_(no meals planned)_");
    expect(day3Block).toContain("_(no meals planned)_");
    // Day 2 has Chili
    const day2Block = md.slice(md.indexOf("## Day 2"), md.indexOf("## Day 3"));
    expect(day2Block).toContain("Chili");
    expect(day2Block).not.toContain("_(no meals planned)_");
  });

  it("sorts items within a day by meal-type orderFlag then item orderFlag", () => {
    const menu = makeMenu({ uid: "m-3" as MenuUid, days: 1 });
    // Add dinner before breakfast in input; dinner orderFlag (2) > breakfast (0)
    const dinnerItem = makeMenuItem({ menuUid: "m-3", day: 1, typeUid: "dinner-uid", name: "Steak", orderFlag: 0 });
    const breakfastItem = makeMenuItem({
      menuUid: "m-3",
      day: 1,
      typeUid: "breakfast-uid",
      name: "Pancakes",
      orderFlag: 0,
    });
    const md = menuToMarkdown(menu, [dinnerItem, breakfastItem], [breakfast, dinner]);
    expect(md.indexOf("Pancakes")).toBeLessThan(md.indexOf("Steak"));
  });

  it("sorts within the same meal type by item orderFlag", () => {
    const menu = makeMenu({ uid: "m-4" as MenuUid, days: 1 });
    const second = makeMenuItem({ menuUid: "m-4", day: 1, typeUid: "dinner-uid", name: "Dessert", orderFlag: 1 });
    const first = makeMenuItem({ menuUid: "m-4", day: 1, typeUid: "dinner-uid", name: "Main", orderFlag: 0 });
    const md = menuToMarkdown(menu, [second, first], [dinner]);
    expect(md.indexOf("Main")).toBeLessThan(md.indexOf("Dessert"));
  });

  it("sorts an unknown typeUid last within a day", () => {
    const menu = makeMenu({ uid: "m-5" as MenuUid, days: 1 });
    const unknown = makeMenuItem({ menuUid: "m-5", day: 1, typeUid: "ghost-type", name: "Mystery", orderFlag: 0 });
    const known = makeMenuItem({ menuUid: "m-5", day: 1, typeUid: "dinner-uid", name: "Roast", orderFlag: 0 });
    const md = menuToMarkdown(menu, [unknown, known], [dinner]);
    expect(md.indexOf("Roast")).toBeLessThan(md.indexOf("Mystery"));
  });

  it("renders the meal-type name and recipe name on each item line", () => {
    const menu = makeMenu({ uid: "m-6" as MenuUid, days: 1 });
    const item = makeMenuItem({ menuUid: "m-6", day: 1, typeUid: "dinner-uid", name: "Lasagna" });
    const md = menuToMarkdown(menu, [item], [dinner]);
    expect(md).toContain("- **Dinner:** Lasagna");
  });

  it("falls back to typeUid string when the meal type is unknown", () => {
    const menu = makeMenu({ uid: "m-7" as MenuUid, days: 1 });
    const item = makeMenuItem({ menuUid: "m-7", day: 1, typeUid: "ghost-type", name: "Soup" });
    const md = menuToMarkdown(menu, [item], [dinner]);
    expect(md).toContain("- **ghost-type:** Soup");
  });

  it("appends item and recipe UIDs when includeItemUids is set", () => {
    const menu = makeMenu({ uid: "m-8" as MenuUid, days: 1 });
    const item = makeMenuItem({
      uid: "mi-8" as MenuItemUid,
      menuUid: "m-8",
      day: 1,
      typeUid: "dinner-uid",
      name: "Curry",
      recipeUid: "recipe-xyz",
    });
    const md = menuToMarkdown(menu, [item], [dinner], { includeItemUids: true });
    expect(md).toContain("- **Dinner:** Curry · item `mi-8` · recipe `recipe-xyz`");
  });

  it("omits the recipe clause when recipeUid is null even with includeItemUids", () => {
    const menu = makeMenu({ uid: "m-9" as MenuUid, days: 1 });
    const item = makeMenuItem({
      uid: "mi-9" as MenuItemUid,
      menuUid: "m-9",
      day: 1,
      typeUid: "dinner-uid",
      name: "Freeform Night",
      recipeUid: null,
    });
    const md = menuToMarkdown(menu, [item], [dinner], { includeItemUids: true });
    expect(md).toContain("- **Dinner:** Freeform Night · item `mi-9`");
    expect(md).not.toContain("· recipe");
  });

  it("omits all UIDs by default (includeItemUids false)", () => {
    const menu = makeMenu({ uid: "m-10" as MenuUid, days: 1 });
    const item = makeMenuItem({
      uid: "mi-10" as MenuItemUid,
      menuUid: "m-10",
      day: 1,
      typeUid: "dinner-uid",
      name: "Plain",
      recipeUid: "recipe-1",
    });
    const md = menuToMarkdown(menu, [item], [dinner]);
    expect(md).toContain("- **Dinner:** Plain");
    expect(md).not.toContain("· item");
    expect(md).not.toContain("· recipe");
  });
});

describe("commitMenu", () => {
  it("upsert branch: put, flush, set, resourceListChanged, notifySync in order", async () => {
    const menu = makeMenu({ deleted: false });
    const menuStore = new MenuStore();
    const setSpy = vi.spyOn(menuStore, "set");

    const put = vi.fn();
    const remove = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const notifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();

    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync }),
      cache: fromAny({ menus: { put, remove }, flush }),
      menuStore,
      notifier: stub.notifier,
    });

    await commitMenu(ctx, menu);

    expect(put.mock.invocationCallOrder[0]).toBeLessThan(flush.mock.invocationCallOrder[0]!);
    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(setSpy.mock.invocationCallOrder[0]!);
    expect(setSpy.mock.invocationCallOrder[0]).toBeLessThan(stub.resourceListChanged.mock.invocationCallOrder[0]!);
    expect(stub.resourceListChanged.mock.invocationCallOrder[0]).toBeLessThan(notifySync.mock.invocationCallOrder[0]!);
    expect(stub.resourceListChanged).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(setSpy).toHaveBeenCalledWith(menu);
  });

  it("delete branch: remove, flush, delete, resourceListChanged, notifySync", async () => {
    const menu = makeMenu({ deleted: false });
    const trashed = { ...menu, deleted: true };
    const menuStore = new MenuStore();
    menuStore.load([menu]);
    const deleteSpy = vi.spyOn(menuStore, "delete");

    const put = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    const flush = vi.fn().mockResolvedValue(undefined);
    const notifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();

    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync }),
      cache: fromAny({ menus: { put, remove }, flush }),
      menuStore,
      notifier: stub.notifier,
    });

    await commitMenu(ctx, trashed);

    expect(remove).toHaveBeenCalledWith(menu.uid);
    expect(deleteSpy).toHaveBeenCalledWith(menu.uid);
    expect(stub.resourceListChanged).toHaveBeenCalledTimes(1);
    expect(put).not.toHaveBeenCalled();
  });

  it("clears the pending mark and rethrows on cache failure", async () => {
    const menu = makeMenu({ deleted: false });
    const menuStore = new MenuStore();
    const clearSpy = vi.spyOn(menuStore, "clearPending");

    const put = vi.fn().mockRejectedValue(new Error("disk full"));
    const flush = vi.fn().mockResolvedValue(undefined);
    const notifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();

    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync }),
      cache: fromAny({ menus: { put, remove: vi.fn() }, flush }),
      menuStore,
      notifier: stub.notifier,
    });

    await expect(commitMenu(ctx, menu)).rejects.toThrow("disk full");
    expect(clearSpy).toHaveBeenCalledWith(menu.uid);
    expect(stub.resourceListChanged).not.toHaveBeenCalled();
    expect(notifySync).not.toHaveBeenCalled();
  });
});

describe("commitMenuItem", () => {
  it("upsert branch calls resourceListChanged and notifySync", async () => {
    const item = makeMenuItem({ deleted: false });
    const menuItemStore = new MenuItemStore();
    const setSpy = vi.spyOn(menuItemStore, "set");

    const put = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const notifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();

    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync }),
      cache: fromAny({ menuItems: { put, remove: vi.fn() }, flush }),
      menuItemStore,
      notifier: stub.notifier,
    });

    await commitMenuItem(ctx, item);
    expect(setSpy).toHaveBeenCalledWith(item);
    expect(stub.resourceListChanged).toHaveBeenCalledTimes(1);
    expect(notifySync).toHaveBeenCalledTimes(1);
  });

  it("delete branch removes from cache and store", async () => {
    const item = makeMenuItem({ deleted: false });
    const trashed = { ...item, deleted: true };
    const menuItemStore = new MenuItemStore();
    menuItemStore.load([item]);
    const deleteSpy = vi.spyOn(menuItemStore, "delete");

    const remove = vi.fn().mockResolvedValue(undefined);
    const flush = vi.fn().mockResolvedValue(undefined);
    const notifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();

    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync }),
      cache: fromAny({ menuItems: { put: vi.fn(), remove }, flush }),
      menuItemStore,
      notifier: stub.notifier,
    });

    await commitMenuItem(ctx, trashed);
    expect(remove).toHaveBeenCalledWith(item.uid);
    expect(deleteSpy).toHaveBeenCalledWith(item.uid);
    expect(stub.resourceListChanged).toHaveBeenCalledTimes(1);
  });
});

describe("commitMenuItemsBatch", () => {
  it("no-op for an empty array", async () => {
    const stub = makeStubNotifier();
    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync: vi.fn() }),
      cache: fromAny({ menuItems: { put: vi.fn(), remove: vi.fn() }, flush: vi.fn() }),
      menuItemStore: new MenuItemStore(),
      notifier: stub.notifier,
    });
    await commitMenuItemsBatch(ctx, []);
    expect(stub.resourceListChanged).not.toHaveBeenCalled();
  });

  it("commits N items with one flush, one resourceListChanged, one notifySync", async () => {
    const a = makeMenuItem({ deleted: false });
    const b = makeMenuItem({ deleted: false });
    const menuItemStore = new MenuItemStore();
    const setSpy = vi.spyOn(menuItemStore, "set");

    const put = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const notifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();

    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync }),
      cache: fromAny({ menuItems: { put, remove: vi.fn() }, flush }),
      menuItemStore,
      notifier: stub.notifier,
    });

    await commitMenuItemsBatch(ctx, [a, b]);
    expect(put).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(stub.resourceListChanged).toHaveBeenCalledTimes(1);
    expect(notifySync).toHaveBeenCalledTimes(1);
  });

  it("clears all pending marks and rethrows on cache failure", async () => {
    const a = makeMenuItem({ deleted: false });
    const b = makeMenuItem({ deleted: false });
    const menuItemStore = new MenuItemStore();
    const clearSpy = vi.spyOn(menuItemStore, "clearPending");

    const put = vi.fn().mockRejectedValue(new Error("io error"));
    const flush = vi.fn().mockResolvedValue(undefined);
    const notifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();

    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync }),
      cache: fromAny({ menuItems: { put, remove: vi.fn() }, flush }),
      menuItemStore,
      notifier: stub.notifier,
    });

    await expect(commitMenuItemsBatch(ctx, [a, b])).rejects.toThrow("io error");
    expect(clearSpy).toHaveBeenCalledWith(a.uid);
    expect(clearSpy).toHaveBeenCalledWith(b.uid);
    expect(stub.resourceListChanged).not.toHaveBeenCalled();
    expect(notifySync).not.toHaveBeenCalled();
  });
});
