<script lang="ts">
  import type { App } from "@modelcontextprotocol/ext-apps";

  import { onMount } from "svelte";

  import Chevron from "../shared/Chevron.svelte";
  import PillButton from "../shared/PillButton.svelte";
  import RatingDots from "../shared/RatingDots.svelte";
  import RecipeDetail from "../shared/RecipeDetail.svelte";
  import RecipeThumb from "../shared/RecipeThumb.svelte";
  import Spinner from "../shared/Spinner.svelte";
  import StatusScreen from "../shared/StatusScreen.svelte";
  import Toast from "../shared/Toast.svelte";
  import WidgetShell from "../shared/WidgetShell.svelte";
  import {
    blobDataUri,
    callTool,
    connectHost,
    errorText,
    readResource,
    type ReceivedResult,
  } from "../shared/host-bridge.js";
  import {
    parseRecipeDetail,
    type RecipeDetailData,
  } from "../shared/recipe-detail.js";
  import { nameTile } from "../shared/tile.js";

  // The per-recipe metadata read_menu denormalizes onto a recipe-linked row (a slice of the
  // shared recipeRowSchema — only the fields a row renders). Null for a freeform item and for a
  // dangling link (a recipeUid whose recipe is gone from the local store) — both stay name-only.
  interface RecipeMeta {
    rating: number;
    prepTime: string | null;
    cookTime: string | null;
    totalTime: string | null;
    photoResourceUri: string | null;
  }
  // One menu item, as read_menu's structuredContent emits it (menuItemRowSchema). A recipe-linked
  // row with `recipe` metadata renders rich (cover thumb + rating + one time, like recipe-browse);
  // tapping it reads the full recipe (read_recipe → shared RecipeDetail). A freeform item
  // (recipeUid: null) has no recipe to open, so it renders muted and non-tappable; a dangling link
  // (recipeUid set, recipe null) stays tappable but name-only.
  interface MenuItem {
    uid: string;
    day: number;
    name: string;
    typeName: string | null;
    recipeUid: string | null;
    recipe: RecipeMeta | null;
  }
  interface Menu {
    name: string;
    days: number;
    notes: string;
    items: MenuItem[];
  }

  let { app }: { app: App } = $props();

  let menu = $state<Menu | null>(null);
  let phase = $state<"loading" | "browse" | "error">("loading");
  let detail = $state<RecipeDetailData | null>(null);
  let theme = $state<"light" | "dark">("light");
  let errorMsg = $state<string | null>(null);
  let toast = $state<{ kind: "error" | "info"; msg: string } | null>(null);
  // The menu-item uid whose recipe read is in flight — it drives the per-row spinner AND doubles
  // as the race token: any move away (Back) nulls it, so a read that resolves after the user left
  // never pops the detail pane. Keyed on the item uid (unique), not the recipe uid (a menu can
  // list the same recipe twice).
  let loadingItemUid = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  // The deepest day any item lands on. Usually ≤ menu.days, but an item beyond the declared span
  // (a menu shrunk after items were placed, a sync skew) or a 0-day menu that still carries items
  // must render every item, never silently drop it — so the rendered span covers BOTH the declared
  // length and the deepest item. `menu.days` is already coerced finite/non-negative in parseMenu.
  const maxItemDay = $derived(
    menu ? menu.items.reduce((m, it) => Math.max(m, it.day), 0) : 0,
  );
  const days = $derived(Math.max(menu?.days ?? 0, maxItemDay));
  // A single-day menu IS its one day, so day headers add nothing — suppress them and render a flat
  // dish list (a "Thanksgiving Dinner" menu reads as the spread, not "Day 1 of 1").
  const singleDay = $derived(days === 1);

  // The full day span (Day 1..days), each with its items in the server's display order (day →
  // meal-type order → item order, already applied by menuItemsToRows). A day with no items is kept
  // so the empty-day line renders — the gap is real information about the template's shape.
  const sections = $derived.by(() => {
    if (!menu) return [] as { day: number; items: MenuItem[] }[];
    const byDay = new Map<number, MenuItem[]>();
    for (const item of menu.items) {
      const bucket = byDay.get(item.day);
      if (bucket) bucket.push(item);
      else byDay.set(item.day, [item]);
    }
    const out: { day: number; items: MenuItem[] }[] = [];
    for (let day = 1; day <= days; day += 1)
      out.push({ day, items: byDay.get(day) ?? [] });
    return out;
  });

  // A menu carries no photo, so the header tile is a deterministic colour hashed from the menu
  // name — the same placeholder treatment a photo-less recipe row gets (shared/tile.ts).
  const tile = $derived(nameTile(menu?.name ?? "", theme === "dark"));

  const metaLine = $derived.by(() => {
    const n = menu?.items.length ?? 0;
    return `${days.toString()} day${days === 1 ? "" : "s"} · ${n.toString()} recipe${n === 1 ? "" : "s"}`;
  });

  onMount(() => {
    connectHost(app, {
      onResult: receive,
      onContext: (ctx) => {
        if (ctx?.theme) theme = ctx.theme;
      },
    });
  });

  // The single host-result entry. Only a menu payload is applied; a read_recipe result (handled in
  // openRecipe's await) and a toast-only action result are not menus, so they fall through — unless
  // nothing has loaded yet, in which case the initial read failed. The menu is told apart by
  // `days: number` + `items: []` — distinct from read_recipe (`ingredients: string`), the
  // meal-week-planner (`weekStart`), and the cooking payload (`steps`/`ingredients` object arrays).
  function receive(result: ReceivedResult | null | undefined) {
    const m = parseMenu(result?.structuredContent);
    if (m) {
      menu = m;
      phase = "browse";
      errorMsg = null;
      detail = null;
      loadingItemUid = null;
      return;
    }
    if (phase === "loading") {
      errorMsg = errorText(result);
      phase = "error";
    }
  }

  async function openRecipe(item: MenuItem) {
    if (loadingItemUid !== null || item.recipeUid === null) return;
    loadingItemUid = item.uid;
    const res = await callTool(app, "read_recipe", {
      lookup: { uid: item.recipeUid },
    });
    // Discard if the user moved away while the read was in flight (the token no longer matches).
    if (loadingItemUid !== item.uid) return;
    loadingItemUid = null;
    const parsed = parseRecipeDetail(res.structuredContent);
    if (res.isError || parsed === null) {
      showToast("Couldn’t open that recipe — try again.");
      return;
    }
    detail = parsed;
  }

  function backToMenu() {
    detail = null;
    loadingItemUid = null;
  }

  // Scheduling needs a start date the widget can't pick ("next Monday"? "the 15th"?) and
  // schedule_menu is a non-idempotent batch write (re-running adds a second copy), so the widget
  // hands off to the assistant — which has the date context and owns the confirmation. Same
  // "widget triggers, assistant plans" pattern as the meal-week-planner's empty slots. Never an
  // in-widget date picker, never a direct schedule_menu call from here.
  function schedule() {
    if (!menu) return;
    app.sendMessage({
      role: "user",
      content: [
        {
          type: "text",
          text: `Schedule the “${menu.name}” menu onto my meal plan — help me pick a start date.`,
        },
      ],
    });
    showToast("Asked the assistant to schedule this menu.", "info");
  }

  function showToast(msg: string, kind: "error" | "info" = "error") {
    clearTimeout(toastTimer);
    toast = { kind, msg };
    toastTimer = setTimeout(() => {
      toast = null;
    }, 2600);
  }

  function parseMenu(data: Record<string, unknown> | undefined): Menu | null {
    if (!data) return null;
    if (
      typeof data["name"] !== "string" ||
      typeof data["days"] !== "number" ||
      !Array.isArray(data["items"])
    ) {
      return null;
    }
    return {
      name: data["name"],
      // Coerce to a finite, non-negative integer — `typeof NaN === "number"` slips past the guard
      // above, and a negative/float span would corrupt the day loop. The untrusted host payload is
      // normalized here the same way every item field is in toItem.
      days: Number.isFinite(data["days"])
        ? Math.max(0, Math.trunc(data["days"]))
        : 0,
      notes: typeof data["notes"] === "string" ? data["notes"] : "",
      items: data["items"].map(toItem),
    };
  }

  function toItem(r: unknown): MenuItem {
    const o = (typeof r === "object" && r !== null ? r : {}) as Record<
      string,
      unknown
    >;
    return {
      uid: typeof o["uid"] === "string" ? o["uid"] : "",
      // A 1-indexed day, coerced finite and ≥ 1 (NaN/0/negative would mis-bucket or vanish a row).
      day: Number.isFinite(o["day"])
        ? Math.max(1, Math.trunc(o["day"] as number))
        : 1,
      name: typeof o["name"] === "string" ? o["name"] : "",
      typeName:
        typeof o["typeName"] === "string" && o["typeName"] !== ""
          ? o["typeName"]
          : null,
      recipeUid:
        typeof o["recipeUid"] === "string" && o["recipeUid"] !== ""
          ? o["recipeUid"]
          : null,
      recipe: toRecipeMeta(o["recipe"]),
    };
  }

  // Parse the embedded recipe metadata defensively (the host payload is untrusted). A missing or
  // malformed value — or any non-object — yields null, so the row falls back to name-only.
  function toRecipeMeta(r: unknown): RecipeMeta | null {
    if (typeof r !== "object" || r === null) return null;
    const o = r as Record<string, unknown>;
    const str = (v: unknown): string | null =>
      typeof v === "string" && v !== "" ? v : null;
    return {
      rating: typeof o["rating"] === "number" ? o["rating"] : 0,
      prepTime: str(o["prepTime"]),
      cookTime: str(o["cookTime"]),
      totalTime: str(o["totalTime"]),
      photoResourceUri: str(o["photoResourceUri"]),
    };
  }

  // The row shows ONE duration — the most decision-relevant of cook → total → prep (the same rule
  // recipe-browse's row applies).
  const relevantTime = (r: RecipeMeta): string | null =>
    r.cookTime ?? r.totalTime ?? r.prepTime;

  // The detail pane's hero photo: read the photo proxy resource and turn its blob into an image
  // `data:` URI (or null on failure). Closes over `app`, passed to RecipeDetail so it stays
  // host-agnostic — the same loader the recipe-browse and meal-week-planner widgets inject.
  const loadPhoto = async (uri: string): Promise<string | null> =>
    blobDataUri(await readResource(app, uri), "image/jpeg");
