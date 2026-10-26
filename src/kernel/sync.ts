import { context, SpanStatusCode, trace, ValueType } from "@opentelemetry/api";
import type { ResultAsync } from "neverthrow";
import type { Logger } from "pino";

import type { CacheError } from "../cache/disk-cache.js";
import type { AnySyncResult, SyncError } from "../paprika/sync-types.js";
import type { BootCtx, Built, DomainId, ErasedBootCtx } from "./registry.js";

import { PartialSyncError } from "../paprika/sync-types.js";
import { getMeter, getTracer, lazy, startTimer } from "../telemetry/scope.js";
import { errorTypeName, traceResultAsync } from "../telemetry/trace-result.js";

/**
 * The kernel's sync engine: a dumb driver over per-module reconciles. Each module
 * contributes a `reconcile` per owned entity via {@link SyncContribution}, reached
 * through the same {@link BootCtx} the boot hooks receive, so a central sync needs
 * no global slice over the modules' hidden stores. `buildKernel` calls
 * {@link buildSyncDriver} once at boot to get the `syncOnce` its `Kernel` exposes;
 * the interval loop (`src/server/sync-loop.ts`) calls it repeatedly.
 */

/**
 * Sync tier — three buckets the driver runs in order each cycle: reference → core →
 * additive. Tiers scope abort-blast-radius, NOT data ordering: nothing reads a sibling
 * store during reconcile (every catalog name resolves at read time), so a tier only
 * decides which reconciles a failure may take down. See docs/adr/0010-reference-sync-tier.md.
 *
 * - `reference` (the lookup catalogs: aisle, category, meal-type) runs FIRST, each
 *   best-effort: an `err` is logged and the cycle continues, degrading to the
 *   last-good in-memory catalog rather than aborting the primary data sync.
 * - `core` (recipe, pantry, grocery) runs next, in dependency order; a core `err`
 *   aborts the cycle as a logged no-op, mirroring the sync loop's never-throws
 *   contract (reworked from throw-abort to Result-abort).
 * - `additive` (meals, menus, photos) runs last, each best-effort, so a soft read
 *   surface can't abort core sync.
 */
export type SyncTier = "reference" | "core" | "additive";

/**
 * One entity's contribution to the sync cycle — the seam between a central sync
 * and module-owned (hidden) stores. A multi-entity domain supplies one per owned
 * entity via `syncs`. `reconcile` receives the SAME {@link BootCtx} the boot hooks
 * do: its own store/cache via `state`, its declared deps' contracts via `deps`, the
 * Paprika client via `infra.client`. So no central all-stores context is needed. It
 * resolves to an `AnySyncResult` carrying the cycle's per-entity changes (recipes/grocery/
 * menus), or `void` for reference/soft entities that report none; an `err` is the
 * abort signal the driver scopes by tier — a reconcile never
 * throws. `sweep` is the per-store pending-write TTL sweep the driver runs once at
 * end-of-cycle.
 */
export interface SyncContribution<State, Deps extends DomainId> {
  readonly tier: SyncTier;
  reconcile(ctx: BootCtx<State, Deps>): ResultAsync<AnySyncResult | void, SyncError>;
  sweep?(): number;
}

/** Kernel-facing erased sync contribution (the `State`/`Deps` generics gone). */
export interface ErasedSync {
  readonly tier: SyncTier;
  reconcile(ctx: ErasedBootCtx): ResultAsync<AnySyncResult | void, SyncError>;
  sweep?(): number;
}

/** What started a sync cycle — a telemetry label, not a behavioral input. */
export type SyncTrigger = "boot" | "interval";

/**
 * How a sync cycle ended, as recorded on its span and duration histogram.
 * `core_partial` is a core abort whose reconcile persisted part of its batch
 * ({@link PartialSyncError}); `core_aborted` is one that made no progress.
 */
export type SyncOutcome = "ok" | "core_partial" | "core_aborted" | "flush_failed" | "contract_breach";

/** One completed `syncOnce`: how it ended, and the results (empty unless it flushed). */
export interface SyncCycle {
  readonly outcome: SyncOutcome;
  readonly results: ReadonlyArray<AnySyncResult>;
}

const ATTR_SYNC_TRIGGER = "mcp_paprika.sync.trigger";
const ATTR_SYNC_OUTCOME = "mcp_paprika.sync.outcome";
const ATTR_SYNC_TIER = "mcp_paprika.sync.tier";
const ATTR_SYNC_DOMAIN = "mcp_paprika.sync.domain";
const ATTR_SYNC_ENTITY = "mcp_paprika.sync.entity";
const ATTR_SYNC_CHANGE_KIND = "mcp_paprika.sync.change.kind";

