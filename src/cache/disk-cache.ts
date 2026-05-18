import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Mutex } from "async-mutex";
import { z } from "zod";
import { RecipeStoredSchema, CategoryStoredSchema, PantryItemStoredSchema } from "../paprika/types.js";
import type { Recipe, Category, RecipeEntry, DiffResult, PantryItem } from "../paprika/types.js";
import { OAuthClientSchema, OAuthTokenSchema } from "../auth/types.js";
import type { OAuthClient, OAuthToken } from "../auth/types.js";

// Type guard for NodeJS.ErrnoException. Mirrors the local helper in
// utils/config.ts but is intentionally not exported from there — each
// module defines its own copy per the existing pattern.
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

// I/O error handling convention throughout this file:
// We use try/catch and check error.code rather than existsSync()-then-read.
// Reason: existsSync() is synchronous (blocks the event loop) and introduces
// a TOCTOU race — the file can be deleted between the existence check and the
// read. The try/catch pattern handles the file's actual state at I/O time with
// no race window, and the explicit rethrow for non-ENOENT codes (EISDIR,
// EACCES, …) ensures unexpected errors are never silently swallowed.

// File-local schema for index.json. Not exported — internal to DiskCache.
const CacheIndexSchema = z.object({
  recipes: z.record(z.string(), z.string()).default({}),
  categories: z.record(z.string(), z.string()).default({}),
  pantry: z.record(z.string(), z.string()).default({}),
  oauthClients: z.record(z.string(), z.string()).default({}),
  oauthTokens: z.record(z.string(), z.string()).default({}),
});

type CacheIndex = z.infer<typeof CacheIndexSchema>;

export class DiskCache {
  private readonly _cacheDir: string;
  private readonly _indexPath: string;
  private readonly _recipesDir: string;
  private readonly _categoriesDir: string;
  private readonly _pantryDir: string;
  private readonly _oauthClientsDir: string;
  private readonly _oauthTokensDir: string;
  private readonly _writeLock = new Mutex();

  // Null until init() is called. diff*() and flush() assert non-null.
  private _index: CacheIndex | null = null;

  // Pending writes buffered by put*(). Drained by flush(). get*() checks
  // these maps before falling back to disk so callers can read back data
  // they just put in the same sync cycle.
  private readonly _pendingRecipes: Map<string, Recipe> = new Map();
  private readonly _pendingCategories: Map<string, Category> = new Map();
  private readonly _pendingPantryItems: Map<string, PantryItem> = new Map();
  private readonly _pendingOAuthClients: Map<string, OAuthClient> = new Map();
  private readonly _pendingOAuthTokens: Map<string, OAuthToken> = new Map();

  constructor(cacheDir: string) {
    this._cacheDir = cacheDir;
    this._indexPath = join(cacheDir, "index.json");
    this._recipesDir = join(cacheDir, "recipes");
    this._categoriesDir = join(cacheDir, "categories");
    this._pantryDir = join(cacheDir, "pantry");
    this._oauthClientsDir = join(cacheDir, "oauthClients");
    this._oauthTokensDir = join(cacheDir, "oauthTokens");
  }

