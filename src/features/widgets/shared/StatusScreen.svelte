<script lang="ts">
  // The shared loading / error / empty screen. `icon` (an emoji), `title`, and `desc` are each
  // optional, so it covers a bare "Loading…" (desc only) through a full empty state (icon + title +
  // desc). `inline` is the in-flow variant (the pantry "nothing in stock" block inside the scroll).
  let {
    icon,
    title,
    desc,
    inline = false,
  }: {
    icon?: string | undefined;
    title?: string | undefined;
    desc?: string | undefined;
    inline?: boolean;
  } = $props();
</script>

<div class="empty" class:inline>
  {#if icon}<div class="big">{icon}</div>{/if}
  {#if title}<p class="t">{title}</p>{/if}
  {#if desc}<p class="d">{desc}</p>{/if}
</div>

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
