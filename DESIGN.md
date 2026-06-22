---
name: mcp-paprika
description: The warm, editorial visual system for the two HTML surfaces of the Paprika MCP Connector — the in-host widgets and the OAuth consent screen.
colors:
  paprika: "oklch(0.543 0.174 30)"
  paprika-ink: "oklch(0.99 0.012 40)"
  fresh-green: "oklch(0.58 0.13 150)"
  fresh-green-ink: "oklch(0.99 0.02 150)"
  warn-amber: "oklch(0.66 0.12 75)"
  warn-amber-bg: "oklch(0.95 0.05 82)"
  alert-red: "oklch(0.56 0.215 29)"
  alert-red-bg: "oklch(0.955 0.042 27)"
  paper: "oklch(0.99 0.004 75)"
  card: "oklch(0.995 0.004 75)"
  ink: "oklch(0.27 0.012 72)"
  muted: "oklch(0.52 0.012 72)"
  faint: "oklch(0.64 0.01 72)"
  line: "oklch(0.91 0.007 72)"
  hover: "oklch(0.96 0.006 72)"
typography:
  title:
    fontFamily: "var(--widget-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif)"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "var(--widget-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif)"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "var(--widget-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif)"
    fontSize: "12px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "0.04em"
  mono:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "1.3rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
components:
  button-primary:
    backgroundColor: "{colors.paprika}"
    textColor: "{colors.paprika-ink}"
    rounded: "{rounded.md}"
    padding: "11px 14px"
    typography: "{typography.body}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "11px 14px"
    typography: "{typography.body}"
  pill-neutral:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "5px 11px"
  pill-accent:
    backgroundColor: "transparent"
    textColor: "{colors.paprika}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
  pill-danger:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "5px 12px"
  list-row:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "11px 16px"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
    padding: "20px 22px"
  toast:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
  brand-tile:
    backgroundColor: "{colors.paprika}"
    textColor: "{colors.paprika-ink}"
    rounded: "{rounded.sm}"
    size: "22px"
---

# Design System: mcp-paprika

## 1. Overview

**Creative North Star: "The Capable Kitchen"**

The two HTML surfaces of the Paprika MCP Connector should feel like a well-run kitchen: competent, unhurried, and quietly trustworthy. The home cook reaches a widget mid-task — standing in a store aisle, working at a stove — and the operator reaches the consent screen once, at the trust moment of first connect. Neither surface is a destination; both exist to let a person finish a thought and move on. The aesthetic is warm and food-forward but editorial — generous space, confident typography, an authority you trust on sight. The reference is NYT Cooking's warmth-with-restraint, never a bubbly consumer-recipe blog.

Warmth here is structural, not decorative. Every neutral carries a faint warm cast (hue ~72) so the surfaces sit native inside a host's warm UI and so paper reads like paper, not like a cold gray dashboard. Color is rationed and always means something: a single paprika identity accent, a green that means _done_ or _fresh_, an amber that means _expiring_, a red that means _danger_. Depth is nearly absent — flat lists, one hairline separator per category, a shadow only on the one thing that genuinely floats. The type voice matches the shell: a widget adopts the host's own typeface through the app SDK — a serif in a serif-first host like Claude, the host's sans otherwise — so it sits native and ships zero web font of its own; the consent page uses the OS system font for the same reason.

This system explicitly rejects four things. It is not generic AI/SaaS dashboard slop — no gradient text, no tracked-uppercase eyebrows over every section, no glassmorphism, no hero-metric templates. It is not enterprise/admin-console heaviness — no gray-on-gray chrome, no heavy borders, no table-everything density where a calm list belongs. It is not a cutesy consumer recipe app — no over-illustration, no bubbly-rounded everything, no emoji-soup, no playful display fonts in UI labels. And the consent screen is never security theater — no red warning banners, no fear copy, no phishy urgency.

**Key Characteristics:**

- Warm-neutral foundation (hue ~72) — paper, not gray; native inside a warm host.
- One identity color (paprika), the rest semantic or neutral; color always carries meaning.
- Host-matched typography — the widget adopts the shell's typeface (serif in a serif-first host, the host's sans otherwise) and ships no web font of its own.
- Flat by default; one separator per category, and a shadow only on something genuinely floating.
- Touch-native affordances (tap targets, swipe-with-fallback) borrowed from the OS, not invented.
- Calm at the trust moment — legibility over alarm.

## 2. Colors

A rationed, food-warm palette: one brand identity color, three semantic signals, and a warm-neutral ramp shared verbatim across both surfaces.

### Primary

- **Paprika** (`oklch(0.543 0.174 30)` light / `oklch(0.7 0.155 33)` dark, `#C0392B`): The connector's one identity color, and the single interactive accent on both surfaces — the header "P" tile, focus rings, the **Restock** pill, and the toast's **Undo** on the widgets; the brand dot and the **Allow** button on the consent screen. An earthy, brick-like red. It nods to the Paprika app it bridges without claiming that brand. Used sparingly, as identity and action, never as decoration.