</script>

<WidgetShell dark={theme === "dark"}>
  {#if phase === "loading"}
    <StatusScreen desc="Loading menu…" />
  {:else if phase === "error"}
    <StatusScreen
      icon="📋"
      title="Couldn’t load menu"
      desc={errorMsg ?? undefined}
    />
  {:else if detail}
    <RecipeDetail
      recipe={detail}
      {loadPhoto}
      onBack={backToMenu}
      backLabel="Back to menu"
    />
  {:else if menu}
    <header>
      <div class="thumb" style="background: {tile};" aria-hidden="true"></div>
      <div class="htext">
        <h2>{menu.name}</h2>
        <div class="meta">{metaLine}</div>
        {#if menu.notes !== ""}<div class="notes">{menu.notes}</div>{/if}
      </div>
    </header>

    <div class="body">
      {#each sections as sec (sec.day)}
        {#if !singleDay}
          <div class="day">
            <span class="dl"
              >Day {sec.day}{#if days > 1}<span class="dctx">
                  of {days}</span
                >{/if}</span
            >
          </div>
        {/if}
        {#if sec.items.length === 0}
          <div class="empty">No meals planned</div>
        {:else}
          {#each sec.items as item (item.uid)}
            {#if item.recipe !== null}
              <button
                class="row rich"
                onclick={() => openRecipe(item)}
                disabled={loadingItemUid !== null}
                aria-label="Open {item.name}"
              >
                <RecipeThumb
                  photoResourceUri={item.recipe.photoResourceUri}
                  name={item.name}
                  dark={theme === "dark"}
                  {loadPhoto}
                />
                <span class="info">
                  <span class="name">{item.name}</span>
                  <span class="sub">
                    {#if item.typeName !== null}<span class="eyebrow"
                        >{item.typeName}</span
                      >{/if}
                    {#if item.typeName !== null && relevantTime(item.recipe)}<span
                        class="sep">·</span
                      >{/if}
                    {#if relevantTime(item.recipe)}<span class="time"
                        >{relevantTime(item.recipe)}</span
                      >{/if}
                    <RatingDots rating={item.recipe.rating} />
                  </span>
                </span>
                {#if loadingItemUid === item.uid}
                  <Spinner size={14} />
                {:else}
                  <Chevron />
                {/if}
              </button>
            {:else if item.recipeUid !== null}
              <button
                class="row"
                onclick={() => openRecipe(item)}
                disabled={loadingItemUid !== null}
                aria-label="Open {item.name}"
              >
                <span class="rt">
                  {#if item.typeName !== null}<span class="mt"
                      >{item.typeName}</span
                    >{/if}
                  <span class="name">{item.name}</span>
                </span>
                {#if loadingItemUid === item.uid}
                  <Spinner size={14} />
                {:else}
                  <Chevron />
                {/if}
              </button>
            {:else}
              <div class="row freeform">
                <span class="rt">
                  {#if item.typeName !== null}<span class="mt"
                      >{item.typeName}</span
                    >{/if}
                  <span class="name">{item.name}</span>
                </span>
              </div>
            {/if}
          {/each}
        {/if}
      {/each}
    </div>

    <footer>
      <PillButton
        variant="accent"
        onclick={schedule}
        ariaLabel="Schedule this menu onto the planner"
      >
        🗓 Schedule this menu…
      </PillButton>
    </footer>
  {:else}
    <StatusScreen icon="📋" title="No menu to show" />
  {/if}

  <Toast {toast} />
</WidgetShell>

<style>
  /* Header + footer are fixed chrome (flex: none); only `.body` absorbs the overflow once `main`
     hits WidgetShell's host-height cap. */
  header {
    flex: none;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 14px 18px 13px;
    padding-top: calc(14px + env(safe-area-inset-top));
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }
  .thumb {
    /* The documented placeholder color tile: 48px / 8px radius (DESIGN.md), the same treatment a
       photo-less recipe row's thumb gets — the menu has no photo, so this stands in permanently. */
    flex: none;
    width: 48px;
    height: 48px;
    border-radius: 8px;
  }
  .htext {
    flex: 1;
    min-width: 0;
  }
  header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    line-height: 1.18;
    text-wrap: balance;
  }
  .meta {
    margin-top: 3px;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .notes {
    margin-top: 5px;
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--faint);
    font-style: italic;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 4px;
    scrollbar-width: none;
  }
  .body::-webkit-scrollbar {
    display: none;
  }

  /* Editorial day heading: calm, non-sticky, in the widget's serif, with a muted "of N" context. */
  .day {
    padding: 14px 18px 4px;
  }
  .dl {
    font-family: var(--widget-font);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .dctx {
    /* margin, not a leading space — Svelte 5 trims leading whitespace inside the span. */
    margin-left: 0.34em;
    font-weight: 400;
    color: var(--faint);
  }
  .empty {
    padding: 2px 18px 8px;
    font-size: 13px;
    font-style: italic;
    color: var(--faint);
  }

  /* Recipe row — the whole line is one button so the host gives it focus + a tap target. */
  .row {
    width: 100%;
    text-align: left;
    padding: 9px 18px;
    display: flex;
    align-items: center;
    gap: 10px;
    transition: background 0.1s;
  }
  .row:hover:not(:disabled) {
    background: var(--hover);
  }
  .row:focus-visible {
    /* Inset ring so the outset ring isn't clipped at the full-bleed row edge (outspecifies the
       low-specificity global focus ring in WidgetShell). */
    outline-offset: -2px;
  }
  .row:disabled {
    cursor: default;
  }
  .rt {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 7px;
  }
  .mt {
    flex: none;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 12px;
    color: var(--muted);
  }
  .mt::after {
    content: "·";
    margin-left: 7px;
    color: var(--faint);
  }
  .name {
    font-size: 15px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Rich recipe row — cover thumb + a two-line name/metadata column, reading like a
     recipe-browse row. The meal-type label takes recipe-browse's category eyebrow slot. */
  .rich {
    gap: 12px;
  }
  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 3px;
    min-width: 0;
  }
  .eyebrow {
    flex: none;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 12px;
    color: var(--muted);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sep {
    flex: none;
    font-size: 10px;
    color: var(--faint);
  }
  .time {
    flex: none;
    font-size: 12px;
    color: var(--faint);
    white-space: nowrap;
  }
  /* Freeform item (no recipe to open) — muted, not interactive. */
  .freeform {
    cursor: default;
  }
  .freeform .name {
    font-weight: 400;
    color: var(--muted);
  }

  footer {
    flex: none;
    display: flex;
    justify-content: center;
    padding: 11px 16px;
    padding-bottom: calc(11px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--line);
    background: var(--bg);
  }
</style>
