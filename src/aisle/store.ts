import { EntityStore } from "../entity/index.js";
import type { Aisle } from "./types.js";
import type { AisleUid } from "../ids.js";

export class AisleStore extends EntityStore<Aisle, AisleUid> {
  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    super(opts ?? {});
  }

  load(items: ReadonlyArray<Aisle>): void {
    this.baseLoad(items);
  }

  resolveByName(name: string): Aisle | undefined {
    const needle = name.toLowerCase();
    for (const aisle of this._items.values()) {
      if (aisle.name.toLowerCase() === needle) return aisle;
    }
    return undefined;
  }
}
