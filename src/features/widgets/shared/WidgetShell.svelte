<script lang="ts">
  import type { Snippet } from "svelte";

  // The canonical theme tokens live here (and only here): a host-context theme flip toggles the
  // `dark` class and re-skins every descendant, because CSS custom properties inherit through the DOM
  // independently of Svelte's style scoping. The outer chrome (the flex-column layout, the body
  // reset, the relative positioning the toast anchors to) is shared by every widget; the list/row
  // treatment composes inside `children`.
  let { dark = false, children }: { dark?: boolean; children: Snippet } =
    $props();
</script>

<main class:dark>
  {@render children()}
</main>

<style>
  :global(body) {
    margin: 0;
  }

  main {
    /* Light by default, overridden under .dark. The token set is the union of what the widgets use —
       each consumes its subset (the tick `--accent-ink`, the expiry `--warn`/`--warn-bg`). */
    --bg: oklch(0.99 0.003 250);
    --ink: oklch(0.27 0.012 265);
    --muted: oklch(0.52 0.012 265);
    --faint: oklch(0.64 0.01 265);
    --line: oklch(0.92 0.005 265);
    --hover: oklch(0.96 0.004 265);
    --accent: oklch(0.58 0.13 150);
    --accent-ink: oklch(0.99 0.02 150);
    --warn: oklch(0.62 0.13 70);
    --warn-bg: oklch(0.96 0.05 80);
    --danger: oklch(0.55 0.17 25);
    --danger-bg: oklch(0.96 0.04 25);
    color-scheme: light;

    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    position: relative;
    background: var(--bg);
    color: var(--ink);
    font:
      15px/1.45 system-ui,
      -apple-system,
      "Segoe UI",
      Roboto,
      sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main.dark {
    --bg: oklch(0.21 0.012 265);
    --ink: oklch(0.95 0.005 265);
    --muted: oklch(0.72 0.012 265);
    --faint: oklch(0.58 0.012 265);
    --line: oklch(0.3 0.013 265);
    --hover: oklch(0.25 0.014 265);
    --accent: oklch(0.74 0.14 150);
    --accent-ink: oklch(0.16 0.03 150);
    --warn: oklch(0.82 0.13 80);
    --warn-bg: oklch(0.3 0.06 80);
    --danger: oklch(0.72 0.16 25);
    --danger-bg: oklch(0.28 0.06 25);
    color-scheme: dark;
  }
</style>
