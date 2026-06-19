import type { CacheError } from "../cache/disk-cache.js";
import type { GroceryItem } from "../domains/grocery/grocery-item/types.js";
import type { GroceryList } from "../domains/grocery/grocery-list/types.js";
import type { MenuItem } from "../domains/menu/menu-item/types.js";
import type { Menu } from "../domains/menu/types.js";
import type { PantryItem } from "../domains/pantry/types.js";
import type { RecipeUid } from "../domains/recipe/ids.js";
import type { Recipe } from "../domains/recipe/types.js";
import type { PaprikaClientError } from "./errors.js";

/**
 * What a reconcile can fail with: the client's typed error on a fetch, or the
 * disk cache's on a put/remove. The driver only logs these (a `reference` /
 * `additive` err is a warning; a `core` err aborts the cycle),
 * so the union stays exactly the two producers' types, unnormalized.
 */
export type SyncError = CacheError | PaprikaClientError;

export type EntityChanges<T> = {
  readonly added: ReadonlyArray<T>;
  readonly updated: ReadonlyArray<T>;
  readonly removedUids: ReadonlyArray<string>;
};

// Closed set of entity types sync can produce. Adding a new entity type here
// requires extending this union deliberately.
export type SyncEntityType = "recipes" | "pantry" | "grocery-lists" | "grocery-items" | "menus" | "menu-items";

// K is locked to SyncEntityType; T is the entity item type.
export type SyncResult<K extends SyncEntityType, T extends object> = {
  readonly changeType: K;
  readonly changes: EntityChanges<T>;
};

export type RecipeSyncResult = SyncResult<"recipes", Recipe>;
export type PantrySyncResult = SyncResult<"pantry", PantryItem>;
export type GroceryListSyncResult = SyncResult<"grocery-lists", GroceryList>;
export type GroceryItemSyncResult = SyncResult<"grocery-items", GroceryItem>;
export type MenuSyncResult = SyncResult<"menus", Menu>;
export type MenuItemSyncResult = SyncResult<"menu-items", MenuItem>;

// Union used as the sync:complete event payload.
export type AnySyncResult =
  | RecipeSyncResult
  | PantrySyncResult
  | GroceryListSyncResult
  | GroceryItemSyncResult
  | MenuSyncResult
  | MenuItemSyncResult;

// Recipe diff classification — recipes are the only diff-and-fetch entity, so
// the UIDs are `RecipeUid`. Produced by `RecipeDiskCache.diff()`.
export type DiffResult = {
  readonly added: ReadonlyArray<RecipeUid>;
  readonly changed: ReadonlyArray<RecipeUid>;
  readonly removed: ReadonlyArray<RecipeUid>;
};
