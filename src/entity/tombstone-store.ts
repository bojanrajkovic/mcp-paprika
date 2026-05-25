import { EntityStore } from "./store.js";

export abstract class TombstoneEntityStore<T extends { uid: UID }, UID extends string> extends EntityStore<T, UID> {
  private readonly _tombstones: Set<UID> = new Set();

  load(items: ReadonlyArray<T>): void {
    this.baseLoad(items);
    for (const item of items) {
      this._tombstones.delete(this.getUid(item));
    }
  }

  override set(item: T): void {
    super.set(item);
    this._tombstones.delete(this.getUid(item));
  }

  override delete(uid: UID): void {
    this._tombstones.add(uid);
    super.delete(uid);
  }

  isTombstone(uid: UID): boolean {
    return this._tombstones.has(uid);
  }
}
