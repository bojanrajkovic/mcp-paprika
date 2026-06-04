import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { Logger } from "pino";

import type { DiskCache } from "../cache/disk-cache.js";
import type { Category } from "../category/types.js";
import type { RecipeUid } from "../ids.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { Photo } from "../photo/types.js";
import type { Notifier } from "../server/notifier.js";
import type { RecipeApi } from "./api.js";
import type { Recipe } from "./types.js";

import { DiskCache as DiskCacheImpl } from "../cache/disk-cache.js";
import { categoryDiskDescriptor } from "../category/disk.js";
import { CategoryStore } from "../category/store.js";
import { PhotoUidSchema } from "../ids.js";
import { defineModule, register } from "../kernel/registry.js";
import { photoDiskDescriptor } from "../photo/disk.js";
import { PhotoStore } from "../photo/store.js";
import { resolveCategoryRefs } from "../tools/helpers.js";
import { sha256Hex } from "../tools/photo-helpers.js";
import { RecipeDiskCache } from "./disk.js";
import { recipeResource } from "./resources/recipe-resource.js";
import { RecipeStore } from "./store.js";
import { categoriesSync } from "./syncs/category-sync.js";
import { photosSync } from "./syncs/photo-sync.js";
import { recipesSync } from "./syncs/recipe-sync.js";
import { categorizeRecipeTool } from "./tools/categorize.js";
import { categoryWriteTools } from "./tools/category-writes.js";
import { createRecipeTool } from "./tools/create.js";
import { deleteCategoryTool } from "./tools/delete-category.js";
import { favoriteRecipeTools } from "./tools/favorite.js";
import { listCategoriesTool } from "./tools/list-categories.js";
import { listRecipesTool } from "./tools/list.js";
import { photoWriteTools } from "./tools/photo-writes.js";
import { purgeRecipeTool } from "./tools/purge.js";
import { rateRecipeTool } from "./tools/rate.js";
import { readRecipeTool } from "./tools/read.js";
import { restoreRecipeTool } from "./tools/restore.js";
import { searchRecipesTool } from "./tools/search.js";
import { trashRecipeTool } from "./tools/trash.js";
import { updateRecipeTool } from "./tools/update.js";

declare module "../kernel/registry.js" {
  interface DomainRegistry {
    recipe: RecipeApi;
  }
}

/**
 * One store + cache pair for one of recipe's three owned entities. Recipes carry
 * the bespoke `RecipeDiskCache` (the uid→hash index that powers diff-and-fetch);
 * categories and photos use the plain `DiskCache`.
 */
export interface RecipeEntitySlice<Store, Cache> {
  readonly store: Store;
  readonly cache: Cache;
}

/**
 * The recipe module's internals. The largest module: it carries THREE store/cache
 * pairs (recipes + categories + photos), because the collapse folds category and
 * photo in (recipe owns both, with NO separate module and NO dependency on either).
 *
 * The write-capable methods (`commitRecipe`, `commitRecipeHardDelete`,
 * `reconcileLocalRecipe`/`reconcileLocalRecipeAbsent`, `commitCategoryUpsert`/
 * `commitCategoryDelete`, `attachPhotoToRecipe`/`commitPhotoDelete`) are bound HERE
 * in `.self`, not in `.build`, because they WRITE — they close over `infra.client`
 * and `infra.notifier`, which the factory has and `.build` does not (mirrors aisle's
 * `ensureAisle`). The read-only contract methods are assembled from the stores in
 * `.build`. Lifted verbatim from `src/tools/{helpers,category-helpers,photo-helpers}.ts`,
 * reaching this module's own stores/caches instead of the god-object context.
 *
 * Vector-index maintenance is DROPPED in the additive phase: `maintainRecipeIndex`/
 * `reindexRecipesForCategoryChange` write the discover-owned `vectorStore`, which the
 * inert module does not carry. The flip wires re-indexing through a discover write-hook
 * (see the `// FLIP:` markers). The `resourceListChanged()` rule is PRESERVED: recipe is
 * a Content entity (fires); category and photo are not (silent).
 */