  async init(): Promise<void> {
    // Create subdirectories (idempotent — recursive: true). Independent paths, so parallelize.
    await Promise.all([
      mkdir(this._recipesDir, { recursive: true }),
      mkdir(this._categoriesDir, { recursive: true }),
      mkdir(this._pantryDir, { recursive: true }),
      mkdir(this._oauthClientsDir, { recursive: true }),
      mkdir(this._oauthTokensDir, { recursive: true }),
    ]);

    // Load index.json. ENOENT = first run → empty index.
    // Parse failure = corruption → log warning + empty index.
    // Other I/O error → rethrow.
    let raw: string;
    try {
      raw = await readFile(this._indexPath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        this._index = { recipes: {}, categories: {}, pantry: {}, oauthClients: {}, oauthTokens: {} };
        return;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      process.stderr.write("DiskCache: corrupt index.json (invalid JSON), resetting to empty index\n");
      this._index = { recipes: {}, categories: {}, pantry: {}, oauthClients: {}, oauthTokens: {} };
      return;
    }

    const result = CacheIndexSchema.safeParse(parsed);
    if (!result.success) {
      process.stderr.write("DiskCache: corrupt index.json (schema mismatch), resetting to empty index\n");
      this._index = { recipes: {}, categories: {}, pantry: {}, oauthClients: {}, oauthTokens: {} };
      return;
    }

    this._index = result.data;
  }

  async flush(): Promise<void> {
    return this._writeLock.runExclusive(async () => {
      if (this._index === null) {
        throw new Error("DiskCache: flush() called before init()");
      }

      // Write all pending recipe and category files in parallel.
      // Each file is opened, written, fsynced, and closed before the index
      // rename — guaranteeing that if a crash occurs after the rename, all
      // referenced files are durably on disk.
      await Promise.all([
        ...[...this._pendingRecipes.entries()].map(async ([uid, recipe]) => {
          const filePath = join(this._recipesDir, `${uid}.json`);
          const fh = await open(filePath, "w");
          try {
            await fh.writeFile(JSON.stringify(recipe, null, 2));
            await fh.sync();
          } finally {
            await fh.close();
          }
        }),
        ...[...this._pendingCategories.entries()].map(async ([uid, category]) => {
          const filePath = join(this._categoriesDir, `${uid}.json`);
          const fh = await open(filePath, "w");
          try {
            await fh.writeFile(JSON.stringify(category, null, 2));
            await fh.sync();
          } finally {
            await fh.close();
          }
        }),
        ...[...this._pendingPantryItems.entries()].map(async ([uid, item]) => {
          const filePath = join(this._pantryDir, `${uid}.json`);
          const fh = await open(filePath, "w");
          try {
            await fh.writeFile(JSON.stringify(item, null, 2));
            await fh.sync();
          } finally {
            await fh.close();
          }
        }),
        ...[...this._pendingOAuthClients.entries()].map(async ([clientId, client]) => {
          const filePath = join(this._oauthClientsDir, `${clientId}.json`);
          const fh = await open(filePath, "w");
          try {
            await fh.writeFile(JSON.stringify(client, null, 2));
            await fh.sync();
          } finally {
            await fh.close();
          }
        }),
        ...[...this._pendingOAuthTokens.entries()].map(async ([tokenHash, token]) => {
          const filePath = join(this._oauthTokensDir, `${tokenHash}.json`);
          const fh = await open(filePath, "w");
          try {
            await fh.writeFile(JSON.stringify(token, null, 2));
            await fh.sync();
          } finally {
            await fh.close();
          }
        }),
      ]);

      // Write index atomically via temp-then-rename.
      // The tmp file is written to cacheDir (same filesystem as index.json)
      // so rename() is a POSIX atomic op within the same directory.
      const tmpPath = join(this._cacheDir, `.index-${Date.now()}.tmp`);
      const fh = await open(tmpPath, "w");
      try {
        await fh.writeFile(JSON.stringify(this._index, null, 2));
        await fh.sync();
      } finally {
        await fh.close();
      }
      await rename(tmpPath, this._indexPath);

      this._pendingRecipes.clear();
      this._pendingCategories.clear();
      this._pendingPantryItems.clear();
      this._pendingOAuthClients.clear();
      this._pendingOAuthTokens.clear();
    });
  }

  async getRecipe(uid: string): Promise<Recipe | null> {
    // Pending map is checked first so callers can read back data they just
    // put in the same sync cycle (before flush writes it to disk).
    const pending = this._pendingRecipes.get(uid);
    if (pending !== undefined) {
      return pending;
    }

    const filePath = join(this._recipesDir, `${uid}.json`);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }

    return RecipeStoredSchema.parse(JSON.parse(raw));
  }

  putRecipe(recipe: Recipe, hash: string): Promise<void> {
    return this._writeLock.runExclusive(() => {
      if (this._index === null) {
        throw new Error("DiskCache: putRecipe() called before init()");
      }
      // Buffer in memory only — no file I/O. flush() writes to disk.
      this._pendingRecipes.set(recipe.uid, recipe);
      // Update index immediately so diffRecipes() reflects the new hash
      // without requiring flush() first (AC6.1).
      this._index.recipes[recipe.uid] = hash;
    });
  }

  putPantryItem(item: PantryItem): Promise<void> {
    return this._writeLock.runExclusive(() => {
      if (this._index === null) {
        throw new Error("DiskCache: putPantryItem() called before init()");
      }
      this._pendingPantryItems.set(item.uid, item);
      this._index.pantry[item.uid] = "";
    });
  }

