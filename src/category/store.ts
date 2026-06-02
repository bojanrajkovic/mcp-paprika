import { TombstoneEntityStore } from "../entity/index.js";
import type { Category } from "./types.js";
import type { CategoryUid } from "../ids.js";

/**
 * In-memory query layer for recipe categories, hydrated by the sync engine.
 * Extends `TombstoneEntityStore<Category, CategoryUid>` (see
 * `../entity/CLAUDE.md`) — unlike the read-only `AisleStore`/`MealTypeStore`
 * reference catalogs, categories gain create/update/delete write tools, so the
 * delete path needs pending-delete + tombstone protection against a concurrent
 * sync resurrecting a just-deleted category.
 *
 * This store is the single source of truth for category data. `RecipeStore`
 * holds only the recipe→category UID foreign keys; name resolution for
 * rendering goes through `resolveNames()` here.
 */
export class CategoryStore extends TombstoneEntityStore<Category, CategoryUid> {
  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    super(opts ?? {});
  }

  /** Case-insensitive exact lookup by display name. */
  resolveByName(name: string): Category | undefined {
    const needle = name.toLowerCase();
    for (const category of this._items.values()) {
      if (category.name.toLowerCase() === needle) return category;
    }
    return undefined;
  }

  /**
   * Resolves recipe category foreign keys to display names, skipping any UID
   * with no matching category (mirrors the prior `RecipeStore.resolveCategories`
   * contract). Used by recipe-rendering call sites and embedding text.
   */
  resolveNames(categoryUids: ReadonlyArray<CategoryUid>): Array<string> {
    const names: Array<string> = [];
    for (const uid of categoryUids) {
      const category = this._items.get(uid);
      if (category) names.push(category.name);
    }
    return names;
  }

  /** Direct (non-tombstoned) children of the given category. */
  getChildren(parentUid: CategoryUid): Array<Category> {
    const children: Array<Category> = [];
    for (const category of this._items.values()) {
      if (category.parentUid === parentUid) children.push(category);
    }
    return children;
  }
}
