import type { DiskCacheDescriptor } from "../../../cache/disk-cache.js";
import type { MenuItem } from "./types.js";

import { MenuItemStoredSchema } from "./types.js";

export const menuItemDiskDescriptor: DiskCacheDescriptor<MenuItem> = {
  subdir: "menuitems",
  parse: (raw) => MenuItemStoredSchema.parse(raw),
  getKey: (mi) => mi.uid,
};
