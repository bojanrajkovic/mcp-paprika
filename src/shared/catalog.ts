import type { Result, ResultAsync } from "neverthrow";
import { err } from "neverthrow";

import type { CacheError } from "../cache/disk-cache.js";
import type { CommitTarget } from "../entity/commit.js";

import { commitEntities, deleteOp } from "../entity/commit.js";

// Shared machinery for the ordered reference catalogs (aisle, meal-type — the
// management tools). Both catalogs are flat name+orderFlag lists with
// identical sort, reposition, and tombstone-delete semantics; the entity-specific
// parts (fields, wire save, messages) stay with each domain.

/** The shape both ordered catalogs share: a branded uid, a display name, an order flag. */
export interface OrderedCatalogEntry {
  readonly uid: string;
  readonly name: string;
  readonly orderFlag: number;
}

/** The catalog in display order — the sort every catalog list/update tool renders. */
export function sortCatalog<T extends OrderedCatalogEntry>(entries: ReadonlyArray<T>): Array<T> {
  return entries.slice().sort((a, b) => {
    if (a.orderFlag !== b.orderFlag) return a.orderFlag - b.orderFlag;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Reposition `target` to the 1-based `position` within the sorted catalog:
 * remove, insert at the clamped index, renumber order flags contiguously.
 * Entries already carrying their contiguous flag are returned as-is, so a
 * caller can diff against the store to save only what changed.
 *
 * Precondition: `target` is an entry OF `sorted` (possibly with edited fields).
 * An unknown uid is not detected — it would be inserted as an (N+1)th entry —
 * so callers resolve the target from the store first.
 */
export function repositionCatalog<T extends OrderedCatalogEntry>(
  sorted: ReadonlyArray<T>,
  target: T,
  position: number,
): Array<T> {
  const without = sorted.filter((e) => e.uid !== target.uid);
  const idx = Math.min(position - 1, without.length);
  return [...without.slice(0, idx), target, ...without.slice(idx)].map((e, i) =>
    e.orderFlag === i ? e : { ...e, orderFlag: i },
  );
}

/**
 * Build a catalog's tombstone-delete contract write (`AisleApi.deleteAisle`,
 * `MealTypeApi.deleteMealType`): sync-gate, lookup, wire tombstone (`save` POSTs
 * the entity with `deleted: true`), local delete commit. Errs with
 * ready-to-surface messages; erring after a successful POST is safe to surface —
 * re-running the delete just re-POSTs the tombstone, and the replace-all sync
 * reconciles either way. The reference guard/warning lives with the calling tool
 * (homed where the referencing entities are visible). `noun` is the
 * capitalized entity noun for messages, e.g. "Aisle" / "Meal type".
 */
export function makeCatalogDelete<
  // `uid: UID` re-narrows OrderedCatalogEntry's plain-string uid to the branded
  // UID param — the load-bearing term that keeps the CommitTarget seam kind-safe.
  // Don't "simplify" it away.
  T extends OrderedCatalogEntry & { readonly uid: UID; readonly deleted: boolean },
  UID extends string,
>(opts: {
  readonly noun: string;
  readonly state: CommitTarget<T, UID, CacheError> & {
    readonly store: { readonly hasSynced: boolean; get(uid: UID): T | undefined };
  };
  readonly save: (tombstone: T) => ResultAsync<unknown, { readonly message: string }>;
  /** Post-commit effect — catalog deletes fire `resourceListChanged` (live-resolved resource content changes). */
  readonly onCommitted?: () => void;
  readonly finish: () => ResultAsync<void, never>;
}): (uid: UID) => Promise<Result<void, string>> {
  return async (uid) => {
    if (!opts.state.store.hasSynced) {
      return err(`${opts.noun} list is not yet synced. Try again in a few seconds.`);
    }
    const existing = opts.state.store.get(uid);
    if (existing === undefined) return err(`No ${opts.noun.toLowerCase()} found with UID "${uid}".`);
    return await opts
      .save({ ...existing, deleted: true })
      .mapErr((e) => `Failed to delete ${opts.noun.toLowerCase()} "${existing.name}": ${e.message}`)
      .andThen(() =>
        commitEntities(opts.state, [deleteOp<UID>(uid)], {
          ...(opts.onCommitted !== undefined ? { onCommitted: opts.onCommitted } : {}),
          finish: opts.finish,
        }).mapErr(
          (e: CacheError) =>
            `${opts.noun} "${existing.name}" was deleted in Paprika, but the local commit failed (${e.message}). ` +
            "Retrying is safe; the next sync reconciles either way.",
        ),
      )
      .map(() => undefined);
  };
}
