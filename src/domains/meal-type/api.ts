import type { Result } from "neverthrow";

import type { MealTypeUid } from "../../ids.js";
import type { HasSynced } from "../../kernel/registry.js";
import type { MealTypeResolveResult, MealTypeSpec } from "./meal-type-helpers.js";
import type { MealType } from "./types.js";

/**
 * Meal-type's public contract — the shared meal-type catalog the meal and menu
 * domains (and the menu resource) resolve against. Read lookups, plus one write
 * path: `ensureMealType` auto-creates a custom type on first reference (mirroring
 * aisle's `ensureAisle`). Explicit edit/delete of meal types is not exposed — that
 * stays a follow-up (#244).
 *
 * The inherited `hasSynced` is the catalog start-gate the meal/menu write tools
 * check before resolving or auto-creating a type.
 */
export interface MealTypeApi extends HasSynced {
  /**
   * Resolve a list of meal-type UIDs to their display names, in order, skipping
   * unknown/dangling UIDs. Backs the menu resource and the meal/menu renderers.
   */
  resolveNames(uids: ReadonlyArray<MealTypeUid>): ReadonlyArray<string>;
  /**
   * Resolve a `{name} | {uid} | {builtin}` spec against the catalog. Returns the
   * resolved `MealType` on a hit, or a structured error reason callers map to
   * their own message style. Called by the meal and menu write tools.
   */
  resolveSpec(spec: MealTypeSpec): MealTypeResolveResult;
  /** The whole catalog (unsorted) — callers sort/render as needed. */
  getAll(): ReadonlyArray<MealType>;
  /**
   * Resolve-or-create a meal type by name (case-insensitive), mirroring aisle's
   * `ensureAisle`. Returns the existing type on a name hit; otherwise creates a
   * custom type (`originalType: null`, default color/export), POSTs it, marks it
   * pending-upsert, and returns it. Called by the meal/menu WRITE tools for a
   * `{name}` spec that doesn't resolve — read/filter tools use `resolveSpec` and
   * never create. Errs with a ready-to-surface message on an empty name, an
   * unsynced catalog, or a failed save (matching the other contract writes —
   * ADR-0014). A failed LOCAL commit after a successful save is absorbed
   * (warn + in-memory catalog updated): erring would invite a duplicate
   * re-create, and the replace-all sync heals the disk copy.
   */
  ensureMealType(name: string): Promise<Result<MealType, string>>;
}
