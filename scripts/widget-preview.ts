/**
 * Dev-only widget preview server: browse the built `dist/widgets/*.html` in a plain browser tab with
 * a fake host shim, no MCP host and no Paprika required. It mounts the preview router
 * ({@link buildWidgetPreviewRouter}) — the same one the HTTP transport gates behind
 * `MCP_WIDGET_PREVIEW` — WITHOUT booting the kernel or authenticating with Paprika, so it starts
 * instantly and offline. That boot-bypass is the whole reason this exists: `pnpm dev` authenticates
 * with Paprika at startup and aborts without credentials, so it can't serve a widget preview on its
 * own.
 *
 * The root `GET /` adds a dev-only INDEX: a card per widget with one-click "Light"/"Dark" links per
 * STATE (populated / empty / error / data variants), each carrying a baked sample payload below. The
 * shim answers every `callServerTool` a widget makes from a per-page, stateful mini-store seeded from
 * that payload — mutated in place by the handlers, so a re-read after mark/clear/move/add
 * reflects the action — which makes every round-trip a widget drives previewable here: the initial
 * result, add-item re-reads, clear/move-to-pantry (with an `elicitation=1` variant popping a native
 * `confirm()` in place of the host's dialog), meal-week navigation, and a recipe tap from any of the
 * three widgets that link one. The samples match each widget's structured-output shape
 * (`shared/server-types.ts`); they are display fixtures, not validated — the widgets discriminate the
 * payload by shape.
 *
 * Run it with `pnpm dev:preview` (port 8899, override with `PORT`), then open `http://127.0.0.1:8899/`
 * for the index, or hit `…/widget-preview?widget=<name>&theme=<light|dark>#payload=<json>` directly.
 * Build the widgets first (`pnpm build:widgets`, or `pnpm dev:widgets` to rebuild on change) — the
 * route reads `dist/widgets` per request, so a browser refresh picks up the latest build with no
 * restart.
 *
 * The payload rides the URL fragment (`#payload=`, never sent in the HTTP request) — untrusted but
 * never reflected either way: the shim reads it client-side and the widget JSON-parses it under its
 * own try/catch (see the router's header). `?payload=` remains a small hand-typed fallback, still
 * size-bounded. This server exists for local iteration only; it is not part of the production build.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { pino } from "pino";

import { buildWidgetPreviewRouter } from "../src/transport/widget-preview.js";

// ---------------------------------------------------------------------------
// Sample payloads — representative structured-output results per widget STATE,
// so the index can render each with a click. Shapes mirror `shared/server-types.ts`;
// UIDs are readable placeholders (never validated at render time), photos are null
// (the preview shim can't proxy `ui://` reads), and the pantry/meal-week dates are relative to
// the day the server starts, so the expiry badges and the week navigation always have a live
// "today" to work against.
// ---------------------------------------------------------------------------

// A local YYYY-MM-DD date `offset` days from today.
const isoDay = (offset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getFullYear().toString()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// Offset from today to this week's Monday.
const MONDAY = -((new Date().getDay() + 6) % 7);

const recipeRow = (
  uid: string,
  name: string,
  categories: readonly string[],
  rating: number,
  prep: string | null,
  cook: string | null,
  total: string | null,
  servings: string | null,
  opts: { readonly pinned?: boolean; readonly onList?: boolean } = {},
): unknown => ({
  uid,
  name,
  categories,
  rating,
  prepTime: prep,
  cookTime: cook,
  totalTime: total,
  servings,
  isPinned: opts.pinned ?? false,
  onGroceryList: opts.onList ?? false,
  created: "2026-01-15T12:00:00.000Z",
  photoResourceUri: null,
});

// Shared recipe rows, reused across the menu / recipe-browser / meal-plan samples.
const R_BENEDICT = recipeRow(
  "recipe-eggs-benedict",
  "Eggs Benedict",
  ["Brunch"],
  5,
  "15 min",
  "15 min",
  "30 min",
  "2",
  { pinned: true },
);
const R_CHICKEN = recipeRow(
  "recipe-roast-chicken",
  "Roast Chicken with Schmaltz",
  ["Dinner"],
  4,
  "20 min",
  "75 min",
  "95 min",
  "4",
);
const R_STEAK = recipeRow(
  "recipe-bearnaise-steak",
  "Béarnaise Steak",
  ["Dinner"],
  5,
  "10 min",
  "15 min",
  "25 min",
  "2",
);
const R_TART = recipeRow("recipe-lemon-tart", "Lemon Tart", ["Dessert"], 3, "30 min", "25 min", "55 min", "8", {
  onList: true,
});
const LIBRARY = [R_BENEDICT, R_CHICKEN, R_STEAK, R_TART];

const MEAL_TYPES = [
  { uid: "mt-breakfast", name: "Breakfast" },
  { uid: "mt-lunch", name: "Lunch" },
  { uid: "mt-dinner", name: "Dinner" },
];

// --- cooking -----------------------------------------------------------------
const COOK_MULTISTEP = {
  recipe_uid: "recipe-eggs-benedict",
  name: "Eggs Benedict",
  servings: "2",
  totalTime: "30 min",
  prepTime: "15 min",
  photoResourceUri: null,
  ingredients: [
    { text: "2 egg yolks", group: "Sauce" },
    { text: "1 stick butter, melted", group: "Sauce" },
    { text: "1 tbsp lemon juice", group: "Sauce" },
    { text: "4 eggs", group: "To assemble" },
    { text: "2 English muffins", group: "To assemble" },
  ],
  prep: { activeMin: 12, passiveWaitMin: 0 },
  steps: [
    {
      text: "Separate the yolks and melt the butter.",
      group: "Sauce",
      ingredientRefs: [0, 1],
      produces: null,
      usesIntermediate: [],
      phase: "prep",
    },
    {
      text: "Whisk the yolks and lemon over a bain-marie, then stream in the warm butter until the sauce holds.",
      group: "Sauce",
      ingredientRefs: [2],
      produces: "lemon sauce",
      usesIntermediate: [],
      phase: "cook",
    },
    {
      text: "Poach the eggs, toast the muffins, and spoon the sauce over the top.",
      group: "To assemble",
      ingredientRefs: [3, 4],
      produces: null,
      usesIntermediate: ["lemon sauce"],
      phase: "cook",
    },
  ],
};

// No cook-phase steps → the stepper is just prep → straight to the done screen (cookCount 0, the
// progress-bar terminal edge case).
const COOK_NOCOOK = {
  recipe_uid: "recipe-salmon-tartine",
  name: "Smoked Salmon Tartine",
  servings: "2",
  totalTime: "10 min",
  prepTime: "10 min",
  photoResourceUri: null,
  ingredients: [
    { text: "2 slices sourdough", group: null },
    { text: "4 oz smoked salmon", group: null },
    { text: "2 tbsp crème fraîche", group: null },
    { text: "1 tbsp capers", group: null },
    { text: "Dill, to finish", group: null },
  ],
  prep: { activeMin: 8, passiveWaitMin: 0 },
  steps: [
    {
      text: "Toast the sourdough.",
      group: null,
      ingredientRefs: [0],
      produces: null,
      usesIntermediate: [],
      phase: "prep",
    },
    {
      text: "Spread the crème fraîche, layer the salmon, scatter capers and dill.",
      group: null,
      ingredientRefs: [1, 2, 3, 4],
      produces: null,
      usesIntermediate: [],
      phase: "prep",
    },
  ],
};

// --- grocery -----------------------------------------------------------------
const GROCERY = {
  uid: "grocery-brunch",
  name: "Weekend Brunch",
  items: [
    { uid: "g1", ingredient: "Eggs", quantity: "1 dozen", aisle: "Dairy & Eggs", purchased: false },
    { uid: "g2", ingredient: "Unsalted butter", quantity: "2 sticks", aisle: "Dairy & Eggs", purchased: true },
    { uid: "g3", ingredient: "Lemons", quantity: "3", aisle: "Produce", purchased: false },
    { uid: "g4", ingredient: "Asparagus", quantity: "1 bunch", aisle: "Produce", purchased: false },
    { uid: "g5", ingredient: "English muffins", quantity: "1 pack", aisle: "Bakery", purchased: false },
    { uid: "g6", ingredient: "Canadian bacon", quantity: "8 oz", aisle: "Meat", purchased: true },
  ],
};
const GROCERY_EMPTY = { uid: "grocery-empty", name: "New List", items: [] };
// Every row already purchased — load this, then tap Clear (twice: the inline confirm, then Clear
// again) to walk the real path to the "List's clear" all-cleared state, since that state is reached
// by the clear interaction, not expressible as a static initial payload.
const GROCERY_ALL_PURCHASED = {
  uid: "grocery-brunch",
  name: "Weekend Brunch",
  items: GROCERY.items.map((item) => ({ ...item, purchased: true })),
};

// --- pantry ------------------------------------------------------------------
const PANTRY = {
  items: [
    {
      uid: "p1",
      ingredient: "Cayenne pepper",
      quantity: "1 jar",
      aisle: "Spices",
      inStock: true,
      expirationDate: null,
    },
    {
      uid: "p2",
      ingredient: "White wine vinegar",
      quantity: "1 bottle",
      aisle: "Condiments",
      inStock: true,
      expirationDate: null,
    },
    {
      uid: "p3",
      ingredient: "Heavy cream",
      quantity: "1 pint",
      aisle: "Dairy & Eggs",
      inStock: true,
      expirationDate: isoDay(3),
    },
    {
      uid: "p4",
      ingredient: "Crème fraîche",
      quantity: "1 tub",
      aisle: "Dairy & Eggs",
      inStock: true,
      expirationDate: isoDay(-10),
    },
    { uid: "p5", ingredient: "Egg yolks", quantity: null, aisle: "Dairy & Eggs", inStock: false, expirationDate: null },
  ],
};
const PANTRY_EMPTY = { items: [] };
// Every item out of stock — the drawer auto-opens and is the whole surface (the onboard state the
// widget designs for; restocking from here sends rows back to their aisles).
const PANTRY_ALL_OUT = { items: PANTRY.items.map((item) => ({ ...item, inStock: false })) };

// --- menu --------------------------------------------------------------------
const MENU = {
  uid: "menu-brunch-weekend",
  name: "Brunch Weekend",
  days: 2,
  notes: "Slow mornings, two ways.",
  items: [
    // `day` is 1-indexed, matching the Paprika wire (docs/wire-captures/menus.har.json) — the
    // widget clamps day to ≥1, so a 0 here silently mis-buckets into Day 1.
    {
      uid: "m1",
      day: 1,
      name: "Eggs Benedict",
      typeUid: "mt-breakfast",
      typeName: "Breakfast",
      recipeUid: "recipe-eggs-benedict",
      recipe: R_BENEDICT,
    },
    { uid: "m2", day: 1, name: "Mimosas", typeUid: "mt-brunch", typeName: "Brunch", recipeUid: null, recipe: null },
    {
      uid: "m3",
      day: 2,
      name: "Asparagus with lemon butter",
      typeUid: "mt-lunch",
      typeName: "Lunch",
      recipeUid: null,
      recipe: null,
    },
  ],
};
const MENU_EMPTY = { uid: "menu-empty", name: "Blank Menu", days: 3, notes: "", items: [] };

// --- meal-week ---------------------------------------------------------------
const WEEK = {
  weekStart: isoDay(MONDAY),
  meals: [
    {
      uid: "w1",
      date: isoDay(MONDAY),
      name: "Overnight oats",
      recipeUid: null,
      typeUid: "mt-breakfast",
      typeName: "Breakfast",
      scale: null,
    },
    {
      uid: "w2",
      date: isoDay(MONDAY + 2),
      name: "Eggs Benedict",
      recipeUid: "recipe-eggs-benedict",
      typeUid: "mt-breakfast",
      typeName: "Breakfast",
      scale: null,
    },
    {
      uid: "w3",
      date: isoDay(MONDAY + 2),
      name: "Roast chicken",
      recipeUid: "recipe-roast-chicken",
      typeUid: "mt-dinner",
      typeName: "Dinner",
      scale: "×2",
    },
    {
      uid: "w4",
      date: isoDay(MONDAY + 4),
      name: "Buttermilk pancakes",
      recipeUid: null,
      typeUid: "mt-breakfast",
      typeName: "Breakfast",
      scale: null,
    },
  ],
  mealTypes: MEAL_TYPES,
};
const WEEK_EMPTY = { weekStart: isoDay(MONDAY), meals: [], mealTypes: MEAL_TYPES };

// --- recipe-browser ----------------------------------------------------------
const BROWSE_LIST = { context: { source: "list" }, total: 4, items: LIBRARY };
const BROWSE_SEARCH = { context: { source: "search", query: "eggs" }, total: 2, items: [R_BENEDICT, R_STEAK] };
const BROWSE_DISCOVER = {
  context: { source: "discover", query: "rich, savory brunch" },
  total: 3,
  items: [R_BENEDICT, R_STEAK, R_CHICKEN],
};
const BROWSE_EMPTY = { context: { source: "list" }, total: 0, items: [] };
const BROWSE_SEARCH_EMPTY = { context: { source: "search", query: "durian soufflé" }, total: 0, items: [] };

// ---------------------------------------------------------------------------

interface Variant {
  readonly label: string;
  readonly payload?: unknown; // omitted → no result (the `demo` widget)
  // A raw, non-JSON string handed to the shim verbatim: `JSON.parse` fails, so `structuredContent`
  // stays undefined and the widget takes its error path with this as the message (a clean error
  // state — the object `payload` would instead be dumped as JSON by the shim's text-content mirror).
  readonly rawText?: string;
  // Adds `&elicitation=1` to the link, so the shim's native confirm() stands in for the server gate.
  readonly elicitation?: boolean;
}
interface WidgetSample {
  readonly name: string;
  readonly title: string;
  readonly blurb: string;
  readonly variants: readonly Variant[];
}

// Pre-scale a payload's items (unique-suffixed uids) so stress variants carry REAL rows whose
// uids the shim's mini-store lookups can resolve.
const scaleItems = <T extends { readonly items: readonly { readonly uid: string }[] }>(
  payload: T,
  copies: number,
): T => ({
  ...payload,
  items: Array.from({ length: copies }, (_, copy) =>
    payload.items.map((item) => ({ ...item, uid: `${item.uid}-${copy}` })),
  ).flat(),
});

const WIDGETS: readonly WidgetSample[] = [
  {
    name: "cooking",
    title: "Cooking",
    blurb: "Step-anchored cook flow — drive to the last step (bar fills → sheen), then Finish → the completion beat.",
    variants: [
      { label: "Multi-step", payload: COOK_MULTISTEP },
      { label: "No-cook (assembly)", payload: COOK_NOCOOK },
      { label: "Error", rawText: "That recipe isn’t in your library yet — try searching for it first." },
    ],
  },
  {
    name: "grocery-checklist",
    title: "Grocery checklist",
    blurb: "Tap to check off; grouped by aisle, checked items sink to the bottom of their group.",
    variants: [
      { label: "Populated", payload: GROCERY },
      { label: "Empty", payload: GROCERY_EMPTY },
      { label: "All purchased (tap Clear ×2 for “list’s clear”)", payload: GROCERY_ALL_PURCHASED },
      {
        label: "All purchased + server confirm (elicitation)",
        payload: GROCERY_ALL_PURCHASED,
        elicitation: true,
      },
      { label: "Very large list (240 items)", payload: scaleItems(GROCERY, 40) },
    ],
  },
  {
    name: "pantry-checklist",
    title: "Pantry",
    blurb:
      "In-stock checklist with expiry badges (amber “soon”, red “expired”); out-of-stock items drop into the drawer — swipe on touch, a hover-revealed button on pointer.",
    variants: [
      { label: "Stocked + expiring", payload: PANTRY },
      { label: "All out of stock (drawer auto-opens)", payload: PANTRY_ALL_OUT },
      { label: "Stocked + server confirm on drawer clear (elicitation)", payload: PANTRY, elicitation: true },
      { label: "Empty", payload: PANTRY_EMPTY },
      { label: "Very large pantry (150 items)", payload: scaleItems(PANTRY, 30) },
    ],
  },
  {
    name: "menu",
    title: "Menu",
    blurb: "A planned menu grouped by day and meal type — a linked recipe row plus freeform items.",
    variants: [
      { label: "Populated", payload: MENU },
      { label: "Empty", payload: MENU_EMPTY },
    ],
  },
  {
    name: "meal-week-planner",
    title: "Meal week planner",
    blurb: "A week grid of planned meals by day and meal type; tap a day to see its slots.",
    variants: [
      { label: "Planned week", payload: WEEK },
      { label: "Empty week", payload: WEEK_EMPTY },
    ],
  },
  {
    name: "recipe-browser",
    title: "Recipe browser",
    blurb:
      "Your library with a category filter and rating/alpha sort; the header + sort adapt to the source. Type a no-match query in the search box to reach the filtered-empty state.",
    variants: [
      { label: "Library (list)", payload: BROWSE_LIST },
      { label: "Search results", payload: BROWSE_SEARCH },
      { label: "Discover", payload: BROWSE_DISCOVER },
      { label: "Empty library (first run)", payload: BROWSE_EMPTY },
      { label: "No search results", payload: BROWSE_SEARCH_EMPTY },
    ],
  },
  {
    name: "demo",
    title: "Demo",
    blurb: "The build-pipeline proof — needs no payload.",
    variants: [{ label: "Default" }],
  },
];

const encode = (payload: unknown): string => encodeURIComponent(JSON.stringify(payload));

const previewHref = (name: string, v: Variant, theme: "light" | "dark"): string => {
  const base = `/widget-preview?widget=${name}&theme=${theme}${v.elicitation ? "&elicitation=1" : ""}`;
  if (v.rawText !== undefined) return `${base}#payload=${encodeURIComponent(v.rawText)}`;
  return v.payload === undefined ? base : `${base}#payload=${encode(v.payload)}`;
};

const renderIndex = (): string => {
  const cards = WIDGETS.map((w) => {
    const rows = w.variants
      .map(
        (v) => `<div class="variant"><span class="vlabel">${v.label}</span>
          <span class="vlinks"><a href="${previewHref(w.name, v, "light")}">Light</a>
          <a class="dark" href="${previewHref(w.name, v, "dark")}">Dark</a></span></div>`,
      )
      .join("\n");
    return `<article class="card"><h2>${w.title}</h2><p>${w.blurb}</p><div class="variants">${rows}</div></article>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mcp-paprika · widget preview</title>
<style>
  :root { color-scheme: light }
  * { box-sizing: border-box }
  body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         max-width: 900px; margin: 0 auto; padding: 40px 20px 64px;
         background: oklch(0.99 0.004 75); color: oklch(0.27 0.012 72) }
  header h1 { font-size: 22px; font-weight: 650; letter-spacing: -0.01em; margin: 0 0 6px }
  header p { color: oklch(0.5 0.012 72); margin: 0 0 4px; max-width: 64ch }
  code { background: oklch(0.94 0.008 72); padding: 1px 6px; border-radius: 6px; font-size: 13px }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; margin-top: 28px }
  .card { border: 1px solid oklch(0.91 0.007 72); border-radius: 14px; padding: 16px 16px 8px;
          background: oklch(0.995 0.004 75) }
  .card h2 { font-size: 15px; font-weight: 650; margin: 0 0 5px }
  .card p { font-size: 12.5px; color: oklch(0.5 0.012 72); margin: 0 0 10px }
  .variant { display: flex; align-items: center; justify-content: space-between; gap: 10px;
             padding: 7px 0; border-top: 1px solid oklch(0.93 0.007 72) }
  .vlabel { font-size: 13px; font-weight: 550 }
  .vlinks { display: flex; gap: 6px; flex: none }
  .vlinks a { text-decoration: none; font-size: 12px; font-weight: 650; padding: 4px 10px; border-radius: 999px;
              background: oklch(0.5 0.174 30); color: oklch(0.99 0.012 40) }
  .vlinks a.dark { background: oklch(0.28 0.012 72); color: oklch(0.7 0.155 33) }
  .vlinks a:hover { filter: brightness(1.06) }
  footer { margin-top: 30px; font-size: 12.5px; color: oklch(0.56 0.012 72); border-top: 1px solid oklch(0.91 0.007 72); padding-top: 16px }
  footer b { color: oklch(0.34 0.012 72) }
  footer p { margin: 0 0 8px }
</style></head><body>
  <header>
    <h1>mcp-paprika widget preview</h1>
    <p>One click renders a widget state with sample data through the fake host shim — no MCP host, no Paprika. Rebuild with <code>pnpm dev:widgets</code> and refresh to see edits.</p>
  </header>
  <div class="grid">${cards}</div>
  <footer>
    <p><b>Previewable here</b> = anything the initial result expresses (populated / empty / error / data variants); local-only interactions (the cooking flow &amp; done screen, grocery/pantry check-off &amp; swipe, the recipe-browser filter/sort/search box); and every round-trip a widget drives through the shim's stateful mini-store — mark/clear/move-to-pantry with the re-read that follows (including items marked earlier in the same session), the re-add echo, meal-week prev/next navigation and its mid-week realign, an elicitation confirm <em>and</em> its decline via the native <code>confirm()</code> dialog (the "elicitation" variants), and a recipe tap from any of the three linking widgets — <code>read_recipe</code> returns the tapped row's own name (menu rows also carry servings/time from their nested recipe), so the browse&nbsp;&rarr;&nbsp;detail swap (with the recipe-browser's View Transition) opens correctly everywhere.</p>
    <p><b>Not previewable</b> (needs a live host): the error toasts a <em>failing</em> round-trip triggers — the shim never errs, so a network-failure state can't be reproduced offline.</p>
    <p><b>Reduced motion:</b> DevTools → ⋮ → More tools → Rendering → emulate <code>prefers-reduced-motion: reduce</code>, then reload — widgets should look identical, just without entrances. Cover photos show as placeholder tiles (the shim can't proxy <code>ui://</code> reads).</p>
  </footer>
</body></html>`;
};

const PORT = Number(process.env["PORT"] ?? 8899);
const log = pino({ level: process.env["LOG_LEVEL"] ?? "warn" });

const app = new Hono();
// Dev index first, then the shared preview router (owns `/widget-preview`).
app.get("/", (c) => c.html(renderIndex()));
app.route("/", buildWidgetPreviewRouter(log.child({ component: "widget-preview" })));

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
  // process.stdout.write, not console.log: the repo's no-console rule lints scripts/ too (matches
  // build-widgets.ts). This is a dev CLI, never on the MCP wire.
  process.stdout.write(
    `widget preview → http://127.0.0.1:${info.port.toString()}/  (one-click index)\n` +
      `  build first with \`pnpm build:widgets\`; direct: …/widget-preview?widget=<name>&theme=dark\n`,
  );
});
