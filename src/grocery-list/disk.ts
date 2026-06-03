import type { DiskCacheDescriptor } from "../cache/disk-cache.js";
import type { GroceryList } from "./types.js";

import { GroceryListStoredSchema } from "./types.js";

export const groceryListDiskDescriptor: DiskCacheDescriptor<GroceryList> = {
  subdir: "grocerylists",
  parse: (raw) => GroceryListStoredSchema.parse(raw),
  getKey: (l) => l.uid,
};
