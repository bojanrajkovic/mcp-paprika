<script lang="ts">
  import type { Snippet } from "svelte";

  // The ingredient·quantity body shared by every row, whatever the row's leading/trailing controls (a
  // checkbox, an Out button, a swipe). `extra` renders after the name inside the body (the pantry
  // expiry badge); omitted, it's just the name + dimmed quantity.
  let {
    ingredient,
    quantity = null,
    extra,
  }: {
    ingredient: string;
    quantity?: string | null;
    extra?: Snippet;
  } = $props();
</script>

<span class="body">
  <span class="name"
    >{ingredient}{#if quantity}<span class="qty"> · {quantity}</span>{/if}</span
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
</style>
