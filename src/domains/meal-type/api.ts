import type { z } from "zod";

import type { MealTypeUid } from "../../ids.js";
import type { MealTypeResolveResult, mealTypeSpecSchema } from "./meal-type-helpers.js";
import type { MealType } from "./types.js";

/** A meal-type selection spec (`{name} | {uid} | {builtin}`) — the inferred type
 * of the shared `mealTypeSpecSchema` both the meal and menu write tools parse. */
export type MealTypeSpec = z.infer<typeof mealTypeSpecSchema>;

/**
 * Meal-type's public contract — a shared reference catalog the meal and menu
 * domains (and the menu resource) resolve against, which is why it stays
 * standalone rather than folded into either. Siblings reach these via
 * `ctx.deps["meal-type"]`; the store and cache stay private. Read, plus one write
 * path: `ensureMealType` auto-creates a custom type on first reference (mirroring
 * aisle's `ensureAisle`). Explicit edit/delete of meal types is not exposed — that
 * stays a follow-up (#244).
 */
export interface MealTypeApi {
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
  /** Whether the catalog has completed its first sync (start-guard gate). */
  hasSynced(): boolean;
  /**
   * Resolve-or-create a meal type by name (case-insensitive), mirroring aisle's
   * `ensureAisle`. Returns the existing type on a name hit; otherwise creates a
   * custom type (`originalType: null`, default color/export), POSTs it, marks it
   * pending-upsert, and returns it. Called by the meal/menu WRITE tools for a
   * `{name}` spec that doesn't resolve — read/filter tools use `resolveSpec` and
   * never create. Throws if the catalog hasn't synced or the save fails.
   */
  ensureMealType(name: string): Promise<MealType>;
}
