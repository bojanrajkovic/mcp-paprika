import type { DiskCacheDescriptor } from "../../../cache/disk-cache.js";
import type { Category } from "./types.js";

import { CategoryStoredSchema } from "./types.js";

export const categoryDiskDescriptor: DiskCacheDescriptor<Category> = {
  subdir: "categories",
  parse: (raw) => CategoryStoredSchema.parse(raw),
  getKey: (c) => c.uid,
};
