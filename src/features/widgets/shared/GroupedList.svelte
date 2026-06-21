<script lang="ts" generics="T">
  import type { Snippet } from "svelte";

  type Group = { key: string; items: T[] };

  // The shared grouped-list chrome: the scroll viewport, the sticky group headers, and the group
  // sections. The header's trailing content (a count, a rule) and the row rendering (the keyed each +
  // flip + the divergent row element) are slotted, because those are where the two checklist widgets
  // differ — the list shell is what they share. `padBottom` adds the safe-area scroll padding for a
  // widget whose scroll ends at the viewport bottom (grocery); a widget with its own bottom chrome
  // (pantry's drawer) handles the inset there and opts out.
  let {
    groups,
    headerExtra,
    rows,
    footer,
    padBottom = true,
  }: {
    groups: Group[];
    headerExtra?: Snippet<[Group]>;
    rows: Snippet<[T[]]>;
    footer?: Snippet;
    padBottom?: boolean;
  } = $props();
</script>

<div class="scroll" class:pad-bottom={padBottom}>
  {#each groups as group (group.key)}
    <section class="group">
      <div class="aisle">
        <h2>{group.key}</h2>
        {@render headerExtra?.(group)}
      </div>
      {@render rows(group.items)}
    </section>
  {/each}
  {@render footer?.()}
</div>

<style>
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .scroll.pad-bottom {
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
  }

  .aisle {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 12px 16px 5px;
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 1;
  }
  .aisle h2 {
    margin: 0;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
</style>
