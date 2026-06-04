import type { DiskCacheDescriptor } from "../../cache/disk-cache.js";
import type { Meal } from "./types.js";

import { MealStoredSchema } from "./types.js";

export const mealDiskDescriptor: DiskCacheDescriptor<Meal> = {
  subdir: "meals",
  parse: (raw) => MealStoredSchema.parse(raw),
  getKey: (m) => m.uid,
};
