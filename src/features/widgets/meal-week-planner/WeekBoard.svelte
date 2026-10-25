<script lang="ts">
  // The wide-host (≥640px) week view: the narrow view's meal-type spine unfolded across all
  // seven days — one band per meal type, seven day cells per band. The prev/next arrows flank
  // the sticky day-header row (the range label is redundant when every day header is visible).
  // A linked meal is a tap target → the inline recipe detail; a freeform meal is plain text;
  // an empty cell carries a quiet "+" that routes planning (with its exact meal-type + day) to
  // the assistant. Purely presentational, like DayStrip/SlotPane: App owns the data and fetches.
  import { quartOut } from "svelte/easing";
  import { fly } from "svelte/transition";

  import Chevron from "../shared/Chevron.svelte";
  import Spinner from "../shared/Spinner.svelte";
  import StatusScreen from "../shared/StatusScreen.svelte";
  import { motion } from "../shared/motion.js";
  import NavButton from "./NavButton.svelte";

  // The minimal meal shape a cell renders (a structural subset of App's Meal).
  interface CellMeal {
    uid: string;
    name: string;
    recipeUid: string | null;
  }
  // One meal-type band: its label plus the week's meals of that type, one cell per day.
  // `plannable: false` (the orphan "Meal" band) suppresses the empty-cell "+" — it isn't a
  // real meal type the assistant could plan for.
  interface Band {
    key: string;
    label: string;
    plannable: boolean;
    cells: CellMeal[][];
  }

  // `animKey` (the week start) re-creates the bands when the week changes; `dir` is the nav
  // direction, so the new week glides in from the side it lives on. The sticky header stays
  // OUTSIDE that key: re-creating it would drop keyboard focus from the arrow mid-interaction.
  // One display-ready day from App's `dayInfos` — the formatting lives once in App.
  interface DayInfo {
    iso: string;
    abbr: string;
    num: number;
    long: string;
  }

  let {
    days,
    todayDate,
    bands,
    animKey,
    dir,
    canPrev,
    canNext,
    busy,
    loadingUid,
    onPrev,
    onNext,
    onOpenRecipe,
    onPlan,
  }: {
    days: DayInfo[];
    todayDate: string;
    bands: Band[];
    animKey: string;
    dir: number;
    canPrev: boolean;
    canNext: boolean;
    busy: boolean;
    loadingUid: string | null;
    onPrev: () => void;
    onNext: () => void;
    onOpenRecipe: (meal: CellMeal) => void;
    onPlan: (label: string, dateIso: string) => void;
  } = $props();
</script>