const syncCycleDuration = lazy(() =>
  getMeter().createHistogram("mcp_paprika.sync.cycle.duration", {
    description: "Duration of sync cycles, by trigger and outcome",
    unit: "s",
    valueType: ValueType.DOUBLE,
  }),
);
const syncChanges = lazy(() =>
  getMeter().createCounter("mcp_paprika.sync.changes", {
    description: "Entity changes applied by sync cycles that completed through flush",
    unit: "{change}",
  }),
);
const syncSweepExpired = lazy(() =>
  getMeter().createCounter("mcp_paprika.sync.sweep.expired", {
    description: "Pending-write marks expired by the end-of-cycle TTL sweep",
    unit: "{mark}",
  }),
);

/** `error.type` class for a reconcile failure: the error's constructor, or the plain-object CacheError. */
const syncErrorType = (error: SyncError): string => errorTypeName(error, "CacheError");

/** What the sync driver needs from `buildKernel`. */
export interface SyncDriverDeps {
  /** The constructed modules, in dependency (topo-sort) order. */
  readonly built: ReadonlyArray<Built>;
  /** The boot ctx each module's reconciles receive. */
  readonly bootCtxOf: (b: Built) => ErasedBootCtx;
  /** Flushes every module cache; a cycle reports results only once this succeeds. */
  readonly flushAll: () => ResultAsync<void, CacheError>;
  readonly log: Logger;
}

/**
 * Build the sync driver: bucket every module's reconciles into their tiers once, and
 * return `syncOnce`, which `buildKernel` exposes as `Kernel.syncOnce`. Three tiers run
 * in order: reference catalogs first (best-effort), then core in dependency order (a
 * failure aborts the cycle), then additive best-effort; then flush + sweep. The whole
 * cycle never throws. Tiers scope abort-blast-radius, not data ordering — nothing
 * reads a sibling store during reconcile.
 *
 * Recipe's core reconciles must LEAD the core tier: recipe must be marked synced
 * before the other core reconciles (pantry, grocery) run, so a later core failure
 * can't gate recipe tools for the interval. Recipe is dep-free, so the topo-sort
 * (which orders aisle→pantry→grocery via their dependency edges) can't hoist it — a
 * stable sort keyed on id "recipe" does. This is the one ordering the dependency DAG
 * can't express; if a second priority case ever appears, promote it to a declared
 * `SyncContribution` ordinal (copy first, abstract on the third).
 */
