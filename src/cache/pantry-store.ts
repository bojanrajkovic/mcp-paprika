import { TombstoneEntityStore } from "../entity/index.js";
import type { PantryItem, PantryItemUid } from "../paprika/types.js";

export class PantryStore extends TombstoneEntityStore<PantryItem, PantryItemUid> {
  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    super(opts ?? {});
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
