<script lang="ts">
  // The shared prev/next week arrow — one 28px circle button used by both the narrow
  // DayStrip and the wide WeekBoard header, kept in one place so the pair can't drift
  // (adaptive ink-mix border, hover gate, expanded hit area). The glyph is the shared
  // Chevron (flipped for prev), so the arrows track the widget family's chevron style.
  import Chevron from "../shared/Chevron.svelte";

  let {
    dir,
    disabled,
    ariaLabel,
    onclick,
  }: {
    dir: "prev" | "next";
    disabled: boolean;
    ariaLabel: string;
    onclick: () => void;
  } = $props();
</script>

<button class="nav-btn" {onclick} {disabled} aria-label={ariaLabel}>
  <Chevron size={15} color="currentColor" flip={dir === "prev"} />
</button>

<style>
  .nav-btn {
    position: relative;
    background: var(--bg);
    border: 1px solid color-mix(in oklch, var(--ink) 22%, transparent);
    border-radius: 999px;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    color: var(--ink);
    transition: background 0.1s;
  }
  /* Compact visual, comfortable target: the hit area extends past the 28px circle
     toward the 44px touch floor. */
  .nav-btn::after {
    content: "";
    position: absolute;
    inset: -8px;
  }
  @media (hover: hover) {
    .nav-btn:hover:not(:disabled) {
      background: var(--hover);
    }
  }
  .nav-btn:active:not(:disabled) {
    background: var(--hover);
  }
  .nav-btn:disabled {
    color: var(--faint);
    cursor: default;
    border-color: transparent;
  }
</style>
