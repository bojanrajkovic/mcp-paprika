<script lang="ts">
  // The shared trailing/disclosure chevron: a small stroked "›" the widgets put at the end of a
  // tappable row or on a disclosure header. `size` is the px box; `color` tints the stroke (any
  // token, default --faint, mirroring Spinner's API); pass `open` to rotate it 90° for something
  // that expands in place (a recipe row, the pantry drawer) — leave it false for a plain
  // navigate-in affordance (menu, a meal slot). The rotation is a CSS transition, so WidgetShell's
  // global reduced-motion block zeroes it; no per-widget handling needed.
  // `flip` mirrors the glyph to point left (the week-nav's previous arrow) — mutually
  // exclusive with `open` in practice (both set transform).
  let {
    size = 15,
    color = "var(--faint)",
    open = false,
    flip = false,
  }: {
    size?: number;
    color?: string;
    open?: boolean;
    flip?: boolean;
  } = $props();
</script>

<svg
  class="chev"
  class:open
  class:flip
  style="--chev-size: {size}px; --chev-color: {color};"
  viewBox="0 0 16 16"
  aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg
>

<style>
  .chev {
    flex: none;
    width: var(--chev-size);
    height: var(--chev-size);
    fill: none;
    stroke: var(--chev-color);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 0.15s;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .chev.flip {
    transform: scaleX(-1);
  }
</style>
