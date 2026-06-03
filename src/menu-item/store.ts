import { TombstoneEntityStore } from "../entity/index.js";
import type { MenuItemUid, MenuUid } from "../ids.js";
import type { MenuItem } from "./types.js";

export class MenuItemStore extends TombstoneEntityStore<MenuItem, MenuItemUid> {
  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    super(opts ?? {});
  }

  /**
   * Returns all non-tombstoned items whose menuUid matches the given value.
   */
  getByMenuUid(menuUid: MenuUid): Array<MenuItem> {
    const result: Array<MenuItem> = [];
    for (const item of this._items.values()) {
      if (item.menuUid === menuUid) result.push(item);
    }
    return result;
  }
}
