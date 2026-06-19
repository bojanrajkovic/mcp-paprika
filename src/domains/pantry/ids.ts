import { z } from "zod";

/**
 * The pantry domain's UID brand. Branding is compile-time kind-safety only,
 * and every primary key is non-empty; a UID leaf imports nothing
 * but zod (conformance-tested); how a foreign key spells absence
 * lives in `docs/architecture.md` (Identifiers).
 */

export const PantryItemUidSchema = z.string().min(1).brand("PantryItemUid");
export type PantryItemUid = z.infer<typeof PantryItemUidSchema>;
