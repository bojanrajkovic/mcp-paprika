import type { GroceryIngredient } from "./types.js";

/**
 * In-memory store for grocery ingredients, keyed by lowercase name for
 * case-insensitive lookup. Unlike GroceryListStore and GroceryItemStore,
 * this is a plain class — not an EntityStore subclass — because ingredients
 * have no pending-writes, no tombstones, and no sweepPending. Internal
 * storage is a Map<string, GroceryIngredient> keyed by lowercase name.
 */
export class GroceryIngredientStore {
  private readonly _items = new Map<string, GroceryIngredient>();
  private _hasSynced = false;

  get hasSynced(): boolean {
    return this._hasSynced;
  }

  get size(): number {
    return this._items.size;
  }

  load(items: ReadonlyArray<GroceryIngredient>): void {
    this._items.clear();
    for (const item of items) {
      this._items.set(item.name.toLowerCase(), item);
    }
    this._hasSynced = true;
  }

  set(ingredient: GroceryIngredient): void {
    this._items.set(ingredient.name.toLowerCase(), ingredient);
  }

  lookupByName(name: string): GroceryIngredient | undefined {
    return this._items.get(name.toLowerCase());
  }

  getAll(): Array<GroceryIngredient> {
    return [...this._items.values()];
  }
}
