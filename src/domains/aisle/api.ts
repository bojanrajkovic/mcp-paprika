import type { Result } from "neverthrow";

import type { AisleUid } from "./ids.js";
import type { Aisle } from "./types.js";

/**
 * Aisle's public contract — the shared aisle catalog grocery and pantry resolve
 * their item/ingredient aisles against. Read lookups, plus two write paths:
 * `ensureAisle` auto-creates an aisle on first reference, and `deleteAisle`
 * backs grocery's `delete_aisle` tool (the reference guard lives with grocery,
 * which owns the referencing items; aisle owns the catalog write).
 */
export interface AisleApi {
  /**
   * Resolve a display name to its `{ aisle, aisleUid }`, auto-creating and
   * persisting the aisle in Paprika when no match exists. An empty name
   * short-circuits to the no-aisle sentinel with no I/O. Called by the grocery
   * and pantry write tools. Errs with a ready-to-surface message when the
   * catalog hasn't synced or the save fails (matching the other contract
   * writes — ADR-0014). A failed LOCAL commit after a successful save is
   * absorbed (warn + in-memory catalog updated): erring would invite a
   * duplicate re-create, and the replace-all sync heals the disk copy.
   */
  ensureAisle(name: string): Promise<Result<{ readonly aisle: string; readonly aisleUid: AisleUid }, string>>;
  /** Case-insensitive display-name lookup (no creation). */
  resolveByName(name: string): Aisle | undefined;
  /** UID lookup; `undefined` for an unknown or dangling UID. */
  get(uid: AisleUid): Aisle | undefined;
  /**
   * Tombstone-delete an aisle (POST `deleted: true`, then the local delete
   * commit). Errs with a ready-to-surface message on an unsynced catalog, an
   * unknown UID, or a failed save; a failed LOCAL commit after a successful
   * save also errs (the message says retrying is safe — the tombstone POST is
   * idempotent, and the replace-all sync reconciles either way). Called by
   * grocery's `delete_aisle`, which guards on referencing items first.
   */
  deleteAisle(uid: AisleUid): Promise<Result<void, string>>;
}
