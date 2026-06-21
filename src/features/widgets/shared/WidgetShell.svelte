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
    /* Warm-neutral base (hue ~72) to sit native inside the host's warm UI and match the consent
       screen. `--accent` is the paprika-orange brand / interactive colour; `--success` is the green
       done / fresh state (kept distinct so a checked item reads positive, never a red "done"); and
       `--danger` is a separate, cooler alert red. The set is the union of what the widgets use — each
       consumes its subset (grocery's `--success`/`--success-ink` tick, the expiry `--warn`). */
    --bg: oklch(0.99 0.004 75);
    --ink: oklch(0.27 0.012 72);
    --muted: oklch(0.52 0.012 72);
    --faint: oklch(0.64 0.01 72);
    --line: oklch(0.91 0.007 72);
    --hover: oklch(0.96 0.006 72);
    --accent: oklch(0.62 0.15 47);
    --accent-ink: oklch(0.99 0.012 52);
    --success: oklch(0.58 0.13 150);
    --success-ink: oklch(0.99 0.02 150);
    --warn: oklch(0.66 0.12 75);
    --warn-bg: oklch(0.95 0.05 82);
    --danger: oklch(0.54 0.21 22);
    --danger-bg: oklch(0.96 0.045 22);
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
    --bg: oklch(0.22 0.008 72);
    --ink: oklch(0.95 0.005 75);
    --muted: oklch(0.72 0.01 72);
    --faint: oklch(0.58 0.01 72);
    --line: oklch(0.31 0.01 72);
    --hover: oklch(0.26 0.012 72);
    --accent: oklch(0.72 0.15 48);
    --accent-ink: oklch(0.2 0.03 45);
    --success: oklch(0.74 0.14 150);
    --success-ink: oklch(0.16 0.03 150);
    --warn: oklch(0.82 0.13 80);
    --warn-bg: oklch(0.3 0.06 80);
    --danger: oklch(0.67 0.2 22);
    --danger-bg: oklch(0.29 0.07 22);
    color-scheme: dark;
  }
</style>
