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

    /* Floor (10rem) ensures the body reports a usable height to autoResize's ResizeObserver even
       when the host starts the iframe small (e.g. from the loading-state measurement). Cap is the
       host's container height (`--widget-max-h`, set by host-style.ts from `containerDimensions`)
       so a long widget scrolls inside the card instead of growing the iframe — NOT `100dvh`, which
       inside the iframe resolves to the CURRENT iframe height and collapses the cap during the
       host's max-content autoResize measurement, pinning the widget at the floor. No host
       dimensions → no cap (`none`): the widget grows to content and the host page scrolls. */
    min-height: 10rem;
    max-height: var(--widget-max-h, none);
    display: flex;
    flex-direction: column;
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

  /* Widget-wide focus ring — the one home for the keyboard-focus outline every widget
     would otherwise re-declare. A control overrides only for an inset ring or a corner
     radius; its scoped local `:focus-visible` outspecifies this low-specificity rule. */
  main :global(:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Widget-wide button reset — the one home for the native-chrome strip every widget button
     would otherwise repeat. Every button here is fully custom-styled, so there is no native
     look to preserve. A control's own class (specificity 0,1,0) overrides any of these base
     values (this rule is 0,0,2), so a button that wants a border / background / colour just
     sets it; the focus ring above stays the accessible affordance. */
  main :global(button) {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  /* Widget-wide reduced motion for CSS animations/transitions. Svelte's JS transitions
     (`transition:` / `animate:flip`) are NOT CSS and are gated separately in motion.ts. */
  @media (prefers-reduced-motion: reduce) {
    main :global(*) {
      animation-duration: 0.001ms !important;
      transition-duration: 0.001ms !important;
    }
  }
</style>
