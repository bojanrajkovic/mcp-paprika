import type { PantryItem, PantryItemUid } from "../paprika/types.js";

export class PantryStore {
  private readonly _items: Map<PantryItemUid, PantryItem> = new Map();
  private _hasSynced = false;

  load(items: ReadonlyArray<PantryItem>): void {
    this._items.clear();
    for (const item of items) {
      this._items.set(item.uid, item);
    }
    this._hasSynced = true;
  }

  get(uid: PantryItemUid): PantryItem | undefined {
    return this._items.get(uid);
  }

  getAll(): Array<PantryItem> {
    return [...this._items.values()];
  }

  set(item: PantryItem): void {
    this._items.set(item.uid, item);
  }

  delete(uid: PantryItemUid): void {
    this._items.delete(uid);
  }

  get size(): number {
    return this._items.size;
  }

  get hasSynced(): boolean {
    return this._hasSynced;
  }

  findByIngredient(query: string): Array<PantryItem> {
    const needle = query.toLowerCase();

    const exact: Array<PantryItem> = [];
    const prefix: Array<PantryItem> = [];
    const substring: Array<PantryItem> = [];

    for (const item of this._items.values()) {
      const hay = item.ingredient.toLowerCase();
      if (hay === needle) exact.push(item);
      else if (hay.startsWith(needle)) prefix.push(item);
      else if (hay.includes(needle)) substring.push(item);
    }

    if (exact.length > 0) return exact;
    if (prefix.length > 0) return prefix;
    return substring;
  }
}
