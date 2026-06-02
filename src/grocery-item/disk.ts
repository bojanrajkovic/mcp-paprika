import type { DiskCacheDescriptor } from "../cache/disk-cache.js";
import { GroceryItemStoredSchema } from "./types.js";
import type { GroceryItem } from "./types.js";

export const groceryItemDiskDescriptor: DiskCacheDescriptor<GroceryItem> = {
  subdir: "groceryitems",
  parse: (raw) => GroceryItemStoredSchema.parse(raw),
  getKey: (i) => i.uid,
};
