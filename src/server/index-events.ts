import type { Logger } from "pino";

import type { Recipe } from "../domains/recipe/types.js";
import type { RecipeUid } from "../ids.js";

/**
 * The recipe/category → discover re-index seam.
 *
 * The discover module owns the vector index, but recipe and category cannot reach
 * it: there is no dependency edge to discover and its public contract is empty by
 * design. So recipe writes (the `maintainRecipeIndex` chokepoints, #177) and the
 * category-change sync signal emit on this kernel-level channel — carried on
 * `Infra` — and discover's `index` boot hook subscribes. That restores the legacy
 * re-embed paths (a tool-written recipe's UID is pending, so sync's diff filters it
 * out; a category rename changes no recipe hash) without a cross-domain reach-around
 * that the isolation boundary would (correctly) reject.
 *
 * Emit is fire-and-forget and never throws: a handler error must not break a sync
 * cycle or a tool write. The VectorStore serializes its own writes via an internal
 * mutex, so unawaited concurrent emits are safe (see `src/features/CLAUDE.md`).
 */
export type IndexEvent =
  | { readonly type: "recipe-changed"; readonly recipes: ReadonlyArray<Recipe> }
  | { readonly type: "recipe-removed"; readonly uids: ReadonlyArray<RecipeUid> }
  // Category UIDs are plain `string` here, matching the source `EntityChanges.removedUids`
  // (the generic sync helper can't brand `T["uid"]`) and the legacy
  // `reindexRecipesForCategoryChange(changedUids: ReadonlyArray<string>)` they feed.
  | { readonly type: "category-changed"; readonly uids: ReadonlyArray<string> };

export interface IndexEventEmitter {
  /** Fire-and-forget notification; never throws (handler errors are swallowed + logged). */
  emit(event: IndexEvent): void;
  /** Subscribe a handler; returns an unsubscribe function. */
  on(handler: (event: IndexEvent) => void): () => void;
}

/** A simple in-process emitter. `log` records swallowed handler errors at `warn`. */
export function createIndexEvents(log: Logger): IndexEventEmitter {
  const handlers = new Set<(event: IndexEvent) => void>();
  return {
    emit(event) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          log.warn({ err, type: event.type }, "index-event handler threw; ignored (best-effort re-index)");
        }
      }
    },
    on(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
