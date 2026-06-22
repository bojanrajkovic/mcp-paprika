<script lang="ts">
  // The week header: a prev/next nav row with the week's date range, above a 7-chip day
  // strip (Monday → Sunday). Each chip shows the weekday abbreviation, the date number, and
  // a presence dot when that day has at least one planned meal; today gets the accent fill,
  // the selected day a hover-tint. Purely presentational — all date arithmetic and the
  // ±4-week clamp live in App; this renders `weekDates` and reports taps. The nav arrows
  // disable at the clamp boundary or while a re-fetch is in flight (`busy`).
  let {
    weekLabel,
    weekDates,
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
    weekDates: string[];
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

  // Display-only formatting of each ISO day (UTC, to match the server's day-granular
  // dates); the week arithmetic that produced `weekDates` stays in App.
  const parse = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
  const abbr = (iso: string): string =>
    parse(iso).toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: "UTC",
    });
  const num = (iso: string): number => parse(iso).getUTCDate();
</script>

<nav class="week-nav">
  <button
    class="wn-btn"
    onclick={onPrev}
    disabled={!canPrev || busy}
    aria-label="Previous week"
  >
    <svg viewBox="0 0 16 16" aria-hidden="true"
      ><path d="M10 3.5 5.5 8l4.5 4.5" /></svg
    >
  </button>
  <span class="wn-label">{weekLabel}</span>
  <button
    class="wn-btn"
    onclick={onNext}
    disabled={!canNext || busy}
    aria-label="Next week"
  >
    <svg viewBox="0 0 16 16" aria-hidden="true"
      ><path d="M6 3.5 10.5 8 6 12.5" /></svg
    >
  </button>
</nav>

<div class="day-strip">
  {#each weekDates as iso (iso)}
    <button
      class="day-chip"
      class:today={iso === todayDate}
      class:sel={iso === selectedDate}
      aria-current={iso === selectedDate ? "date" : undefined}
      onclick={() => onSelect(iso)}
    >
      <span class="dc-name">{abbr(iso)}</span>
      <span class="dc-num">{num(iso)}</span>
      <span class="dc-dot" class:on={hasActivity.has(iso)}></span>
    </button>
  {/each}
</div>

<style>
  /* flex: none — see the SlotPane/App note: these rows size to content and overflow the shell's
     viewport cap visibly so the host's max-content autoResize measures the true height. */
  .week-nav {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border-bottom: 1px solid var(--line);
  }
  .wn-btn {
    appearance: none;
    background: var(--bg);
    border: 1px solid color-mix(in oklch, var(--ink) 22%, transparent);
    border-radius: 999px;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--ink);
    transition: background 0.1s;
  }
  .wn-btn:hover:not(:disabled) {
    background: var(--hover);
  }
  .wn-btn:disabled {
    color: var(--faint);
    cursor: default;
    border-color: transparent;
  }
  .wn-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .wn-btn svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
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
    padding: 10px 12px 6px;
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
  .day-chip:hover {
    background: var(--hover);
  }
  .day-chip.sel {
    background: var(--hover);
  }
  .day-chip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .dc-name {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    letter-spacing: 0.02em;
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
     toggles via `.on` so an empty day reserves the same height. */
  .dc-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: transparent;
  }
  .dc-dot.on {
    background: var(--accent);
    opacity: 0.5;
  }
  .day-chip.sel .dc-dot.on,
  .day-chip.today .dc-dot.on {
    opacity: 1;
  }
</style>
