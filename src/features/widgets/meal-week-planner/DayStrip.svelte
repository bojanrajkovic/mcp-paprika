<script lang="ts">
  // The week header: a prev/next nav row with the week's date range, above a 7-chip day
  // strip (Monday → Sunday). Each chip shows the weekday abbreviation, the date number, and
  // a presence dot when that day has at least one planned meal; today gets the accent fill,
  // the selected day a hover-tint. Purely presentational — all date arithmetic and the
  // ±4-week clamp live in App; this renders `weekDates` and reports taps. The nav arrows
  // disable at the clamp boundary or while a re-fetch is in flight (`busy`).
  import NavButton from "./NavButton.svelte";

  // One display-ready day from App's `dayInfos` — the formatting lives once in App.
  interface DayInfo {
    iso: string;
    abbr: string;
    num: number;
  }

  let {
    weekLabel,
    days,
    selectedDate,
    todayDate,
    hasActivity,
    canPrev,
    canNext,
    busy,
    onPrev,
    onNext,
    onSelect,
  }: {
    weekLabel: string;
    days: DayInfo[];
    selectedDate: string;
    todayDate: string;
    hasActivity: Set<string>;
    canPrev: boolean;
    canNext: boolean;
    busy: boolean;
    onPrev: () => void;
    onNext: () => void;
    onSelect: (iso: string) => void;
  } = $props();
</script>

<nav class="week-nav">
  <NavButton
    dir="prev"
    disabled={!canPrev || busy}
    ariaLabel="Previous week"
    onclick={onPrev}
  />
  <span class="wn-label">{weekLabel}</span>
  <NavButton
    dir="next"
    disabled={!canNext || busy}
    ariaLabel="Next week"
    onclick={onNext}
  />
</nav>

<div class="day-strip">
  {#each days as day (day.iso)}
    <button
      class="day-chip"
      class:today={day.iso === todayDate}
      class:sel={day.iso === selectedDate}
      aria-current={day.iso === selectedDate ? "date" : undefined}
      onclick={() => onSelect(day.iso)}
    >
      <span class="dc-name">{day.abbr}</span>
      <span class="dc-num">{day.num}</span>
      <span class="dc-dot" class:on={hasActivity.has(day.iso)}></span>
    </button>
  {/each}
</div>

<style>
  /* flex: none — fixed chrome (see App): the day strip never shrinks, so SlotPane's scroll region
     absorbs the overflow at the host-height cap. */
  /* The nav row and the day strip are one semantic unit ("which week, which day"): no
     separator between them, and the strip pulls up close so the pair reads as one calendar
     block between the header hairline above and the strip hairline below. */
  .week-nav {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px 2px;
  }
  .wn-label {
    font-size: 13px;
    color: var(--muted);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .day-strip {
    flex: none;
    display: flex;
    padding: 4px 12px 6px;
    gap: 4px;
    border-bottom: 1px solid var(--line);
  }
  .day-chip {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    cursor: pointer;
    padding: 6px 2px 8px;
    border-radius: 10px;
    transition: background 0.1s;
    border: none;
    background: transparent;
    font: inherit;
  }
  @media (hover: hover) {
    .day-chip:hover {
      background: var(--hover);
    }
  }
  .day-chip:active {
    background: var(--hover);
  }
  .day-chip.sel {
    background: var(--hover);
  }
  .day-chip:focus-visible {
    outline-offset: -2px;
  }
  .dc-name {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    letter-spacing: 0.03em;
  }
  .dc-num {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    font-variant-numeric: tabular-nums;
  }
  .day-chip.today .dc-name {
    color: var(--accent);
  }
  .day-chip.today .dc-num {
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: 50%;
  }
  .day-chip.sel .dc-name {
    color: var(--ink);
  }
  /* Presence dot: a fixed 4px box so chips with and without a meal align; the visible dot
     toggles via `.on` so an empty day reserves the same height. Full accent — it is a real
     signal ("this day has meals"), and a 4px dot dimmed to half opacity disappears on a
     phone in daylight; quietness comes from its size. */
  .dc-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: transparent;
  }
  .dc-dot.on {
    background: var(--accent);
  }
</style>
