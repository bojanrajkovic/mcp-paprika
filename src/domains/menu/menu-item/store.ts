import type { MenuItemUid, MenuUid } from "../ids.js";
import type { MenuItem } from "./types.js";

import { EntityStore } from "../../../entity/index.js";

export class MenuItemStore extends EntityStore<MenuItem, MenuItemUid> {
  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    super(opts ?? {});
  }

  /**
   * Returns all items whose menuUid matches the given value.
   */
  getByMenuUid(menuUid: MenuUid): Array<MenuItem> {
    const result: Array<MenuItem> = [];
    for (const item of this._items.values()) {
      if (item.menuUid === menuUid) result.push(item);
    }
    return result;
  }
}
