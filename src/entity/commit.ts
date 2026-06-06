import type { ResultAsync as ResultAsyncType } from "neverthrow";
import { okAsync, ResultAsync } from "neverthrow";

import type { EntityStore } from "./store.js";

/**
 * The shared commit protocol — the one audited home for what was previously
 * copy-pasted across every domain's write chokepoints (#255 / #246):
 *
 *   markPending* (FIRST, before any cache I/O)
 *     → cache put/remove (batched under `ResultAsync.combine`)
 *     → cache.flush() (exactly once per cache)
 *     → on any failure: clearPending(every marked UID), surface the error
 *     → store set/delete
 *     → onCommitted?() (resourceListChanged / index events — caller-composed)
 *     → finish() (the single notifySync nudge)
 *
 * The pending mark shields a just-written UID from a sync cycle that reads a
 * canonical list issued before the write propagated; a failed commit clears
 * every mark it made, because a marked UID suppresses sync reconciliation
 * until TTL — all-or-nothing on failure is intentional (the server save
 * already succeeded, so local divergence is temporary and the next sync
 * reconciles it). `ResultAsync.combine` awaits every cache op (the underlying
 * promises never reject), so a failure cannot race `clearPending`.
 *
 * Layering: the cache is typed structurally ({@link CommitCache}) and the
 * notify tail arrives as the `finish` thunk, so this file imports neither
 * `src/cache` nor `src/paprika` — `src/entity` stays a leaf.
 */

/** The cache surface the protocol drives — structural, so `DiskCache`, `RecipeDiskCache`, or a test fake all conform. */
export interface CommitCache<T, E> {
  put(item: T): ResultAsyncType<void, E>;
  remove(key: string): ResultAsyncType<void, E>;
  flush(): ResultAsyncType<void, E>;
}

/** A store+cache pair, the shape every domain's `*State` slice already has. */
export interface CommitTarget<T extends { uid: UID }, UID extends string, E> {
  readonly store: EntityStore<T, UID>;
  readonly cache: CommitCache<T, E>;
}

/**
 * One entity operation within a commit. Two kinds, because payloads follow the
 * row's fate: an upsert writes the row (`cache.put` + `store.set`), a delete
 * removes it (`cache.remove` + `store.delete`). `markDelete` modulates only
 * the pending mark: recipe's trash is an upsert (the row survives, `inTrash`
 * flipped) whose sync-facing intent is a delete, so the UID must be shielded
 * as one. The invalid fourth combination — remove the row but mark
 * upsert-intent — is unrepresentable.
 */
export type CommitOp<T, UID extends string> =
  | { readonly kind: "upsert"; readonly item: T; readonly markDelete: boolean }
  | { readonly kind: "delete"; readonly uid: UID };

/** An upsert op; `markDelete` for the soft-delete shape (row kept, delete-intent mark). */
export const upsertOp = <T>(
  item: T,
  opts?: { readonly markDelete?: boolean },
): { readonly kind: "upsert"; readonly item: T; readonly markDelete: boolean } => ({
  kind: "upsert",
  item,
  markDelete: opts?.markDelete ?? false,
});

/** A hard-delete op (row removed from cache and store). */
export const deleteOp = <UID extends string>(uid: UID): { readonly kind: "delete"; readonly uid: UID } => ({
  kind: "delete",
  uid,
});

/**
 * The standard classifier for entities carrying Paprika's `deleted` flag:
 * deleted → hard delete, else upsert. NOT universal — recipe's trash is a
 * soft-delete (`upsertOp(saved, { markDelete: saved.inTrash })`: the row
 * survives with delete-intent marked), so reach for that shape, not this one,
 * when the entity must outlive its delete flag.
 */
export const deletedFlagOp = <T extends { readonly uid: UID; readonly deleted: boolean }, UID extends string>(
  item: T,
): CommitOp<T, UID> => (item.deleted ? deleteOp(item.uid) : upsertOp(item));

/** The per-commit side effects, supplied by the owning domain. */
export interface CommitEffects {
  /** Post-apply, pre-`finish` effects (`resourceListChanged()`, index events). Never runs on the failure path. */
  readonly onCommitted?: () => void;
  /** The tail nudge, exactly once per commit: `() => notifySyncBestEffort(client, log)`. */
  readonly finish: () => ResultAsyncType<void, never>;
}

/**
 * One slice's contribution to a commit, generics erased behind lazy thunks so
 * heterogeneous slices (recipe + photo in one joint commit) can share a
 * protocol run. Methods are invoked by {@link commitSlices} in protocol order;
 * `cacheOps()` STARTS the cache I/O, so it is never called before `mark()`.
 */
export interface SliceCommit<E> {
  readonly size: number;
  mark(): void;
  cacheOps(): ReadonlyArray<ResultAsyncType<void, E>>;
  flush(): ResultAsyncType<void, E>;
  clear(): void;
  apply(): void;
}

/** Bind a slice and its ops into a {@link SliceCommit} bundle for {@link commitSlices}. */
export function sliceOps<T extends { uid: UID }, UID extends string, E>(
  target: CommitTarget<T, UID, E>,
  ops: ReadonlyArray<CommitOp<T, UID>>,
): SliceCommit<E> {
  const uidOf = (op: CommitOp<T, UID>): UID => (op.kind === "delete" ? op.uid : op.item.uid);
  return {
    size: ops.length,
    mark: () => {
      for (const op of ops) {
        if (op.kind === "upsert" && !op.markDelete) target.store.markPendingUpsert(op.item.uid);
        else target.store.markPendingDelete(uidOf(op));
      }
    },
    cacheOps: () => ops.map((op) => (op.kind === "delete" ? target.cache.remove(op.uid) : target.cache.put(op.item))),
    flush: () => target.cache.flush(),
    clear: () => {
      for (const op of ops) target.store.clearPending(uidOf(op));
    },
    apply: () => {
      for (const op of ops) {
        if (op.kind === "delete") target.store.delete(op.uid);
        else target.store.set(op.item);
      }
    },
  };
}

/**
 * Run the commit protocol across one or more slices as a joint commit: all
 * marks, then all cache ops, then each cache flushed once (sequentially — if
 * an earlier flush fails, later caches keep their buffered ops unflushed),
 * then clear-ALL-on-failure across every slice, then all store applies, then
 * the shared effects exactly once.
 */
export function commitSlices<E>(
  slices: ReadonlyArray<SliceCommit<E>>,
  effects: CommitEffects,
): ResultAsyncType<void, E> {
  if (slices.every((s) => s.size === 0)) return okAsync(undefined);
  for (const s of slices) s.mark();
  return ResultAsync.combine(slices.flatMap((s) => s.cacheOps()))
    .andThen(() =>
      slices.reduce<ResultAsyncType<void, E>>((acc, s) => acc.andThen(() => s.flush()), okAsync(undefined)),
    )
    .mapErr((e) => {
      for (const s of slices) s.clear();
      return e;
    })
    .andThen(() => {
      for (const s of slices) s.apply();
      effects.onCommitted?.();
      return effects.finish();
    });
}

/** The common case: commit ops against a single store+cache slice. */
export function commitEntities<T extends { uid: UID }, UID extends string, E>(
  target: CommitTarget<T, UID, E>,
  ops: ReadonlyArray<CommitOp<T, UID>>,
  effects: CommitEffects,
): ResultAsyncType<void, E> {
  return commitSlices([sliceOps(target, ops)], effects);
}
