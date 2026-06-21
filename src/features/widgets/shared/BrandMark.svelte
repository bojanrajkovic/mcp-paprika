<script lang="ts">
  // The connector's brand mark — a paprika-orange tile with the "P" monogram, beside the widget
  // title. Each widget shows it in its header for a persistent, on-brand identity. The tile is
  // decorative (the title carries the accessible name), so it is aria-hidden.
  let { title }: { title: string } = $props();
</script>

<div class="brand">
  <span class="tile" aria-hidden="true">P</span>
  <h1>{title}</h1>
</div>

<style>
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .tile {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: var(--accent);
    color: var(--accent-ink);
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 14px;
  }
  h1 {
    font-size: 17px;
    font-weight: 650;
    letter-spacing: -0.01em;
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