export interface RecipeSelf {
  readonly recipe: RecipeEntitySlice<RecipeStore, RecipeDiskCache>;
  readonly category: RecipeEntitySlice<CategoryStore, DiskCache<Category>>;
  readonly photo: RecipeEntitySlice<PhotoStore, DiskCache<Photo>>;

  /** Persist a saved recipe locally, then nudge cloud sync. Content → fires resourceListChanged. */
  commitRecipe(saved: Recipe): Promise<void>;
  /** Hard-delete (empty-trash) commit: purge the recipe from cache + store. */
  commitRecipeHardDelete(saved: Recipe): Promise<void>;
  /** Canonical pull: align the local copy of a `getRecipe` result (no pending mark, no notifySync). */
  reconcileLocalRecipe(authoritative: Recipe): Promise<boolean>;
  /** Canonical pull for a 404: drop a stale local phantom. */
  reconcileLocalRecipeAbsent(uid: RecipeUid): Promise<boolean>;
  /** Persist a category create/rename/re-parent locally. Reference → no resourceListChanged. */
  commitCategoryUpsert(category: Category): Promise<void>;
  /** Persist a category soft-delete locally. */
  commitCategoryDelete(category: Category): Promise<void>;
  /** Build the Photo + photo-bearing recipe, run the 3-request upload, commit both locally. */
  attachPhotoToRecipe(recipe: Readonly<Recipe>, thumbnail: Buffer, full: Buffer): Promise<Photo>;
  /** Persist a photo soft-delete locally. */
  commitPhotoDelete(savedPhoto: Photo): Promise<void>;
}

