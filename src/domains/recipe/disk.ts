import { mkdir, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Logger } from "pino";
import { z } from "zod";

import type { RecipeUid } from "../../ids.js";
import type { DiffResult } from "../../paprika/sync-types.js";
import type { Recipe, RecipeEntry } from "./types.js";

import { DiskCache } from "../../cache/disk-cache.js";
import { isNodeError } from "../../utils/errors.js";
import { RecipeStoredSchema } from "./types.js";

// Local schema for recipes/index.json. The unified index.json schema lived
// in the old DiskCache; in the new layout only recipes carry real hashes,
// so the index schema is a flat uid → hash map.
const RecipeIndexSchema = z.record(z.string(), z.string());

export class RecipeDiskCache extends DiskCache<Recipe> {
  private readonly _hashes: Map<string, string> = new Map();

  constructor(opts: { readonly subdir: string; readonly log?: Logger }) {
    super({
      subdir: opts.subdir,
      parse: (raw) => RecipeStoredSchema.parse(raw),
      getKey: (r) => r.uid,
      ...(opts.log !== undefined ? { log: opts.log } : {}),
    });
  }

  override async init(): Promise<void> {
    await this._maybeMigrateLegacyIndex();
    await super.init();
    let raw: string;
    try {
      raw = await readFile(join(this._subdir, "index.json"), "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        // Cold-start: no recipes index yet. Silent by design.
        return;
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.log.warn(
        { err, path: join(this._subdir, "index.json") },
        "corrupt recipes index.json, resetting to empty index",
      );
      return;
    }
    const result = RecipeIndexSchema.safeParse(parsed);
    if (!result.success) {
      this.log.warn(
        { path: join(this._subdir, "index.json") },
        "schema mismatch on recipes index.json, resetting to empty index",
      );
      return;
    }
    for (const [uid, hash] of Object.entries(result.data)) {
      this._hashes.set(uid, hash);
    }
  }

  /**
   * Idempotent, crash-safe one-shot upgrade from the legacy unified index
   * (`<cacheDir>/index.json`, a `{ recipes: {uid→hash}, … }` map) to this cache's
   * per-entity `recipes/index.json`. Only the `recipes` namespace carried real
   * hashes; the other namespaces were directory-listing placeholders the per-entity
   * caches rebuild from `readdir`, so only `recipes` is extracted. Writes the new
   * file FIRST (temp-then-rename), then unlinks the legacy one; a crash between
   * re-runs idempotently. Lives HERE, not on a composition root, so it runs wherever
   * a RecipeDiskCache is built — both transports — independent of how the rest of the
   * cache (or auth) is assembled. The legacy file sits one level above this subdir.
   */
  private async _maybeMigrateLegacyIndex(): Promise<void> {
    const legacyPath = join(dirname(this._subdir), "index.json");
    let raw: string;
    try {
      raw = await readFile(legacyPath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") return; // fresh install or already migrated
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.log.warn(
        { err, path: legacyPath },
        "corrupt legacy index.json — discarding; recipes will be re-hashed on next sync",
      );
      await this._safeUnlink(legacyPath);
      return;
    }

    const recipesParsed = RecipeIndexSchema.safeParse((parsed as { recipes?: unknown })?.recipes);
    if (recipesParsed.success && Object.keys(recipesParsed.data).length > 0) {
      await mkdir(this._subdir, { recursive: true });
      const tmpPath = join(this._subdir, `.index-${Date.now().toString()}.tmp`);
      await this._writeFileAtomic(tmpPath, JSON.stringify(recipesParsed.data, null, 2));
      await rename(tmpPath, join(this._subdir, "index.json"));
      this.log.info(
        { count: Object.keys(recipesParsed.data).length },
        "migrated legacy unified index.json to recipes/index.json",
      );
    } else if (!recipesParsed.success) {
      this.log.warn(
        { path: legacyPath },
        "legacy index.json present but recipes namespace is missing or malformed — discarding",
      );
    }

    await this._safeUnlink(legacyPath);
  }

  private async _safeUnlink(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
  }

  /**
   * Puts a recipe and records its hash for diffing. The hash is read from
   * `recipe.hash` — every caller passes the recipe's own hash here, and the
   * type carries it as a non-nullable field, so the dedicated parameter the
   * old API took (`putRecipe(recipe, hash)`) was vestigial.
   */
  override async put(recipe: Recipe): Promise<void> {
    return this._mutex.runExclusive(() => {
      this._assertInitialized("put");
      this._putInner(recipe);
      this._hashes.set(recipe.uid, recipe.hash);
    });
  }

  override async remove(uid: string): Promise<void> {
    return this._mutex.runExclusive(async () => {
      this._assertInitialized("remove");
      await this._removeInner(uid);
      this._hashes.delete(uid);
    });
  }

  /**
   * Classifies remote entries against the local uid → hash map into
   * added / changed / removed. O(n + m). Reflects pending puts immediately
   * (put updates `_hashes` synchronously inside the mutex).
   */
  diff(entries: ReadonlyArray<RecipeEntry>): DiffResult {
    this._assertInitialized("diff");
    // `entry.uid` is already a `RecipeUid` (from `RecipeEntry`), so added/changed
    // brand for free. `_hashes` is an internal string-keyed map; its keys were
    // written from `recipe.uid`, so minting `RecipeUid` for `removed` at this
    // boundary is the one sanctioned cast (the brand flows out via `DiffResult`).
    const added: Array<RecipeUid> = [];
    const changed: Array<RecipeUid> = [];
    const remoteUids = new Set<string>();

    for (const entry of entries) {
      remoteUids.add(entry.uid);
      const localHash = this._hashes.get(entry.uid);
      if (localHash === undefined) {
        added.push(entry.uid);
      } else if (localHash !== entry.hash) {
        changed.push(entry.uid);
      }
    }

    const removed: Array<RecipeUid> = [];
    for (const uid of this._hashes.keys()) {
      if (!remoteUids.has(uid)) removed.push(uid as RecipeUid);
    }

    return { added, changed, removed };
  }

  protected override async _writePending(): Promise<void> {
    await super._writePending();
    // Always rewrite the recipes index. `remove()` may have mutated _hashes
    // without leaving anything in _pending, so "pending was empty" doesn't
    // mean "index is up to date." The file is small; this is cheap.
    const obj: Record<string, string> = {};
    for (const [uid, hash] of this._hashes) obj[uid] = hash;
    const tmpPath = join(this._subdir, `.index-${Date.now().toString()}.tmp`);
    await this._writeFileAtomic(tmpPath, JSON.stringify(obj, null, 2));
    await rename(tmpPath, join(this._subdir, "index.json"));
  }
}
