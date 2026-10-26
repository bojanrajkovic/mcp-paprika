import { describe, expect, it, vi } from "vitest";

import {
  BOOT_PACE,
  MAX_CONVERGING_MISSES,
  nextSyncPace,
  PARTIAL_RETRY_MS,
  runSyncLoop,
  type SyncPace,
} from "./sync-loop.js";

// ---------------------------------------------------------------------------
// nextSyncPace
// ---------------------------------------------------------------------------

describe("nextSyncPace", () => {
  const INTERVAL = 15 * 60_000;
  const steady: SyncPace = { kind: "steady" };

  it("starts converging, so a zero-progress first loop cycle after boot still retries fast", () => {
    expect(nextSyncPace(BOOT_PACE, "core_aborted", INTERVAL)).toEqual({
      pace: { kind: "converging", misses: 1 },
      delayMs: PARTIAL_RETRY_MS,
    });
  });

  it("settles to the interval after an ok cycle", () => {
    expect(nextSyncPace(BOOT_PACE, "ok", INTERVAL)).toEqual({ pace: steady, delayMs: INTERVAL });
  });

  it("starts converging on a partial cycle, even from steady", () => {
    expect(nextSyncPace(steady, "core_partial", INTERVAL)).toEqual({
      pace: { kind: "converging", misses: 0 },
      delayMs: PARTIAL_RETRY_MS,
    });
  });

  it("resets the miss count when a converging cycle makes progress again", () => {
    expect(nextSyncPace({ kind: "converging", misses: 2 }, "core_partial", INTERVAL).pace).toEqual({
      kind: "converging",
      misses: 0,
    });
  });

  it(`falls back to the interval on the ${MAX_CONVERGING_MISSES.toString()}th zero-progress pass in a row`, () => {
    let pace: SyncPace = { kind: "converging", misses: 0 };
    const delays: number[] = [];
    for (let i = 0; i < MAX_CONVERGING_MISSES; i++) {
      const next = nextSyncPace(pace, "core_aborted", INTERVAL);
      pace = next.pace;
      delays.push(next.delayMs);
    }
    expect(delays).toEqual([...Array<number>(MAX_CONVERGING_MISSES - 1).fill(PARTIAL_RETRY_MS), INTERVAL]);
    expect(pace).toEqual(steady);
  });

  it.each(["core_aborted", "flush_failed", "contract_breach"] as const)(
    "keeps the interval for a %s cycle when steady, so an outage doesn't speed the loop up",
    (outcome) => {
      expect(nextSyncPace(steady, outcome, INTERVAL)).toEqual({ pace: steady, delayMs: INTERVAL });
    },
  );

  it("never retries slower than the interval itself", () => {
    expect(nextSyncPace(steady, "core_partial", 30_000).delayMs).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// runSyncLoop
// ---------------------------------------------------------------------------

describe("runSyncLoop", () => {
  it("calls onCycle immediately (before the first interval elapses)", async () => {
    const onCycle = vi.fn().mockResolvedValue("ok");

    const handle = runSyncLoop(onCycle, 10_000); // very long interval — should never fire

    // Yield one microtask turn so the async IIFE's first `await onCycle()` resolves
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(onCycle).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it("calls onCycle multiple times across short intervals then stabilises after stop()", async () => {
    const onCycle = vi.fn().mockResolvedValue("ok");

    const INTERVAL = 15; // ms — small enough to get ≥2 calls quickly

    const handle = runSyncLoop(onCycle, INTERVAL);

    // Wait long enough for at least 2 cycles to complete (first immediate + 1 interval)
    await new Promise<void>((r) => setTimeout(r, INTERVAL * 3));

    const countBeforeStop = onCycle.mock.calls.length;
    expect(countBeforeStop).toBeGreaterThanOrEqual(2);

    handle.stop();

    // Wait one more interval — count must not grow after stop()
    await new Promise<void>((r) => setTimeout(r, INTERVAL * 2));

    expect(onCycle.mock.calls.length).toBe(countBeforeStop);
  });

  it("does not kill the loop when onCycle throws", async () => {
    let callCount = 0;
    const onCycle = vi.fn().mockImplementation(async () => {
      callCount++;
      throw new Error("sync failed");
    });

    const INTERVAL = 15;
    const handle = runSyncLoop(onCycle, INTERVAL);

    // Give it time for multiple failing cycles
    await new Promise<void>((r) => setTimeout(r, INTERVAL * 3));

    expect(callCount).toBeGreaterThanOrEqual(2);

    handle.stop();
  });

  it("stop() aborts the in-flight wait promptly, with no extra onCycle calls", async () => {
    const onCycle = vi.fn().mockResolvedValue("ok");

    const INTERVAL = 500; // long interval — only the immediate call should fire

    const handle = runSyncLoop(onCycle, INTERVAL);

    // Wait for the first immediate cycle, then stop before the next interval fires
    await new Promise<void>((r) => setTimeout(r, 20));
    handle.stop();

    const countAfterStop = onCycle.mock.calls.length;
    expect(countAfterStop).toBe(1);

    // Wait well past the interval — confirm the count is still 1
    await new Promise<void>((r) => setTimeout(r, INTERVAL + 50));
    expect(onCycle.mock.calls.length).toBe(1);
  });
});
