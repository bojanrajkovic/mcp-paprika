import { mkdir, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";

import { OAuthTokenSchema } from "../../auth/types.js";
import type { OAuthToken } from "../../auth/types.js";
import { CategoryStoredSchema, PantryItemStoredSchema } from "../../paprika/types.js";
import type { Category, PantryItem } from "../../paprika/types.js";
import { isNodeError } from "../../utils/errors.js";
import { SILENT_LOG } from "../../utils/log.js";

import { DiskCache, writeFileAtomic } from "./base.js";
import { OAuthClientDiskCache } from "./oauth-clients.js";
import { RecipeDiskCache } from "./recipes.js";

// Schema for the recipes namespace inside the legacy unified index.json.
// Only this namespace is migrated — other namespaces stored empty-string
// placeholders equivalent to a directory listing, which the new per-entity
// init() rebuilds from `readdir` anyway.
const LegacyRecipeIndexSchema = z.record(z.string(), z.string());

interface InitFlushable {
  init(): Promise<void>;
  flush(): Promise<void>;
}

/**
 * Composition root for the persistence layer. Owns one `DiskCache`-derived
 * instance per entity, runs the legacy-index migration on first boot, and
 * coordinates startup (`init`) and shutdown-ish (`flush`) across all of them.
 *
 * Each subcache holds its own per-entity mutex; the root holds nothing.
 * There is no cross-entity atomic snapshot — each entity's `flush()` is
 * individually atomic (files fsynced; recipes index temp-then-rename'd
 * inside its own mutex), which is what `paprika/sync.ts` needs.
 */
export class DiskCacheRoot {
  readonly recipes: RecipeDiskCache;
  readonly categories: DiskCache<Category>;
  readonly pantry: DiskCache<PantryItem>;
  readonly oauthClients: OAuthClientDiskCache;
  readonly oauthTokens: DiskCache<OAuthToken>;

  private readonly _cacheDir: string;
  private readonly _subcaches: ReadonlyArray<InitFlushable>;
  private readonly log: Logger;

  constructor(cacheDir: string, log?: Logger) {
    this._cacheDir = cacheDir;
    this.log = log ?? SILENT_LOG;

    const logOpts = log !== undefined ? { log } : {};
    this.recipes = new RecipeDiskCache({ subdir: join(cacheDir, "recipes"), ...logOpts });
    this.categories = new DiskCache<Category>({
      subdir: join(cacheDir, "categories"),
      parse: (raw) => CategoryStoredSchema.parse(raw),
      getKey: (c) => c.uid,
      ...logOpts,
    });
    this.pantry = new DiskCache<PantryItem>({
      subdir: join(cacheDir, "pantry"),
      parse: (raw) => PantryItemStoredSchema.parse(raw),
      getKey: (i) => i.uid,
      ...logOpts,
    });
    this.oauthClients = new OAuthClientDiskCache({ subdir: join(cacheDir, "oauthClients"), ...logOpts });
    this.oauthTokens = new DiskCache<OAuthToken>({
      subdir: join(cacheDir, "oauthTokens"),
      parse: (raw) => OAuthTokenSchema.parse(raw),
      getKey: (t) => t.tokenHash,
      ...logOpts,
    });

    this._subcaches = [this.recipes, this.categories, this.pantry, this.oauthClients, this.oauthTokens];
  }

  async init(): Promise<void> {
    await this._maybeMigrateLegacyIndex();
    await Promise.all(this._subcaches.map((s) => s.init()));
  }

  async flush(): Promise<void> {
    await Promise.all(this._subcaches.map((s) => s.flush()));
  }

  /**
   * Idempotent, crash-safe upgrade from the legacy unified index.json
   * (`<cacheDir>/index.json`) to the per-entity layout
   * (`<cacheDir>/recipes/index.json`). The legacy index carried real
   * hashes only for recipes; every other namespace stored empty-string
   * placeholders that are exactly equivalent to a directory listing, so
   * the migration only extracts the `recipes` map.
   *
   * Crash safety: writes `recipes/index.json` FIRST (atomically via
   * temp-then-rename), then deletes the legacy file. A crash between
   * those steps leaves the legacy file in place; on next startup we
   * re-run and overwrite `recipes/index.json` with the same content
   * (idempotent), then retry the delete. Already-migrated installs
   * (no legacy file present) skip everything via an ENOENT return.
   */
  private async _maybeMigrateLegacyIndex(): Promise<void> {
    const legacyPath = join(this._cacheDir, "index.json");
    let raw: string;
    try {
      raw = await readFile(legacyPath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        // Fresh install or already-migrated: nothing to do.
        return;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // Corrupt legacy index — abandon its contents (matches the old
      // behavior of "corrupt → empty index"; recipes get re-hashed on next
      // sync) but still delete the legacy file so we stop trying.
      this.log.warn(
        { err, path: legacyPath },
        "corrupt legacy index.json — discarding; recipes will be re-hashed on next sync",
      );
      await this._safeUnlink(legacyPath);
      return;
    }

    const recipesParsed = LegacyRecipeIndexSchema.safeParse((parsed as { recipes?: unknown })?.recipes);
    if (recipesParsed.success && Object.keys(recipesParsed.data).length > 0) {
      const recipesDir = join(this._cacheDir, "recipes");
      await mkdir(recipesDir, { recursive: true });
      const targetPath = join(recipesDir, "index.json");
      const tmpPath = join(recipesDir, `.index-${Date.now().toString()}.tmp`);
      await writeFileAtomic(tmpPath, JSON.stringify(recipesParsed.data, null, 2));
      await rename(tmpPath, targetPath);
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
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}
