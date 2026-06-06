import type { AisleUid } from "./ids.js";

/** The catalog read {@link aisleDisplayName} resolves against — structurally `AisleApi.get`. */
export interface AisleNameSource {
  get(uid: AisleUid): { readonly name: string } | undefined;
}

/**
 * An item's display aisle: the LIVE catalog name first, the item's denormalized
 * `aisle` copy as the dangling/no-aisle fallback. This is ADR-0017's
 * render-resolution contract in one place — items denormalize the aisle name at
 * write time, so after an aisle rename only the catalog is current; every
 * grocery/pantry renderer resolves through here rather than trusting the copy.
 * (`NO_AISLE_UID` is the empty string, which misses the catalog and falls back
 * to the item's empty `aisle` — the renderers' "—" case.)
 */
export function aisleDisplayName(
  catalog: AisleNameSource,
  item: { readonly aisleUid: AisleUid; readonly aisle: string },
): string {
  return catalog.get(item.aisleUid)?.name ?? item.aisle;
}
