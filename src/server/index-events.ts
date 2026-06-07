import type { Logger } from "pino";

import type { RecipeUid } from "../domains/recipe/ids.js";
import type { Recipe } from "../domains/recipe/types.js";

import { getMeter, lazy } from "../telemetry/scope.js";

// The seam swallows handler errors by contract (a re-index failure must not
// break a sync cycle or tool write), so — like the notifier — the counter is
// the aggregate visibility the swallow takes away from operators.
const indexEvents = lazy(() =>
  getMeter().createCounter("mcp_paprika.index_events", {
    description: "Cross-domain index events, by type and handler outcome",
    unit: "{event}",
  }),
);

/**
 * The recipe/category → discover re-index seam.
 *
 * The discover module owns the vector index, but recipe and category cannot reach
 * it: there is no dependency edge to discover and its public contract is empty by
 * design. So recipe writes (the commit chokepoints, #177) and the category-change
 * sync signal emit on this kernel-level channel — carried on `Infra` — and discover's
 * `index` boot hook subscribes. The emit is load-bearing because the sync diff alone
 * misses both cases: a tool-written recipe's UID is pending, so the recipe diff filters
 * it out, and a category rename changes no recipe hash — yet both must re-embed. The
 * channel covers them without a cross-domain reach-around the isolation boundary would
 * (correctly) reject.
 *
 * Emit is fire-and-forget and never throws: a handler error must not break a sync
 * cycle or a tool write. The VectorStore serializes its own writes via an internal
 * mutex, so unawaited concurrent emits are safe (see `src/features/CLAUDE.md`).
 */
export type IndexEvent =
  | { readonly type: "recipe-changed"; readonly recipes: ReadonlyArray<Recipe> }
  | { readonly type: "recipe-removed"; readonly uids: ReadonlyArray<RecipeUid> }
  // Category UIDs are plain `string` here, matching the source `EntityChanges.removedUids`
  // (the generic replace-all sync helper can't brand `T["uid"]`); discover's category-changed
  // handler compares them as plain strings against each recipe's `categories`.
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
          indexEvents().add(1, {
            "mcp_paprika.index_event.type": event.type,
            "mcp_paprika.index_event.outcome": "handled",
          });
        } catch (err) {
          log.warn({ err, type: event.type }, "index-event handler threw; ignored (best-effort re-index)");
          indexEvents().add(1, {
            "mcp_paprika.index_event.type": event.type,
            "mcp_paprika.index_event.outcome": "handler_threw",
          });
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
