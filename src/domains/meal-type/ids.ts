import { z } from "zod";

/**
 * The meal-type domain's UID brand. Branding is compile-time kind-safety only,
 * and every primary key is non-empty; a UID leaf imports nothing
 * but zod (conformance-tested); how a foreign key spells absence
 * lives in `docs/architecture.md` (Identifiers).
 */

export const MealTypeUidSchema = z.string().min(1).brand("MealTypeUid");
export type MealTypeUid = z.infer<typeof MealTypeUidSchema>;
