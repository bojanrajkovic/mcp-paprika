import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";

import type { DiskCache } from "../../cache/disk-cache.js";
import type { RecipeUid } from "../../ids.js";
import type { PaprikaClient } from "../../paprika/client.js";
import type { Notifier } from "../../server/notifier.js";
import type { RecipeApi } from "./api.js";
import type { Category } from "./category/types.js";
import type { Photo } from "./photo/types.js";
import type { Recipe } from "./types.js";

import { DiskCache as DiskCacheImpl } from "../../cache/disk-cache.js";
import { PhotoUidSchema } from "../../ids.js";
import { defineModule, register } from "../../kernel/registry.js";
import { resolvePendingWriteTtl } from "../../utils/config.js";
import { toMessage } from "../../utils/log.js";
import { categoryDiskDescriptor } from "./category/disk.js";
import { CategoryStore } from "./category/store.js";
import { RecipeDiskCache } from "./disk.js";
import { GENERATED_MAX_FULL_EDGE, normalizePhoto, sha256Hex } from "./photo-helpers.js";
import { photoDiskDescriptor } from "./photo/disk.js";
import { PhotoStore } from "./photo/store.js";
import { resolveCategoryRefs } from "./recipe-markdown.js";
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

declare module "../../kernel/registry.js" {
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
 * Vector-index maintenance (the legacy `maintainRecipeIndex`/`reindexRecipesForCategoryChange`,
 * #177) writes the discover-owned `vectorStore`, which recipe cannot reach (no dependency
 * edge into discover by design). So each write chokepoint EMITS on `infra.indexEvents` —
 * the kernel-level re-index seam discover's `index` boot hook subscribes to — instead of
 * reaching across the boundary. The `resourceListChanged()` rule is PRESERVED: recipe is a
 * Content entity (fires); category and photo are not (silent).
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
  /** Recipe-domain write exposed on `RecipeApi` for photo-gen: normalize + attach AI bytes. */
  attachGeneratedPhoto(recipeUid: RecipeUid, full: Buffer): Promise<Result<Photo, { readonly message: string }>>;
  /** Persist a photo soft-delete locally. */
  commitPhotoDelete(savedPhoto: Photo): Promise<void>;
}

