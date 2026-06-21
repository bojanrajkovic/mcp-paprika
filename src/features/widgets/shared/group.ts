/**
 * Group a pre-ordered item list into runs of consecutive same-key rows — the grouping primitive both
 * checklist widgets share. The caller orders/filters first (grocery feeds server walk-order; pantry
 * filters in-stock and sorts by aisle), so this only walks the list and starts a new group whenever
 * the key changes. Generic over the key (an aisle name today; a date for the meal-plan board) — the
 * key is whatever the caller computes per item.
 */
export function groupConsecutive<T>(items: readonly T[], keyOf: (item: T) => string): { key: string; items: T[] }[] {
  const out: { key: string; items: T[] }[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(item);
    else out.push({ key, items: [item] });
  }
  return out;
}
