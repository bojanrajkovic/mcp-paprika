import { scheduler } from "node:timers/promises";

import type { AnySyncResult } from "../paprika/sync-types.js";
import type { Notifier } from "./notifier.js";

/**
 * The background sync interval driver, extracted from the legacy `SyncEngine`'s
 * `start`/`stop`/`_loop` (sync.ts:262-276, 662-683). The kernel exposes only
 * `syncOnce()`; this is the loop that calls it on an interval until stopped.
 *
 * `onCycle` runs one cycle. The kernel's `syncOnce()` already never throws, but
 * the inner `try/catch` is kept as belt-and-suspenders (matching legacy's
 * defensive catch). The `scheduler.wait` + `AbortController` + `AbortError`-swallow
 * exit is the load-bearing piece preserved verbatim: `stop()` aborts the in-flight
 * wait so the loop exits promptly instead of after the full interval.
 *
 * Like legacy `_loop`, the loop runs `onCycle()` IMMEDIATELY as its first iteration
 * (then waits). The caller has already run the initial cycle once at build time
 * (the kernel's `buildKernel` does), so the first loop iteration is a second sync —
 * exactly as the legacy `runInitialSync` + `sync.start()` sequence did. The loop is
 * fire-and-forget (not awaited), so it never blocks the transport's `connect()`.
 */
export function runSyncLoop(onCycle: () => Promise<void>, intervalMs: number): { stop(): void } {
  const ac = new AbortController();
  const { signal } = ac;
  void (async (): Promise<void> => {
    while (true) {
      try {
        await onCycle();
      } catch {
        // Defensive: onCycle (kernel.syncOnce) should never throw, but a thrown
        // error must not kill the loop or escape as an unhandled rejection.
      }
      try {
        await scheduler.wait(intervalMs, { signal });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        throw err;
      }
    }
  })().catch(() => {
    // The loop only rejects on a non-abort `scheduler.wait` error (effectively
    // never); swallow so it can't surface as an unhandled rejection on shutdown.
  });
  return {
    stop(): void {
      ac.abort();
    },
  };
}

/**
 * Fan out a resource-list notification for a completed sync cycle's results — the
 * legacy `wireSync` `sync:complete` subscriber (build.ts:357-371), now applied to
 * the array `kernel.syncOnce()` returns rather than per-event. Fires
 * `resourceListChanged()` once per qualifying result: Content entities with an MCP
 * resource surface (recipes, grocery lists + items, menus + items). Pantry is
 * excluded — it has no resource surface. `resourceListChanged()` is idempotent
 * fire-and-forget, so N calls in one cycle collapse client-side exactly as the
 * legacy per-event emits did. The kernel returns `[]` for an aborted/un-flushed
 * cycle, so a failed cycle fans out nothing (mirroring legacy's sync:error-only).
 */
export function notifyFromResults(results: ReadonlyArray<AnySyncResult>, notifier: Notifier): void {
  for (const result of results) {
    if (
      result.changeType !== "recipes" &&
      result.changeType !== "grocery-lists" &&
      result.changeType !== "grocery-items" &&
      result.changeType !== "menus" &&
      result.changeType !== "menu-items"
    ) {
      continue;
    }
    const { added, updated, removedUids } = result.changes;
    if (added.length > 0 || updated.length > 0 || removedUids.length > 0) {
      notifier.resourceListChanged();
    }
  }
}
