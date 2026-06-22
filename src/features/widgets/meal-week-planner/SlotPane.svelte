<script lang="ts">
  // The focused-day detail: a day label + summary, then one row per meal-type slot (ordered
  // by the registry App passes). A slot with a recipe-linked meal is a tap target → opens the
  // inline recipe detail; a freeform meal (no recipeUid) is a plain label; an empty slot shows
  // a `—` placeholder and a "Plan ↗" pill that routes planning to the assistant. App owns the
  // fetch and the slot-building; this only renders and reports taps.
  import PillButton from "../shared/PillButton.svelte";
  import Spinner from "../shared/Spinner.svelte";

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

  let {
    dayLabel,
    daySub,
    slots,
    loadingUid,
    onOpenRecipe,
    onPlan,
  }: {
    dayLabel: string;
    daySub: string;
    slots: Slot[];
    loadingUid: string | null;
    onOpenRecipe: (meal: SlotMeal) => void;
    onPlan: (label: string) => void;
  } = $props();
</script>

<div class="day-detail">
  <div class="dd-label">
    <span class="dd-day">{dayLabel}</span>
    <span class="dd-sub">{daySub}</span>
  </div>

  {#each slots as slot (slot.key)}
    <div class="meal-slot">
      <span class="ms-type">{slot.label}</span>
      <div class="ms-body">
        {#if slot.meals.length === 0}
          <div class="ms-empty">
            <span class="dash">—</span>
            <PillButton variant="accent-fill" onclick={() => onPlan(slot.label)}
              >Plan ↗</PillButton
            >
          </div>
        {:else}
          {#each slot.meals as meal (meal.uid)}
            {#if meal.recipeUid}
              <button
                class="ms-name"
                onclick={() => onOpenRecipe(meal)}
                disabled={loadingUid === meal.uid}
              >
                <span class="ms-text">{meal.name}</span>
                {#if loadingUid === meal.uid}
                  <Spinner size={13} />
                {:else}
                  <svg class="ms-chev" viewBox="0 0 16 16" aria-hidden="true"
                    ><path d="M6 3.5 10.5 8 6 12.5" /></svg
                  >
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
    align-items: flex-start;
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
    padding-top: 3px;
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
    appearance: none;
    border: 0;
    background: transparent;
    font: inherit;
    color: inherit;
    text-align: left;
    width: 100%;
    padding: 2px 0;
    font-size: 14px;
    font-weight: 550;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .ms-name:disabled {
    cursor: default;
  }
  .ms-name:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 6px;
  }
  .ms-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ms-chev {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--faint);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ms-free {
    font-size: 14px;
    padding: 2px 0;
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
