<script lang="ts">
  import type { Snippet } from "svelte";

  // The ingredient·quantity body shared by every row, whatever the row's leading/trailing controls (a
  // checkbox, an Out button, a swipe). `done` strikes through and dims the name + quantity (a checked
  // grocery item). `extra` renders after the name inside the body (the pantry expiry badge); omitted,
  // it's just the name + dimmed quantity.
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
  .body.done .name {
    color: var(--faint);
    text-decoration: line-through;
    text-decoration-color: color-mix(in oklch, var(--faint) 60%, transparent);
  }
  .body.done .qty {
    color: var(--faint);
  }
</style>