### Secondary — Semantic signals

- **Fresh Green** (`oklch(0.58 0.13 150)` light / `oklch(0.74 0.14 150)` dark): The _done / fresh_ state — a checked grocery item's box and tick, an in-stock pantry item. A completed action reads positive, never as a red "done."
- **Warn Amber** (`oklch(0.66 0.12 75)`, surface `oklch(0.95 0.05 82)`): _Expiring soon_ — the pantry's expiry badge before it lapses.
- **Alert Red** (`oklch(0.56 0.215 29)` light / `oklch(0.7 0.2 29)` dark, surface `oklch(0.955 0.042 27)`): _Danger / expired_ — the destructive-action confirm, the inline error toast, an expired pantry badge, the swipe-to-remove reveal. A vivid fire-engine red, deliberately more saturated than the earthy brick brand, so an alert never reads as the brand.

### Neutral — Warm paper

- **Paper** (`oklch(0.99 0.004 75)` light / `oklch(0.22 0.008 72)` dark): The base background. Warm, near-white in light; warm charcoal in dark.
- **Card** (`oklch(0.995 0.004 75)`): The one raised surface — the consent screen's card, lifted a hair above the page.
- **Ink** (`oklch(0.27 0.012 72)` light / `oklch(0.95 0.005 75)` dark): Primary text.
- **Muted** (`oklch(0.52 0.012 72)`): Secondary text — quantities, sub-labels, resting pill text.
- **Faint** (`oklch(0.64 0.01 72)`): Tertiary text and the strikethrough on a done row.
- **Line** (`oklch(0.91 0.007 72)` light / `oklch(0.31 0.01 72)` dark): Hairline dividers and borders — 1px, never a heavy stroke.
- **Hover** (`oklch(0.96 0.006 72)`): The hover wash and the neutral toast surface.

The widget surface themes to the host (light/dark, lightness shifts while hue holds); the consent screen is light-only by design.

### Named Rules

**The One Identity Color Rule.** Paprika is the only identity color on either surface. Everything else is neutral or a semantic signal. If a color isn't paprika and isn't carrying state, it's a warm neutral.

**The Two-Reds Rule.** Paprika-red is _identity_; alert-red is _danger_; they must never blur into each other. The brand is one earthy paprika-red everywhere — it is not shifted or re-hued per surface. Danger is a separate, vivid fire-engine red, deliberately more saturated, so the two warm reds stay legible apart when they share a view (a paprika brand tile in the header, an alert-red expired badge in a row). Brand and danger are never the same red.

**The Green-Means-Done Rule.** A completed or fresh state is always green, never a red checkmark. Done is a positive, and the color says so.

## 3. Typography

**Body Font:** host-matched. The widget resolves `--widget-font` to the shell's typeface — a serif stack (`"Anthropic Serif", Georgia, "Times New Roman", ui-serif, serif`) for a serif-first host like Claude, the host's own `--font-sans` otherwise, falling back to the OS system sans (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). The consent page uses a fixed **editorial serif** (`Georgia, "Times New Roman", ui-serif, serif`) — a deliberate brand choice, not host-matched: it is server-rendered with no host shell to inherit from, so it picks an editorial register that rhymes with the widgets' serif voice while keeping its monospace redirect-host anchor.
**Display Font:** none — there is no separate display face; weight and size carry the hierarchy.
**Mono Font:** `ui-monospace, "SF Mono", Menlo, monospace` — reserved for exactly one thing (see The Mono-Anchor Rule).

**Character:** Quiet, native, and trustworthy. The widget speaks in the host's own voice — adopting the shell's typeface so it reads as part of the surrounding app, not a foreign embed. In a serif-first host like Claude this lands the NYT-Cooking editorial register the brand is tuned to; in a sans host it matches the host's sans. There is no separate display face and the widget ships no web font of its own — the personality comes from spacing, weight, color, and the host's type, not from a bespoke typeface.

### Hierarchy

- **Title** (weight 650, 17px, line-height 1.2, letter-spacing -0.01em): The widget header name and the consent client name. The most prominent type on a surface; there is nothing larger except the mono anchor.
- **Body** (weight 400, 15px, line-height 1.45): Row labels, grant copy, descriptions. The reading default.
- **Label** (weight 650, 12px, letter-spacing 0.04em, uppercase): Aisle/group headers and the consent screen's field labels — muted, quietly tracked, never shouting.
- **Quantity / meta** (13px, muted, `font-variant-numeric: tabular-nums`): The ` · quantity` after an ingredient and other secondary metadata; tabular figures so columns of numbers align.
- **Mono anchor** (weight 700, 1.3rem, monospace): The OAuth redirect host on the consent screen — the largest, most deliberate element on that surface.

