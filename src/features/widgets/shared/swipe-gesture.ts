/**
 * The touch-gesture recognizer CORE shared by the pantry's swipe-to-remove, the grocery
 * checklist's swipe-to-check, and the meal-week-planner's day pager. It owns the
 * slop gate, the optional dominant-axis lock, drag tracking, the distance-or-flick commit
 * decision, and cancel/abandon discipline — the mechanics that were hand-rolled three times and
 * drifted (PR #29's review caught the pager missing a guard the pantry version already had).
 *
 * Deliberately DOM- and framework-agnostic: pantry/grocery drive it from `PointerEvent`, the
 * pager from `TouchEvent` (it needs `touches.length` for its multi-touch check) — forcing one
 * event model onto all three would be a bigger change than the ticket asks for. A caller feeds
 * raw `(x, y, t)` samples from whichever event it has; the DOM wiring (pointer capture, which
 * pointer/touch owns the gesture, `touchend` vs `pointerup`) and the gesture RESPONSE (row
 * reveal, armed pop + haptic, sweep-off, day-pane translate, spring-back) stay per-widget.
 *
 * `direction`/`resist`/`armPx`/`flick` differ per caller by design (the ticket's own example:
 * 56px/0.35 vs 80px/0.8) — `SWIPE_SLOP_PX` is the one constant genuinely identical across all
 * three today. Two deliberate consolidations onto the already-hardened pantry algorithm ride
 * along: velocity is always the RECENT (last-sample) rate rather than the pager's old
 * elapsed-average, and `cancel()` never commits — a caller that previously routed a cancel event
 * through its commit path (grocery's `pointercancel`) is fixed by construction.
 */

export const SWIPE_SLOP_PX = 8;

export interface SwipeConfig {
  /** "x": ignore vertical movement entirely (a row swipe; CSS `touch-action: pan-y` already owns
   *  vertical scroll). "auto": lock to whichever axis crosses the slop first (the day pager, which
   *  has no per-axis CSS split to lean on). */
  axis: "x" | "auto";
  direction: "left" | "right" | "both";
  /** Maps the raw delta since gesture start to the value the caller renders — a rubber-band clamp
   *  (pantry/grocery) or a damping scale (the pager). */
  resist: (rawDx: number) => number;
  armPx: number;
  /** A fast flick commits from a smaller distance than `armPx`; omit for distance-only commit. */
  flick?: { px: number; velocityPxMs: number };
}

export interface SwipeRelease {
  committed: boolean;
  /** Whether the gesture ever crossed the slop gate — a caller uses this to decide between a
   *  settle-back animation and a no-op (and, for a button target, whether to suppress the
   *  following synthetic click). */
  wasEngaged: boolean;
  dx: number;
}

export interface SwipeRecognizer {
  /** A gesture is in progress (from `start()` until `release()`/`cancel()`) — the guard a caller
   *  uses to ignore a second pointer/touch while the first one owns the gesture. */
  readonly active: boolean;
  /** Past the slop gate — the caller's cue to start showing drag visuals. */
  readonly engaged: boolean;
  readonly dx: number;
  start(x: number, y: number, t: number): void;
  move(x: number, y: number, t: number): void;
  release(): SwipeRelease;
  /** Resets with no commit — the one path for a `pointercancel`/`touchcancel` and a multi-touch
   *  abort alike. */
  cancel(): void;
}

export function createSwipeRecognizer(config: SwipeConfig): SwipeRecognizer {
  let active = false;
  let engaged = false;
  let lockedOut = false; // "auto" axis resolved to vertical — this gesture never engages
  let x0 = 0;
  let y0 = 0;
  let dx = 0;
  let vx = 0;
  let lastX = 0;
  let lastT = 0;

  function signOk(d: number): boolean {
    if (config.direction === "left") return d < 0;
    if (config.direction === "right") return d > 0;
    return d !== 0;
  }

  function reset(): void {
    active = false;
    engaged = false;
    lockedOut = false;
    dx = 0;
    vx = 0;
  }

  return {
    get active() {
      return active;
    },
    get engaged() {
      return engaged;
    },
    get dx() {
      return dx;
    },
    start(x, y, t) {
      active = true;
      engaged = false;
      lockedOut = false;
      x0 = x;
      y0 = y;
      dx = 0;
      vx = 0;
      lastX = x;
      lastT = t;
    },
    move(x, y, t) {
      if (!active || lockedOut) return;
      const rawDx = x - x0;
      if (!engaged) {
        if (config.axis === "auto") {
          const rawDy = y - y0;
          if (Math.abs(rawDx) < SWIPE_SLOP_PX && Math.abs(rawDy) < SWIPE_SLOP_PX) return; // undecided
          if (Math.abs(rawDy) > Math.abs(rawDx)) {
            lockedOut = true; // vertical wins — hand the rest of this gesture to native scroll
            return;
          }
        } else if (Math.abs(rawDx) < SWIPE_SLOP_PX) {
          return; // undecided: let touch-action own a vertical pan
        }
        engaged = true;
      }
      const dt = t - lastT;
      if (dt > 0) vx = (x - lastX) / dt;
      lastX = x;
      lastT = t;
      dx = config.resist(rawDx);
    },
    release() {
      const wasEngaged = engaged;
      const committed =
        engaged &&
        signOk(dx) &&
        (Math.abs(dx) > config.armPx ||
          (config.flick !== undefined &&
            Math.sign(vx) === Math.sign(dx) &&
            Math.abs(dx) > config.flick.px &&
            Math.abs(vx) > config.flick.velocityPxMs));
      const result = { committed, wasEngaged, dx };
      reset();
      return result;
    },
    cancel() {
      reset();
    },
  };
}
