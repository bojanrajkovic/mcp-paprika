<script lang="ts">
  import type { Snippet } from "svelte";
  import { fade } from "svelte/transition";

  import { motion } from "./motion.js";

  // The shared loading / error / empty screen. `icon` (an emoji), `title`, and `desc` are each
  // optional, so it covers a bare "Loading…" (desc only) through a full empty state (icon + title +
  // desc). `inline` is the in-flow variant (the pantry "nothing in stock" block inside the scroll).
  // `children` renders after the desc — a trailing CTA (the recipe-browser's "Clear filters").
  // `animate` fades the whole block in via a motion()-gated `in:fade|global`, for an empty state
  // that appears reactively (a filter emptying, a phase settling) rather than on first mount. The
  // fade is `|global` because it sits on this component's own `{#if}`, which is created together
  // with the component, and a local intro never plays there. It is a
  // `role=status` live region, so a phase change (loading → error → content) is announced to a screen
  // reader; the emoji `icon` is decorative (`aria-hidden`), the title/desc carry the message.
  let {
    icon,
    title,
    desc,
    inline = false,
    animate = false,
    children,
  }: {
    icon?: string | undefined;
    title?: string | undefined;
    desc?: string | undefined;
    inline?: boolean;
    animate?: boolean;
    children?: Snippet;
  } = $props();
</script>

{#snippet body()}
  {#if icon}<div class="big" aria-hidden="true">{icon}</div>{/if}
  {#if title}<p class="t">{title}</p>{/if}
  {#if desc}<p class="d">{desc}</p>{/if}
  {#if children}{@render children()}{/if}
{/snippet}

{#if animate}
  <div
    class="empty"
    class:inline
    role="status"
    aria-live="polite"
    in:fade|global={{ duration: motion(180) }}
  >
    {@render body()}
  </div>
{:else}
  <div class="empty" class:inline role="status" aria-live="polite">
    {@render body()}
  </div>
{/if}

<style>
  .empty {
    flex: 1;
    display: grid;
    place-content: center;
    justify-items: center;
    text-align: center;
    gap: 6px;
    padding: 40px 24px;
    color: var(--muted);
  }
  .empty.inline {
    padding: 32px 24px;
  }
  .empty .big {
    font-size: 30px;
  }
  .empty .t {
    color: var(--ink);
    font-weight: 600;
    margin: 0;
  }
  .empty .d {
    font-size: 13px;
    max-width: 34ch;
    margin: 0;
  }
</style>
