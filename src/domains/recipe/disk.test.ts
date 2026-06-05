import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeUid } from "../../ids.js";

import { makeRecipe } from "../../../test/cache/__fixtures__/recipes.js";
import { makeRecipeCache, useTempDir } from "../../../test/support/disk-caches.js";
import { makePinoCapture } from "../../../test/support/tool-test-utils.js";

// Mock fs/promises so the rename used by the recipes index temp-then-rename can
// be made to fail on demand. The factory imports the real module and overrides
// only `rename` with a spy.
vi.mock("node:fs/promises", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs/promises")>();
  return { ...orig, rename: vi.fn(orig.rename) };
});

const tmp = useTempDir("mcp-paprika-recipe-disk-");
beforeEach(async () => {
  await tmp.setup();
});
afterEach(async () => {
  await tmp.teardown();
});

describe("RecipeDiskCache", () => {
  describe("init lifecycle", () => {
    it("get/getAll throw before init", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await expect(cache.getAll()).rejects.toThrow("before init");
      await expect(cache.get("any")).rejects.toThrow("before init");
    });

    it("diff throws before init", () => {
      const cache = makeRecipeCache(tmp.dir());
      expect(() => cache.diff([])).toThrow("before init");
    });
  });

  describe("CRUD + hash index", () => {
    it("put buffers in memory; no file written until flush", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();
      const recipe = makeRecipe();
      await cache.put(recipe);

      await expect(stat(join(tmp.dir(), "recipes", `${recipe.uid}.json`))).rejects.toThrow();
    });

    it("get returns buffered recipe immediately after put", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();
      const recipe = makeRecipe();
      await cache.put(recipe);
      expect(await cache.get(recipe.uid)).toEqual(recipe);
    });

    it("put + flush + get round-trips through disk", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();
      const recipe = makeRecipe();
      await cache.put(recipe);
      await cache.flush();

      expect(await cache.get(recipe.uid)).toEqual(recipe);
    });

    it("get returns null for an unknown uid", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();
      expect(await cache.get("nonexistent-uid")).toBeNull();
    });

    it("remove deletes the file and drops the entry from the hash index", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();
      const recipe = makeRecipe();
      await cache.put(recipe);
      await cache.flush();

      const filePath = join(tmp.dir(), "recipes", `${recipe.uid}.json`);
      await expect(stat(filePath)).resolves.toBeDefined();

      await cache.remove(recipe.uid);
      await cache.flush();

      await expect(stat(filePath)).rejects.toThrow();
      expect(await cache.get(recipe.uid)).toBeNull();

      const indexRaw = await readFile(join(tmp.dir(), "recipes", "index.json"), "utf-8");
      const index = JSON.parse(indexRaw) as Record<string, string>;
      expect(index).not.toHaveProperty(recipe.uid);
    });

    it("remove is idempotent on a missing file", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();
      await expect(cache.remove("never-existed")).resolves.toBeUndefined();
    });

    it("getAll includes pending (not-yet-flushed) recipes", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();
      const recipe = makeRecipe();
      await cache.put(recipe);

      const all = await cache.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]).toEqual(recipe);
    });

    it("getAll across instances returns all flushed recipes", async () => {
      const c1 = makeRecipeCache(tmp.dir());
      await c1.init();
      const r1 = makeRecipe();
      const r2 = makeRecipe();
      const r3 = makeRecipe();
      await c1.put(r1);
      await c1.put(r2);
      await c1.put(r3);
      await c1.flush();

      const c2 = makeRecipeCache(tmp.dir());
      await c2.init();
      const all = await c2.getAll();
      expect(all).toHaveLength(3);
      expect(all).toContainEqual(r1);
      expect(all).toContainEqual(r2);
      expect(all).toContainEqual(r3);
    });
  });

  describe("index file behavior", () => {
    it("flush writes recipes/index.json with uid → hash entries", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();
      const recipe = makeRecipe({ hash: "my-hash" });
      await cache.put(recipe);
      await cache.flush();

      const raw = await readFile(join(tmp.dir(), "recipes", "index.json"), "utf-8");
      const index = JSON.parse(raw) as Record<string, string>;
      expect(index[recipe.uid]).toBe("my-hash");
    });

    it("no .tmp file remains in the recipes dir after a successful flush", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();
      await cache.put(makeRecipe());
      await cache.flush();

      const entries = await readdir(join(tmp.dir(), "recipes"));
      expect(entries.filter((e) => e.endsWith(".tmp"))).toHaveLength(0);
    });

    it("emits warn record when recipes/index.json is corrupt", async () => {
      // First init creates the recipes dir. Then we corrupt the index file and
      // construct a new cache, which is when the corruption is observed.
      const seed = makeRecipeCache(tmp.dir());
      await seed.init();
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(tmp.dir(), "recipes", "index.json"), "{ broken json");

      const { log, records } = makePinoCapture();
      const cache = makeRecipeCache(tmp.dir(), log);
      await cache.init();

      const warnRecords = records.filter((r) => r["level"] === 40);
      expect(warnRecords).toHaveLength(1);
      expect(warnRecords[0]!["msg"]).toBe("corrupt recipes index.json, resetting to empty index");
    });
  });

  describe("diff", () => {
    it("added: remote-only UIDs are classified as added", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();
      const recipe = makeRecipe({ uid: "uid-1" as RecipeUid });
      const diff = cache.diff([{ uid: recipe.uid, hash: "h1" }]);
      expect(diff.added).toContain(recipe.uid);
      expect(diff.changed).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
    });

    it("changed: UIDs with diverging hashes are classified as changed", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();
      const recipe = makeRecipe({ uid: "uid-1" as RecipeUid, hash: "hash-v1" });
      await cache.put(recipe);

      const diff = cache.diff([{ uid: recipe.uid, hash: "hash-v2" }]);
      expect(diff.changed).toContain(recipe.uid);
    });

    it("removed: UIDs present locally but absent remotely are classified as removed", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();
      const recipe = makeRecipe({ uid: "uid-1" as RecipeUid });
      await cache.put(recipe);

      const diff = cache.diff([]);
      expect(diff.removed).toContain(recipe.uid);
    });

    it("put updates the hash index immediately — diff reflects new hash without flush", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();
      const r1 = makeRecipe({ uid: "uid-1" as RecipeUid, hash: "hash-v1" });
      await cache.put(r1);
      expect(cache.diff([{ uid: r1.uid, hash: "hash-v1" }])).toEqual({ added: [], changed: [], removed: [] });

      const r2 = { ...r1, hash: "hash-v2" };
      await cache.put(r2);
      expect(cache.diff([{ uid: r1.uid, hash: "hash-v1" }]).changed).toContain(r1.uid);
    });

    it("mixed case: added + changed + removed in one call", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();
      const r1 = makeRecipe({ uid: "uid-1" as RecipeUid, hash: "hash-a" });
      const r2 = makeRecipe({ uid: "uid-2" as RecipeUid, hash: "hash-b" });
      const r3 = makeRecipe({ uid: "uid-3" as RecipeUid, hash: "hash-c" });
      await cache.put(r1);
      await cache.put(r2);
      await cache.put(r3);

      const diff = cache.diff([
        { uid: r1.uid, hash: "hash-a" }, // same
        { uid: r2.uid, hash: "hash-CHANGED" }, // changed
        { uid: "uid-4" as RecipeUid, hash: "hash-new" }, // added
      ]);

      expect(diff.added).toEqual(["uid-4"]);
      expect(diff.changed).toEqual([r2.uid]);
      expect(diff.removed).toEqual([r3.uid]);
    });
  });

  describe("mutex", () => {
    it("a flush failure does not poison subsequent operations (mutex releases on exception)", async () => {
      const cache = makeRecipeCache(tmp.dir());
      await cache.init();
      await cache.put(makeRecipe());

      const { rename: renameMock } = await import("node:fs/promises");
      vi.mocked(renameMock).mockRejectedValueOnce(new Error("EACCES: simulated"));

      await expect(cache.flush()).rejects.toThrow("EACCES: simulated");

      // Recovery within a short window — proves the mutex released.
      const recovery = (async () => {
        await cache.put(makeRecipe());
        await cache.flush();
      })();
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("recovery took >200ms")), 200));
      await Promise.race([recovery, timeout]);

      const recipeFiles = (await readdir(join(tmp.dir(), "recipes"))).filter((f) => f !== "index.json");
      expect(recipeFiles.length).toBeGreaterThanOrEqual(2);
    });
  });
});
