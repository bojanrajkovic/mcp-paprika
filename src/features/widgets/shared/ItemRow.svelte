<script lang="ts">
  import type { Snippet } from "svelte";

  // The ingredient · quantity body shared by every row, whatever the row's leading/trailing controls
  // (a checkbox, an Out button, a swipe). `done` fades the entire body to ~38% opacity (a checked
  // grocery item) — the checkbox already signals done; the fade recedes the row without any
  // per-element color math or font-size changes. `extra` renders after the name inside the body
  // (the pantry expiry badge); omitted, it's just the name + dimmed quantity. The " · " separator
  // is written as a `{" · "}` expression so Svelte does not trim its leading space.
  let {
    ingredient,
    quantity = null,
    done = false,
    extra,
  }: {
    ingredient: string;
    quantity?: string | null;
    done?: boolean;
    extra?: Snippet;
  } = $props();
</script>

<span class="body" class:done>
  <span class="name"
    >{ingredient}{#if quantity}<span class="qty">{" · "}{quantity}</span
      >{/if}</span
  >
  {@render extra?.()}
</span>

<style>
  .body {
    flex: 1;
    min-width: 0;
  }
  .name {
    display: block;
    overflow-wrap: anywhere;
  }
  .qty {
    color: var(--muted);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .body.done {
    opacity: 0.38;
  }
</style>
