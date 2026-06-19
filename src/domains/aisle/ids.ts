import { z } from "zod";

/**
 * The aisle domain's UID brand and its no-reference sentinel. Branding is
 * compile-time kind-safety only, and every primary key is non-empty;
 * a UID leaf imports nothing but zod (conformance-tested); how a
 * foreign key spells absence lives in `docs/architecture.md` (Identifiers).
 */

export const AisleUidSchema = z.string().min(1).brand("AisleUid");
export type AisleUid = z.infer<typeof AisleUidSchema>;

/**
 * The grocery family's "no aisle" foreign-key reference. Grocery items, pantry
 * items, and grocery ingredients coerce a null wire `aisle_uid` to the empty
 * string rather than carrying `null`, because a malformed/absent aisle reference
 * must not abort the whole sync (#76). {@link AisleUidSchema} is `.min(1)`, so
 * `""` is **not** a valid primary-key `AisleUid`; {@link NoAisleRef} names that
 * sentinel as its own branded literal, and {@link AisleUidRef} is the schema an
 * `aisle_uid` *field* accepts — a real aisle UID or the no-aisle sentinel.
 */
export const NoAisleRef = z.literal("").brand("AisleUid");
export const AisleUidRef = z.union([AisleUidSchema, NoAisleRef]);
/** The "no aisle" sentinel value: an empty {@link AisleUid} (parses via {@link AisleUidRef}). */
export const NO_AISLE_UID = "" as AisleUid;
