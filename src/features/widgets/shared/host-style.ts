// The two ext-apps style helpers ride the inlined `globalThis.ExtApps` runtime — the same seam
// `mount-widget` reads `App` from. The import is TYPE-ONLY (erased, like `mount-widget`'s `App`), so
// ext-apps stays a build-time-only devDependency and nothing reaches the prod bundle; pinning the
// runtime's shape to `typeof` the real functions makes a host-style API change a compile error here
// rather than silent drift. Both are optional: the dev preview shim and any older host may not
// provide them, and a missing helper is a no-op, not a crash.
import type { applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

interface HostStyleRuntime {
  applyHostStyleVariables?: typeof applyHostStyleVariables;
  applyHostFonts?: typeof applyHostFonts;
}

// The host-context fields that drive typography. Structurally satisfied by the full
// `app.getHostContext()` result; every field is untrusted host data, read defensively. `variables`
// and the font CSS are pinned to ext-apps' own parameter types via `typeof`.
type HostStyleVariables = Parameters<typeof applyHostStyleVariables>[0];
type HostFontCss = Parameters<typeof applyHostFonts>[0];

interface HostStyleContext {
  readonly styles?:
    | {
        readonly variables?: HostStyleVariables | undefined;
        readonly css?: { readonly fonts?: HostFontCss | undefined } | undefined;
      }
    | undefined;
  readonly userAgent?: string | undefined;
  // The host's allocation for the widget's iframe, in px — `WidgetShell` caps `main` at this so a
  // long widget scrolls inside the card instead of growing the iframe. Untrusted; read defensively.
  readonly containerDimensions?:
    | { readonly height?: number | undefined; readonly maxHeight?: number | undefined }
    | undefined;
}

// Hosts whose reading UI is serif-first — the NYT-Cooking editorial register this widget is tuned to.
// Matched against the host's self-reported identifier, which is the only host-identity signal a
// sandboxed iframe has: cross-origin isolation blocks it from reading its embedder's DOM or metadata.
const SERIF_HOSTS = /claude|anthropic/i;

// A serif-first host gets its own serif when it ships one through the fonts channel, then a system
// serif. Every other host (and the standalone preview) matches the shell's sans — `var(--font-sans)`
// resolves to whatever the host set via applyHostStyleVariables, falling back to our system sans.
const SERIF_STACK = `"Anthropic Serif", Georgia, "Times New Roman", ui-serif, serif`;
const SANS_STACK = `var(--font-sans, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif)`;

/**
 * Adopt the host's style tokens and resolve `--widget-font` (which `WidgetShell` consumes) to match
 * the shell the widget renders in. Applies the host's CSS variables (`--font-sans`, …) and any
 * host-provided `@font-face`/`@import`, then picks a serif stack for a serif-first host or the
 * host's sans otherwise.
 *
 * Idempotent: safe on connect AND on every host-context change — `applyHostFonts` dedupes its
 * `<style>` tag and re-setting the variables/property re-applies the same values. Pass the FULL
 * `app.getHostContext()` (its params are merged before the change handler fires), so the host
 * identifier is always present and the font never resets on a partial theme-only update.
 */
export function applyHostStyles(ctx: HostStyleContext | null | undefined): void {
  const ext = (globalThis as unknown as { ExtApps?: HostStyleRuntime }).ExtApps;
  const variables = ctx?.styles?.variables;
  const fonts = ctx?.styles?.css?.fonts;
  if (variables) ext?.applyHostStyleVariables?.(variables);
  if (fonts) ext?.applyHostFonts?.(fonts);
  const serif = SERIF_HOSTS.test(ctx?.userAgent ?? "");
  document.documentElement.style.setProperty("--widget-font", serif ? SERIF_STACK : SANS_STACK);

  // Cap `WidgetShell`'s `main` at the host's container height (a STABLE px value), so long content
  // scrolls inside the card. NOT `100dvh` — inside the iframe that resolves to the current iframe
  // height, which collapses the cap during the host's max-content autoResize measurement and pins
  // the widget at its min-height floor. When the host sends no dimensions, `--widget-max-h` stays
  // unset and `WidgetShell` falls back to no cap (the widget grows; the host page scrolls).
  const cd = ctx?.containerDimensions;
  const maxH = typeof cd?.maxHeight === "number" ? cd.maxHeight : typeof cd?.height === "number" ? cd.height : null;
  // Always set it (to `none` when absent) so a host that drops dimensions on a later context change
  // clears a stale cap rather than leaving it; WidgetShell reads `var(--widget-max-h, none)`.
  document.documentElement.style.setProperty(
    "--widget-max-h",
    maxH !== null && Number.isFinite(maxH) && maxH > 0 ? `${maxH.toString()}px` : "none",
  );
}
