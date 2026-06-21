/**
 * Reduced-motion gate for JS-driven Svelte transitions (`slide`/`fly`/`fade`) and animation
 * durations. Svelte's JS transitions are NOT CSS transitions, so a `@media (prefers-reduced-motion:
 * reduce)` block does not disable them — the duration must be gated in JS. Read the media query once
 * and pass `motion(N)` as the duration: 0 when the user asked for reduced motion, N otherwise.
 */
export const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const motion = (ms: number): number => (reduced ? 0 : ms);