<div class="board">
  <!-- Sticky header: arrows in the outer 28px gutters, day headers in the seven 1fr columns
       the band cells below share, so headers and cells stay column-aligned by construction. -->
  <div class="bd-head grid7">
    <NavButton
      dir="prev"
      disabled={!canPrev || busy}
      ariaLabel="Previous week"
      onclick={onPrev}
    />
    {#each days as day (day.iso)}
      <span
        class="bd-day"
        class:today={day.iso === todayDate}
        aria-current={day.iso === todayDate ? "date" : undefined}
      >
        <span class="bd-day-name">{day.abbr}</span>
        <span class="bd-day-num">{day.num}</span>
      </span>
    {/each}
    <NavButton
      dir="next"
      disabled={!canNext || busy}
      ariaLabel="Next week"
      onclick={onNext}
    />
  </div>

  {#key animKey}
    <div
      class="bands"
      class:busy
      aria-busy={busy}
      in:fly={{ x: dir * 20, duration: motion(180), easing: quartOut }}
    >
      {#if bands.length === 0}
        <!-- Same dead-end guard as the narrow pane's empty state, same shared home. -->
        <StatusScreen
          inline
          desc="No meal types yet. Plan a meal with your assistant and the slots appear here."
        />
      {/if}
      {#each bands as band (band.key)}
        <div class="bd-band grid7">
          <span class="bd-type">{band.label}</span>
          {#each band.cells as meals, i (days[i]?.iso ?? i)}
            <div class="bd-cell" class:today={days[i]?.iso === todayDate}>
              {#each meals as meal (meal.uid)}
                {#if meal.recipeUid}
                  <button
                    class="bd-meal"
                    onclick={() => onOpenRecipe(meal)}
                    disabled={loadingUid === meal.uid}
                    aria-busy={loadingUid === meal.uid}
                    aria-label={`${meal.name} — ${band.label}, ${days[i]?.long ?? ""}`}
                  >
                    <span class="bd-meal-name">{meal.name}</span>
                    {#if loadingUid === meal.uid}<Spinner size={11} />{:else}
                      <!-- The same tappable-vs-freeform cue the narrow slot rows use. -->
                      <Chevron size={11} />
                    {/if}
                  </button>
                {:else}
                  <span class="bd-meal bd-free">{meal.name}</span>
                {/if}
              {/each}
              {#if meals.length === 0 && band.plannable}
                <button
                  class="bd-plan"
                  onclick={() => onPlan(band.label, days[i]?.iso ?? "")}
                  aria-label={`Plan ${band.label.toLowerCase()} for ${days[i]?.long ?? ""}`}
                  ><span class="bd-plan-glyph">+</span></button
                >
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {/key}
</div>

<style>
  /* The scroll region at wide widths — same contract as SlotPane's .day-detail: fills the space
     below the widget header and scrolls only once `main` hits the host-height cap. */
  .board {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 16px calc(16px + env(safe-area-inset-bottom));
  }

  /* One shared column template keeps the header row and every band aligned: 28px nav gutters
     flanking seven equal day columns. Band rows leave the gutters empty (the type label spans
     the full width; the first cell pins to column 2). The grid caps at a working measure and
     centers — on a very wide host, seven columns of 12.5px text stretched full-bleed smear
     into a sparse haze; a capped board stays a board. */
  .grid7 {
    display: grid;
    grid-template-columns: 28px repeat(7, 1fr) 28px;
    /* Fluid inter-column air: a fixed 6px left a meal's trailing chevron nearly touching
       the neighbor's "+" (two small glyphs with ambiguous grouping). The gap is paid from
       SURPLUS width only — 6px at the 640px minimum (where ~72px columns can't spare a
       pixel without mid-word breaks), ramping linearly to 20px by ~1000px. */
    column-gap: clamp(6px, 3.9vw - 19px, 20px);
    max-width: 60rem;
    margin-inline: auto;
  }

  .bd-head {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg);
    align-items: center;
    padding: 10px 0 8px;
    border-bottom: 1px solid var(--line);
  }
  /* Left-aligned to sit on the same left edge as the cell text below (meal names and the
     "+" affordances are left-aligned); a centered header over left-aligned columns reads
     as misregistration. */
  .bd-day {
    display: flex;
    align-items: baseline;
    justify-content: flex-start;
    gap: 5px;
    min-width: 0;
  }
  .bd-day-name {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    letter-spacing: 0.03em;
  }
  .bd-day-num {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .bd-day.today .bd-day-name {
    color: var(--accent);
  }
  .bd-day.today .bd-day-num {
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: 50%;
    width: 22px;
    height: 22px;
    display: inline-grid;
    place-items: center;
  }

  /* While a week re-fetch is in flight the bands dim — the "working on it" cue the locked
     arrows alone don't give. Pure opacity: cheap, and zeroed by reduced motion. */
  .bands {
    transition: opacity 0.15s;
  }
  .bands.busy {
    opacity: 0.55;
  }

  .bd-band {
    padding: 8px 0 10px;
  }
  .bd-band + .bd-band {
    border-top: 1px solid var(--line);
  }
  .bd-type {
    /* Starts at the first day column (not the nav gutter) so the label sits over the
       content it names. */
    grid-column: 2 / -1;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    letter-spacing: 0.03em;
    padding: 2px 0 6px;
  }
  .bd-cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  /* Today's column carries a faint accent wash — the wayfinding anchor below the circled
     header date. Stacked per-band, the washes read as one column. Square and a whisper
     (3.5%): rounded corners + a stronger tint made empty today cells read as content cards
     around a lone "+", not as a background. The wash box matches the cells' 3px bleed. */
  .bd-cell.today {
    background: color-mix(in oklch, var(--accent) 3.5%, transparent);
    padding: 2px 3px;
    margin: -2px -3px;
  }
  /* Pin the first cell past the left nav gutter; the rest auto-flow into columns 3–8. */
  .bd-cell:nth-child(2) {
    grid-column-start: 2;
  }

  .bd-meal {
    display: flex;
    align-items: center;
    gap: 4px;
    text-align: left;
    font-size: 12.5px;
    font-weight: 550;
    line-height: 1.3;
    /* Bleed 3px, not more: adjacent day cells sit across a 6px gap, and a wider bleed
       makes neighboring meals' hit areas overlap — a gap tap would open the wrong recipe. */
    padding: 4px 3px;
    margin: 0 -3px;
    border-radius: 6px;
    min-width: 0;
    /* Hug the name + chevron (capped by the cell): stretched across a wide column, the
       hover wash reads as a large empty pill floating past short names. The cap allows the
       3px LEFT bleed only — a long name's trailing chevron must stop at the column edge,
       not eat into the inter-column air. */
    align-self: flex-start;
    max-width: calc(100% + 3px);
  }
  /* Long names (linked or freeform) wrap inside the narrow column, capped at three lines.
     Hyphenation first (the shell sets lang="en"), so a word that must break reads as
     "Bene-dict"; overflow-wrap stays as the last-resort guard for unbreakable strings. */
  .bd-meal-name,
  .bd-free {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
    hyphens: auto;
    overflow-wrap: anywhere;
  }
  @media (hover: hover) {
    .bd-meal:not(.bd-free):hover:not(:disabled) {
      background: var(--hover);
    }
  }
  .bd-meal:disabled {
    cursor: default;
  }
  .bd-free {
    cursor: default;
  }

  /* The quiet per-cell plan affordance. Muted, not faint: an interactive control should sit
     comfortably above the 3:1 UI floor (faint scrapes by at ~3.3:1 on light paper). */
  /* The hit area and the visual are split: the BUTTON fills the whole empty cell (an empty
     cell IS the plan target), while the hover wash lives on the glyph-sized inner span — a
     full-cell wash read as a large empty block with a lone "+" in the corner. */
  .bd-plan {
    align-self: stretch;
    flex: 1;
    display: flex;
    align-items: flex-start;
    text-align: left;
    padding: 0;
    margin: 0 -3px;
    color: var(--muted);
  }
  .bd-plan-glyph {
    font-size: 14px;
    line-height: 1.3;
    padding: 4px 5px;
    border-radius: 6px;
    transition:
      background 0.13s,
      color 0.13s;
  }
  @media (hover: hover) {
    .bd-plan:hover .bd-plan-glyph {
      background: var(--hover);
      color: var(--accent);
    }
  }
  @media (pointer: coarse) {
    .bd-meal,
    .bd-plan {
      min-height: 44px;
    }
  }
</style>