  removeRecipe(uid: string): Promise<void> {
    return this._writeLock.runExclusive(async () => {
      if (this._index === null) {
        throw new Error("DiskCache: removeRecipe() called before init()");
      }

      // Delete file from disk if present. ENOENT is fine — idempotent.
      const filePath = join(this._recipesDir, `${uid}.json`);
      try {
        await unlink(filePath);
      } catch (error: unknown) {
        if (!isNodeError(error) || error.code !== "ENOENT") {
          throw error;
        }
      }

      // Remove from index and pending map.
      delete this._index.recipes[uid];
      this._pendingRecipes.delete(uid);
    });
  }

  removePantryItem(uid: string): Promise<void> {
    return this._writeLock.runExclusive(async () => {
      if (this._index === null) {
        throw new Error("DiskCache: removePantryItem() called before init()");
      }

      const filePath = join(this._pantryDir, `${uid}.json`);
      try {
        await unlink(filePath);
      } catch (error: unknown) {
        if (!isNodeError(error) || error.code !== "ENOENT") {
          throw error;
        }
      }

      delete this._index.pantry[uid];
      this._pendingPantryItems.delete(uid);
    });
  }

  async getAllRecipes(): Promise<Array<Recipe>> {
    if (this._index === null) {
      throw new Error("DiskCache: getAllRecipes() called before init()");
    }

    // Start with pending entries. Pending shadows disk for the same UID.
    const result: Map<string, Recipe> = new Map(this._pendingRecipes);

    // Read all .json files from recipesDir and add those not already in pending.
    let files: Array<string>;
    try {
      files = await readdir(this._recipesDir);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [...result.values()];
      }
      throw error;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    await Promise.all(
      jsonFiles.map(async (filename) => {
        const uid = filename.slice(0, -5); // strip ".json"
        if (result.has(uid)) return; // pending entry shadows disk
        const raw = await readFile(join(this._recipesDir, filename), "utf-8");
        const recipe = RecipeStoredSchema.parse(JSON.parse(raw));
        result.set(uid, recipe);
      }),
    );

    return [...result.values()];
  }

  async getAllPantryItems(): Promise<Array<PantryItem>> {
    if (this._index === null) {
      throw new Error("DiskCache: getAllPantryItems() called before init()");
    }

    const result: Map<string, PantryItem> = new Map(this._pendingPantryItems);

    let files: Array<string>;
    try {
      files = await readdir(this._pantryDir);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [...result.values()];
      }
      throw error;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    await Promise.all(
      jsonFiles.map(async (filename) => {
        const uid = filename.slice(0, -5);
        if (result.has(uid)) return;
        const raw = await readFile(join(this._pantryDir, filename), "utf-8");
        const item = PantryItemStoredSchema.parse(JSON.parse(raw));
        result.set(uid, item);
      }),
    );

    return [...result.values()];
  }

  async getCategory(uid: string): Promise<Category | null> {
    const pending = this._pendingCategories.get(uid);
    if (pending !== undefined) {
      return pending;
    }

    const filePath = join(this._categoriesDir, `${uid}.json`);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }

