import type { AisleUid } from "../../ids.js";
import type { Aisle } from "./types.js";

/**
 * Aisle's public contract — a shared reference catalog both grocery and pantry
 * resolve against (which is why it stays standalone, not folded into either).
 * Siblings reach these via `ctx.deps.aisle`; the store and cache stay private.
 */
export interface AisleApi {
  /**
   * Resolve a display name to its `{ aisle, aisleUid }`, auto-creating and
   * persisting the aisle in Paprika when no match exists. An empty name
   * short-circuits to the no-aisle sentinel with no I/O. Called by the grocery
   * and pantry write tools.
   */
  ensureAisle(name: string): Promise<{ readonly aisle: string; readonly aisleUid: AisleUid }>;
  /** Case-insensitive display-name lookup (no creation). */
  resolveByName(name: string): Aisle | undefined;
  /** UID lookup; `undefined` for an unknown or dangling UID. */
  get(uid: AisleUid): Aisle | undefined;
}
