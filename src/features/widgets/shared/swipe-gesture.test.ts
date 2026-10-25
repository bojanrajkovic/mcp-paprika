/**
 * Unit tests for `createSwipeRecognizer` — the shared slop/axis/commit core behind the
 * pantry's swipe-to-remove, the grocery checklist's swipe-to-check, and the meal-week-planner's
 * day pager. Each widget's own config is exercised here directly, plus the two
 * consolidations the extraction makes (recent-velocity flick, cancel never commits).
 *
 * Browser tier: excluded from node-side tsconfigs, typechecked by `tsconfig.widgets.json`
 * (pure TS, no DOM needed).
 */
import { describe, expect, it } from "vitest";

import { createSwipeRecognizer, SWIPE_SLOP_PX } from "./swipe-gesture.js";

const clampLeft = (raw: number) => Math.max(-120, Math.min(0, raw));
const clampRight = (raw: number) => Math.max(0, Math.min(120, raw));
const damp = (raw: number) => raw * 0.55;

describe("createSwipeRecognizer — slop gate", () => {
  it("stays disengaged below SWIPE_SLOP_PX", () => {
    const r = createSwipeRecognizer({ axis: "x", direction: "left", resist: clampLeft, armPx: 80 });
    r.start(0, 0, 0);
    r.move(-(SWIPE_SLOP_PX - 1), 0, 10);
    expect(r.engaged).toBe(false);
    expect(r.dx).toBe(0);
  });

  it("engages once the horizontal delta crosses the slop", () => {
    const r = createSwipeRecognizer({ axis: "x", direction: "left", resist: clampLeft, armPx: 80 });
    r.start(0, 0, 0);
    r.move(-SWIPE_SLOP_PX, 0, 10);
    expect(r.engaged).toBe(true);
  });

  it("axis: x ignores vertical movement entirely", () => {
    const r = createSwipeRecognizer({ axis: "x", direction: "left", resist: clampLeft, armPx: 80 });
    r.start(0, 0, 0);
    r.move(-SWIPE_SLOP_PX, 500, 10); // a large vertical component never blocks engagement
    expect(r.engaged).toBe(true);
  });
});

describe("createSwipeRecognizer — axis: auto (the day pager)", () => {
  const cfg = {
    axis: "auto" as const,
    direction: "both" as const,
    resist: damp,
    armPx: 56,
    flick: { px: 0, velocityPxMs: 0.35 },
  };

  it("locks to horizontal when the initial delta is x-dominant", () => {
    const r = createSwipeRecognizer(cfg);
    r.start(0, 0, 0);
    r.move(20, 5, 10);
    expect(r.engaged).toBe(true);
  });

  it("locks out (never engages) when the initial delta is y-dominant, handing off to native scroll", () => {
    const r = createSwipeRecognizer(cfg);
    r.start(0, 0, 0);
    r.move(5, 20, 10);
    expect(r.engaged).toBe(false);
    // A later horizontal move must not resurrect this gesture — the vertical lock is sticky.
    r.move(80, 20, 20);
    expect(r.engaged).toBe(false);
    expect(r.dx).toBe(0);
  });
});

describe("createSwipeRecognizer — resistance", () => {
  it("applies the caller's resist function to the raw delta", () => {
    const r = createSwipeRecognizer({ axis: "x", direction: "left", resist: clampLeft, armPx: 80 });
    r.start(0, 0, 0);
    r.move(-200, 0, 10); // past the -120 clamp floor
    expect(r.dx).toBe(-120);
  });
});

