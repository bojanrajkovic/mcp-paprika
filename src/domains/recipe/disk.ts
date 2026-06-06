import { mkdir, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Result } from "neverthrow";
import { okAsync, ResultAsync } from "neverthrow";
import type { Logger } from "pino";
import { z } from "zod";

import type { CacheError } from "../../cache/disk-cache.js";
import type { RecipeUid } from "../../ids.js";
import type { DiffResult } from "../../paprika/sync-types.js";
import type { Recipe, RecipeEntry } from "./types.js";

import { cacheError, DiskCache, enoentOk } from "../../cache/disk-cache.js";
import { RecipeStoredSchema } from "./types.js";

// Local schema for recipes/index.json. Only recipes carry a real content hash —
// the other entities' on-disk entries are directory-listing placeholders — so this
// index is a flat uid → hash map.
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

  override init(): ResultAsync<void, CacheError> {
    return this._maybeMigrateLegacyIndex()
      .andThen(() => super.init())
      .andThen(() => this._loadHashIndex());
  }

  /**
   * Load the uid → hash map from `recipes/index.json`. A missing index is a
   * cold start; a corrupt or schema-mismatched one resets to an empty map
   * (the next sync re-fetches and re-hashes everything) — neither is an `err`,
   * because a bad cache must degrade to "re-sync," never to a startup failure.
   */
  private _loadHashIndex(): ResultAsync<void, CacheError> {
    const indexPath = join(this._subdir, "index.json");
    return ResultAsync.fromPromise(readFile(indexPath, "utf-8"), cacheError(`read ${indexPath}`))
      .orElse(enoentOk<string | null>(null)) // Cold-start: no recipes index yet. Silent by design.
      .map((raw) => {
        if (raw === null) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          this.log.warn({ err, path: indexPath }, "corrupt recipes index.json, resetting to empty index");
          return;
        }
        const result = RecipeIndexSchema.safeParse(parsed);
        if (!result.success) {
          this.log.warn({ path: indexPath }, "schema mismatch on recipes index.json, resetting to empty index");
          return;
        }
        for (const [uid, hash] of Object.entries(result.data)) {
          this._hashes.set(uid, hash);
        }
      });
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
  private _maybeMigrateLegacyIndex(): ResultAsync<void, CacheError> {
    const legacyPath = join(dirname(this._subdir), "index.json");
    return ResultAsync.fromPromise(readFile(legacyPath, "utf-8"), cacheError(`read ${legacyPath}`))
      .orElse(enoentOk<string | null>(null)) // fresh install or already migrated
      .andThen((raw) => {
        if (raw === null) return okAsync<void, CacheError>(undefined);

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          this.log.warn(
            { err, path: legacyPath },
            "corrupt legacy index.json — discarding; recipes will be re-hashed on next sync",
          );
          return this._safeUnlink(legacyPath);
        }

        const recipesParsed = RecipeIndexSchema.safeParse((parsed as { recipes?: unknown }).recipes);
        let migrate: ResultAsync<void, CacheError>;
        if (recipesParsed.success && Object.keys(recipesParsed.data).length > 0) {
          const data = recipesParsed.data;
          migrate = ResultAsync.fromPromise(
            mkdir(this._subdir, { recursive: true }),
            cacheError(`mkdir ${this._subdir}`),
          )
            .andThen(() => {
              const tmpPath = join(this._subdir, `.index-${Date.now().toString()}.tmp`);
              return this._writeFileAtomic(tmpPath, JSON.stringify(data, null, 2)).andThen(() =>
                ResultAsync.fromPromise(
                  rename(tmpPath, join(this._subdir, "index.json")),
                  cacheError(`rename recipes index into place`),
                ),
              );
            })
            .map(() => {
              this.log.info(
                { count: Object.keys(data).length },
                "migrated legacy unified index.json to recipes/index.json",
              );
            });
        } else {
          if (!recipesParsed.success) {
            this.log.warn(
              { path: legacyPath },
              "legacy index.json present but recipes namespace is missing or malformed — discarding",
            );
          }
          migrate = okAsync(undefined);
        }
        return migrate.andThen(() => this._safeUnlink(legacyPath));
      });
  }

  private _safeUnlink(path: string): ResultAsync<void, CacheError> {
    return ResultAsync.fromPromise(unlink(path), cacheError(`unlink ${path}`)).orElse(enoentOk<void>(undefined));
  }

  /**
   * Puts a recipe and records its hash for diffing. The hash is read from
   * `recipe.hash` — every caller passes the recipe's own hash here, and the
   * type carries it as a non-nullable field, so no separate `hash` parameter
   * is needed.
   */
  override put(recipe: Recipe): ResultAsync<void, CacheError> {
    return this._locked("put", () => {
      this._putInner(recipe);
      this._hashes.set(recipe.uid, recipe.hash);
      return okAsync<void, CacheError>(undefined);
    });
  }

  override remove(uid: string): ResultAsync<void, CacheError> {
    return this._locked("remove", () =>
      this._removeInner(uid).map(() => {
        this._hashes.delete(uid);
      }),
    );
  }

  /**
   * Classifies remote entries against the local uid → hash map into
   * added / changed / removed. O(n + m). Reflects pending puts immediately
   * (put updates `_hashes` synchronously inside the mutex).
   */
  diff(entries: ReadonlyArray<RecipeEntry>): Result<DiffResult, CacheError> {
    return this._requireInit("diff").map(() => {
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
    });
  }

  protected override _writePending(): ResultAsync<void, CacheError> {
    return super._writePending().andThen(() => {
      // Always rewrite the recipes index. `remove()` may have mutated _hashes
      // without leaving anything in _pending, so "pending was empty" doesn't
      // mean "index is up to date." The file is small; this is cheap.
      const obj: Record<string, string> = {};
      for (const [uid, hash] of this._hashes) obj[uid] = hash;
      const tmpPath = join(this._subdir, `.index-${Date.now().toString()}.tmp`);
      return this._writeFileAtomic(tmpPath, JSON.stringify(obj, null, 2)).andThen(() =>
        ResultAsync.fromPromise(
          rename(tmpPath, join(this._subdir, "index.json")),
          cacheError("rename recipes index into place"),
        ),
      );
    });
  }
}
