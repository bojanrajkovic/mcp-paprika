import { z } from "zod";

/**
 * The menu domain's UID brands — menus and menu items. Branding is
 * compile-time kind-safety only, and every primary key is non-empty (ADR-0007);
 * a UID leaf imports nothing but zod (ADR-0016, conformance-tested); how a
 * foreign key spells absence lives in `docs/architecture.md` (Identifiers).
 */

export const MenuUidSchema = z.string().min(1).brand("MenuUid");
export type MenuUid = z.infer<typeof MenuUidSchema>;

export const MenuItemUidSchema = z.string().min(1).brand("MenuItemUid");
export type MenuItemUid = z.infer<typeof MenuItemUidSchema>;