register(
  defineModule("recipe", [])
    .self<RecipeSelf>(async (infra) => {
      const client: PaprikaClient = infra.client;
      const notifier: Notifier = infra.notifier;
      const log: Logger = infra.log;

      // Three stores + three caches. Recipes use the bespoke RecipeDiskCache
      // (carries the uid→hash diff index); categories + photos use plain DiskCache.
      // Reuse-in-place: point each at the SAME flat path the legacy DiskCacheRoot
      // uses (`<cacheDir>/recipes` | `/categories` | `/photos`). The <domain>/<entity>
      // disk reshape + move-migration is deferred to the flip (ADR-0009).
      const recipeStore = new RecipeStore();
      const recipeCache = new RecipeDiskCache({ subdir: join(infra.cacheDir, "recipes"), log });
      await recipeCache.init();

      const categoryStore = new CategoryStore();
      const categoryCache = new DiskCacheImpl<Category>({
        ...categoryDiskDescriptor,
        subdir: join(infra.cacheDir, categoryDiskDescriptor.subdir),
        log,
      });
      await categoryCache.init();

      const photoStore = new PhotoStore();
      const photoCache = new DiskCacheImpl<Photo>({
        ...photoDiskDescriptor,
        subdir: join(infra.cacheDir, photoDiskDescriptor.subdir),
        log,
      });
      await photoCache.init();

      // ---- Recipe write chokepoints (lifted verbatim from src/tools/helpers.ts) ----

      // Order: markPending* (FIRST, before any cache I/O) → cache put/remove → flush
      // → store set/delete → resourceListChanged → notifySync. The pending mark
      // shields this UID from sync-cycle reconciliation during the propagation race.
      // `inTrash: true` is the recipe-side soft-delete → pending-delete; else upsert.
      const commitRecipe: RecipeSelf["commitRecipe"] = async (saved) => {
        if (saved.inTrash) {
          recipeStore.markPendingDelete(saved.uid);
        } else {
          recipeStore.markPendingUpsert(saved.uid);
        }
        try {
          await recipeCache.put(saved);
          await recipeCache.flush();
        } catch (e) {
          recipeStore.clearPending(saved.uid);
          throw e;
        }
        recipeStore.set(saved);
        notifier.resourceListChanged();
        // FLIP: re-index via the discover write-hook — `maintainRecipeIndex` wrote
        // the discover-owned vectorStore, which the inert recipe module does not carry.
        await client.notifySync();
      };

      const commitRecipeHardDelete: RecipeSelf["commitRecipeHardDelete"] = async (saved) => {
        recipeStore.markPendingDelete(saved.uid);
        try {
          await recipeCache.remove(saved.uid);
          await recipeCache.flush();
        } catch (e) {
          recipeStore.clearPending(saved.uid);
          throw e;
        }
        recipeStore.delete(saved.uid);
        notifier.resourceListChanged();
        // FLIP: purge from the discover index via the discover write-hook.
        await client.notifySync();
      };

      // Canonical PULL — align local state to a getRecipe result WITHOUT a Paprika
      // write: no pending-write mark, no notifySync (nothing changed server-side).
      // Best-effort: a cache failure is logged and the decision still stands.
      const reconcileLocalRecipe: RecipeSelf["reconcileLocalRecipe"] = async (authoritative) => {
        const local = recipeStore.get(authoritative.uid);
        if (local !== undefined && local.hash === authoritative.hash && local.inTrash === authoritative.inTrash) {
          return false;
        }
        try {
          await recipeCache.put(authoritative);
          await recipeCache.flush();
        } catch (err) {
          log.warn({ err, uid: authoritative.uid }, "local recipe reconcile failed; sync will heal it next cycle");
          return false;
        }
        recipeStore.set(authoritative);
        notifier.resourceListChanged();
        // FLIP: re-index via the discover write-hook.
        return true;
      };

      const reconcileLocalRecipeAbsent: RecipeSelf["reconcileLocalRecipeAbsent"] = async (uid) => {
        if (recipeStore.get(uid) === undefined) {
          return false;
        }
        try {
          await recipeCache.remove(uid);
          await recipeCache.flush();
        } catch (err) {
          log.warn({ err, uid }, "local recipe reconcile (removal) failed; sync will heal it next cycle");
          return false;
        }
        recipeStore.delete(uid);
        notifier.resourceListChanged();
        // FLIP: purge from the discover index via the discover write-hook.
        return true;
      };

      // ---- Category write chokepoints (lifted verbatim from src/tools/category-helpers.ts) ----
      // Mark-pending-first mirrors commitRecipe. No resourceListChanged() — categories
      // have no MCP resource surface; recipe rendering resolves names through the store
      // on read. The category re-embed (maintainCategoryRecipeIndex) is DROPPED here.
      const commitCategoryUpsert: RecipeSelf["commitCategoryUpsert"] = async (category) => {
        categoryStore.markPendingUpsert(category.uid);
        try {
          await categoryCache.put(category);
          await categoryCache.flush();
        } catch (e) {
          categoryStore.clearPending(category.uid);
          throw e;
        }
        categoryStore.set(category);
        // FLIP: re-embed the category's recipes via the discover write-hook (a rename
        // changes the display name baked into their embedding text).
        await client.notifySync();
      };

      const commitCategoryDelete: RecipeSelf["commitCategoryDelete"] = async (category) => {
        categoryStore.markPendingDelete(category.uid);
        try {
          await categoryCache.remove(category.uid);
          await categoryCache.flush();
        } catch (e) {
          categoryStore.clearPending(category.uid);
          throw e;
        }
        categoryStore.delete(category.uid);
        await client.notifySync();
      };

      // ---- Photo write chokepoints (lifted verbatim from src/tools/photo-helpers.ts) ----
      // attachPhotoToRecipe builds the Photo + photo-bearing recipe, runs the client's
      // verified 3-request upload, then commits BOTH the recipe and photo stores. No
      // resourceListChanged() — the recipe resource renders photoUrl, not photo/photoLarge.
      const commitPhotoUpload = async (savedRecipe: Recipe, savedPhoto: Photo): Promise<void> => {
        recipeStore.markPendingUpsert(savedRecipe.uid);
        photoStore.markPendingUpsert(savedPhoto.uid);
        try {
          await recipeCache.put(savedRecipe);
          await photoCache.put(savedPhoto);
          await recipeCache.flush();
          await photoCache.flush();
        } catch (e) {
          recipeStore.clearPending(savedRecipe.uid);
          photoStore.clearPending(savedPhoto.uid);
          throw e;
        }
        recipeStore.set(savedRecipe);
        photoStore.set(savedPhoto);
        await client.notifySync();
      };

      const attachPhotoToRecipe: RecipeSelf["attachPhotoToRecipe"] = async (recipe, thumbnail, full) => {
        const existing = photoStore.getByRecipeUid(recipe.uid);
        const orderFlag = existing.length > 0 ? Math.max(...existing.map((p) => p.orderFlag)) + 1 : 0;
        const photoUid = PhotoUidSchema.parse(randomUUID().toUpperCase());
        const thumbnailUid = randomUUID().toUpperCase();

        const photo: Photo = {
          uid: photoUid,
          recipeUid: recipe.uid,
          filename: `${photoUid}.jpg`,
          name: String(orderFlag + 1),
          orderFlag,
          hash: sha256Hex(full),
          deleted: false,
        };
        const recipeWithPhoto: Recipe = {
          ...recipe,
          photo: `${thumbnailUid}.jpg`,
          photoLarge: `${photoUid}.jpg`,
          photoHash: sha256Hex(thumbnail),
        };

        // uploadPhoto stamps the recipe's content hash and returns the hashed recipe —
        // commit that so the cache matches what was POSTed and sync won't re-fetch it.
        const savedRecipe = await client.uploadPhoto(recipeWithPhoto, photo, thumbnail, full);
        await commitPhotoUpload(savedRecipe, photo);
        return photo;
      };

      const commitPhotoDelete: RecipeSelf["commitPhotoDelete"] = async (savedPhoto) => {
        photoStore.markPendingDelete(savedPhoto.uid);
        try {
          await photoCache.remove(savedPhoto.uid);
          await photoCache.flush();
        } catch (e) {
          photoStore.clearPending(savedPhoto.uid);
          throw e;
        }
        photoStore.delete(savedPhoto.uid);
        await client.notifySync();
      };

      return {
        recipe: { store: recipeStore, cache: recipeCache },
        category: { store: categoryStore, cache: categoryCache },
        photo: { store: photoStore, cache: photoCache },
        commitRecipe,
        commitRecipeHardDelete,
        reconcileLocalRecipe,
        reconcileLocalRecipeAbsent,
        commitCategoryUpsert,
        commitCategoryDelete,
        attachPhotoToRecipe,
        commitPhotoDelete,
      };
    })
    .build((self) => ({
      api: {
        get: (uid) => self.recipe.store.get(uid),
        resolveCategoryRefs: (refs) => resolveCategoryRefs(self.category.store.getAll(), [...refs]),
        resolveCategoryNames: (uids) => self.category.store.resolveNames([...uids]),
        recipesInCategory: (categoryUid) =>
          self.recipe.store
            .getAll()
            .filter((r) => r.categories.includes(categoryUid))
            .map((r) => r.uid),
      },
      tools: [
        listRecipesTool,
        readRecipeTool,
        searchRecipesTool,
        createRecipeTool,
        updateRecipeTool,
        categorizeRecipeTool,
        ...favoriteRecipeTools,
        rateRecipeTool,
        trashRecipeTool,
        restoreRecipeTool,
        purgeRecipeTool,
        listCategoriesTool,
        ...categoryWriteTools,
        deleteCategoryTool,
        ...photoWriteTools,
      ],
      resources: [recipeResource],
      syncs: [recipesSync(self), categoriesSync(self), photosSync(self)],
      flush: async () => {
        await self.recipe.cache.flush();
        await self.category.cache.flush();
        await self.photo.cache.flush();
      },
    })),
);
