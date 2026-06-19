import { z } from "zod";

/**
 * The meal domain's UID brand. Branding is compile-time kind-safety only,
 * and every primary key is non-empty; a UID leaf imports nothing
 * but zod (conformance-tested); how a foreign key spells absence
 * lives in `docs/architecture.md` (Identifiers).
 */

export const MealUidSchema = z.string().min(1).brand("MealUid");
export type MealUid = z.infer<typeof MealUidSchema>;
