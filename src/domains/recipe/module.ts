import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { err, ok, ResultAsync } from "neverthrow";
import type { Logger } from "pino";

import type { CacheError, DiskCache } from "../../cache/disk-cache.js";
import type { PaprikaClient } from "../../paprika/client.js";
import type { PaprikaClientError } from "../../paprika/errors.js";
import type { Notifier } from "../../server/notifier.js";
import type { RecipeApi } from "./api.js";
import type { Category } from "./category/types.js";
import type { RecipeUid } from "./ids.js";
import type { Photo } from "./photo/types.js";
import type { Recipe } from "./types.js";

import { DiskCache as DiskCacheImpl } from "../../cache/disk-cache.js";
import { hydrateStore } from "../../cache/hydrate.js";
import { commitEntities, commitSlices, deleteOp, sliceOps, upsertOp } from "../../entity/commit.js";
import { defineModule, register } from "../../kernel/registry.js";
import { notifySyncBestEffort } from "../../paprika/client.js";
import { resolvePendingWriteTtl } from "../../utils/config.js";
import { unwrapAtBoot } from "../../utils/errors.js";
import { toMessage } from "../../utils/log.js";
import { CategoryStore } from "./category/store.js";
import { categoryDiskDescriptor } from "./category/types.js";
import { RecipeDiskCache } from "./disk.js";
import { PhotoUidSchema } from "./ids.js";
import { GENERATED_MAX_FULL_EDGE, normalizePhoto, sha256Hex } from "./photo-helpers.js";
import { PhotoStore } from "./photo/store.js";
import { photoDiskDescriptor } from "./photo/types.js";
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
import { pinRecipeTools } from "./tools/pin.js";
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
interface RecipeEntitySlice<Store, Cache> {
  readonly store: Store;
  readonly cache: Cache;
}

/**
 * The recipe module's state — the largest, with THREE store/cache pairs (recipes +
 * categories + photos): recipe owns category and photo directly, with NO separate
 * module and NO dependency on either.
 */
export interface RecipeState {
  readonly recipe: RecipeEntitySlice<RecipeStore, RecipeDiskCache>;
  readonly category: RecipeEntitySlice<CategoryStore, DiskCache<Category>>;
  readonly photo: RecipeEntitySlice<PhotoStore, DiskCache<Photo>>;
}

/**
 * Recipe's write chokepoints (`ctx.writes`), invoked by its own recipe / category /
 * photo tools. Recipe is a Content entity, so its recipe writes fire
 * `resourceListChanged()`; category and photo writes are silent. Vector-index
 * maintenance (#177) writes the discover-owned index, which recipe cannot reach (no
 * dependency edge into discover by design) — so each recipe/category write EMITS on
 * `infra.indexEvents`, the kernel re-index seam discover's `index` boot hook subscribes
 * to, rather than reaching across the boundary. (`attachGeneratedPhoto`, the
 * photo-gen-facing write, is a CONTRACT method and lives on `api`, not here.)
 */
export interface RecipeWrites {
  /** Persist a saved recipe locally, then nudge cloud sync. Content → fires resourceListChanged. */
  commitRecipe(saved: Recipe): ResultAsync<void, CacheError>;
  /** Hard-delete (empty-trash) commit: purge the recipe from cache + store. */
  commitRecipeHardDelete(saved: Recipe): ResultAsync<void, CacheError>;
  /** Canonical pull: align the local copy of a `getRecipe` result (no pending mark, no notifySync). Best-effort — absorbs its own failures. */
  reconcileLocalRecipe(authoritative: Recipe): Promise<boolean>;
  /** Canonical pull for a 404: drop a stale local phantom. Best-effort — absorbs its own failures. */
  reconcileLocalRecipeAbsent(uid: RecipeUid): Promise<boolean>;
  /** Persist a category create/rename/re-parent locally. Reference → no resourceListChanged. */
  commitCategoryUpsert(category: Category): ResultAsync<void, CacheError>;
  /** Persist a category soft-delete locally. */
  commitCategoryDelete(category: Category): ResultAsync<void, CacheError>;
  /** Build the Photo + photo-bearing recipe, run the 3-request upload, commit both locally.
   * Errs with the client's error on an upload failure, the cache's on a local-commit one. */
  attachPhotoToRecipe(
    recipe: Readonly<Recipe>,
    thumbnail: Buffer,
    full: Buffer,
  ): ResultAsync<Photo, CacheError | PaprikaClientError>;
  /** Persist a photo soft-delete locally. */
  commitPhotoDelete(savedPhoto: Photo): ResultAsync<void, CacheError>;
}

