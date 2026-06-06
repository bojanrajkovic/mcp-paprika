import { z } from "zod";

/**
 * The recipe domain's UID brands — recipes, categories, photos. Branding is
 * compile-time kind-safety only, and every primary key is non-empty (ADR-0007);
 * a UID leaf imports nothing but zod (ADR-0016, conformance-tested); how a
 * foreign key spells absence lives in `docs/architecture.md` (Identifiers).
 */

export const RecipeUidSchema = z.string().min(1).brand("RecipeUid");
export type RecipeUid = z.infer<typeof RecipeUidSchema>;

export const CategoryUidSchema = z.string().min(1).brand("CategoryUid");
export type CategoryUid = z.infer<typeof CategoryUidSchema>;

export const PhotoUidSchema = z.string().min(1).brand("PhotoUid");
export type PhotoUid = z.infer<typeof PhotoUidSchema>;