export function buildSyncDriver({
  built,
  bootCtxOf,
  flushAll,
  log,
}: SyncDriverDeps): (trigger?: SyncTrigger) => Promise<SyncCycle> {
  const syncOrder = [...built].sort((a, z) => (a.id === "recipe" ? -1 : 0) - (z.id === "recipe" ? -1 : 0));
  type RunSync = () => ResultAsync<AnySyncResult | void, SyncError>;
  const referenceSyncs: Array<RunSync> = [];
  const coreSyncs: Array<RunSync> = [];
  const additiveSyncs: Array<RunSync> = [];
  const sweepers: Array<() => number> = [];
  for (const b of syncOrder) {
    if (b.syncs === undefined) continue;
    for (const sync of b.syncs) {
      // Each reconcile runs under its own span (named by owning domain — a
      // domain with several syncs shares the name; the entity attribute
      // stamped from the result disambiguates), child of the cycle span via
      // the active context. error.type carries the typed failure's class.
      const run: RunSync = () =>
        traceResultAsync(
          getTracer(),
          `paprika.sync.reconcile ${b.id}`,
          { attributes: { [ATTR_SYNC_TIER]: sync.tier, [ATTR_SYNC_DOMAIN]: b.id }, errorType: syncErrorType },
          () =>
            sync.reconcile(bootCtxOf(b)).map((result) => {
              // The reconcile span is the active span here (traceResultAsync
              // runs fn under it); stamp what the reconcile produced.
              if (result !== undefined) {
                trace.getActiveSpan()?.setAttributes({
                  [ATTR_SYNC_ENTITY]: result.changeType,
                  "mcp_paprika.sync.added": result.changes.added.length,
                  "mcp_paprika.sync.updated": result.changes.updated.length,
                  "mcp_paprika.sync.removed": result.changes.removedUids.length,
                });
              }
              return result;
            }),
        );
      if (sync.tier === "reference") referenceSyncs.push(run);
      else if (sync.tier === "core") coreSyncs.push(run);
      else additiveSyncs.push(run);
      if (sync.sweep !== undefined) sweepers.push(sync.sweep);
    }
  }

  return async (trigger: SyncTrigger = "interval"): Promise<SyncCycle> => {
    // The cycle span parents every reconcile span (and their undici fetch
    // children) via the active context; `finish` is the single end point that
    // stamps the outcome, records the duration histogram, and — only for a
    // cycle that completed through flush — counts the applied changes. The
    // change counters mirror the results contract: an aborted cycle reports
    // none.
    const cycleSpan = getTracer().startSpan("paprika.sync_cycle", { attributes: { [ATTR_SYNC_TRIGGER]: trigger } });
    const cycleElapsedSeconds = startTimer();
    const finish = (outcome: SyncOutcome, results: ReadonlyArray<AnySyncResult>): SyncCycle => {
      const elapsedSeconds = cycleElapsedSeconds();
      cycleSpan.setAttribute(ATTR_SYNC_OUTCOME, outcome);
      if (outcome !== "ok") cycleSpan.setStatus({ code: SpanStatusCode.ERROR });
      cycleSpan.end();
      syncCycleDuration().record(elapsedSeconds, {
        [ATTR_SYNC_TRIGGER]: trigger,
        [ATTR_SYNC_OUTCOME]: outcome,
      });
      let total = 0;
      const entitiesChanged: string[] = [];
      for (const r of results) {
        const counts = [
          ["added", r.changes.added.length],
          ["updated", r.changes.updated.length],
          ["removed", r.changes.removedUids.length],
        ] as const;
        let entityTotal = 0;
        for (const [kind, n] of counts) {
          if (n > 0) syncChanges().add(n, { [ATTR_SYNC_ENTITY]: r.changeType, [ATTR_SYNC_CHANGE_KIND]: kind });
          entityTotal += n;
        }
        total += entityTotal;
        if (entityTotal > 0) entitiesChanged.push(r.changeType);
      }
      // Close every cycle with a summary line (the interval loop is otherwise
      // silent on success): a change-bearing cycle at info, a clean no-op at
      // debug. The aborted outcomes already logged their err/warn above, so they
      // close at debug here without a second error line. Trace correlation via the
      // span; per-entity counts live on the sync_changes metric.
      const fields = {
        trigger,
        outcome,
        durationSec: Math.round(elapsedSeconds),
        changes: total,
        entities: entitiesChanged,
      };
      if (outcome === "ok" && total > 0) {
        log.info(fields, "sync cycle complete");
      } else {
        log.debug(fields, "sync cycle complete");
      }
      return { outcome, results };
    };
    return context.with(trace.setSpan(context.active(), cycleSpan), async () => {
      const results: Array<AnySyncResult> = [];
      // The reconciles speak Result, so the abort seam is the core-tier
      // `err` below, not a catch. The try/catch is pure defense-in-depth for a
      // reconcile that breaks its own contract (a throw inside a chain callback
      // rejects the underlying promise): syncOnce's never-throws promise is
      // load-bearing for the interval loop and boot.
      try {
        // Reference catalogs first, best-effort: a catalog fetch failure degrades to the
        // last-good in-memory catalog (consumers resolve names at read time and gate on
        // hasSynced) rather than aborting the primary data sync below.
        for (const run of referenceSyncs) {
          (await run()).match(
            (r) => {
              if (r !== undefined) results.push(r);
            },
            (err) => {
              log.warn({ err }, "reference sync failed; core sync unaffected");
            },
          );
        }
        for (const run of coreSyncs) {
          const coreErr = (await run()).match(
            (r) => {
              if (r !== undefined) results.push(r);
              return undefined;
            },
            (err) => err,
          );
          if (coreErr !== undefined) {
            // A core err aborts the cycle: no flush, no sweep, no results — the
            // partially reconciled state stays in memory and the next cycle retries.
            // A PartialSyncError already persisted its own landed items, so it's
            // reported apart for the loop to retry sooner.
            log.error({ err: coreErr }, "sync failed");
            return finish(coreErr instanceof PartialSyncError ? "core_partial" : "core_aborted", []);
          }
        }
        for (const run of additiveSyncs) {
          (await run()).match(
            (r) => {
              if (r !== undefined) results.push(r);
            },
            (err) => {
              log.warn({ err }, "additive sync failed; core sync unaffected");
            },
          );
        }
        // Only a cycle that reached flush reports results: a core-reconcile err (or
        // a flush error) aborts the cycle. Returning the partially accumulated
        // `results` for an aborted, un-flushed cycle would count changes for state
        // that never became durable — return `[]` instead.
        return (await flushAll()).match(
          () => {
            let swept = 0;
            for (const sweep of sweepers) swept += sweep();
            if (swept > 0) {
              log.debug({ swept }, "swept pending writes past TTL");
              syncSweepExpired().add(swept);
            }
            return finish("ok", results);
          },
          (flushErr) => {
            log.error({ err: flushErr }, "sync flush failed");
            return finish("flush_failed", []);
          },
        );
      } catch (err) {
        log.error({ err }, "sync failed (reconcile broke the Result contract)");
        return finish("contract_breach", []);
      }
    });
  };
}
