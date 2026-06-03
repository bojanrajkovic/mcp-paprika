import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PantryItemUid, RecipeUid } from "../ids.js";

import { makePinoCapture } from "../tools/tool-test-utils.js";
import { makeGroceryIngredient } from "./__fixtures__/grocery-ingredients.js";
import { makeGroceryItem } from "./__fixtures__/grocery-items.js";
import { makeGroceryList } from "./__fixtures__/grocery-lists.js";
import { makeOAuthClient, makeOAuthToken } from "./__fixtures__/oauth.js";
import { makePantryItem } from "./__fixtures__/pantry.js";
import { makeCategory, makeRecipe } from "./__fixtures__/recipes.js";
import { DiskCacheRoot } from "./disk-cache-root.js";

// Mock fs/promises so the rename used by the recipes index temp-then-rename
// can be made to fail on demand. The factory imports the real module and
// overrides only `rename` with a spy.
vi.mock("node:fs/promises", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs/promises")>();
  return { ...orig, rename: vi.fn(orig.rename) };
});

describe("DiskCacheRoot", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "paprika-disk-cache-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("init lifecycle", () => {
    it("creates per-entity subdirectories on init", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();

      for (const sub of [
        "recipes",
        "categories",
        "pantry",
        "aisles",
        "oauthClients",
        "oauthTokens",
        "grocerylists",
        "groceryitems",
        "groceryingredients",
      ]) {
        expect((await stat(join(tempDir, sub))).isDirectory()).toBe(true);
      }
    });

    it("recipes.get/getAll throw before init", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await expect(cache.recipes.getAll()).rejects.toThrow("before init");
      await expect(cache.recipes.get("any")).rejects.toThrow("before init");
    });

    it("recipes.diff throws before init", () => {
      const cache = new DiskCacheRoot(tempDir);
      expect(() => cache.recipes.diff([])).toThrow("before init");
    });

    it("flush before init throws", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await expect(cache.flush()).rejects.toThrow("before init");
    });
  });

  describe("recipes — CRUD + hash index", () => {
    it("put buffers in memory; no file written until flush", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const recipe = makeRecipe();
      await cache.recipes.put(recipe);

      await expect(stat(join(tempDir, "recipes", `${recipe.uid}.json`))).rejects.toThrow();
    });

    it("get returns buffered recipe immediately after put", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const recipe = makeRecipe();
      await cache.recipes.put(recipe);
      expect(await cache.recipes.get(recipe.uid)).toEqual(recipe);
    });

    it("put + flush + get round-trips through disk", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const recipe = makeRecipe();
      await cache.recipes.put(recipe);
      await cache.flush();

      expect(await cache.recipes.get(recipe.uid)).toEqual(recipe);
    });

    it("get returns null for an unknown uid", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      expect(await cache.recipes.get("nonexistent-uid")).toBeNull();
    });

    it("remove deletes the file and drops the entry from the hash index", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const recipe = makeRecipe();
      await cache.recipes.put(recipe);
      await cache.flush();

      const filePath = join(tempDir, "recipes", `${recipe.uid}.json`);
      await expect(stat(filePath)).resolves.toBeDefined();

      await cache.recipes.remove(recipe.uid);
      await cache.flush();

      await expect(stat(filePath)).rejects.toThrow();
      expect(await cache.recipes.get(recipe.uid)).toBeNull();

      const indexRaw = await readFile(join(tempDir, "recipes", "index.json"), "utf-8");
      const index = JSON.parse(indexRaw) as Record<string, string>;
      expect(index).not.toHaveProperty(recipe.uid);
    });

    it("remove is idempotent on a missing file", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      await expect(cache.recipes.remove("never-existed")).resolves.toBeUndefined();
    });

    it("getAll includes pending (not-yet-flushed) recipes", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const recipe = makeRecipe();
      await cache.recipes.put(recipe);

      const all = await cache.recipes.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]).toEqual(recipe);
    });

    it("getAll across instances returns all flushed recipes", async () => {
      const c1 = new DiskCacheRoot(tempDir);
      await c1.init();
      const r1 = makeRecipe();
      const r2 = makeRecipe();
      const r3 = makeRecipe();
      await c1.recipes.put(r1);
      await c1.recipes.put(r2);
      await c1.recipes.put(r3);
      await c1.flush();

      const c2 = new DiskCacheRoot(tempDir);
      await c2.init();
      const all = await c2.recipes.getAll();
      expect(all).toHaveLength(3);
      expect(all).toContainEqual(r1);
      expect(all).toContainEqual(r2);
      expect(all).toContainEqual(r3);
    });
  });

  describe("recipes — index file behavior", () => {
    it("flush writes recipes/index.json with uid → hash entries", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const recipe = makeRecipe({ hash: "my-hash" });
      await cache.recipes.put(recipe);
      await cache.flush();

      const raw = await readFile(join(tempDir, "recipes", "index.json"), "utf-8");
      const index = JSON.parse(raw) as Record<string, string>;
      expect(index[recipe.uid]).toBe("my-hash");
    });

    it("no .tmp file remains in the recipes dir after a successful flush", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      await cache.recipes.put(makeRecipe());
      await cache.flush();

      const entries = await readdir(join(tempDir, "recipes"));
      expect(entries.filter((e) => e.endsWith(".tmp"))).toHaveLength(0);
    });

    it("emits warn record when recipes/index.json is corrupt", async () => {
      // First init creates the recipes dir. Then we corrupt the index file and
      // construct a new root, which is when the corruption is observed.
      const seed = new DiskCacheRoot(tempDir);
      await seed.init();
      await writeFile(join(tempDir, "recipes", "index.json"), "{ broken json");

      const { log, records } = makePinoCapture();
      const cache = new DiskCacheRoot(tempDir, log);
      await cache.init();

      const warnRecords = records.filter((r) => r["level"] === 40);
      expect(warnRecords).toHaveLength(1);
      expect(warnRecords[0]!["msg"]).toBe("corrupt recipes index.json, resetting to empty index");
    });
  });

  describe("recipes.diff", () => {
    it("added: remote-only UIDs are classified as added", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const recipe = makeRecipe({ uid: "uid-1" as RecipeUid });
      const diff = cache.recipes.diff([{ uid: recipe.uid, hash: "h1" }]);
      expect(diff.added).toContain(recipe.uid);
      expect(diff.changed).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
    });

    it("changed: UIDs with diverging hashes are classified as changed", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const recipe = makeRecipe({ uid: "uid-1" as RecipeUid, hash: "hash-v1" });
      await cache.recipes.put(recipe);

      const diff = cache.recipes.diff([{ uid: recipe.uid, hash: "hash-v2" }]);
      expect(diff.changed).toContain(recipe.uid);
    });

    it("removed: UIDs present locally but absent remotely are classified as removed", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const recipe = makeRecipe({ uid: "uid-1" as RecipeUid });
      await cache.recipes.put(recipe);

      const diff = cache.recipes.diff([]);
      expect(diff.removed).toContain(recipe.uid);
    });

    it("put updates the hash index immediately — diff reflects new hash without flush", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const r1 = makeRecipe({ uid: "uid-1" as RecipeUid, hash: "hash-v1" });
      await cache.recipes.put(r1);
      expect(cache.recipes.diff([{ uid: r1.uid, hash: "hash-v1" }])).toEqual({ added: [], changed: [], removed: [] });

      const r2 = { ...r1, hash: "hash-v2" };
      await cache.recipes.put(r2);
      expect(cache.recipes.diff([{ uid: r1.uid, hash: "hash-v1" }]).changed).toContain(r1.uid);
    });

    it("mixed case: added + changed + removed in one call", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const r1 = makeRecipe({ uid: "uid-1" as RecipeUid, hash: "hash-a" });
      const r2 = makeRecipe({ uid: "uid-2" as RecipeUid, hash: "hash-b" });
      const r3 = makeRecipe({ uid: "uid-3" as RecipeUid, hash: "hash-c" });
      await cache.recipes.put(r1);
      await cache.recipes.put(r2);
      await cache.recipes.put(r3);

      const diff = cache.recipes.diff([
        { uid: r1.uid, hash: "hash-a" }, // same
        { uid: r2.uid, hash: "hash-CHANGED" }, // changed
        { uid: "uid-4" as RecipeUid, hash: "hash-new" }, // added
      ]);

      expect(diff.added).toEqual(["uid-4"]);
      expect(diff.changed).toEqual([r2.uid]);
      expect(diff.removed).toEqual([r3.uid]);
    });
  });

  describe("categories — CRUD", () => {
    it("put then get round-trips through pending and disk", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const category = makeCategory();

      await cache.categories.put(category);
      expect(await cache.categories.get(category.uid)).toEqual(category);

      await cache.flush();
      const cache2 = new DiskCacheRoot(tempDir);
      await cache2.init();
      expect(await cache2.categories.get(category.uid)).toEqual(category);
    });

    it("get returns null for an unknown uid", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      expect(await cache.categories.get("nonexistent")).toBeNull();
    });
  });

  describe("pantry — CRUD", () => {
    it("put + flush writes a JSON file under pantry/", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const item = makePantryItem();
      await cache.pantry.put(item);
      await cache.flush();

      const raw = await readFile(join(tempDir, "pantry", `${item.uid}.json`), "utf-8");
      const parsed = JSON.parse(raw) as { uid: string; ingredient: string; quantity: string };
      expect(parsed.uid).toBe(item.uid);
      expect(parsed.ingredient).toBe(item.ingredient);
    });

    it("getAll merges pending and disk, with pending shadowing disk", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();

      const diskItem = makePantryItem({ uid: "uid-disk" as PantryItemUid });
      await cache.pantry.put(diskItem);
      await cache.flush();

      const pendingItem = makePantryItem({ uid: "uid-pending" as PantryItemUid });
      await cache.pantry.put(pendingItem);

      const all = await cache.pantry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((i) => i.uid).sort()).toEqual(["uid-disk", "uid-pending"]);

      // Shadowing: a pending put with the same uid replaces the disk version
      // for the next getAll. Use the existing diskItem's UID so the disk
      // version is on disk before we shadow it.
      const shadowedItem = makePantryItem({
        uid: diskItem.uid,
        ingredient: "Shadowing Value",
      });
      await cache.pantry.put(shadowedItem);

      const all2 = await cache.pantry.getAll();
      const shadowed = all2.find((i) => i.uid === diskItem.uid);
      expect(shadowed?.ingredient).toBe("Shadowing Value");
    });

    it("remove deletes the file and is idempotent", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const item = makePantryItem();
      await cache.pantry.put(item);
      await cache.flush();

      const filePath = join(tempDir, "pantry", `${item.uid}.json`);
      await expect(stat(filePath)).resolves.toBeDefined();

      await cache.pantry.remove(item.uid);
      await expect(stat(filePath)).rejects.toThrow();

      const all = await cache.pantry.getAll();
      expect(all).toHaveLength(0);

      // Idempotent — removing a UID that was never present resolves.
      await expect(cache.pantry.remove("never-existed-uid")).resolves.toBeUndefined();
    });
  });

  describe("oauthClients — CRUD + tryPut cap", () => {
    it("put + flush round-trip", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const clientId = randomUUID();
      const client = makeOAuthClient({ clientId });
      await cache.oauthClients.put(client);
      expect(await cache.oauthClients.get(clientId)).toEqual(client);

      await cache.flush();
      const cache2 = new DiskCacheRoot(tempDir);
      await cache2.init();
      expect(await cache2.oauthClients.get(clientId)).toEqual(client);
    });

    it("on-disk JSON contains the registrationAccessTokenHash and no plaintext fields", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const clientId = randomUUID();
      await cache.oauthClients.put(makeOAuthClient({ clientId, registrationAccessTokenHash: "a".repeat(64) }));
      await cache.flush();

      const raw = await readFile(join(tempDir, "oauthClients", `${clientId}.json`), "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed["registrationAccessTokenHash"]).toMatch(/^[0-9a-f]{64}$/);
      expect(parsed).not.toHaveProperty("client_secret");
      expect(parsed).not.toHaveProperty("clientSecret");
      expect(parsed).not.toHaveProperty("registrationAccessToken");
    });

    it("tryPut accepts the put while under the cap", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const result = await cache.oauthClients.tryPut(makeOAuthClient(), 5);
      expect(result.ok).toBe(true);
    });

    it("tryPut rejects new clients once the cap is reached but allows re-puts", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();

      const first = makeOAuthClient();
      const second = makeOAuthClient();
      await cache.oauthClients.tryPut(first, 1);
      const rejected = await cache.oauthClients.tryPut(second, 1);
      expect(rejected).toEqual({ ok: false, currentCount: 1 });

      // Re-puts of an existing clientId skip the count check.
      const updated = await cache.oauthClients.tryPut({ ...first, clientName: "Updated" }, 1);
      expect(updated.ok).toBe(true);
    });
  });

  describe("oauthTokens — CRUD", () => {
    it("put + flush + get reads from disk", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const token = makeOAuthToken();
      await cache.oauthTokens.put(token);
      await cache.flush();
      expect(await cache.oauthTokens.get(token.tokenHash)).toEqual(token);
    });

    it("filename equals tokenHash; tokenHash field equals filename", async () => {
      const token = makeOAuthToken();
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      await cache.oauthTokens.put(token);
      await cache.flush();

      const entries = await readdir(join(tempDir, "oauthTokens"));
      expect(entries).toContain(`${token.tokenHash}.json`);

      const raw = await readFile(join(tempDir, "oauthTokens", `${token.tokenHash}.json`), "utf-8");
      const parsed = JSON.parse(raw) as { tokenHash: string };
      expect(parsed.tokenHash).toBe(token.tokenHash);
    });

    it("remove deletes the file and is idempotent", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const token = makeOAuthToken();
      await cache.oauthTokens.put(token);
      await cache.flush();
      const filePath = join(tempDir, "oauthTokens", `${token.tokenHash}.json`);
      await expect(stat(filePath)).resolves.toBeDefined();

      await cache.oauthTokens.remove(token.tokenHash);
      await expect(stat(filePath)).rejects.toThrow();

      const all = await cache.oauthTokens.getAll();
      expect(all).toHaveLength(0);
    });
  });

  describe("grocery subcaches — AC1.9", () => {
    it("init creates grocerylists, groceryitems, groceryingredients subdirectories", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();

      for (const sub of ["grocerylists", "groceryitems", "groceryingredients"]) {
        expect((await stat(join(tempDir, sub))).isDirectory()).toBe(true);
      }
    });

    it("groceryLists: put + flush + get round-trips through disk", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const list = makeGroceryList();
      await cache.groceryLists.put(list);
      await cache.flush();

      const cache2 = new DiskCacheRoot(tempDir);
      await cache2.init();
      const all = await cache2.groceryLists.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]).toEqual(list);
    });

    it("groceryItems: put + flush + get round-trips through disk", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const item = makeGroceryItem();
      await cache.groceryItems.put(item);
      await cache.flush();

      const cache2 = new DiskCacheRoot(tempDir);
      await cache2.init();
      const all = await cache2.groceryItems.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]).toEqual(item);
    });

    it("groceryIngredients: put + flush + get round-trips through disk", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      const ingredient = makeGroceryIngredient();
      await cache.groceryIngredients.put(ingredient);
      await cache.flush();

      const cache2 = new DiskCacheRoot(tempDir);
      await cache2.init();
      const all = await cache2.groceryIngredients.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]).toEqual(ingredient);
    });

    it("all three grocery subcaches survive a full put → flush → new root → init → getAll round-trip", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();

      const list = makeGroceryList({ name: "Weekly Shopping" });
      const item = makeGroceryItem({ name: "Avocados" });
      const ingredient = makeGroceryIngredient({ name: "Garlic" });

      await cache.groceryLists.put(list);
      await cache.groceryItems.put(item);
      await cache.groceryIngredients.put(ingredient);
      await cache.flush();

      const cache2 = new DiskCacheRoot(tempDir);
      await cache2.init();

      const lists = await cache2.groceryLists.getAll();
      expect(lists).toHaveLength(1);
      expect(lists[0]).toEqual(list);

      const items = await cache2.groceryItems.getAll();
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual(item);

      const ingredients = await cache2.groceryIngredients.getAll();
      expect(ingredients).toHaveLength(1);
      expect(ingredients[0]).toEqual(ingredient);
    });
  });

  describe("concurrency — per-subcache mutex serialization", () => {
    it("interleaved puts + flushes across entities land atomically", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();

      const recipes = Array.from({ length: 20 }, (_, i) => makeRecipe({ uid: `r-${i.toString()}` as RecipeUid }));
      const clients = Array.from({ length: 20 }, () =>
        makeOAuthClient({ registrationAccessTokenHash: "a".repeat(64) }),
      );
      const tokens = Array.from({ length: 10 }, () => makeOAuthToken());

      const ops: Array<Promise<unknown>> = [];
      for (let i = 0; i < 20; i++) {
        ops.push(cache.recipes.put(recipes[i]!));
        ops.push(cache.oauthClients.put(clients[i]!));
        if (i % 4 === 3) ops.push(cache.flush());
      }
      for (const t of tokens) ops.push(cache.oauthTokens.put(t));
      ops.push(cache.flush());

      await Promise.all(ops);

      expect((await readdir(join(tempDir, "recipes"))).filter((f) => f !== "index.json")).toHaveLength(20);
      expect(await readdir(join(tempDir, "oauthClients"))).toHaveLength(20);
      expect(await readdir(join(tempDir, "oauthTokens"))).toHaveLength(10);

      expect(await cache.recipes.getAll()).toHaveLength(20);
      expect(await cache.oauthClients.getAll()).toHaveLength(20);
      expect(await cache.oauthTokens.getAll()).toHaveLength(10);

      // No tmp leftovers from the recipes index rename.
      expect((await readdir(join(tempDir, "recipes"))).filter((e) => e.endsWith(".tmp"))).toHaveLength(0);
    });

    it("a flush failure does not poison subsequent operations (mutex releases on exception)", async () => {
      const cache = new DiskCacheRoot(tempDir);
      await cache.init();
      await cache.recipes.put(makeRecipe());

      const { rename: renameMock } = await import("node:fs/promises");
      vi.mocked(renameMock).mockRejectedValueOnce(new Error("EACCES: simulated"));

      await expect(cache.flush()).rejects.toThrow("EACCES: simulated");

      // Recovery within a short window — proves the mutex released.
      const recovery = (async () => {
        await cache.recipes.put(makeRecipe());
        await cache.flush();
      })();
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("recovery took >200ms")), 200));
      await Promise.race([recovery, timeout]);

      const recipeFiles = (await readdir(join(tempDir, "recipes"))).filter((f) => f !== "index.json");
      expect(recipeFiles.length).toBeGreaterThanOrEqual(2);
    });
  });
});
