<script lang="ts">
  import type { Snippet } from "svelte";

  // The shared pill action button. Variants map to the roles the widgets use: `neutral` (muted,
  // hover to ink — grocery's Clear/Keep), `danger` (muted, hover to danger — the pantry Out),
  // `danger-strong` (danger outline + text always — grocery's clear-confirm), `accent` (accent
  // outline + text — the pantry Restock), `accent-fill` (muted at rest, fills accent on hover —
  // the meal-planner's empty-slot Plan call-to-action). The shape, focus ring, and transition are
  // shared; the variant sets the colors (and the one-px padding differences the originals carried). On
  // coarse pointers (touch) the pill grows to a 44px min-height tap target with its label centered;
  // fine pointers (mouse) keep the compact pill.
  let {
    variant = "neutral",
    onclick,
    ariaLabel,
    children,
  }: {
    variant?: "neutral" | "danger" | "danger-strong" | "accent" | "accent-fill";
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
  class:accent-fill={variant === "accent-fill"}
  {onclick}
  aria-label={ariaLabel}>{@render children()}</button
>

<style>
  .pill {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--line);
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
    padding: 5px 11px;
    border-radius: 999px;
    white-space: nowrap;
    transition:
      background 0.13s,
      color 0.13s,
      border-color 0.13s;
  }
  /* Touch hosts get a real 44px tap target; the compact padding still sets the fine-pointer size. */
  @media (pointer: coarse) {
    .pill {
      min-height: 44px;
    }
  }
  .pill.danger {
    padding: 5px 12px;
  }
  .pill.danger-strong {
    border-color: color-mix(in oklch, var(--danger) 55%, transparent);
    color: var(--danger);
  }
  .pill.accent {
    border-color: color-mix(in oklch, var(--accent) 45%, transparent);
    color: var(--accent);
    padding: 4px 12px;
  }
  /* Press feedback everywhere, touch included: the hover treatment, applied momentarily.
     Without this a tap gives no visual acknowledgment until the async action lands. */
  .pill.neutral:active {
    background: var(--hover);
    color: var(--ink);
  }
  .pill.danger:active {
    background: var(--danger-bg);
    color: var(--danger);
    border-color: color-mix(in oklch, var(--danger) 50%, transparent);
  }
  .pill.danger-strong:active {
    background: var(--danger-bg);
  }
  .pill.accent:active {
    background: color-mix(in oklch, var(--accent) 12%, transparent);
  }
  .pill.accent-fill:active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  /* Hover treatments only where hover exists — on touch, :hover sticks after a tap and the
     pill appears frozen in its hover state until something else is tapped. */
  @media (hover: hover) {
    .pill.neutral:hover {
      background: var(--hover);
      color: var(--ink);
    }
    .pill.danger:hover {
      background: var(--danger-bg);
      color: var(--danger);
      border-color: color-mix(in oklch, var(--danger) 50%, transparent);
    }
    .pill.danger-strong:hover {
      background: var(--danger-bg);
    }
    .pill.accent:hover {
      background: color-mix(in oklch, var(--accent) 12%, transparent);
    }
    /* Muted at rest, fills accent on hover — a soft call-to-action (the empty-slot Plan pill). */
    .pill.accent-fill:hover {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--accent-ink);
    }
  }
</style>
