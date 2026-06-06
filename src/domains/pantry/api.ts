import type { ResultAsync } from "neverthrow";

import type { HasSynced } from "../../kernel/registry.js";
import type { AisleUid } from "../aisle/ids.js";
import type { PantryItem } from "./types.js";

/**
 * Pantry's public contract — the surface grocery consumes via `ctx.deps.pantry`.
 * Scoped to exactly the live cross-domain call sites, nothing speculative:
 *   - `hasSynced` (inherited from {@link HasSynced}) — grocery gates the move and
 *     `delete_aisle` on pantry being warm;
 *   - `createItems` — the write `move_grocery_items_to_pantry` needs, distinguishing
 *     API-create failure from local-commit failure so grocery can keep its
 *     create-first/delete-second ordering and partial-failure messaging;
 *   - `countItemsInAisle` — the reference count `delete_aisle`'s guard blocks on.
 */
export interface PantryApi extends HasSynced {
  /**
   * Persist a batch of pantry items: POST to Paprika, then commit to the local
   * cache + store (the full `markPending → cache → flush → store → notifySync`
   * sequence). Called by grocery's `move_grocery_items_to_pantry`.
   *
   * Returns the server-saved items on success. On failure, the error names the
   * phase — `"save"` (the POST failed; nothing was created server-side, so grocery
   * can abort without deleting its items) or `"commit"` (the POST succeeded but the
   * local commit failed; the items exist server-side and appear after the next
   * sync, so grocery must NOT delete its items) — and carries the saved items so
   * the caller can surface their UIDs.
   */
  createItems(items: ReadonlyArray<PantryItem>): ResultAsync<ReadonlyArray<PantryItem>, PantryCreateError>;
  /** How many pantry items reference an aisle — `delete_aisle`'s guard blocks while > 0. */
  countItemsInAisle(uid: AisleUid): number;
}

/** The phase that failed inside `createItems`, with the underlying error message. */
export interface PantryCreateError {
  readonly phase: "save" | "commit";
  readonly message: string;
  /** The server-saved items — empty on a `"save"` failure, populated on `"commit"`. */
  readonly saved: ReadonlyArray<PantryItem>;
}
