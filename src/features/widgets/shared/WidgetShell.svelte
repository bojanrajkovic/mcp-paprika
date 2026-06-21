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
       screen. `--accent` is paprika-red (#C0392B) — the one brand identity colour, shared with the
       consent screen and used for every interactive accent (the brand tile, focus rings, the Restock
       pill, the toast Undo). `--success` is the green done / fresh state (kept distinct so a checked
       item reads positive, never a red "done"). `--danger` is a vivid fire-engine red, deliberately
       more saturated than the earthy brand so an alert never reads as the brand. The set is the union
       of what the widgets use — each consumes its subset (grocery's `--success`/`--success-ink` tick,
       the expiry `--warn`). */
    --bg: oklch(0.99 0.004 75);
    --ink: oklch(0.27 0.012 72);
    --muted: oklch(0.52 0.012 72);
    --faint: oklch(0.64 0.01 72);
    --line: oklch(0.91 0.007 72);
    --hover: oklch(0.96 0.006 72);
    --accent: oklch(0.543 0.174 30);
    --accent-ink: oklch(0.99 0.012 40);
    --success: oklch(0.58 0.13 150);
    --success-ink: oklch(0.99 0.02 150);
    --warn: oklch(0.66 0.12 75);
    --warn-bg: oklch(0.95 0.05 82);
    --danger: oklch(0.56 0.215 29);
    --danger-bg: oklch(0.955 0.042 27);
    color-scheme: light;

    /* Cap at the viewport so long lists scroll; don't force a height so short lists size to content
       rather than leaving a blank gap below the footer (100dvh is the iframe viewport, adjusting for
       mobile browser chrome that 100vh ignores). */
    max-height: 100dvh;
    display: flex;
    flex-direction: column;
    min-height: 0;
    position: relative;
    background: var(--bg);
    color: var(--ink);
    /* `--widget-font` is resolved per host by the shared host-style helper to match the shell the
       widget renders in (a serif-first host gets a serif stack; everyone else matches the host's
       `--font-sans`). It is unset until then and during the standalone preview, so the fallback — our
       own system sans — is the honest default. */
    font-family: var(
      --widget-font,
      system-ui,
      -apple-system,
      "Segoe UI",
      Roboto,
      sans-serif
    );
    font-size: 15px;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }
  main.dark {
    --bg: oklch(0.22 0.008 72);
    --ink: oklch(0.95 0.005 75);
    --muted: oklch(0.72 0.01 72);
    --faint: oklch(0.58 0.01 72);
    --line: oklch(0.31 0.01 72);
    --hover: oklch(0.26 0.012 72);
    --accent: oklch(0.7 0.155 33);
    --accent-ink: oklch(0.22 0.03 33);
    --success: oklch(0.74 0.14 150);
    --success-ink: oklch(0.16 0.03 150);
    --warn: oklch(0.82 0.13 80);
    --warn-bg: oklch(0.3 0.06 80);
    --danger: oklch(0.7 0.2 29);
    --danger-bg: oklch(0.31 0.075 27);
    color-scheme: dark;
  }
</style>
