import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Mutex } from "async-mutex";
import { z } from "zod";
import type { Logger } from "pino";
import { RecipeStoredSchema, CategoryStoredSchema, PantryItemStoredSchema } from "../paprika/types.js";
import type { Recipe, Category, RecipeEntry, DiffResult, PantryItem } from "../paprika/types.js";
import { OAuthClientSchema, OAuthTokenSchema } from "../auth/types.js";
import type { OAuthClient, OAuthToken } from "../auth/types.js";
import { SILENT_LOG } from "../utils/log.js";
import { isNodeError } from "../utils/errors.js";

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
  private readonly log: Logger;

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

  constructor(cacheDir: string, log?: Logger) {
    this._cacheDir = cacheDir;
    this._indexPath = join(cacheDir, "index.json");
    this._recipesDir = join(cacheDir, "recipes");
    this._categoriesDir = join(cacheDir, "categories");
    this._pantryDir = join(cacheDir, "pantry");
    this._oauthClientsDir = join(cacheDir, "oauthClients");
    this._oauthTokensDir = join(cacheDir, "oauthTokens");
    this.log = log ?? SILENT_LOG;
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
        // Cold-start: index file doesn't exist yet on first run. Silent by design.
        this._index = { recipes: {}, categories: {}, pantry: {}, oauthClients: {}, oauthTokens: {} };
        return;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.log.warn({ err, path: this._indexPath }, "corrupt index.json, resetting to empty index");
      this._index = { recipes: {}, categories: {}, pantry: {}, oauthClients: {}, oauthTokens: {} };
      return;
    }

    const result = CacheIndexSchema.safeParse(parsed);
    if (!result.success) {
      this.log.warn({ path: this._indexPath }, "schema mismatch on index.json, resetting to empty index");
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
    return this._readJsonFile(this._recipesDir, uid, (raw) => RecipeStoredSchema.parse(raw), this._pendingRecipes);
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
      await this._removeJsonFile(this._recipesDir, uid, this._pendingRecipes, this._index.recipes);
    });
  }

  removePantryItem(uid: string): Promise<void> {
    return this._writeLock.runExclusive(async () => {
      if (this._index === null) {
        throw new Error("DiskCache: removePantryItem() called before init()");
      }
      await this._removeJsonFile(this._pantryDir, uid, this._pendingPantryItems, this._index.pantry);
    });
  }

  async getAllRecipes(): Promise<Array<Recipe>> {
    if (this._index === null) {
      throw new Error("DiskCache: getAllRecipes() called before init()");
    }
    return this._readAllJsonFiles(this._recipesDir, this._pendingRecipes, (raw) => RecipeStoredSchema.parse(raw));
  }

  async getAllPantryItems(): Promise<Array<PantryItem>> {
    if (this._index === null) {
      throw new Error("DiskCache: getAllPantryItems() called before init()");
    }
    return this._readAllJsonFiles(this._pantryDir, this._pendingPantryItems, (raw) =>
      PantryItemStoredSchema.parse(raw),
    );
  }

  async getCategory(uid: string): Promise<Category | null> {
    return this._readJsonFile(
      this._categoriesDir,
      uid,
      (raw) => CategoryStoredSchema.parse(raw),
      this._pendingCategories,
    );
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

  // ============================================================================
  // Private generic helpers for namespace-agnostic JSON CRUD
  // ============================================================================

  // Returns a pending entry (if present) or reads+validates a JSON file from
  // disk. ENOENT is silenced and returns null. parse() runs on every disk
  // read; pending entries are returned directly (already validated at buffer
  // time). Does not acquire _writeLock — callers are responsible.
  private async _readJsonFile<T>(
    dir: string,
    key: string,
    parse: (raw: unknown) => T,
    pending: ReadonlyMap<string, T>,
  ): Promise<T | null> {
    const hit = pending.get(key);
    if (hit !== undefined) {
      return hit;
    }

    const filePath = join(dir, `${key}.json`);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        // Cold-start: index file doesn't exist yet on first run. Silent by design.
        return null;
      }
      throw error;
    }

    return parse(JSON.parse(raw));
  }

  // Reads all JSON files from a directory and merges with pending entries.
  // Pending entries shadow disk for the same key. ENOENT on the directory is
  // silenced (first-run case). parse() runs on every disk read.
  // Does not acquire _writeLock — read-only, no mutex needed.
  private async _readAllJsonFiles<T>(
    dir: string,
    pending: ReadonlyMap<string, T>,
    parse: (raw: unknown) => T,
  ): Promise<Array<T>> {
    // Seed result with pending entries. Pending shadows disk for the same key.
    const result: Map<string, T> = new Map(pending);

    let files: Array<string>;
    try {
      files = await readdir(dir);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        // Cold-start: directory doesn't exist yet on first run. Silent by design.
        return [...result.values()];
      }
      throw error;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    await Promise.all(
      jsonFiles.map(async (filename) => {
        const key = filename.slice(0, -5); // strip ".json"
        if (result.has(key)) return; // pending entry shadows disk
        const raw = await readFile(join(dir, filename), "utf-8");
        const value = parse(JSON.parse(raw));
        result.set(key, value);
      }),
    );

    return [...result.values()];
  }

  // Deletes a file from disk (ENOENT-silenced), then removes the key from the
  // in-memory index record and the pending map. Must be called inside
  // _writeLock.runExclusive — the public remove methods are responsible for
  // acquiring the lock. Unlink failure (non-ENOENT) throws before touching
  // index or pending, preserving consistency.
  private async _removeJsonFile<T>(
    dir: string,
    key: string,
    pending: Map<string, T>,
    indexRecord: Record<string, string>,
  ): Promise<void> {
    const filePath = join(dir, `${key}.json`);
    try {
      await unlink(filePath);
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
      // Idempotent removal: file already gone is the desired end state.
    }

    delete indexRecord[key];
    pending.delete(key);
  }

  // ============================================================================
  // Private synchronous helper for diff computation
  // ============================================================================

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

  /**
   * Atomically counts the current OAuth-client population and puts `client`
   * only if it fits under `maxClients`. Both the count and the put happen
   * inside the same `_writeLock` acquisition, so concurrent callers can't
   * both observe count=49, both pass the check, and both write — the race
   * window that a separate count-then-put would leave open.
   *
   * Returns:
   * - `{ ok: true }` if the client was buffered (caller still owes a `flush()`).
   * - `{ ok: false, currentCount }` if the cap is already reached; nothing
   *   was written. `currentCount` lets callers log/diagnose.
   *
   * Updating an existing client (same `clientId`) is treated as a re-put,
   * not a new client — the count check uses the pre-existing index size.
   */
  tryPutOAuthClient(
    client: OAuthClient,
    maxClients: number,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly currentCount: number }> {
    return this._writeLock.runExclusive(() => {
      if (this._index === null) {
        throw new Error("DiskCache: tryPutOAuthClient() called before init()");
      }
      const alreadyKnown = Object.prototype.hasOwnProperty.call(this._index.oauthClients, client.clientId);
      const currentCount = Object.keys(this._index.oauthClients).length;
      if (!alreadyKnown && currentCount >= maxClients) {
        return { ok: false, currentCount } as const;
      }
      this._pendingOAuthClients.set(client.clientId, client);
      this._index.oauthClients[client.clientId] = "";
      return { ok: true } as const;
    });
  }

  async getOAuthClient(clientId: string): Promise<OAuthClient | null> {
    return this._readJsonFile(
      this._oauthClientsDir,
      clientId,
      (raw) => OAuthClientSchema.parse(raw),
      this._pendingOAuthClients,
    );
  }

  removeOAuthClient(clientId: string): Promise<void> {
    return this._writeLock.runExclusive(async () => {
      if (this._index === null) {
        throw new Error("DiskCache: removeOAuthClient() called before init()");
      }
      await this._removeJsonFile(this._oauthClientsDir, clientId, this._pendingOAuthClients, this._index.oauthClients);
    });
  }

  async getAllOAuthClients(): Promise<Array<OAuthClient>> {
    if (this._index === null) {
      throw new Error("DiskCache: getAllOAuthClients() called before init()");
    }
    return this._readAllJsonFiles(this._oauthClientsDir, this._pendingOAuthClients, (raw) =>
      OAuthClientSchema.parse(raw),
    );
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
    return this._readJsonFile(
      this._oauthTokensDir,
      tokenHash,
      (raw) => OAuthTokenSchema.parse(raw),
      this._pendingOAuthTokens,
    );
  }

  removeOAuthToken(tokenHash: string): Promise<void> {
    return this._writeLock.runExclusive(async () => {
      if (this._index === null) {
        throw new Error("DiskCache: removeOAuthToken() called before init()");
      }
      await this._removeJsonFile(this._oauthTokensDir, tokenHash, this._pendingOAuthTokens, this._index.oauthTokens);
    });
  }

  async getAllOAuthTokens(): Promise<Array<OAuthToken>> {
    if (this._index === null) {
      throw new Error("DiskCache: getAllOAuthTokens() called before init()");
    }
    return this._readAllJsonFiles(this._oauthTokensDir, this._pendingOAuthTokens, (raw) => OAuthTokenSchema.parse(raw));
  }
}
