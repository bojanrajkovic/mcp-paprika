import type { MealTypeUid } from "./ids.js";
import type { MealType } from "./types.js";

import { EntityStore } from "../../entity/index.js";

export class MealTypeStore extends EntityStore<MealType, MealTypeUid> {
  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    super(opts ?? {});
  }

  resolveByName(name: string): MealType | undefined {
    const needle = name.toLowerCase();
    for (const mt of this._items.values()) {
      if (mt.name.toLowerCase() === needle) return mt;
    }
    return undefined;
  }
}
