import { join } from "node:path";

import type { Logger } from "pino";

import type { Aisle } from "../aisle/types.js";
import type { OAuthToken } from "../auth/types.js";
import type { Category } from "../category/types.js";
import type { GroceryIngredient } from "../grocery-ingredient/types.js";
import type { GroceryItem } from "../grocery-item/types.js";
import type { GroceryList } from "../grocery-list/types.js";
import type { MealType } from "../meal-type/types.js";
import type { Meal } from "../meal/types.js";
import type { MenuItem } from "../menu-item/types.js";
import type { Menu } from "../menu/types.js";
import type { PantryItem } from "../pantry/types.js";
import type { Photo } from "../photo/types.js";
import type { DiskCacheDescriptor } from "./disk-cache.js";

import { aisleDiskDescriptor } from "../aisle/disk.js";
import { categoryDiskDescriptor } from "../category/disk.js";
import { groceryIngredientDiskDescriptor } from "../grocery-ingredient/disk.js";
import { groceryItemDiskDescriptor } from "../grocery-item/disk.js";
import { groceryListDiskDescriptor } from "../grocery-list/disk.js";
import { mealTypeDiskDescriptor } from "../meal-type/disk.js";
import { mealDiskDescriptor } from "../meal/disk.js";
import { menuItemDiskDescriptor } from "../menu-item/disk.js";
import { menuDiskDescriptor } from "../menu/disk.js";
import { pantryDiskDescriptor } from "../pantry/disk.js";
import { photoDiskDescriptor } from "../photo/disk.js";
import { RecipeDiskCache } from "../recipe/disk.js";
import { oauthTokensDiskDescriptor } from "./auth-cache.js";
import { DiskCache } from "./disk-cache.js";
import { OAuthClientDiskCache } from "./oauth-client-disk-cache.js";

interface InitFlushable {
  init(): Promise<void>;
  flush(): Promise<void>;
}

/**
 * Composition root for the persistence layer. Owns one `DiskCache`-derived
 * instance per entity and coordinates startup (`init`) and shutdown-ish (`flush`)
 * across all of them.
 *
 * Each subcache holds its own per-entity mutex; the root holds nothing.
 * There is no cross-entity atomic snapshot — each entity's `flush()` is
 * individually atomic (files fsynced; recipes index temp-then-rename'd
 * inside its own mutex), which is what `paprika/sync.ts` needs.
 *
 * The legacy unified-index migration is NOT here: it lives on `RecipeDiskCache.init()`
 * (it concerns only the recipes namespace), so it runs wherever a recipe cache is
 * built — under the kernel's per-module caches and under this root alike — rather
 * than being coupled to constructing the whole root.
 */
export class DiskCacheRoot {
  readonly recipes: RecipeDiskCache;
  readonly categories: DiskCache<Category>;
  readonly pantry: DiskCache<PantryItem>;
  readonly aisles: DiskCache<Aisle>;
  readonly oauthClients: OAuthClientDiskCache;
  readonly oauthTokens: DiskCache<OAuthToken>;
  readonly groceryLists: DiskCache<GroceryList>;
  readonly groceryItems: DiskCache<GroceryItem>;
  readonly groceryIngredients: DiskCache<GroceryIngredient>;
  readonly meals: DiskCache<Meal>;
  readonly mealTypes: DiskCache<MealType>;
  readonly menus: DiskCache<Menu>;
  readonly menuItems: DiskCache<MenuItem>;
  readonly photos: DiskCache<Photo>;

  private readonly _subcaches: ReadonlyArray<InitFlushable>;

  constructor(cacheDir: string, log?: Logger) {
    const logOpts = log !== undefined ? { log } : {};
    const make = <T>(descriptor: DiskCacheDescriptor<T>): DiskCache<T> =>
      new DiskCache<T>({
        subdir: join(cacheDir, descriptor.subdir),
        parse: descriptor.parse,
        getKey: descriptor.getKey,
        ...logOpts,
      });

    // recipes and oauthClients carry behavior beyond a descriptor (a hash
    // index for diffing; an atomic client-cap), so they subclass DiskCache
    // and are constructed directly; every other subcache is `make(descriptor)`.
    this.recipes = new RecipeDiskCache({ subdir: join(cacheDir, "recipes"), ...logOpts });
    this.categories = make(categoryDiskDescriptor);
    this.pantry = make(pantryDiskDescriptor);
    this.aisles = make(aisleDiskDescriptor);
    this.oauthClients = new OAuthClientDiskCache({ subdir: join(cacheDir, "oauthClients"), ...logOpts });
    this.oauthTokens = make(oauthTokensDiskDescriptor);
    this.groceryLists = make(groceryListDiskDescriptor);
    this.groceryItems = make(groceryItemDiskDescriptor);
    this.groceryIngredients = make(groceryIngredientDiskDescriptor);
    this.meals = make(mealDiskDescriptor);
    this.mealTypes = make(mealTypeDiskDescriptor);
    this.menus = make(menuDiskDescriptor);
    this.menuItems = make(menuItemDiskDescriptor);
    this.photos = make(photoDiskDescriptor);

    this._subcaches = [
      this.recipes,
      this.categories,
      this.pantry,
      this.aisles,
      this.oauthClients,
      this.oauthTokens,
      this.groceryLists,
      this.groceryItems,
      this.groceryIngredients,
      this.meals,
      this.mealTypes,
      this.menus,
      this.menuItems,
      this.photos,
    ];
  }

  async init(): Promise<void> {
    // The recipes subcache runs the legacy-index migration as part of its own init().
    await Promise.all(this._subcaches.map((s) => s.init()));
  }

  async flush(): Promise<void> {
    await Promise.all(this._subcaches.map((s) => s.flush()));
  }
}
