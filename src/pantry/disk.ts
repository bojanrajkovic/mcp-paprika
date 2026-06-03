import type { DiskCacheDescriptor } from "../cache/disk-cache.js";
import { PantryItemStoredSchema } from "./types.js";
import type { PantryItem } from "./types.js";

export const pantryDiskDescriptor: DiskCacheDescriptor<PantryItem> = {
  subdir: "pantry",
  parse: (raw) => PantryItemStoredSchema.parse(raw),
  getKey: (i) => i.uid,
};
