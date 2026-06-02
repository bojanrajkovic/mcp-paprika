// TEMPORARY re-export barrel (ADR-0005 Phase 3 migration).
//
// The per-entity modules under `src/<entity>/types.ts` and the leaves below
// (`src/ids.ts`, `./sync-types.ts`, `./auth-response.ts`) are now the real homes
// for every type that used to live here. This barrel keeps the pre-refactor
// `paprika/types` import path working while importers are migrated to the
// per-entity paths, and is DELETED once the codemod completes — the end state
// has no barrel.
export * from "../ids.js";
export * from "../recipe/types.js";
export * from "../category/types.js";
export * from "../aisle/types.js";
export * from "../pantry/types.js";
export * from "../grocery-list/types.js";
export * from "../grocery-item/types.js";
export * from "../grocery-ingredient/types.js";
export * from "../meal/types.js";
export * from "../meal-type/types.js";
export * from "../menu/types.js";
export * from "../menu-item/types.js";
export * from "../photo/types.js";
export * from "./sync-types.js";
export * from "./auth-response.js";
