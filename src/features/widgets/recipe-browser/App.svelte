<script lang="ts">
  import type { App } from "@modelcontextprotocol/ext-apps";

  import { onMount } from "svelte";
  import { slide } from "svelte/transition";

  import BrandMark from "../shared/BrandMark.svelte";
  import PillButton from "../shared/PillButton.svelte";
  import RecipeDetail from "../shared/RecipeDetail.svelte";
  import StatusScreen from "../shared/StatusScreen.svelte";
  import Toast from "../shared/Toast.svelte";
  import WidgetShell from "../shared/WidgetShell.svelte";
  import {
    callTool,
    connectHost,
    errorText,
    type ReceivedResult,
  } from "../shared/host-bridge.js";
  import { motion } from "../shared/motion.js";
  import {
    parseRecipeDetail,
    type RecipeDetailData,
  } from "../shared/recipe-detail.js";
  import DetailStrip from "./DetailStrip.svelte";
  import RecipeRow from "./RecipeRow.svelte";

  // One browse row, denormalized by list_recipes / search_recipes / discover_recipes — the same
  // shared recipeRowSchema, so the widget renders identically whichever tool produced it.
  interface BrowseRecipe {
    uid: string;
    name: string;
    categories: string[];
    rating: number;
    prepTime: string | null;
    cookTime: string | null;
    totalTime: string | null;
    servings: string | null;
  }
  type Source = "list" | "search" | "discover";
  interface Browse {
    source: Source;
    query: string | null;
    recipes: BrowseRecipe[];
  }

  let { app }: { app: App } = $props();

  let browse = $state<Browse | null>(null);
  let phase = $state<"loading" | "browse" | "error">("loading");
  let detail = $state<RecipeDetailData | null>(null);
  let theme = $state<"light" | "dark">("light");
  let errorMsg = $state<string | null>(null);
  let toast = $state<{ kind: "error" | "info"; msg: string } | null>(null);

  // Client-side refine state: the chip filter, the live search text, and the list-only sort.
  // None re-fetches — the full result set is already in structuredContent.
  let activeCat = $state("All");
  let query = $state("");
  let sortMode = $state<"alpha" | "rating">("alpha");
  let photos = $state(true);

  // The expanded row's uid (one at a time); null = none open.
  let openUid = $state<string | null>(null);
  // The recipe whose read is in flight — its uid drives the per-row spinner AND doubles as the
  // race token: any move away (Back) nulls it, and the in-flight read is discarded if it no
  // longer matches, so a result landing after the user left never pops the detail pane.
  let loadingRecipeUid = $state<string | null>(null);
  // The browse list element + the scroll offset captured before opening the detail pane. On Back
  // the list remounts and the `restoreScroll` action re-applies the offset (Svelte 5 has no
  // `bind:scrollTop`, so the position is read from the live node and written back on mount).
  let listEl = $state<HTMLDivElement | undefined>(undefined);
  let listScroll = 0;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const recipes = $derived(browse?.recipes ?? []);
  const source = $derived(browse?.source ?? "list");

  const title = $derived.by(() => {
    if (!browse) return "Recipes";
    if (browse.source === "search")
      return browse.query ? `Results for “${browse.query}”` : "Search results";
    if (browse.source === "discover") return "Recipes for you";
    return "My recipes";
  });

  // Chips are the unique PRIMARY categories (categories[0]) plus a leading "All".
  const categories = $derived.by(() => {
    const seen = new Set<string>();
    const out = ["All"];
    for (const r of recipes) {
      const c = r.categories[0];
      if (c !== undefined && c !== "" && !seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  });

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = recipes.filter((r) => {
      const catOk = activeCat === "All" || r.categories[0] === activeCat;
      const qOk =
        q === "" ||
        r.name.toLowerCase().includes(q) ||
        r.categories.some((c) => c.toLowerCase().includes(q));
      return catOk && qOk;
    });
    // Only list_recipes is re-sortable — search and discover carry their own ordering (relevance
    // / semantic rank), and re-sorting would discard the value the tool computed.
    if (source !== "list") return list;
    return [...list].sort((a, b) =>
      sortMode === "rating"
        ? b.rating - a.rating || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name),
    );
  });

  const showSearch = $derived(recipes.length > 0);
  const showChips = $derived(categories.length > 1);
  const showSort = $derived(source === "list" && recipes.length > 1);
  const allFilteredOut = $derived(recipes.length > 0 && filtered.length === 0);

  const emptyDesc = $derived.by(() => {
    if (source === "list") return "Your recipe library is empty.";
    return browse?.query
      ? `No recipes matched “${browse.query}”.`
      : "No recipes matched your search.";
  });

  onMount(() => {
    connectHost(app, {
      onResult: receive,
      onContext: (ctx) => {
        if (ctx?.theme) theme = ctx.theme;
      },
    });
  });

  // The single host-result entry. Only a browse payload is applied; a read_recipe result
  // (handled in openRecipe's await) and a toast-only action result carry no `source`, so they
  // fall through — unless nothing has loaded yet, in which case the initial read failed.
  function receive(result: ReceivedResult | null | undefined) {
    const b = parseBrowse(result?.structuredContent);
    if (b) {
      browse = b;
      phase = "browse";
      errorMsg = null;
      // A fresh result set replaces everything: leave any open detail pane, drop the
      // content-tied refine state (category + search), and reset the saved scroll. The display
      // preferences (sort mode, photos) persist deliberately.
      detail = null;
      activeCat = "All";
      query = "";
      openUid = null;
      listScroll = 0;
      cancelPendingRecipe();
      return;
    }
    if (phase === "loading") {
      errorMsg = errorText(result);
      phase = "error";
    }
  }

  function cancelPendingRecipe() {
    loadingRecipeUid = null;
  }

  // Collapsing the open row or refining the list moves away from any recipe read in flight, so
  // its result must no longer pop the detail pane — null the open row AND the race token together.
  function resetExpansion() {
    openUid = null;
    cancelPendingRecipe();
  }

  function toggleRow(uid: string) {
    const next = openUid === uid ? null : uid;
    resetExpansion();
    openUid = next;
  }

  function setCategory(c: string) {
    activeCat = c;
    resetExpansion();
  }

  function onSearchInput(e: Event) {
    query = (e.currentTarget as HTMLInputElement).value;
    resetExpansion();
  }

  function clearSearch() {
    query = "";
    resetExpansion();
  }

  function clearFilters() {
    activeCat = "All";
    query = "";
    resetExpansion();
  }

  function toggleSort() {
    sortMode = sortMode === "alpha" ? "rating" : "alpha";
    resetExpansion();
  }

  async function openRecipe(recipe: BrowseRecipe) {
    if (loadingRecipeUid !== null) return;
    loadingRecipeUid = recipe.uid;
    const res = await callTool(app, "read_recipe", {
      lookup: { uid: recipe.uid },
    });
    // Discard if the user moved away while the read was in flight (the token no longer matches).
    if (loadingRecipeUid !== recipe.uid) return;
    loadingRecipeUid = null;
    const parsed = parseRecipeDetail(res.structuredContent);
    if (res.isError || parsed === null) {
      showToast("Couldn’t open that recipe — try again.");
      return;
    }
    listScroll = listEl?.scrollTop ?? 0;
    detail = parsed;
  }

  // Re-apply the saved scroll offset when the browse list (re)mounts — chiefly the return from
  // the detail pane.
  function restoreScroll(node: HTMLDivElement) {
    node.scrollTop = listScroll;
  }

  async function addToGrocery(recipe: BrowseRecipe) {
    // The grocery list isn't rendered here, so there's no optimistic state to revert — await the
    // call and toast the outcome.
    const res = await callTool(app, "add_recipe_to_grocery_list", {
      recipe: { uid: recipe.uid },
    });
    if (res.isError)
      showToast("Couldn’t add to your grocery list — try again.");
    else showToast(`Added ${recipe.name} to your grocery list.`, "info");
  }

  // plan_meals needs a recipe + date + meal type — the widget can't supply the latter two without
  // a date picker and a meal-type selector, so it hands the planning to the chat thread, which
  // has the scheduling context.
  function planMeal(recipe: BrowseRecipe) {
    app.sendMessage({
      role: "user",
      content: [
        { type: "text", text: `Help me plan a meal with ${recipe.name}.` },
      ],
    });
    showToast("Asked the assistant to help plan this.", "info");
  }

  function backToBrowse() {
    detail = null;
    cancelPendingRecipe();
  }

  function showToast(msg: string, kind: "error" | "info" = "error") {
    clearTimeout(toastTimer);
    toast = { kind, msg };
    toastTimer = setTimeout(() => {
      toast = null;
    }, 2600);
  }

  function parseBrowse(
    data: Record<string, unknown> | undefined,
  ): Browse | null {
    if (!data) return null;
    const ctx = data["context"];
    const items = data["items"];
    if (typeof ctx !== "object" || ctx === null || !Array.isArray(items))
      return null;
    const src = (ctx as Record<string, unknown>)["source"];
    if (src !== "list" && src !== "search" && src !== "discover") return null;
    const q = (ctx as Record<string, unknown>)["query"];
    return {
      source: src,
      query: typeof q === "string" && q !== "" ? q : null,
      recipes: items.map(toRecipe),
    };
  }

  function toRecipe(r: unknown): BrowseRecipe {
    const o = (typeof r === "object" && r !== null ? r : {}) as Record<
      string,
      unknown
    >;
    const cats = Array.isArray(o["categories"])
      ? o["categories"].filter((c): c is string => typeof c === "string")
      : [];
    return {
      uid: typeof o["uid"] === "string" ? o["uid"] : "",
      name: typeof o["name"] === "string" ? o["name"] : "",
      categories: cats,
      rating: typeof o["rating"] === "number" ? o["rating"] : 0,
      prepTime: typeof o["prepTime"] === "string" ? o["prepTime"] : null,
      cookTime: typeof o["cookTime"] === "string" ? o["cookTime"] : null,
      totalTime: typeof o["totalTime"] === "string" ? o["totalTime"] : null,
      servings: typeof o["servings"] === "string" ? o["servings"] : null,
    };
  }
