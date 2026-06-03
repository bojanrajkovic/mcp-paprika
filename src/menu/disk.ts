import type { DiskCacheDescriptor } from "../cache/disk-cache.js";
import { MenuStoredSchema } from "./types.js";
import type { Menu } from "./types.js";

export const menuDiskDescriptor: DiskCacheDescriptor<Menu> = {
  subdir: "menus",
  parse: (raw) => MenuStoredSchema.parse(raw),
  getKey: (m) => m.uid,
};
