import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { ResultAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CacheError, DiskCacheDescriptor } from "./disk-cache.js";

import { makeGroceryIngredient } from "../../test/domains/grocery/__fixtures__/grocery-ingredients.js";
import { makeGroceryItem } from "../../test/domains/grocery/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../../test/domains/grocery/__fixtures__/grocery-lists.js";
import { makePantryItem } from "../../test/domains/pantry/__fixtures__/pantry.js";
import { makeCategory } from "../../test/domains/recipe/__fixtures__/recipes.js";
import { makeCache, useTempDir } from "../../test/support/disk-caches.js";
import { groceryIngredientDiskDescriptor } from "../domains/grocery/grocery-ingredient/types.js";
import { groceryItemDiskDescriptor } from "../domains/grocery/grocery-item/types.js";
import { groceryListDiskDescriptor } from "../domains/grocery/grocery-list/types.js";
import { pantryDiskDescriptor } from "../domains/pantry/types.js";
import { categoryDiskDescriptor } from "../domains/recipe/category/types.js";

// A synthetic entity so the generic DiskCache<T> contract is exercised in
// isolation from any real schema. The real descriptors (category, pantry,
// grocery*) are round-tripped by the table at the bottom; the bespoke subclasses
// (RecipeDiskCache, OAuthClientDiskCache) have their own co-located suites.
interface Widget {
  readonly id: string;
  readonly value: number;
}
const widgetDescriptor: DiskCacheDescriptor<Widget> = {
  subdir: "widgets",
  parse: (raw) => raw as Widget,
  getKey: (w) => w.id,
};
const makeWidget = (overrides: Partial<Widget> = {}): Widget => ({ id: "w-1", value: 1, ...overrides });

const tmp = useTempDir("mcp-paprika-disk-cache-");
beforeEach(async () => {
  await tmp.setup();
});
afterEach(async () => {
  await tmp.teardown();
});