</script>

<WidgetShell dark={theme === "dark"}>
  {#if phase === "loading"}
    <StatusScreen desc="Loading recipes…" />
  {:else if phase === "error"}
    <StatusScreen
      icon="🍽️"
      title="Couldn’t load recipes"
      desc={errorMsg ?? undefined}
    />
  {:else if detail}
    <RecipeDetail
      recipe={detail}
      onBack={backToBrowse}
      backLabel="Back to recipes"
    />
  {:else if recipes.length === 0}
    <StatusScreen icon="🍽️" title="No recipes found" desc={emptyDesc} />
  {:else}
    <header>
      <BrandMark {title} />
      <span class="count"
        >{filtered.length} recipe{filtered.length === 1 ? "" : "s"}</span
      >
    </header>

    {#if showSearch}
      <div class="search">
        <svg class="sic" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" />
        </svg>
        <input
          class="sinp"
          type="text"
          placeholder="Search recipes…"
          autocomplete="off"
          value={query}
          oninput={onSearchInput}
          aria-label="Search recipes"
        />
        {#if query !== ""}
          <button class="sclr" onclick={clearSearch} aria-label="Clear search">
            <svg viewBox="0 0 16 16" aria-hidden="true"
              ><path d="M4 4l8 8M12 4l-8 8" /></svg
            >
          </button>
        {/if}
      </div>
    {/if}

    <div class="controls">
      {#if showChips}
        <div class="chips">
          {#each categories as c (c)}
            <button
              class="chip"
              class:on={c === activeCat}
              onclick={() => setCategory(c)}>{c}</button
            >
          {/each}
        </div>
      {:else}
        <span class="grow"></span>
      {/if}
      <div class="ctrl-acts">
        {#if showSort}
          <PillButton onclick={toggleSort} ariaLabel="Change sort order">
            {sortMode === "rating" ? "★ Rating" : "A–Z"}
          </PillButton>
        {/if}
        <button
          class="pbtn"
          class:off={!photos}
          onclick={() => (photos = !photos)}
          aria-pressed={photos}
          aria-label={photos ? "Hide photos" : "Show photos"}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1.5" y="3" width="13" height="10" rx="1.5" /><circle
              cx="5.5"
              cy="6.5"
              r="1.2"
            /><path d="M2 12l3.5-3.5 2.5 2.5 2.5-2.5 3.5 3.5" />
          </svg>
        </button>
      </div>
    </div>

    <div class="list" bind:this={listEl} use:restoreScroll>
      {#if allFilteredOut}
        <div class="noresults">
          <p>No recipes match these filters.</p>
          <PillButton onclick={clearFilters} ariaLabel="Clear filters"
            >Clear filters</PillButton
          >
        </div>
      {:else}
        {#each filtered as r (r.uid)}
          <div class="row" class:open={openUid === r.uid}>
            <RecipeRow
              recipe={r}
              open={openUid === r.uid}
              {photos}
              dark={theme === "dark"}
              onToggle={() => toggleRow(r.uid)}
            />
            {#if openUid === r.uid}
              <div transition:slide={{ duration: motion(160) }}>
                <DetailStrip
                  recipe={r}
                  loading={loadingRecipeUid === r.uid}
                  onRead={() => openRecipe(r)}
                  onGrocery={() => addToGrocery(r)}
                  onPlan={() => planMeal(r)}
                />
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}

  <Toast {toast} />
</WidgetShell>

<style>
  /* Header, search, and controls are fixed chrome (flex: none) so only `.list` absorbs the
     overflow once `main` hits WidgetShell's host-height cap. */
  header {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 16px 12px;
    padding-top: calc(14px + env(safe-area-inset-top));
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }
  .count {
    flex: none;
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .search {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 16px;
    padding: 8px 14px;
    background: var(--hover);
    border: 1px solid var(--line);
    border-radius: 999px;
  }
  .sic {
    flex: none;
    width: 16px;
    height: 16px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.6;
    stroke-linecap: round;
  }
  .sinp {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    outline: none;
    font: inherit;
    font-size: 14px;
    color: var(--ink);
  }
  .sinp::placeholder {
    color: var(--faint);
  }
  .sclr {
    appearance: none;
    flex: none;
    border: 0;
    background: transparent;
    padding: 0;
    cursor: pointer;
    line-height: 0;
    color: var(--faint);
  }
  .sclr svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
  }

  .controls {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px 8px;
    border-bottom: 1px solid var(--line);
  }
  .chips {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    flex: 1;
    min-width: 0;
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .grow {
    flex: 1;
  }
  .chip {
    flex: none;
    appearance: none;
    padding: 4px 12px;
    border-radius: 999px;
    border: 1px solid color-mix(in oklch, var(--ink) 18%, transparent);
    background: var(--bg);
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.12s,
      color 0.12s,
      border-color 0.12s;
  }
  .chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .chip:not(.on):hover {
    background: var(--hover);
    color: var(--ink);
  }
  .ctrl-acts {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .pbtn {
    appearance: none;
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 28px;
    border: 1px solid color-mix(in oklch, var(--ink) 18%, transparent);
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s;
  }
  .pbtn:hover {
    background: var(--hover);
    color: var(--ink);
  }
  .pbtn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .pbtn.off {
    color: var(--faint);
    opacity: 0.7;
  }
  .pbtn svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .list::-webkit-scrollbar {
    display: none;
  }
  .row {
    border-bottom: 1px solid var(--line);
  }
  .row:last-child {
    border-bottom: none;
  }

  .noresults {
    display: grid;
    place-items: center;
    gap: 10px;
    padding: 40px 24px;
    text-align: center;
    color: var(--muted);
  }
  .noresults p {
    margin: 0;
    font-size: 14px;
  }
</style>
