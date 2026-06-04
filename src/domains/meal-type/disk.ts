import type { DiskCacheDescriptor } from "../../cache/disk-cache.js";
import type { MealType } from "./types.js";

import { MealTypeStoredSchema } from "./types.js";

export const mealTypeDiskDescriptor: DiskCacheDescriptor<MealType> = {
  subdir: "mealtypes",
  parse: (raw) => MealTypeStoredSchema.parse(raw),
  getKey: (mt) => mt.uid,
};