### Named Rules

**The Match-the-Shell Rule.** A widget adopts the host's typeface, not its own — through the app SDK's style channel (`--font-sans` and the host's font CSS), choosing a serif register for serif-first hosts and the host's sans otherwise, falling back to the system font. It ships no web font of its own. The security-critical consent page is not embedded, so it cannot match a shell — it uses a fixed editorial serif as a deliberate brand choice, keeping its monospace redirect-host anchor. Nativeness and a zero-payload iframe beat a bespoke webfont here.

**The Mono-Anchor Rule.** The one element rendered in monospace is the OAuth redirect host — the single fact an attacker cannot forge. It gets the largest, most tamper-evident treatment on the screen precisely because it is the fact the user must read. Monospace is reserved for it; nothing decorative borrows the mono face.

## 4. Elevation

This system is flat by default. Surfaces sit directly on the warm paper, separated by 1px hairline dividers (`line`) and by warm tonal shifts (`hover` for a resting wash), not by shadow. Depth is conveyed by layering warm neutrals, not by stacking drop-shadows. A shadow appears only on an element that is _genuinely floating_ above the surface — and there are exactly two.

### Shadow Vocabulary

- **Floating toast** (`box-shadow: 0 8px 24px -12px oklch(0 0 0 / 0.5)`): The widget toast, which overlays the list at the top of the viewport. The negative spread keeps it a soft lift, not a hard drop.
- **Lifted card** (`box-shadow: 0 1px 2px oklch(0.5 0.02 70 / 0.05), 0 8px 24px oklch(0.5 0.02 70 / 0.06)`): The consent screen's card, lifted a hair off the page. Two layers — a tight contact shadow plus a diffuse ambient one — both warm-tinted and very low alpha.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. A shadow is a signal that something is floating (the toast) or lifted off the page (the consent card) — never decoration on a resting list, a row, or a button. If it isn't floating, it has no shadow.

## 5. Components

Every component leads with its character, then its exact shape, color, and state treatment. Buttons and rows are the load-bearing primitives; the brand mark and the destination anchor are the signature pieces.

### Buttons

The surface has two button families: the consent screen's full-width action buttons, and the widgets' compact action pills.

- **Shape:** Action buttons are gently rounded (10px). Pills are fully round (999px).
- **Primary (consent Allow):** Paprika fill (`paprika`) with light ink (`paprika-ink`), weight 600, padding 11px 14px, radius 10px. The single emphatic control on the trust surface.
- **Ghost (consent Deny):** Transparent with ink text and a 1px `line-2` border, same size as Primary. Deny is given equal visual weight to Allow — the screen does not steer.
- **Pills (widget actions):** 12px/600 text, padding ~5px 11px, fully round, 1px `line` border, transparent fill. Variants: **neutral** (muted → ink on hover, hover wash — grocery's Clear/Keep), **accent** (`paprika` outline + text — pantry's Restock), **danger** (muted → alert-red on hover — pantry's Out), **danger-strong** (alert-red outline + text at rest — grocery's clear-confirm).
- **Focus:** Pills and rows show a 2px `paprika` focus ring, offset 2px. Always visible on keyboard focus; never suppressed.
- **Adaptive outline border:** A button or control outline that sits on a non-base surface (an expanded detail strip, which uses the `hover` background) borders with `1px solid color-mix(in oklch, var(--ink) 22%, transparent)` — a percentage of the theme's own ink — not the fixed `line` token. `line` is tuned for separators on the base surface and washes out against the darker `hover` fill, especially in dark mode; mixing from ink keeps the outline legible on either surface, light or dark. Prefer it over `line` for control outlines off the base surface.

### Chips / Badges

- **Style:** The pantry expiry badge — a fully round (999px) pill, 12px text, padding 1px 7px.
- **State:** **soon** uses `warn-amber` on its amber surface; **expired** uses `alert-red` on its red surface. The badge is the row's only color, so the state reads at a glance.

### Cards / Containers

- **Corner Style:** Cards use the large radius (14px); the consent card is the only true card.
- **Background:** `card` over `paper`.
- **Shadow Strategy:** The lifted-card shadow from Elevation — the one place a container is allowed to lift.
- **Border:** 1px `line`.
- **Internal Padding:** 20px 22px (the consent body).

### List Rows

- **Style:** Full-width rows on `paper`, padding 11px 16px — never boxed cards, and **no per-row divider**. The ingredient name leads; a ` · quantity` follows in muted tabular figures (the separator is a real space on both sides of the `·`, so a done strike-through runs straight through it).
- **Done state:** The name strikes through and dims to `faint` (a `color-mix` line color, never a harsh strike); a grocery checkbox (6px-radius, 2px border) fills with `fresh-green` and shows a green tick; an in-flight write shows a small `fresh-green` spinner.
- **Grouped by aisle:** Each category is bracketed by a **full-width hairline separator** above its sticky, uppercase 12px `muted` heading (with a count as flavor text beside it); rows within a group flow without internal lines. One separator per category, not a line per row. The heading and its count baseline-align.

### Rating Dots (signature)

A quieter, on-brand alternative to star glyphs: five small (~5px) dots, right-aligned on a browse row, filled to the recipe's 0–5 rating in `paprika`; unfilled dots are the same color at 0.2 opacity. Rating reads as a compact density mark rather than a literal row of stars. The group carries an accessible name ("Rated N of 5"); the dots themselves are decorative.

### Placeholder Tile (signature)

A 48px rounded (8px) color tile standing in for a recipe photo until real thumbnails exist. Its hue is derived deterministically from the recipe name's character codes, mapped into the **food range** — hue 38–130 (ambers through greens) — with lightness and chroma fixed per theme (L ~0.7 light / ~0.32 dark, C 0.06). The reserved ranges keep it from colliding with meaning: **hue 22–35** is the paprika/brand red (never a tile), and **hue 130+** trends to the success green. The result is a palette of food-adjacent hues that read as intentional, not as a default gray. Any widget generating color-coded placeholder tiles follows this range.

### Toast

- **Style:** A floating status strip at the top of the widget, radius 10px, padding 9px 12px, with the floating-toast shadow.
- **Variants:** **info** is the neutral `hover` surface with ink text; **error** is the `alert-red` surface with alert-red text. An optional action (the pantry Undo) renders in `paprika`.
- **Motion:** A 0.2s ease-out entrance, fully disabled under `prefers-reduced-motion`.

### Brand Mark (signature)

The connector's identity on the widget surface: a 22px paprika-red tile (6px radius) carrying a bold "P" in light ink, beside the widget title (17px/650). The tile is decorative — `aria-hidden`, the title carries the accessible name. It gives every widget a persistent, on-brand header without a logo image.

### Destination Anchor (signature)

The consent screen's load-bearing element: a soft warm panel (`dest-bg`, 11px radius) labeled "Authorization code will be sent to", containing the redirect host in large monospace (1.3rem/700). It is the visual climax of the trust moment — the one fact the user must verify, given the most deliberate, tamper-evident treatment on the page. Everything else on the screen defers to it.

## 6. Do's and Don'ts

### Do:

- **Do** ration color: one paprika identity accent, plus green (done/fresh), amber (expiring), red (danger). If a color isn't paprika and isn't carrying state, make it a warm neutral.
- **Do** keep paprika-red for _identity_ (one earthy red, every surface) and a vivid fire-engine red for _danger_ — distinct enough that they never blur where they share a view (The Two-Reds Rule).
- **Do** render _done_ and _fresh_ in green; a checkmark is satisfying, never a red "done."
- **Do** match the shell's typeface via the host style channel (`--font-sans` / the host's font CSS — serif for a serif-first host, the host's sans otherwise); reserve monospace for the OAuth redirect host alone.
- **Do** keep surfaces flat — one hairline separator per category and warm tonal shifts for separation; a shadow only on the toast and the consent card.
- **Do** keep the warm cast on every neutral (hue ~72) so the surfaces sit native in a warm host.
- **Do** borrow native affordances — real tap targets, swipe-to-act with a visible-button fallback — rather than inventing new ones.
- **Do** keep the consent screen calm and legible: anchor on the redirect host, state the grant plainly, give Deny equal weight to Allow.

### Don't:

- **Don't** ship generic AI/SaaS dashboard slop — no gradient text, no tracked-uppercase eyebrows over every section, no identical icon-card grids, no glassmorphism, no hero-metric templates.
- **Don't** drift into enterprise/admin-console heaviness — no gray-on-gray chrome, no heavy borders, no table-everything density where a calm list belongs.
- **Don't** go cutesy consumer recipe app / food blog — no over-illustration, no bubbly-rounded everything, no emoji-heavy labels, no playful display fonts in UI. NYT Cooking, not a cutesy food blog.
- **Don't** make the consent screen scary security-theater — no red warning banners, no fear copy, no phishy urgency. The redirect-approval earns trust by being legible and calm, never by shouting.
- **Don't** use a cold or pure-gray neutral; paper is warm.
- **Don't** add a shadow to a resting list, row, or button; flat is the default.
- **Don't** divide rows within a category with per-row hairlines — one full-width separator per category, never a line per item.
- **Don't** ship a web font of your own to the widget iframe or the consent page — adopt the host's typeface instead.
- **Don't** blur the brand red and the danger red — keep the brand earthy and the alert vivid, never the same red in the same view.
