import type { DiskCacheDescriptor } from "../cache/disk-cache.js";
import { CategoryStoredSchema } from "./types.js";
import type { Category } from "./types.js";

export const categoryDiskDescriptor: DiskCacheDescriptor<Category> = {
  subdir: "categories",
  parse: (raw) => CategoryStoredSchema.parse(raw),
  getKey: (c) => c.uid,
};