register(
  defineModule("recipe", [])
    .state<RecipeState>(async (infra) => {
      const log: Logger = infra.log;
      const pendingWriteTtlMs = resolvePendingWriteTtl(infra.config);

      // Three stores + three caches. Recipes use the bespoke RecipeDiskCache
      // (carries the uid→hash diff index); categories + photos use plain DiskCache.
      // Disk is flat: each cache's subdir is `<cacheDir>/recipes` | `/categories` |
      // `/photos` (the cache is un-namespaced, so there is no migration).
      //
      // Each store is hydrated from its cache so tools work on a warm restart before
      // the first sync completes. Recipe is the load-bearing one: it syncs by DIFF, so
      // an unchanged warm cache fetches nothing — without hydrating here the recipe
      // store would stay empty until a recipe changed remotely. Recipe hydrates via
      // per-item `set` + the separate `markSynced()` (gating recipe tools); categories
      // and photos use the shared `hydrateStore`.
      const recipeStore = new RecipeStore({ pendingWriteTtlMs });
      const recipeCache = new RecipeDiskCache({ subdir: join(infra.cacheDir, "recipes"), log });
      unwrapAtBoot(await recipeCache.init(), "recipe cache init");
      const cachedRecipes = unwrapAtBoot(await recipeCache.getAll(), "recipe cache hydrate");
      for (const recipe of cachedRecipes) recipeStore.set(recipe);
      if (cachedRecipes.length > 0) recipeStore.markSynced();

      const categoryStore = new CategoryStore({ pendingWriteTtlMs });
      const categoryCache = new DiskCacheImpl<Category>({
        ...categoryDiskDescriptor,
        subdir: join(infra.cacheDir, categoryDiskDescriptor.subdir),
        log,
      });
      unwrapAtBoot(await categoryCache.init(), "category cache init");
      unwrapAtBoot(await hydrateStore(categoryCache, categoryStore), "category cache hydrate");

      const photoStore = new PhotoStore({ pendingWriteTtlMs });
      const photoCache = new DiskCacheImpl<Photo>({
        ...photoDiskDescriptor,
        subdir: join(infra.cacheDir, photoDiskDescriptor.subdir),
        log,
      });
      unwrapAtBoot(await photoCache.init(), "photo cache init");
      unwrapAtBoot(await hydrateStore(photoCache, photoStore), "photo cache hydrate");

      return {
        recipe: { store: recipeStore, cache: recipeCache },
        category: { store: categoryStore, cache: categoryCache },
        photo: { store: photoStore, cache: photoCache },
      };
    })
    .build((state, infra) => {
      const client: PaprikaClient = infra.client;
      const notifier: Notifier = infra.notifier;
      const log: Logger = infra.log;

      // ---- Recipe write chokepoints ----

      // The commit protocol (mark-first → cache → flush → clear-on-failure → store
      // → effects → notify) lives in src/entity/commit.ts; these bind recipe's three
      // slices and per-chokepoint effects.
      const finish = () => notifySyncBestEffort(client, log);

      // `inTrash: true` is the recipe-side soft-delete: the row survives (put + set),
      // but its sync-facing intent is a delete — `markDelete` shields the UID as one.
      const commitRecipe: RecipeWrites["commitRecipe"] = (saved) =>
        commitEntities(state.recipe, [upsertOp(saved, { markDelete: saved.inTrash })], {
          onCommitted: () => {
            notifier.resourceListChanged();
            // Re-index at commit time, before notifySync: a tool-written recipe's UID is
            // pending, so the sync recipe-diff filters it out and never re-embeds it (#177).
            // A trashed recipe is REMOVED from the index, else re-embedded (mirrors the
            // markDelete flag above). discover's index hook subscribes to this channel;
            // the emit never throws.
            if (saved.inTrash) {
              infra.indexEvents.emit({ type: "recipe-removed", uids: [saved.uid] });
            } else {
              infra.indexEvents.emit({ type: "recipe-changed", recipes: [saved] });
            }
          },
          finish,
        });

      const commitRecipeHardDelete: RecipeWrites["commitRecipeHardDelete"] = (saved) =>
        commitEntities(state.recipe, [deleteOp(saved.uid)], {
          onCommitted: () => {
            notifier.resourceListChanged();
            infra.indexEvents.emit({ type: "recipe-removed", uids: [saved.uid] });
          },
          finish,
        });

      // Canonical PULL — align local state to a getRecipe result WITHOUT a Paprika
      // write: no pending-write mark, no notifySync (nothing changed server-side).
      // Best-effort: a cache failure is logged and the decision still stands.
      const reconcileLocalRecipe: RecipeWrites["reconcileLocalRecipe"] = async (authoritative) => {
        const local = state.recipe.store.get(authoritative.uid);
        if (local !== undefined && local.hash === authoritative.hash && local.inTrash === authoritative.inTrash) {
          return false;
        }
        return state.recipe.cache
          .put(authoritative)
          .andThen(() => state.recipe.cache.flush())
          .match(
            () => {
              state.recipe.store.set(authoritative);
              notifier.resourceListChanged();
              // Same inTrash branch as commitRecipe: a canonical pull that lands a trashed
              // recipe must REMOVE it from the index, not re-embed it.
              if (authoritative.inTrash) {
                infra.indexEvents.emit({ type: "recipe-removed", uids: [authoritative.uid] });
              } else {
                infra.indexEvents.emit({ type: "recipe-changed", recipes: [authoritative] });
              }
              return true;
            },
            (e) => {
              log.warn(
                { err: e, uid: authoritative.uid },
                "local recipe reconcile failed; sync will heal it next cycle",
              );
              return false;
            },
          );
      };

      const reconcileLocalRecipeAbsent: RecipeWrites["reconcileLocalRecipeAbsent"] = async (uid) => {
        if (state.recipe.store.get(uid) === undefined) {
          return false;
        }
        return state.recipe.cache
          .remove(uid)
          .andThen(() => state.recipe.cache.flush())
          .match(
            () => {
              state.recipe.store.delete(uid);
              notifier.resourceListChanged();
              infra.indexEvents.emit({ type: "recipe-removed", uids: [uid] });
              return true;
            },
            (e) => {
              log.warn({ err: e, uid }, "local recipe reconcile (removal) failed; sync will heal it next cycle");
              return false;
            },
          );
      };

      // ---- Category write chokepoints ----
      // Mark-pending-first mirrors commitRecipe. No resourceListChanged() — categories
      // have no MCP resource surface; recipe rendering resolves names through the store
      // on read.
      const commitCategoryUpsert: RecipeWrites["commitCategoryUpsert"] = (category) =>
        commitEntities(state.category, [upsertOp(category)], {
          // A category rename changes the display name baked into its recipes' embedding
          // text, yet no recipe hash, so the recipe diff never re-fetches them. discover's
          // index hook re-embeds the category's recipes on this signal (best-effort).
          onCommitted: () => infra.indexEvents.emit({ type: "category-changed", uids: [category.uid] }),
          finish,
        });

      const commitCategoryDelete: RecipeWrites["commitCategoryDelete"] = (category) =>
        commitEntities(state.category, [deleteOp(category.uid)], { finish });

      // ---- Photo write chokepoints ----
      // attachPhotoToRecipe builds the Photo + photo-bearing recipe, runs the client's
      // verified 3-request upload, then commits BOTH the recipe and photo stores. No
      // resourceListChanged() — the recipe resource renders photoUrl, not photo/photoLarge.
      // The one multi-slice commit: recipe + photo land jointly (shared marks, joint
      // clear-on-failure, one notifySync) via the helper's `commitSlices` core.
      const commitPhotoUpload = (savedRecipe: Recipe, savedPhoto: Photo): ResultAsync<void, CacheError> =>
        commitSlices([sliceOps(state.recipe, [upsertOp(savedRecipe)]), sliceOps(state.photo, [upsertOp(savedPhoto)])], {
          finish,
        });

      const attachPhotoToRecipe: RecipeWrites["attachPhotoToRecipe"] = (recipe, thumbnail, full) => {
        const existing = state.photo.store.getByRecipeUid(recipe.uid);
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
        return client
          .uploadPhoto(recipeWithPhoto, photo, thumbnail, full)
          .andThen((savedRecipe) => commitPhotoUpload(savedRecipe, photo).map(() => photo));
      };

      // The recipe-domain write photo-gen's generate_recipe_photo(attach:true) calls
      // through `ctx.deps.recipe` — recipe owns the photo entity, so the normalize +
      // hasSynced guard + the verified upload all live here (the same chokepoint
      // upload_recipe_photo's generated path uses). Returns a Result so the caller in
      // the photo-gen module can render success/failure without a thrown boundary.
      const attachGeneratedPhoto: RecipeApi["attachGeneratedPhoto"] = async (recipeUid, full) => {
        const recipe = state.recipe.store.get(recipeUid);
        if (recipe === undefined)
          return err({
            message: `No recipe found with UID "${recipeUid}" (it may not exist or was already deleted). Use \`search_recipes\` to find it.`,
          });
        // Gate on the photo catalog being synced — order_flag/name derive from the existing
        // gallery, so attaching before photos sync could assign a colliding index.
        if (!state.photo.store.hasSynced) {
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
        return attachPhotoToRecipe(recipe, normalized.thumbnail, normalized.full).match(
          (photo) => ok(photo),
          (e) => err({ message: `Failed to attach the generated photo: ${e.message}` }),
        );
      };

      const commitPhotoDelete: RecipeWrites["commitPhotoDelete"] = (savedPhoto) =>
        commitEntities(state.photo, [deleteOp(savedPhoto.uid)], { finish });

      return {
        api: {
          get: (uid) => state.recipe.store.get(uid),
          findByName: (title) => state.recipe.store.findByName(title),
          resolveCategoryRefs: (refs) => resolveCategoryRefs(state.category.store.getAll(), [...refs]),
          resolveCategoryNames: (uids) => state.category.store.resolveNames([...uids]),
          recipesInCategory: (categoryUid) =>
            state.recipe.store
              .getAll()
              .filter((r) => r.categories.includes(categoryUid))
              .map((r) => r.uid),
          hasSynced: () => state.recipe.store.hasSynced,
          getAll: () => state.recipe.store.getAll(),
          size: () => state.recipe.store.size,
          attachGeneratedPhoto,
        },
        writes: {
          commitRecipe,
          commitRecipeHardDelete,
          reconcileLocalRecipe,
          reconcileLocalRecipeAbsent,
          commitCategoryUpsert,
          commitCategoryDelete,
          attachPhotoToRecipe,
          commitPhotoDelete,
        },
        tools: [
          listRecipesTool,
          readRecipeTool,
          searchRecipesTool,
          createRecipeTool,
          updateRecipeTool,
          categorizeRecipeTool,
          ...favoriteRecipeTools,
          ...pinRecipeTools,
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
        syncs: [recipesSync(state), categoriesSync(state), photosSync(state)],
        flush: () =>
          ResultAsync.combine([
            state.recipe.cache.flush(),
            state.category.cache.flush(),
            state.photo.cache.flush(),
          ]).map(() => undefined),
      };
    }),
);