describe("DiskCache<T> — generic contract", () => {
  describe("init lifecycle", () => {
    it("creates its subdir on init", async () => {
      const cache = makeCache(tmp.dir(), widgetDescriptor);
      (await cache.init())._unsafeUnwrap();
      expect((await stat(join(tmp.dir(), "widgets"))).isDirectory()).toBe(true);
    });

    it("get/getAll/flush err before init", async () => {
      const cache = makeCache(tmp.dir(), widgetDescriptor);
      expect((await cache.get("any"))._unsafeUnwrapErr().message).toContain("before init");
      expect((await cache.getAll())._unsafeUnwrapErr().message).toContain("before init");
      expect((await cache.flush())._unsafeUnwrapErr().message).toContain("before init");
    });
  });

  describe("CRUD + buffering", () => {
    it("put buffers in memory; no file until flush", async () => {
      const cache = makeCache(tmp.dir(), widgetDescriptor);
      (await cache.init())._unsafeUnwrap();
      (await cache.put(makeWidget()))._unsafeUnwrap();
      await expect(stat(join(tmp.dir(), "widgets", "w-1.json"))).rejects.toThrow();
    });

    it("get returns the buffered item immediately after put", async () => {
      const cache = makeCache(tmp.dir(), widgetDescriptor);
      (await cache.init())._unsafeUnwrap();
      const w = makeWidget();
      (await cache.put(w))._unsafeUnwrap();
      expect((await cache.get("w-1"))._unsafeUnwrap()).toEqual(w);
    });

    it("put + flush + get round-trips through disk", async () => {
      const cache = makeCache(tmp.dir(), widgetDescriptor);
      (await cache.init())._unsafeUnwrap();
      const w = makeWidget({ value: 42 });
      (await cache.put(w))._unsafeUnwrap();
      (await cache.flush())._unsafeUnwrap();

      const raw = await readFile(join(tmp.dir(), "widgets", "w-1.json"), "utf-8");
      expect(JSON.parse(raw)).toEqual(w);
      expect((await cache.get("w-1"))._unsafeUnwrap()).toEqual(w);
    });

    it("get returns null for an unknown key", async () => {
      const cache = makeCache(tmp.dir(), widgetDescriptor);
      (await cache.init())._unsafeUnwrap();
      expect((await cache.get("nope"))._unsafeUnwrap()).toBeNull();
    });

    it("getAll across instances returns all flushed items", async () => {
      const c1 = makeCache(tmp.dir(), widgetDescriptor);
      (await c1.init())._unsafeUnwrap();
      (await c1.put(makeWidget({ id: "a" })))._unsafeUnwrap();
      (await c1.put(makeWidget({ id: "b" })))._unsafeUnwrap();
      (await c1.flush())._unsafeUnwrap();

      const c2 = makeCache(tmp.dir(), widgetDescriptor);
      (await c2.init())._unsafeUnwrap();
      const all = (await c2.getAll())._unsafeUnwrap();
      expect(all.map((w) => w.id).sort()).toEqual(["a", "b"]);
    });

    it("getAll merges pending and disk, with pending shadowing disk", async () => {
      const cache = makeCache(tmp.dir(), widgetDescriptor);
      (await cache.init())._unsafeUnwrap();
      (await cache.put(makeWidget({ id: "disk", value: 1 })))._unsafeUnwrap();
      (await cache.flush())._unsafeUnwrap();

      (await cache.put(makeWidget({ id: "pending", value: 2 })))._unsafeUnwrap();
      // A pending put with an on-disk key shadows the disk version for getAll.
      (await cache.put(makeWidget({ id: "disk", value: 99 })))._unsafeUnwrap();

      const all = (await cache.getAll())._unsafeUnwrap();
      expect(all).toHaveLength(2);
      expect(all.find((w) => w.id === "disk")?.value).toBe(99);
      expect(all.find((w) => w.id === "pending")?.value).toBe(2);
    });

    it("remove deletes the file and is idempotent", async () => {
      const cache = makeCache(tmp.dir(), widgetDescriptor);
      (await cache.init())._unsafeUnwrap();
      (await cache.put(makeWidget()))._unsafeUnwrap();
      (await cache.flush())._unsafeUnwrap();

      const filePath = join(tmp.dir(), "widgets", "w-1.json");
      await expect(stat(filePath)).resolves.toBeDefined();

      (await cache.remove("w-1"))._unsafeUnwrap();
      await expect(stat(filePath)).rejects.toThrow();
      expect((await cache.getAll())._unsafeUnwrap()).toHaveLength(0);

      // Idempotent — removing a key that was never present is ok.
      expect((await cache.remove("never-existed"))._unsafeUnwrap()).toBeUndefined();
    });

    it("has/size reflect the known-keys mirror", async () => {
      const cache = makeCache(tmp.dir(), widgetDescriptor);
      (await cache.init())._unsafeUnwrap();
      (await cache.put(makeWidget({ id: "x" })))._unsafeUnwrap();
      expect(cache.has("x")).toBe(true);
      expect(cache.has("y")).toBe(false);
      expect(cache.size).toBe(1);
    });
  });

  describe("per-subcache mutex serialization + independence", () => {
    it("interleaved puts + flushes on two independent subcaches all land", async () => {
      // Two caches over the same cache dir, different subdirs — the post-kernel
      // production shape: each module owns one subcache, with no central
      // coordinator. Each owns its own mutex, so concurrent flushes across them
      // never block one another and every write lands.
      const alpha = makeCache(tmp.dir(), { ...widgetDescriptor, subdir: "alpha" });
      const beta = makeCache(tmp.dir(), { ...widgetDescriptor, subdir: "beta" });
      (await alpha.init())._unsafeUnwrap();
      (await beta.init())._unsafeUnwrap();

      const ops: Array<ResultAsync<void, CacheError>> = [];
      for (let i = 0; i < 20; i++) {
        ops.push(alpha.put(makeWidget({ id: `a-${i.toString()}` })));
        ops.push(beta.put(makeWidget({ id: `b-${i.toString()}` })));
        if (i % 4 === 3) ops.push(alpha.flush(), beta.flush());
      }
      ops.push(alpha.flush(), beta.flush());
      (await ResultAsync.combine(ops))._unsafeUnwrap();

      expect((await readdir(join(tmp.dir(), "alpha"))).filter((f) => f.endsWith(".json"))).toHaveLength(20);
      expect((await readdir(join(tmp.dir(), "beta"))).filter((f) => f.endsWith(".json"))).toHaveLength(20);
      expect((await alpha.getAll())._unsafeUnwrap()).toHaveLength(20);
      expect((await beta.getAll())._unsafeUnwrap()).toHaveLength(20);
    });
  });
});

describe("DiskCache<T> — real entity descriptors round-trip", () => {
  // Each `run` closure is monomorphic in T, so the heterogeneous descriptors sit
  // in one homogeneous table without tripping DiskCacheDescriptor<T> variance.
  async function roundTrip<T>(descriptor: DiskCacheDescriptor<T>, item: T): Promise<void> {
    const c1 = makeCache(tmp.dir(), descriptor);
    (await c1.init())._unsafeUnwrap();
    expect((await stat(join(tmp.dir(), descriptor.subdir))).isDirectory()).toBe(true);
    (await c1.put(item))._unsafeUnwrap();
    (await c1.flush())._unsafeUnwrap();

    const c2 = makeCache(tmp.dir(), descriptor);
    (await c2.init())._unsafeUnwrap();
    const all = (await c2.getAll())._unsafeUnwrap();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(item);
  }

  const cases: ReadonlyArray<{ readonly name: string; readonly run: () => Promise<void> }> = [
    { name: "categories", run: () => roundTrip(categoryDiskDescriptor, makeCategory()) },
    { name: "pantry", run: () => roundTrip(pantryDiskDescriptor, makePantryItem()) },
    { name: "grocery lists", run: () => roundTrip(groceryListDiskDescriptor, makeGroceryList()) },
    { name: "grocery items", run: () => roundTrip(groceryItemDiskDescriptor, makeGroceryItem()) },
    { name: "grocery ingredients", run: () => roundTrip(groceryIngredientDiskDescriptor, makeGroceryIngredient()) },
  ];

  it.each(cases)("$name: put → flush → fresh instance → getAll, and creates its subdir", async ({ run }) => {
    await run();
  });
});
