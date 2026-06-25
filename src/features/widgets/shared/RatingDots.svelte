<script lang="ts">
  // The shared 0–5 rating indicator: five accent dots, the first `rating` of them lit. Right-
  // aligned at the end of its flex row (browse + menu rows both place it at the trailing edge of
  // the text column). An unrated recipe (rating 0) shows five dim dots.
  let { rating }: { rating: number } = $props();

  // Clamp to a whole 0–5 at the render chokepoint, so neither an untrusted host payload (the menu
  // feed) nor a future caller can light a phantom sixth dot or print "Rated 9 of 5".
  const lit = $derived(Math.max(0, Math.min(5, Math.round(rating))));
</script>

<span class="dots" role="img" aria-label="Rated {lit} of 5">
  {#each [0, 1, 2, 3, 4] as i (i)}<span class="dot" class:on={i < lit}
    ></span>{/each}
</span>

<style>
  .dots {
    display: flex;
    gap: 2px;
    margin-left: auto;
    flex: none;
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    opacity: 0.2;
  }
  .dot.on {
    opacity: 1;
  }
</style>
