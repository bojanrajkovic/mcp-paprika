import type { DiskCacheDescriptor } from "../../cache/disk-cache.js";
import type { Aisle } from "./types.js";

import { AisleStoredSchema } from "./types.js";

export const aisleDiskDescriptor: DiskCacheDescriptor<Aisle> = {
  subdir: "aisles",
  parse: (raw) => AisleStoredSchema.parse(raw),
  getKey: (a) => a.uid,
};
