<script lang="ts">
  // The shared 0–5 rating indicator: five accent dots, the first `rating` of them lit. Right-
  // aligned at the end of its flex row (browse + menu rows both place it at the trailing edge of
  // the text column). An unrated recipe (rating 0) shows five dim dots.
  let { rating }: { rating: number } = $props();
</script>

<span class="dots" role="img" aria-label="Rated {rating} of 5">
  {#each [0, 1, 2, 3, 4] as i (i)}<span class="dot" class:on={i < rating}
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
