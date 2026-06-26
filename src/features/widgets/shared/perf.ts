/**
 * Render-attribution marks. Label the widget boot timeline so the iframe's Performance
 * panel (User Timing track) and `performance.getEntriesByType("measure")` decompose the
 * host-placeholder window into parse/eval (timeOrigin → boot) vs handshake (boot → connected)
 * vs data delivery (connected → first-result) vs initial render (boot → mounted).
 *
 * Pure client-side measurement, read during a profile and reported back to the server. Browser
 * only (compiled by esbuild / svelte-check, never the node tsc), so `performance` is the DOM global.
 */
const PREFIX = "paprika-widget";

/** Mark a lifecycle milestone, prefixed so it stands out in the Performance timeline. */
export function perfMark(name: string): void {
  performance.mark(`${PREFIX}:${name}`);
}

/**
 * Name the interval between two marks (shows as a span in the User Timing track). Skips silently
 * when a mark is absent — milestone order can vary (a result can land before connect resolves).
 */
export function perfMeasure(name: string, start: string, end: string): void {
  const has = (m: string): boolean => performance.getEntriesByName(`${PREFIX}:${m}`, "mark").length > 0;
  if (has(start) && has(end)) {
    performance.measure(`${PREFIX}:${name}`, `${PREFIX}:${start}`, `${PREFIX}:${end}`);
  }
}