    return CategoryStoredSchema.parse(JSON.parse(raw));
  }

  putCategory(category: Category, hash: string): Promise<void> {
    return this._writeLock.runExclusive(() => {
      if (this._index === null) {
        throw new Error("DiskCache: putCategory() called before init()");
      }
      this._pendingCategories.set(category.uid, category);
      this._index.categories[category.uid] = hash;
    });
  }

  // Private synchronous helper. Classifies remote entries against the local
  // uid → hash map into added/changed/removed. Uses a Set for O(1) remote
  // UID lookup so the algorithm is O(n + m), not O(n × m).
  private _diffEntries(
    remote: ReadonlyArray<{ readonly uid: string; readonly hash: string }>,
    local: Readonly<Record<string, string>>,
  ): DiffResult {
    const added: Array<string> = [];
    const changed: Array<string> = [];
    const remoteUids = new Set<string>();

    for (const entry of remote) {
      remoteUids.add(entry.uid);
      // noUncheckedIndexedAccess: local[uid] is string | undefined
      const localHash = local[entry.uid];
      if (localHash === undefined) {
        added.push(entry.uid);
      } else if (localHash !== entry.hash) {
        changed.push(entry.uid);
      }
    }

    const removed = Object.keys(local).filter((uid) => !remoteUids.has(uid));

    return { added, changed, removed };
  }

  diffRecipes(entries: ReadonlyArray<RecipeEntry>): DiffResult {
    if (this._index === null) {
      throw new Error("DiskCache: diffRecipes() called before init()");
    }
    return this._diffEntries(entries, this._index.recipes);
  }

  putOAuthClient(client: OAuthClient): Promise<void> {
    return this._writeLock.runExclusive(() => {
      if (this._index === null) {
        throw new Error("DiskCache: putOAuthClient() called before init()");
      }
      this._pendingOAuthClients.set(client.clientId, client);
      this._index.oauthClients[client.clientId] = "";
    });
  }

  async getOAuthClient(clientId: string): Promise<OAuthClient | null> {
    const pending = this._pendingOAuthClients.get(clientId);
    if (pending !== undefined) {
      return pending;
    }

    const filePath = join(this._oauthClientsDir, `${clientId}.json`);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }

    return OAuthClientSchema.parse(JSON.parse(raw));
  }

  removeOAuthClient(clientId: string): Promise<void> {
    return this._writeLock.runExclusive(async () => {
      if (this._index === null) {
        throw new Error("DiskCache: removeOAuthClient() called before init()");
      }

      const filePath = join(this._oauthClientsDir, `${clientId}.json`);
      try {
        await unlink(filePath);
      } catch (error: unknown) {
        if (!isNodeError(error) || error.code !== "ENOENT") {
          throw error;
        }
      }

      delete this._index.oauthClients[clientId];
      this._pendingOAuthClients.delete(clientId);
    });
  }

  async getAllOAuthClients(): Promise<Array<OAuthClient>> {
    if (this._index === null) {
      throw new Error("DiskCache: getAllOAuthClients() called before init()");
    }

    const result: Map<string, OAuthClient> = new Map(this._pendingOAuthClients);

    let files: Array<string>;
    try {
      files = await readdir(this._oauthClientsDir);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [...result.values()];
      }
      throw error;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    await Promise.all(
      jsonFiles.map(async (filename) => {
        const clientId = filename.slice(0, -5);
        if (result.has(clientId)) return;
        const raw = await readFile(join(this._oauthClientsDir, filename), "utf-8");
        const client = OAuthClientSchema.parse(JSON.parse(raw));
        result.set(clientId, client);
      }),
    );

    return [...result.values()];
  }

  putOAuthToken(token: OAuthToken): Promise<void> {
    return this._writeLock.runExclusive(() => {
      if (this._index === null) {
        throw new Error("DiskCache: putOAuthToken() called before init()");
      }
      this._pendingOAuthTokens.set(token.tokenHash, token);
      this._index.oauthTokens[token.tokenHash] = "";
    });
  }

  async getOAuthToken(tokenHash: string): Promise<OAuthToken | null> {
    const pending = this._pendingOAuthTokens.get(tokenHash);
    if (pending !== undefined) {
      return pending;
    }

    const filePath = join(this._oauthTokensDir, `${tokenHash}.json`);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }

    return OAuthTokenSchema.parse(JSON.parse(raw));
  }

  removeOAuthToken(tokenHash: string): Promise<void> {
    return this._writeLock.runExclusive(async () => {
      if (this._index === null) {
        throw new Error("DiskCache: removeOAuthToken() called before init()");
      }

      const filePath = join(this._oauthTokensDir, `${tokenHash}.json`);
      try {
        await unlink(filePath);
      } catch (error: unknown) {
        if (!isNodeError(error) || error.code !== "ENOENT") {
          throw error;
        }
      }

      delete this._index.oauthTokens[tokenHash];
      this._pendingOAuthTokens.delete(tokenHash);
    });
  }

  async getAllOAuthTokens(): Promise<Array<OAuthToken>> {
    if (this._index === null) {
      throw new Error("DiskCache: getAllOAuthTokens() called before init()");
    }

    const result: Map<string, OAuthToken> = new Map(this._pendingOAuthTokens);

    let files: Array<string>;
    try {
      files = await readdir(this._oauthTokensDir);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [...result.values()];
      }
      throw error;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    await Promise.all(
      jsonFiles.map(async (filename) => {
        const tokenHash = filename.slice(0, -5);
        if (result.has(tokenHash)) return;
        const raw = await readFile(join(this._oauthTokensDir, filename), "utf-8");
        const token = OAuthTokenSchema.parse(JSON.parse(raw));
        result.set(tokenHash, token);
      }),
    );

    return [...result.values()];
  }
}
