<script lang="ts">
  // The focused-day detail: a day label + summary, then one row per meal-type slot (ordered
  // by the registry App passes). A slot with a recipe-linked meal is a tap target → opens the
  // inline recipe detail; a freeform meal (no recipeUid) is a plain label; an empty slot shows
  // a `—` placeholder and a "Plan ↗" pill that routes planning to the assistant. App owns the
  // fetch and the slot-building; this only renders and reports taps.
  import { quartOut } from "svelte/easing";
  import { fly } from "svelte/transition";

  import Chevron from "../shared/Chevron.svelte";
  import PillButton from "../shared/PillButton.svelte";
  import Spinner from "../shared/Spinner.svelte";
  import StatusScreen from "../shared/StatusScreen.svelte";
  import { motion } from "../shared/motion.js";

  // The minimal meal shape a slot row renders (a structural subset of App's Meal).
  interface SlotMeal {
    uid: string;
    name: string;
    recipeUid: string | null;
  }
  interface Slot {
    key: string;
    label: string;
    meals: SlotMeal[];
  }

  // `animKey` re-creates the day content when the focused day changes; `dir` (-1/0/1) is the
  // move's direction, so the content glides in from the side the calendar moved toward. `busy`
  // dims the pane while a week re-fetch is in flight. `onSwipeDay` is the touch pager: a
  // horizontal swipe moves a day (±1), additive to the day chips.
  let {
    dayLabel,
    daySub,
    slots,
    animKey,
    dir,
    busy,
    loadingUid,
    onOpenRecipe,
    onPlan,
    onSwipeDay,
  }: {
    dayLabel: string;
    daySub: string;
    slots: Slot[];
    animKey: string;
    dir: number;
    busy: boolean;
    loadingUid: string | null;
    onOpenRecipe: (meal: SlotMeal) => void;
    onPlan: (label: string) => void;
    // Returns whether the page actually turned — false (clamp boundary, fetch in flight)
    // springs the content back instead of leaving a committed-but-dead gesture.
    onSwipeDay: (dir: number) => boolean;
  } = $props();

  // --- Touch day-paging. The pane tracks the finger horizontally (with resistance) once the
  // gesture commits to the x-axis; past a distance or flick threshold the release pages a day
  // (App plays the directional glide), otherwise the content springs back. `touch-action:
  // pan-y` leaves vertical scrolling fully native — the axis lock only decides what WE do
  // with the horizontal component, so no preventDefault fights. Mouse users page via the
  // day chips; the gesture is touch-only and additive (the chips remain the visible path).
  let dragX = $state(0);
  // True only for the spring-back after an uncommitted swipe — gates the CSS transition so
  // it can't smooth (and lag) the finger-tracking or fight the keyed fly-in.
  let springing = $state(false);
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let axis: "x" | "y" | null = null;
  let tracking = false;
  let springTimer: ReturnType<typeof setTimeout> | undefined;

  function touchStart(e: TouchEvent) {
    const t = e.touches[0];
    if (e.touches.length !== 1 || !t) {
      // A second finger means this is a pinch/multi-touch gesture, not a page — abandon
      // any drag in progress so lifting a finger can't commit a spurious page turn.
      tracking = false;
      if (axis === "x" && dragX !== 0) springBack();
      return;
    }
    startX = t.clientX;
    startY = t.clientY;
    startT = performance.now();
    axis = null;
    tracking = true;
    springing = false;
    clearTimeout(springTimer);
  }
  function touchMove(e: TouchEvent) {
    const t = e.touches[0];
    if (!tracking || !t) return;
    if (e.touches.length !== 1) {
      tracking = false;
      if (axis === "x" && dragX !== 0) springBack();
      return;
    }
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (axis === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (axis === "x") dragX = dx * 0.55;
  }
  function springBack() {
    springing = true;
    dragX = 0;
    springTimer = setTimeout(() => {
      springing = false;
    }, 200);
  }
  function touchEnd() {
    if (!tracking) return;
    tracking = false;
    if (axis !== "x") return;
    const elapsed = Math.max(1, performance.now() - startT);
    const commit = Math.abs(dragX) > 56 || Math.abs(dragX) / elapsed > 0.35;
    if (commit) {
      const dir = dragX < 0 ? 1 : -1;
      if (onSwipeDay(dir)) {
        // Same-flush reset: dragX clears in the same batch as the day change, so the new
        // keyed content never renders with the old drag offset.
        dragX = 0;
        return;
      }
      // The page couldn't turn (clamp boundary / fetch in flight): spring back so the
      // gesture visibly rejects instead of dying silently.
    }
    springBack();
  }
  function touchCancel() {
    tracking = false;
    if (axis === "x") springBack();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -- the touch handlers are the
     additive swipe pager, not an interactive control: the day chips (real buttons) remain
     the assistive-tech path, and giving this scroll region a role would misdescribe it. -->
<div
  class="day-detail"
  class:busy
  aria-busy={busy}
  ontouchstart={touchStart}
  ontouchmove={touchMove}
  ontouchend={touchEnd}
  ontouchcancel={touchCancel}
>
  {#key animKey}
    <div
      class="day-content"
      class:springing
      style:transform={dragX === 0 ? undefined : `translateX(${dragX}px)`}
      in:fly={{ x: dir * 14, duration: motion(170), easing: quartOut }}
    >
      <div class="dd-label">
        <span class="dd-day">{dayLabel}</span>
        <span class="dd-sub">{daySub}</span>
      </div>

      {#if slots.length === 0}
        <!-- An empty meal-type registry (hostile or truly fresh payload) must not dead-end
             into a label above nothing. StatusScreen is the system's one home for empty
             states — its role=status live region announces this to a screen reader too. -->
        <StatusScreen
          inline
          desc="No meal types yet. Plan a meal with your assistant and the slots appear here."
        />
      {/if}

      {#each slots as slot (slot.key)}
        <div class="meal-slot">
          <span class="ms-type">{slot.label}</span>
          <div class="ms-body">
            {#if slot.meals.length === 0}
              <div class="ms-empty">
                <span class="dash">—</span>
                <PillButton
                  variant="accent-fill"
                  onclick={() => onPlan(slot.label)}>Plan ↗</PillButton
                >
              </div>
            {:else}
              {#each slot.meals as meal (meal.uid)}
                {#if meal.recipeUid}
                  <button
                    class="ms-name"
                    onclick={() => onOpenRecipe(meal)}
                    disabled={loadingUid === meal.uid}
                    aria-busy={loadingUid === meal.uid}
                  >
                    <span class="ms-text">{meal.name}</span>
                    {#if loadingUid === meal.uid}
                      <Spinner size={13} />
                    {:else}
                      <Chevron size={14} />
                    {/if}
                  </button>
                {:else}
                  <span class="ms-free">{meal.name}</span>
                {/if}
              {/each}
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/key}
</div>

<style>
  /* The scroll region: fills the space below the chrome and scrolls only when `main` hits the
     host-height cap (WidgetShell's `--widget-max-h`). Below the cap, `main` sizes to content and
     this never activates. (The cap must be the host's container height, not `100dvh` — see the
     WidgetShell note; an iframe-relative cap pins the widget at its min-height floor.) */
  .day-detail {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 0;
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
    /* Vertical scrolling stays native; only the horizontal component reaches the swipe
       pager's touch handlers. */
    touch-action: pan-y;
  }
  /* While a week re-fetch is in flight the pane dims — the "working on it" cue the locked
     nav arrows alone don't give. Pure opacity: cheap, and zeroed by reduced motion. */
  .day-content {
    transition: opacity 0.15s;
  }
  /* Spring-back after an uncommitted swipe only — never during finger-tracking (it would
     lag the drag) and never during the keyed fly-in (it would fight the JS transition). */
  .day-content.springing {
    transition:
      opacity 0.15s,
      transform 0.2s cubic-bezier(0.25, 1, 0.5, 1);
  }
  .busy .day-content {
    opacity: 0.55;
  }
  .dd-label {
    padding: 0 16px 12px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .dd-day {
    font-size: 15px;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dd-sub {
    font-size: 12px;
    color: var(--muted);
    flex: none;
  }

  .meal-slot {
    padding: 10px 16px;
    display: flex;
    /* baseline so the smaller meal-type label sits on the same text baseline as the meal name (or
       the placeholder dash), instead of a hand-tuned top nudge that drifts as either size changes. */
    align-items: baseline;
    gap: 14px;
    border-top: 1px solid var(--line);
  }
  .ms-type {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    letter-spacing: 0.03em;
    width: 64px;
    flex: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ms-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ms-name {
    text-align: left;
    /* Stretched by the column flex parent; the negative margins let the hover wash and tap
       target bleed 8px past the text column on both sides (width:100% would only shift it). */
    align-self: stretch;
    padding: 2px 8px;
    margin: 0 -8px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 550;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    transition: background 0.13s;
  }
  @media (hover: hover) {
    .ms-name:hover:not(:disabled) {
      background: var(--hover);
    }
  }
  .ms-name:active:not(:disabled) {
    background: var(--hover);
  }
  /* Touch hosts get a real tap target on the recipe-open row (same floor PillButton uses). */
  @media (pointer: coarse) {
    .ms-name {
      min-height: 44px;
    }
  }
  .ms-name:disabled {
    cursor: default;
  }
  .ms-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Match .ms-name's weight: a freeform meal is still a meal name, not lighter than a linked one. */
  .ms-free {
    font-size: 14px;
    font-weight: 550;
    padding: 2px 0;
    min-width: 0;
    /* A pasted unbroken string (a URL-ish name) must wrap, not overflow the pane. */
    overflow-wrap: anywhere;
  }

  .ms-empty {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .dash {
    font-size: 14px;
    color: var(--faint);
  }
</style>
