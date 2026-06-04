import type { DiskCacheDescriptor } from "../../../cache/disk-cache.js";
import type { GroceryIngredient } from "./types.js";

import { GroceryIngredientStoredSchema } from "./types.js";

export const groceryIngredientDiskDescriptor: DiskCacheDescriptor<GroceryIngredient> = {
  subdir: "groceryingredients",
  parse: (raw) => GroceryIngredientStoredSchema.parse(raw),
  getKey: (i) => i.uid,
};
