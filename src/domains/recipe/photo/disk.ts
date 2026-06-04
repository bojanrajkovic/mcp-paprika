import type { DiskCacheDescriptor } from "../../../cache/disk-cache.js";
import type { Photo } from "./types.js";

import { PhotoStoredSchema } from "./types.js";

export const photoDiskDescriptor: DiskCacheDescriptor<Photo> = {
  subdir: "photos",
  parse: (raw) => PhotoStoredSchema.parse(raw),
  getKey: (p) => p.uid,
};