register(
  defineModule("recipe", [])
    .self<RecipeSelf>(async (infra) => {
      const client: PaprikaClient = infra.client;
      const notifier: Notifier = infra.notifier;
      const log: Logger = infra.log;
      const pendingWriteTtlMs = resolvePendingWriteTtl(infra.config);

      // Three stores + three caches. Recipes use the bespoke RecipeDiskCache
      // (carries the uid→hash diff index); categories + photos use plain DiskCache.
      // Reuse-in-place: point each at the SAME flat path the legacy DiskCacheRoot
      // uses (`<cacheDir>/recipes` | `/categories` | `/photos`). The <domain>/<entity>
      // disk reshape + move-migration is deferred to the flip (ADR-0009).
      //
      // Each store is hydrated from its cache (legacy hydrate) so tools work on a warm
      // restart before the first sync completes. Recipe is the load-bearing one: it
      // syncs by DIFF, so an unchanged warm cache fetches nothing — without hydrating
      // here the recipe store would stay empty until a recipe changed remotely. It
      // hydrates via per-item `set` + `markSynced` (gating recipe tools on); categories
      // and photos `load` (photos drop tombstones, like legacy's `!deleted` filter).
      const recipeStore = new RecipeStore({ pendingWriteTtlMs });
      const recipeCache = new RecipeDiskCache({ subdir: join(infra.cacheDir, "recipes"), log });
      await recipeCache.init();
      const cachedRecipes = await recipeCache.getAll();
      for (const recipe of cachedRecipes) recipeStore.set(recipe);
      if (cachedRecipes.length > 0) recipeStore.markSynced();

      const categoryStore = new CategoryStore({ pendingWriteTtlMs });
      const categoryCache = new DiskCacheImpl<Category>({
        ...categoryDiskDescriptor,
        subdir: join(infra.cacheDir, categoryDiskDescriptor.subdir),
        log,
      });
      await categoryCache.init();
      const cachedCategories = await categoryCache.getAll();
      if (cachedCategories.length > 0) categoryStore.load(cachedCategories);

      const photoStore = new PhotoStore({ pendingWriteTtlMs });
      const photoCache = new DiskCacheImpl<Photo>({
        ...photoDiskDescriptor,
        subdir: join(infra.cacheDir, photoDiskDescriptor.subdir),
        log,
      });
      await photoCache.init();
      const cachedPhotos = (await photoCache.getAll()).filter((p) => !p.deleted);
      if (cachedPhotos.length > 0) photoStore.load(cachedPhotos);

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
        // Re-index at commit time, before notifySync: a tool-written recipe's UID is
        // pending, so the sync recipe-diff filters it out and never re-embeds it (#177).
        // A trashed recipe is REMOVED from the index, else re-embedded — mirroring legacy
        // maintainRecipeIndex's `if (inTrash) removeRecipe; else indexRecipe` branch
        // (this commit's markPending block above branches on inTrash the same way).
        // discover's index hook subscribes to this channel; the emit never throws.
        if (saved.inTrash) {
          infra.indexEvents.emit({ type: "recipe-removed", uids: [saved.uid] });
        } else {
          infra.indexEvents.emit({ type: "recipe-changed", recipes: [saved] });
        }
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
        infra.indexEvents.emit({ type: "recipe-removed", uids: [saved.uid] });
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
        // Same inTrash branch as commitRecipe: a canonical pull that lands a trashed
        // recipe must REMOVE it from the index, not re-embed it (legacy reconcileLocalRecipe
        // routed through maintainRecipeIndex, which branches on inTrash).
        if (authoritative.inTrash) {
          infra.indexEvents.emit({ type: "recipe-removed", uids: [authoritative.uid] });
        } else {
          infra.indexEvents.emit({ type: "recipe-changed", recipes: [authoritative] });
        }
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
        infra.indexEvents.emit({ type: "recipe-removed", uids: [uid] });
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
        // A category rename changes the display name baked into its recipes' embedding
        // text, yet no recipe hash, so the recipe diff never re-fetches them. discover's
        // index hook re-embeds the category's recipes on this signal (best-effort).
        infra.indexEvents.emit({ type: "category-changed", uids: [category.uid] });
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

      // The recipe-domain write photo-gen's generate_recipe_photo(attach:true) calls
      // through `ctx.deps.recipe` — recipe owns the photo entity, so the normalize +
      // hasSynced guard + the verified upload all live here (the same chokepoint
      // upload_recipe_photo's generated path uses). Returns a Result so the caller in
      // the photo-gen module can render success/failure without a thrown boundary.
      const attachGeneratedPhoto: RecipeSelf["attachGeneratedPhoto"] = async (recipeUid, full) => {
        const recipe = recipeStore.get(recipeUid);
        if (recipe === undefined) return err({ message: `No recipe found with UID "${recipeUid}".` });
        // Gate on the photo catalog being synced — order_flag/name derive from the existing
        // gallery, so attaching before photos sync could assign a colliding index.
        if (!photoStore.hasSynced) {
          return err({ message: "The photo catalog is still syncing; try again in a moment." });
        }
        let normalized: { readonly thumbnail: Buffer; readonly full: Buffer };
        try {
          // Cap the long edge like upload_recipe_photo's generated path, so generate-and-attach
          // and preview-then-save store the same size.
          normalized = await normalizePhoto(full, { maxFullEdge: GENERATED_MAX_FULL_EDGE });
        } catch (e) {
          return err({ message: `Failed to process the generated image: ${toMessage(e)}` });
        }
        try {
          return ok(await attachPhotoToRecipe(recipe, normalized.thumbnail, normalized.full));
        } catch (e) {
          return err({ message: `Failed to attach the generated photo: ${toMessage(e)}` });
        }
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
        attachGeneratedPhoto,
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
        hasSynced: () => self.recipe.store.hasSynced,
        getAll: () => self.recipe.store.getAll(),
        size: () => self.recipe.store.size,
        attachGeneratedPhoto: self.attachGeneratedPhoto,
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
