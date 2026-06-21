<script lang="ts">
  import type { Snippet } from "svelte";

  // The shared pill action button. Variants map to the roles the two widgets use: `neutral` (muted,
  // hover to ink — grocery's Clear/Keep), `danger` (muted, hover to danger — the pantry Out),
  // `danger-strong` (danger outline + text always — grocery's clear-confirm), `accent` (accent
  // outline + text — the pantry Restock). The shape, focus ring, and transition are shared; the
  // variant sets the colors (and the one-px padding differences the originals carried).
  let {
    variant = "neutral",
    onclick,
    ariaLabel,
    children,
  }: {
    variant?: "neutral" | "danger" | "danger-strong" | "accent";
    onclick: () => void;
    ariaLabel?: string;
    children: Snippet;
  } = $props();
</script>

<button
  class="pill"
  class:neutral={variant === "neutral"}
  class:danger={variant === "danger"}
  class:danger-strong={variant === "danger-strong"}
  class:accent={variant === "accent"}
  {onclick}
  aria-label={ariaLabel}>{@render children()}</button
>

<style>
  .pill {
    appearance: none;
    flex: none;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    padding: 5px 11px;
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.13s,
      color 0.13s,
      border-color 0.13s;
  }
  .pill:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .pill.neutral:hover {
    background: var(--hover);
    color: var(--ink);
  }
  .pill.danger {
    padding: 5px 12px;
  }
  .pill.danger:hover {
    background: var(--danger-bg);
    color: var(--danger);
    border-color: color-mix(in oklch, var(--danger) 50%, transparent);
  }
  .pill.danger-strong {
    border-color: color-mix(in oklch, var(--danger) 55%, transparent);
    color: var(--danger);
  }
  .pill.danger-strong:hover {
    background: var(--danger-bg);
  }
  .pill.accent {
    border-color: color-mix(in oklch, var(--accent) 45%, transparent);
    color: var(--accent);
    padding: 4px 12px;
  }
  .pill.accent:hover {
    background: color-mix(in oklch, var(--accent) 12%, transparent);
  }
</style>
