/**
 * Unit tests for `createSwipeAction` — the pointer-DOM wiring and response physics (armed pop,
 * drag shadow, weighted settle, commit-transform, optional click suppression) shared by the
 * pantry's swipe-to-remove and the grocery checklist's swipe-to-check.
 *
 * Browser tier: excluded from node-side tsconfigs, typechecked by `tsconfig.widgets.json`. A fake
 * node stands in for the DOM element — it only needs `style`, `addEventListener`/
 * `removeEventListener` (captured into a map so a test can invoke a handler directly), and
 * `setPointerCapture` (the source already try/catches a throwing one, but a no-op is closer to a
 * real host). Fake timers control the motion()-gated settle/commit delays.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSwipeAction, type SwipeActionParams } from "./swipe-action.js";

function fakeNode() {
  const listeners = new Map<string, EventListener>();
  return {
    style: {} as { transform: string; transition: string },
    listeners,
    addEventListener(type: string, fn: EventListener) {
      listeners.set(type, fn);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
    setPointerCapture() {
      // no-op — a real host captures the pointer; the handler under test doesn't depend on it
    },
  };
}

function pointerEvent(over: Partial<PointerEvent>): PointerEvent {
  return { clientX: 0, clientY: 0, timeStamp: 0, isPrimary: true, button: 0, pointerId: 1, ...over } as PointerEvent;
}

function fakeParams(over: Partial<SwipeActionParams> = {}): SwipeActionParams {
  return { enabled: true, commit: vi.fn(), arm: vi.fn(), drag: vi.fn(), ...over };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const leftConfig = {
  axis: "x" as const,
  direction: "left" as const,
  resist: (raw: number) => Math.max(-120, Math.min(0, raw)),
  armPx: 80,
  flick: { px: 40, velocityPxMs: 0.8 },
  commitTransform: "translateX(-110%)",
  suppressClick: true,
};

const rightConfig = {
  axis: "x" as const,
  direction: "right" as const,
  resist: (raw: number) => Math.max(0, Math.min(120, raw)),
  armPx: 80,
  commitTransform: "",
};

describe("createSwipeAction — DOM wiring", () => {
  it("registers pointer listeners, and a click listener only when suppressClick is set", () => {
    const swipe = createSwipeAction(leftConfig);
    const node = fakeNode();
    swipe(node as unknown as HTMLElement, fakeParams());
    expect(node.listeners.has("pointerdown")).toBe(true);
    expect(node.listeners.has("pointermove")).toBe(true);
    expect(node.listeners.has("pointerup")).toBe(true);
    expect(node.listeners.has("pointercancel")).toBe(true);
    expect(node.listeners.has("click")).toBe(true);

    const noClickSwipe = createSwipeAction(rightConfig);
    const node2 = fakeNode();
    noClickSwipe(node2 as unknown as HTMLElement, fakeParams());
    expect(node2.listeners.has("click")).toBe(false);
  });
});

describe("createSwipeAction — drag and arm callbacks", () => {
  it("fires drag(true) once the gesture engages, and arm(true) past the threshold", () => {
    const drag = vi.fn();
    const arm = vi.fn();
    const swipe = createSwipeAction(leftConfig);
    const node = fakeNode();
    swipe(node as unknown as HTMLElement, fakeParams({ drag, arm }));
    const down = node.listeners.get("pointerdown")!;
    const move = node.listeners.get("pointermove")!;

    down(pointerEvent({ clientX: 0, timeStamp: 0 }) as unknown as Event);
    move(pointerEvent({ clientX: -10, timeStamp: 5 }) as unknown as Event); // past slop, engaged
    expect(drag).toHaveBeenCalledWith(true);
    expect(arm).not.toHaveBeenCalledWith(true);

    move(pointerEvent({ clientX: -90, timeStamp: 10 }) as unknown as Event); // past the 80px arm
    expect(arm).toHaveBeenCalledWith(true);
    expect(node.style.transform).toBe("translateX(-90px)");
  });

  it("clears drag and arm on release", () => {
    const drag = vi.fn();
    const arm = vi.fn();
    const commit = vi.fn();
    const swipe = createSwipeAction(leftConfig);
    const node = fakeNode();
    swipe(node as unknown as HTMLElement, fakeParams({ drag, arm, commit }));
    node.listeners.get("pointerdown")!(pointerEvent({ clientX: 0, timeStamp: 0 }) as unknown as Event);
    node.listeners.get("pointermove")!(pointerEvent({ clientX: -90, timeStamp: 10 }) as unknown as Event);
    node.listeners.get("pointerup")!(pointerEvent({ clientX: -90, timeStamp: 10 }) as unknown as Event);
    expect(drag).toHaveBeenLastCalledWith(false);
    expect(arm).toHaveBeenLastCalledWith(false);
  });
});

describe("createSwipeAction — commit", () => {
  it("eases to commitTransform, then calls commit() after the motion delay", () => {
    const commit = vi.fn();
    const swipe = createSwipeAction(leftConfig);
    const node = fakeNode();
    swipe(node as unknown as HTMLElement, fakeParams({ commit }));
    node.listeners.get("pointerdown")!(pointerEvent({ clientX: 0, timeStamp: 0 }) as unknown as Event);
    node.listeners.get("pointermove")!(pointerEvent({ clientX: -90, timeStamp: 10 }) as unknown as Event);
    node.listeners.get("pointerup")!(pointerEvent({ clientX: -90, timeStamp: 10 }) as unknown as Event);

    expect(node.style.transform).toBe("translateX(-110%)");
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(130);
    expect(commit).toHaveBeenCalledOnce();
  });

  it("a re-tap during the commit-ease window does not cancel the pending commit", () => {
    // gesture.release() resets gesture.active synchronously, well before the eased commit
    // transform finishes and commit() actually fires — a naive re-entry guard on gesture.active
    // alone would let a re-tap in that window clearTimeout the pending commit and silently drop
    // it. The `committing` flag closes that window.
    const commit = vi.fn();
    const swipe = createSwipeAction(leftConfig);
    const node = fakeNode();
    swipe(node as unknown as HTMLElement, fakeParams({ commit }));
    node.listeners.get("pointerdown")!(pointerEvent({ clientX: 0, timeStamp: 0 }) as unknown as Event);
    node.listeners.get("pointermove")!(pointerEvent({ clientX: -90, timeStamp: 10 }) as unknown as Event);
    node.listeners.get("pointerup")!(pointerEvent({ clientX: -90, timeStamp: 10 }) as unknown as Event);

    // Re-tap inside the ~130ms commit-ease window, before the delayed commit() has fired.
    node.listeners.get("pointerdown")!(pointerEvent({ clientX: -90, timeStamp: 20 }) as unknown as Event);
    node.listeners.get("pointermove")!(pointerEvent({ clientX: -50, timeStamp: 25 }) as unknown as Event);

    vi.advanceTimersByTime(130);
    expect(commit).toHaveBeenCalledOnce();
  });

  it("a row that stays (commitTransform '') eases back to rest instead of exiting", () => {
    const commit = vi.fn();
    const swipe = createSwipeAction(rightConfig);
    const node = fakeNode();
    swipe(node as unknown as HTMLElement, fakeParams({ commit }));
    node.listeners.get("pointerdown")!(pointerEvent({ clientX: 0, timeStamp: 0 }) as unknown as Event);
    node.listeners.get("pointermove")!(pointerEvent({ clientX: 90, timeStamp: 10 }) as unknown as Event);
    node.listeners.get("pointerup")!(pointerEvent({ clientX: 90, timeStamp: 10 }) as unknown as Event);

    expect(node.style.transform).toBe("");
    vi.advanceTimersByTime(130);
    expect(commit).toHaveBeenCalledOnce();
  });
});

describe("createSwipeAction — settle back", () => {
  it("settles to rest without committing when released short of the threshold", () => {
    const commit = vi.fn();
    const swipe = createSwipeAction(leftConfig);
    const node = fakeNode();
    swipe(node as unknown as HTMLElement, fakeParams({ commit }));
    node.listeners.get("pointerdown")!(pointerEvent({ clientX: 0, timeStamp: 0 }) as unknown as Event);
    node.listeners.get("pointermove")!(pointerEvent({ clientX: -30, timeStamp: 10 }) as unknown as Event);
    node.listeners.get("pointerup")!(pointerEvent({ clientX: -30, timeStamp: 10 }) as unknown as Event);

    expect(node.style.transform).toBe("");
    expect(node.style.transition).toContain("180ms");
    vi.advanceTimersByTime(200);
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("createSwipeAction — click suppression", () => {
  it("suppresses the post-drag synthetic click when configured", () => {
    const swipe = createSwipeAction(leftConfig);
    const node = fakeNode();
    swipe(node as unknown as HTMLElement, fakeParams());
    node.listeners.get("pointerdown")!(pointerEvent({ clientX: 0, timeStamp: 0 }) as unknown as Event);
    node.listeners.get("pointermove")!(pointerEvent({ clientX: -30, timeStamp: 10 }) as unknown as Event);
    node.listeners.get("pointerup")!(pointerEvent({ clientX: -30, timeStamp: 10 }) as unknown as Event);

    const click = node.listeners.get("click")!;
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    click({ preventDefault, stopPropagation } as unknown as Event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();

    // Only the click immediately after a drag is swallowed — a later plain click passes through.
    const preventDefault2 = vi.fn();
    click({ preventDefault: preventDefault2, stopPropagation: vi.fn() } as unknown as Event);
    expect(preventDefault2).not.toHaveBeenCalled();
  });
});

describe("createSwipeAction — cancel never commits", () => {
  it("settles back on a pointercancel without calling commit", () => {
    const commit = vi.fn();
    const swipe = createSwipeAction(leftConfig);
    const node = fakeNode();
    swipe(node as unknown as HTMLElement, fakeParams({ commit }));
    node.listeners.get("pointerdown")!(pointerEvent({ clientX: 0, timeStamp: 0 }) as unknown as Event);
    node.listeners.get("pointermove")!(pointerEvent({ clientX: -90, timeStamp: 10 }) as unknown as Event); // past armPx
    node.listeners.get("pointercancel")!(pointerEvent({ clientX: -90, timeStamp: 10 }) as unknown as Event);

    vi.advanceTimersByTime(200);
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("createSwipeAction — enabled guard", () => {
  it("ignores a pointerdown when enabled is false", () => {
    const drag = vi.fn();
    const swipe = createSwipeAction(leftConfig);
    const node = fakeNode();
    swipe(node as unknown as HTMLElement, fakeParams({ enabled: false, drag }));
    node.listeners.get("pointerdown")!(pointerEvent({ clientX: 0, timeStamp: 0 }) as unknown as Event);
    node.listeners.get("pointermove")!(pointerEvent({ clientX: -90, timeStamp: 10 }) as unknown as Event);
    expect(drag).not.toHaveBeenCalled();
    expect(node.style.transform).toBeUndefined();
  });

  it("ignores a non-primary pointer or a non-left button", () => {
    const swipe = createSwipeAction(leftConfig);
    const node = fakeNode();
    swipe(node as unknown as HTMLElement, fakeParams());
    node.listeners.get("pointerdown")!(pointerEvent({ isPrimary: false }) as unknown as Event);
    node.listeners.get("pointermove")!(pointerEvent({ clientX: -90, timeStamp: 10 }) as unknown as Event);
    expect(node.style.transform).toBeUndefined();

    node.listeners.get("pointerdown")!(pointerEvent({ button: 2 }) as unknown as Event);
    node.listeners.get("pointermove")!(pointerEvent({ clientX: -90, timeStamp: 10 }) as unknown as Event);
    expect(node.style.transform).toBeUndefined();
  });
});