describe("createSwipeRecognizer — distance commit", () => {
  it("commits past armPx in the allowed direction (pantry: left)", () => {
    const r = createSwipeRecognizer({ axis: "x", direction: "left", resist: clampLeft, armPx: 80 });
    r.start(0, 0, 0);
    r.move(-90, 0, 10);
    expect(r.release()).toMatchObject({ committed: true, wasEngaged: true });
  });

  it("does not commit short of armPx", () => {
    const r = createSwipeRecognizer({ axis: "x", direction: "left", resist: clampLeft, armPx: 80 });
    r.start(0, 0, 0);
    r.move(-40, 0, 10);
    expect(r.release()).toMatchObject({ committed: false, wasEngaged: true });
  });

  it("never commits in the wrong direction, even past armPx worth of raw distance", () => {
    // grocery only commits rightward; resist clamps negative motion to 0, so dx never goes negative.
    const r = createSwipeRecognizer({ axis: "x", direction: "right", resist: clampRight, armPx: 80 });
    r.start(0, 0, 0);
    r.move(-200, 0, 10);
    expect(r.dx).toBe(0);
    expect(r.release().committed).toBe(false);
  });

  it("a release before any engagement is a no-op, not a commit", () => {
    const r = createSwipeRecognizer({ axis: "x", direction: "left", resist: clampLeft, armPx: 80 });
    r.start(0, 0, 0);
    r.move(-3, 0, 10); // under slop
    expect(r.release()).toMatchObject({ committed: false, wasEngaged: false });
  });
});

describe("createSwipeRecognizer — flick commit", () => {
  it("commits a fast flick short of armPx (pantry: 40px @ 0.8px/ms)", () => {
    const r = createSwipeRecognizer({
      axis: "x",
      direction: "left",
      resist: clampLeft,
      armPx: 80,
      flick: { px: 40, velocityPxMs: 0.8 },
    });
    r.start(0, 0, 0);
    r.move(-50, 0, 10); // 50px in 10ms = 5px/ms, well past the flick velocity
    expect(r.release().committed).toBe(true);
  });

  it("does not flick-commit below the flick distance floor", () => {
    const r = createSwipeRecognizer({
      axis: "x",
      direction: "left",
      resist: clampLeft,
      armPx: 80,
      flick: { px: 40, velocityPxMs: 0.8 },
    });
    r.start(0, 0, 0);
    r.move(-30, 0, 10); // fast, but under the 40px flick floor and under armPx
    expect(r.release().committed).toBe(false);
  });

  it("does not flick-commit on a fast move in the wrong direction", () => {
    const r = createSwipeRecognizer({
      axis: "x",
      direction: "left",
      resist: clampLeft,
      armPx: 80,
      flick: { px: 40, velocityPxMs: 0.8 },
    });
    r.start(0, 0, 0);
    r.move(50, 0, 10); // fast rightward — clamped to 0 by resist, never a leftward commit
    expect(r.dx).toBe(0);
    expect(r.release().committed).toBe(false);
  });

  it("uses RECENT velocity, not the elapsed average — a slow start then a late flick still commits", () => {
    const r = createSwipeRecognizer({
      axis: "auto",
      direction: "both",
      resist: damp,
      armPx: 56,
      flick: { px: 0, velocityPxMs: 0.35 },
    });
    r.start(0, 0, 0);
    r.move(10, 0, 100); // slow: 10px over 100ms — well under the average threshold
    r.move(30, 0, 110); // then a fast final 20px in 10ms — recent velocity is what's checked
    expect(r.release().committed).toBe(true);
  });
});

describe("createSwipeRecognizer — cancel never commits", () => {
  it("resets a fully-armed gesture with no commit", () => {
    const r = createSwipeRecognizer({ axis: "x", direction: "right", resist: clampRight, armPx: 80 });
    r.start(0, 0, 0);
    r.move(200, 0, 10); // past armPx
    r.cancel();
    expect(r.active).toBe(false);
    expect(r.dx).toBe(0);
    // A release() after cancel() reads a fresh, un-engaged gesture — no phantom commit survives.
    expect(r.release()).toMatchObject({ committed: false, wasEngaged: false });
  });
});

describe("createSwipeRecognizer — active", () => {
  it("is active only between start() and release()/cancel()", () => {
    const r = createSwipeRecognizer({ axis: "x", direction: "left", resist: clampLeft, armPx: 80 });
    expect(r.active).toBe(false);
    r.start(0, 0, 0);
    expect(r.active).toBe(true);
    r.release();
    expect(r.active).toBe(false);
  });
});
