import { scheduler } from "node:timers/promises";

import type { SyncOutcome } from "../kernel/sync.js";

/**
 * The background sync interval driver. The kernel exposes only `syncOnce()`; this
 * is the loop that calls it on an interval until stopped.
 *
 * `onCycle` runs one cycle and returns its outcome, which picks the next wait
 * ({@link nextSyncPace}). The kernel's `syncOnce()` already never throws, but
 * the inner `try/catch` is kept as belt-and-suspenders. The `scheduler.wait` +
 * `AbortController` + abort-exit is the load-bearing piece: `stop()` aborts the
 * in-flight wait so the loop exits promptly instead of after the full interval.
 *
 * The loop runs `onCycle()` IMMEDIATELY as its first iteration (then waits). The
 * caller has already run the initial cycle at build time (the kernel's `buildKernel`
 * does), so the first loop iteration is a second sync. The loop is fire-and-forget
 * (not awaited), so it never blocks the transport's `connect()`.
 */
export function runSyncLoop(onCycle: () => Promise<SyncOutcome>, intervalMs: number): { stop(): void } {
  const ac = new AbortController();
  const { signal } = ac;
  void (async (): Promise<void> => {
    let pace = BOOT_PACE;
    while (true) {
      let outcome: SyncOutcome = "contract_breach";
      try {
        outcome = await onCycle();
      } catch {
        // Defensive: onCycle (kernel.syncOnce) should never throw, but a thrown
        // error must not kill the loop or escape as an unhandled rejection.
      }
      const next = nextSyncPace(pace, outcome, intervalMs);
      pace = next.pace;
      try {
        await scheduler.wait(next.delayMs, { signal });
      } catch {
        // `scheduler.wait` rejects only on abort (`stop()` was called) — exit the
        // loop. Exiting on any rejection (rather than rethrowing the non-abort
        // ones into a swallowing catch, as the throw-based version did) keeps the
        // behavior identical and the loop throw-free.
        return;
      }
    }
  })();
  return {
    stop(): void {
      ac.abort();
    },
  };
}

/** How soon a converging loop retries: 2x the Paprika breaker's 30s half-open, so the breaker has closed. */
export const PARTIAL_RETRY_MS = 60_000;

/** The zero-progress pass, in a row, on which a converging loop gives up and falls back to the interval. */
export const MAX_CONVERGING_MISSES = 3;

/**
 * Where the loop is. `converging`: catching up on a partially-applied sync, retrying
 * every {@link PARTIAL_RETRY_MS} and counting zero-progress passes in a row. `steady`:
 * the normal interval.
 */
export type SyncPace = { readonly kind: "converging"; readonly misses: number } | { readonly kind: "steady" };

/**
 * The loop starts converging: boot is when catching up matters most, and the loop's
 * immediate first cycle can land nothing just because the boot cycle tripped the
 * breaker. An outage at boot costs at most {@link MAX_CONVERGING_MISSES} quick tries.
 */
export const BOOT_PACE: SyncPace = { kind: "converging", misses: 0 };

/**
 * The next pace and the wait before the next cycle. A `core_partial` cycle persisted
 * part of a batch (e.g. a rate-limited cold start, #483), so the loop converges: it
 * retries fast and tolerates a few zero-progress passes (a breaker probe that hits the
 * rate limit again) before falling back. Each partial pass lands more, so this ends.
 * An `ok` cycle settles to the interval, and a steady loop keeps the interval for any
 * failure, so an outage or bad credentials don't speed it up.
 */
export function nextSyncPace(
  pace: SyncPace,
  outcome: SyncOutcome,
  intervalMs: number,
): { readonly pace: SyncPace; readonly delayMs: number } {
  const fastMs = Math.min(PARTIAL_RETRY_MS, intervalMs);
  if (outcome === "ok") return { pace: { kind: "steady" }, delayMs: intervalMs };
  if (outcome === "core_partial") return { pace: { kind: "converging", misses: 0 }, delayMs: fastMs };
  if (pace.kind === "converging" && pace.misses + 1 < MAX_CONVERGING_MISSES) {
    return { pace: { kind: "converging", misses: pace.misses + 1 }, delayMs: fastMs };
  }
  return { pace: { kind: "steady" }, delayMs: intervalMs };
}
