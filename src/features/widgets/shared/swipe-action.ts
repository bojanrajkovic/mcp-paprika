/**
 * The pointer-swipe response layer shared by the pantry's swipe-to-remove and the grocery
 * checklist's swipe-to-check. Both drive PointerEvent-based drags with the SAME
 * response physics — the armed pop + haptic tick at the commit threshold, the mid-drag lift
 * shadow, and a weighted settle on an uncommitted release — so this factory wraps
 * createSwipeRecognizer (the gesture math) plus that shared DOM wiring and response, leaving only
 * what genuinely differs per widget as config: direction/resist/armPx/flick (already SwipeConfig),
 * the transform a committed release eases toward before commit() fires (pantry's row exits to
 * -110%; grocery's row stays in the list and eases back to 0 — see commitTransform), and whether
 * the swipe needs to suppress its own post-drag synthetic click (pantry's row wraps separate
 * button targets a stray click could activate; grocery's row IS the button, and its own
 * tapThrottled debounce already absorbs a same-handler double-fire).
 *
 * The meal-week-planner's day pager is NOT a consumer: it's TouchEvent-based (needs
 * touches.length for its multi-touch check) with a wholly different response (pane translate +
 * spring-back class, no armed/haptic/click-suppression at all) — that divergence is real, not
 * drift, so it stays wired directly to createSwipeRecognizer in SlotPane.svelte.
 */
import { motion } from "./motion.js";
import { createSwipeRecognizer, type SwipeConfig } from "./swipe-gesture.js";

export interface SwipeActionConfig extends SwipeConfig {
  /** The transform a committed release eases toward before `commit()` fires. `"translateX(-110%)"`
   *  for a row that exits the list (the reveal fills the slot as it leaves); `""` for a row that
   *  stays and just needs to settle to rest before the state change lands. */
  commitTransform: string;
  /** Wire post-drag click suppression — for a swipe wrapping a non-button ancestor with its own
   *  clickable children. Omit when the swipe wraps the interactive element itself (its click and
   *  commit() already target the same handler, and an existing debounce absorbs the double-fire). */
  suppressClick?: boolean;
}

export interface SwipeActionParams {
  enabled: boolean;
  commit: () => void;
  /** Fires as the drag crosses the commit threshold — the reveal's armed pop + haptic tick. */
  arm: (on: boolean) => void;
  /** Fires as the drag engages/disengages — the mid-drag lift shadow. */
  drag: (on: boolean) => void;
}

/** Builds a Svelte action bound to one static config (direction, thresholds, commit transform);
 *  the returned action still takes the per-row reactive params (enabled/commit/arm/drag) at each
 *  `use:` site. */
export function createSwipeAction(config: SwipeActionConfig) {
  return function swipe(node: HTMLElement, param: SwipeActionParams) {
    let p = param;
    const gesture = createSwipeRecognizer(config);
    let armed = false;
    let suppressClick = false; // a drag's release also synthesizes a click — swallow that one
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    // True from a committed release until commit() actually fires. gesture.release() resets
    // gesture.active synchronously, well before the eased commit transform finishes and commit()
    // runs — without this, a re-tap on the same row inside that window would pass down()'s
    // gesture.active guard and clearTimeout the pending commit, silently dropping it.
    let committing = false;

    const setArmed = (on: boolean) => {
      if (armed === on) return;
      armed = on;
      p.arm(on);
      // A physical tick as the row crosses the threshold — silently unavailable on hosts without
      // vibration (iOS Safari, permission-gated iframes), where the visual pop still carries it.
      if (on && typeof navigator.vibrate === "function") navigator.vibrate(10);
    };
    const down = (e: PointerEvent) => {
      // One primary pointer owns the gesture: a second finger or a non-left button never restarts
      // a drag mid-flight, and a synthetic pointer that can't be captured still tracks.
      if (!p.enabled || gesture.active || committing || !e.isPrimary || e.button !== 0) return;
      clearTimeout(settleTimer);
      node.style.transition = "";
      gesture.start(e.clientX, e.clientY, e.timeStamp);
      try {
        node.setPointerCapture(e.pointerId);
      } catch {
        // untrusted/synthetic pointers (tests) have no capturable id; bubbling still delivers moves
      }
    };
    const move = (e: PointerEvent) => {
      if (!gesture.active) return;
      if (!p.enabled) {
        // a capability flip or the item leaving mid-drag — abandon the gesture
        node.style.transform = "";
        gesture.cancel();
        p.drag(false);
        setArmed(false);
        return;
      }
      const wasEngaged = gesture.engaged;
      gesture.move(e.clientX, e.clientY, e.timeStamp);
      if (!wasEngaged && gesture.engaged) p.drag(true);
      // Resist past the commit threshold so the row can't be dragged fully off — enough to reveal
      // the action, not slide the whole row away. The row stays opaque; the action shows behind it.
      node.style.transform = `translateX(${gesture.dx.toString()}px)`;
      setArmed(Math.abs(gesture.dx) > config.armPx);
    };
    const settleBack = () => {
      // Released early: settle home with weight instead of snapping. The inline transition is
      // cleared afterward so the next drag tracks the finger with no lag.
      node.style.transition = `transform ${motion(180).toString()}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      node.style.transform = "";
      settleTimer = setTimeout(() => {
        node.style.transition = "";
      }, motion(200));
    };
    const up = () => {
      if (!gesture.active) return;
      const { committed, wasEngaged } = gesture.release();
      p.drag(false);
      setArmed(false);
      if (config.suppressClick) {
        // A release over a control (a hidden/visible action button) also fires a click; a real
        // drag's release must not double as an activation.
        suppressClick = wasEngaged;
      }
      if (committed) {
        // Ease to the commit transform, then commit — the visual settles (or exits) before the
        // state change lands, never a jump-cut.
        node.style.transition = `transform ${motion(130).toString()}ms cubic-bezier(0.25, 1, 0.5, 1)`;
        node.style.transform = config.commitTransform;
        committing = true;
        settleTimer = setTimeout(() => {
          committing = false;
          p.commit();
        }, motion(130));
      } else if (wasEngaged) {
        settleBack();
      } else {
        node.style.transform = "";
      }
    };
    const click = (e: MouseEvent) => {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
      }
      suppressClick = false;
    };
    const cancel = () => {
      // The browser took the gesture (a scroll won) — settle back, and never commit from a cancel.
      if (!gesture.active) return;
      const wasEngaged = gesture.engaged;
      gesture.cancel();
      p.drag(false);
      setArmed(false);
      if (wasEngaged) settleBack();
      else node.style.transform = "";
    };
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", cancel);
    // capture: swallow the post-drag click first — only wired when the widget asks for it.
    if (config.suppressClick) node.addEventListener("click", click, true);
    return {
      update(next: SwipeActionParams) {
        p = next;
      },
      destroy() {
        clearTimeout(settleTimer);
        node.removeEventListener("pointerdown", down);
        node.removeEventListener("pointermove", move);
        node.removeEventListener("pointerup", up);
        node.removeEventListener("pointercancel", cancel);
        node.removeEventListener("click", click, true); // no-op if never registered
      },
    };
  };
}
