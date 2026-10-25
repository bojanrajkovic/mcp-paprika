import { tick } from "svelte";

import { reduced } from "./motion.js";

type ViewTransitionDoc = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => {
    finished: Promise<void>;
  };
};

// The most recent transition per `dirAttr` key.
const latest = new Map<string, object>();

/**
 * Run `mutate` inside a View Transition so a view swap MORPHS instead of hard-cutting. Degrades to an
 * instant `mutate()` where the API is absent (Firefox) or the user prefers reduced motion. Svelte
 * applies state on a microtask, so `mutate` runs inside the transition callback and `tick()` flushes
 * the pending DOM before the API captures the "after" frame.
 *
 * `dirAttr` (e.g. `["cookVt", "fwd"]`) sets `documentElement.dataset[key] = value` for the duration of
 * the transition, so directional `::view-transition` CSS can key on it (the cook flow's slide
 * direction); it is cleared when the transition finishes. Omit it for a plain cross-fade + shared
 * element morph (the recipe-browser's browse ↔ detail swap).
 *
 * Shared by the cooking flow (`nav`) and the recipe-browser (browse ↔ detail); the reduced-motion
 * gate, capability check, and `tick()`-flush live here once so the two can't drift.
 */
export function viewTransition(mutate: () => void, dirAttr?: readonly [key: string, value: string]): void {
  const doc = document as ViewTransitionDoc;
  if (reduced || typeof doc.startViewTransition !== "function") {
    mutate();
    return;
  }
  const token = {};
  if (dirAttr) {
    latest.set(dirAttr[0], token);
    document.documentElement.dataset[dirAttr[0]] = dirAttr[1];
  }
  const transition = doc.startViewTransition(async () => {
    mutate();
    await tick();
  });
  if (dirAttr) {
    // A new transition skips the running one, whose `finished` then settles while the new one is
    // still animating. Only the latest transition for a key may clear its attribute.
    const clear = (): void => {
      if (latest.get(dirAttr[0]) !== token) return;
      latest.delete(dirAttr[0]);
      delete document.documentElement.dataset[dirAttr[0]];
    };
    transition.finished.then(clear, clear);
  }
}
