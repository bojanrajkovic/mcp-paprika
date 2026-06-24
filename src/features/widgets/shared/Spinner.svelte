<script lang="ts">
  // The shared in-flight spinner: a rotating ring that the widgets show while a tap's tool call
  // is pending (grocery's checkbox write, the meal planner's recipe read). `size` is the px
  // diameter; `color` is any CSS color or token (e.g. "var(--accent)") that tints the ring and
  // its bright leading arc. Decorative (`aria-hidden`) — the surrounding control conveys busy
  // state. Self-gates reduced motion in CSS, so callers don't repeat the media block.
  let {
    size = 14,
    color = "var(--accent)",
  }: { size?: number; color?: string } = $props();
</script>

<span
  class="spin"
  style="--spin-size: {size}px; --spin-color: {color};"
  aria-hidden="true"
></span>

<style>
  .spin {
    display: inline-block;
    flex: none;
    width: var(--spin-size);
    height: var(--spin-size);
    border: 2px solid color-mix(in oklch, var(--spin-color) 35%, transparent);
    border-top-color: var(--spin-color);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
