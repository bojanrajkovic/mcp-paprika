import { describe, expect, it, vi } from "vitest";

import type { AnySyncResult } from "../paprika/sync-types.js";

import { makeStubNotifier } from "../../test/support/tool-test-utils.js";
import { notifyFromResults, runSyncLoop } from "./sync-loop.js";

// ---------------------------------------------------------------------------
// notifyFromResults
// ---------------------------------------------------------------------------

describe("notifyFromResults", () => {
  it("fires resourceListChanged once per qualifying result", () => {
    const { notifier, resourceListChanged } = makeStubNotifier();

    const results = [
      { changeType: "recipes", changes: { added: [{}], updated: [], removedUids: [] } },
      { changeType: "grocery-lists", changes: { added: [], updated: [{}], removedUids: [] } },
      { changeType: "grocery-items", changes: { added: [], updated: [], removedUids: ["x"] } },
      { changeType: "menus", changes: { added: [{}], updated: [], removedUids: [] } },
      { changeType: "menu-items", changes: { added: [], updated: [{}], removedUids: [] } },
    ] as unknown as ReadonlyArray<AnySyncResult>;

    notifyFromResults(results, notifier);

    expect(resourceListChanged).toHaveBeenCalledTimes(5);
  });

  it("skips a pantry changeType entirely", () => {
    const { notifier, resourceListChanged } = makeStubNotifier();

    const results = [
      { changeType: "pantry", changes: { added: [{}], updated: [{}], removedUids: ["y"] } },
    ] as unknown as ReadonlyArray<AnySyncResult>;

    notifyFromResults(results, notifier);

    expect(resourceListChanged).not.toHaveBeenCalled();
  });

  it("skips a qualifying changeType whose changes are all empty", () => {
    const { notifier, resourceListChanged } = makeStubNotifier();

    const results = [
      { changeType: "recipes", changes: { added: [], updated: [], removedUids: [] } },
      { changeType: "grocery-lists", changes: { added: [], updated: [], removedUids: [] } },
    ] as unknown as ReadonlyArray<AnySyncResult>;

    notifyFromResults(results, notifier);

    expect(resourceListChanged).not.toHaveBeenCalled();
  });

  it("fans out nothing for an empty results array", () => {
    const { notifier, resourceListChanged } = makeStubNotifier();

    notifyFromResults([], notifier);

    expect(resourceListChanged).not.toHaveBeenCalled();
  });

  it("fires for added, updated, and removedUids independently", () => {
    const { notifier, resourceListChanged } = makeStubNotifier();

    // One result with only `added`, one with only `updated`, one with only `removedUids`
    const results = [
      { changeType: "recipes", changes: { added: [{}], updated: [], removedUids: [] } },
      { changeType: "menus", changes: { added: [], updated: [{}], removedUids: [] } },
      { changeType: "menu-items", changes: { added: [], updated: [], removedUids: ["z"] } },
    ] as unknown as ReadonlyArray<AnySyncResult>;

    notifyFromResults(results, notifier);

    expect(resourceListChanged).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// runSyncLoop
// ---------------------------------------------------------------------------

describe("runSyncLoop", () => {
  it("calls onCycle immediately (before the first interval elapses)", async () => {
    const onCycle = vi.fn().mockResolvedValue(undefined);

    const handle = runSyncLoop(onCycle, 10_000); // very long interval — should never fire

    // Yield one microtask turn so the async IIFE's first `await onCycle()` resolves
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(onCycle).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it("calls onCycle multiple times across short intervals then stabilises after stop()", async () => {
    const onCycle = vi.fn().mockResolvedValue(undefined);

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
    const onCycle = vi.fn().mockResolvedValue(undefined);

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
