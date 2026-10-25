<script lang="ts">
  import type { App } from "@modelcontextprotocol/ext-apps";

  import { onMount } from "svelte";
  import { MediaQuery } from "svelte/reactivity";

  import BrandMark from "../shared/BrandMark.svelte";
  import RecipeDetail from "../shared/RecipeDetail.svelte";
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
  import type {
    MealRow,
    MealTypeRef,
    MealWeekStructured,
  } from "../shared/server-types.js";
  import { viewTransition } from "../shared/view-transition.js";
  import DayStrip from "./DayStrip.svelte";
  import SlotPane from "./SlotPane.svelte";
  import WeekBoard from "./WeekBoard.svelte";

  // The widget view-models slice the server's own read_meal_plan output (B1), so a rename of a
  // meal-row or type-ref field breaks this widget at compile time. One planned meal is denormalized
  // by read_meal_plan — `typeName` is resolved server-side, so the widget never joins the meal-type
  // catalog itself (it drops the row's `scale`, which the board doesn't render).
  type Meal = Pick<
    MealRow,
    "uid" | "name" | "recipeUid" | "date" | "typeUid" | "typeName"
  >;
  type TypeRef = MealTypeRef;
  // A validated read_meal_plan week payload.
  interface Week {
    weekStart: string;
    meals: Meal[];
    mealTypes: TypeRef[];
  }

  const NAV_CLAMP_WEEKS = 4; // prev/next reach ±4 weeks from the current week

  // ≥640px hosts get the week board (every day visible at once); below it, the
  // day strip + focused-day master-detail. Inside the host's sandboxed iframe the
  // viewport IS the host-given container width, so a media query is a container query.
  const wide = new MediaQuery("(min-width: 640px)");

  let { app }: { app: App } = $props();

  // The recipe-detail hero photo loader — reads the photo proxy and turns its blob into an image
  // `data:` URI. A stable identity (defined once per instance) matters: RecipeDetail's $effect
  // depends on it, so a fresh inline arrow each render would null and re-fetch the hero every update.
  const loadPhoto = async (uri: string): Promise<string | null> =>
    blobDataUri(await readResource(app, uri), "image/jpeg");

  let week = $state<Week | null>(null);
  let phase = $state<"loading" | "week" | "error">("loading");
  let selectedDate = $state<string>("");
  let detail = $state<RecipeDetailData | null>(null);
  let theme = $state<"light" | "dark">("light");
  let errorMsg = $state<string | null>(null);
  let toast = $state<{ kind: "error" | "info"; msg: string } | null>(null);
  // True while a week re-fetch is in flight — locks the nav arrows so rapid prev/next
  // taps queue at most one fetch.
  let navBusy = $state(false);
  // The MEAL whose recipe is being read (its `uid`, not the recipe's) — drives the per-row spinner
  // AND doubles as the race token: any move away (Back, week nav, day select) nulls it, and the
  // in-flight read is discarded if this no longer matches the meal it was started for, so a result
  // that lands after the user left never hijacks the view. Keyed on the meal so two meals sharing
  // one recipe stay distinct.
  let loadingRecipeUid = $state<string | null>(null);
  // Direction of the last day/week move (-1 back, 1 forward, 0 none) — the slot pane / board
  // content glides from that side so the motion says which way the calendar moved.
  let slideDir = $state(0);
  // Set true on the first applyWeek, so the one-time current-week realignment runs only on
  // the initial host payload, never on a widget-driven navigation.
  let primed = false;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  // Week cache for perceived-instant navigation: every applied week is kept by weekStart and
  // its neighbors are prefetched, so prev/next usually swaps with no fetch gap; the swapped
  // week is then silently re-read (see reconcile), bounding staleness to one round-trip.
  // ≤9 entries inside the ±4-week clamp — no eviction needed. Non-reactive by design.
  const weekCache = new Map<string, Week>();
  const prefetching = new Set<string>();

  // --- Date helpers. All arithmetic is UTC, matching read_meal_plan's day-granular dates;
  // `todayIso` is UTC too, so the "today" highlight aligns with the data's notion of today. ---
  const parseIso = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
  const toIso = (d: Date): string => d.toISOString().slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);
  const addDays = (iso: string, n: number): string => {
    const d = parseIso(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return toIso(d);
  };
  const mondayOf = (iso: string): string => {
    const d = parseIso(iso);
    const dow = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
    return toIso(d);
  };
  const dayCount = (from: string, to: string): number =>
    Math.round(
      (parseIso(to).getTime() - parseIso(from).getTime()) / 86_400_000,
    );
  // Index (0–6) of `iso` within the week starting `weekStart`, or -1 if outside it.
  const indexInWeek = (iso: string, weekStart: string): number => {
    const d = dayCount(weekStart, iso);
    return d >= 0 && d <= 6 ? d : -1;
  };
  const fmtShort = (iso: string): string =>
    parseIso(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const fmtLong = (iso: string): string =>
    parseIso(iso).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });

  // --- Derived view state ---
  const weekDates = $derived.by(() => {
    if (!week) return [];
    const start = week.weekStart;
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  });
  const activity = $derived.by(() => {
    const s = new Set<string>();
    if (week) for (const m of week.meals) s.add(m.date);
    return s;
  });
  const plannedCount = $derived(
    weekDates.filter((d) => activity.has(d)).length,
  );
  const weekLabel = $derived(
    week
      ? `${fmtShort(week.weekStart)} – ${fmtShort(addDays(week.weekStart, 6))}`
      : "",
  );
  // Whole weeks between the current week's Monday and the given week start — the one
  // definition of the nav-clamp coordinate, shared by the derived state, the prefetcher,
  // and the swipe pager's boundary check.
  const weeksFromToday = (weekStart: string): number =>
    Math.round(dayCount(mondayOf(todayIso), weekStart) / 7);
  const weeksFromNow = $derived(week ? weeksFromToday(week.weekStart) : 0);
  const canPrev = $derived(week !== null && weeksFromNow > -NAV_CLAMP_WEEKS);
  const canNext = $derived(week !== null && weeksFromNow < NAV_CLAMP_WEEKS);

  // Display-ready day info, derived once per week (the Intl formatting is not free, and
  // DayStrip / WeekBoard rendering it per cell was the widget's third copy of these
  // formatters): the presentational components consume this instead of formatting dates.
  const dayInfos = $derived(
    weekDates.map((iso) => ({
      iso,
      abbr: parseIso(iso).toLocaleDateString("en-US", {
        weekday: "short",
        timeZone: "UTC",
      }),
      num: parseIso(iso).getUTCDate(),
      long: fmtLong(iso),
    })),
  );

  const focusedMeals = $derived(
    week ? week.meals.filter((m) => m.date === selectedDate) : [],
  );
  const dayLabel = $derived(
    selectedDate === todayIso ? "Today" : fmtLong(selectedDate),
  );
  const daySub = $derived(
    focusedMeals.length === 0
      ? "Nothing planned"
      : `${focusedMeals.length} meal${focusedMeals.length === 1 ? "" : "s"} planned`,
  );
  // A meal whose type is missing from the registry (dangling/null typeUid) — shown under a
  // trailing "Meal" slot/band so none hide.
  const knownTypes = $derived(new Set(week?.mealTypes.map((t) => t.uid) ?? []));
  const isOrphan = (m: Meal): boolean =>
    m.typeUid === null || !knownTypes.has(m.typeUid);

  // ONE grouping pipeline for both views: one band per registry meal type (ordered), seven
  // day cells each, plus an orphan "Meal" band when ANY day has an orphan (its "+" is
  // suppressed via plannable — "Meal" isn't a plannable type). The narrow view's `slots` are
  // the focused day's column of this same matrix, so the two views can't disagree about
  // which meals exist. Keys are plain strings (not branded uids) so the "__other" sentinel
  // shares the field type.
  const boardBands = $derived.by(() => {
    if (!week) return [];
    const w = week;
    const cellsOf = (pick: (m: Meal) => boolean): Meal[][] =>
      weekDates.map((d) => w.meals.filter((m) => m.date === d && pick(m)));
    const bands = w.mealTypes.map((t) => ({
      key: t.uid as string,
      label: t.name,
      plannable: true,
      cells: cellsOf((m) => m.typeUid === t.uid),
    }));
    const orphanCells = cellsOf(isOrphan);
    if (orphanCells.some((c) => c.length > 0))
      bands.push({
        key: "__other",
        label: "Meal",
        plannable: false,
        cells: orphanCells,
      });
    return bands;
  });

  // The focused day's column of the matrix. The orphan slot shows only when THAT day has
  // orphans (an empty "Meal" slot would offer planning for a non-type).
  const focusedIdx = $derived(
    week ? indexInWeek(selectedDate, week.weekStart) : -1,
  );
  const slots = $derived(
    boardBands
      .map((b) => ({
        key: b.key,
        label: b.label,
        meals: b.cells[focusedIdx] ?? [],
      }))
      .filter((s) => s.key !== "__other" || s.meals.length > 0),
  );

  // The week-complete beat (tick draw + sheen) fires once per week, on the first time that
  // week shows 7/7 — driven by STATE, not element creation: the header unmounts whenever the
  // recipe detail opens, so a mount-triggered CSS animation would replay on every Back.
  // No cleanup return: an unrelated effect re-run (a reconcile re-apply) must not cancel a
  // beat already in flight.
  const celebratedWeeks = new Set<string>();
  let celebrating = $state(false);
  let celebrateTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (plannedCount === 7 && week && !celebratedWeeks.has(week.weekStart)) {
      celebratedWeeks.add(week.weekStart);
      celebrating = true;
      clearTimeout(celebrateTimer);
      celebrateTimer = setTimeout(() => {
        celebrating = false;
      }, 1200);
    }
  });

  onMount(() => {
    connectHost(app, {
      onResult: receive,
      onContext: (ctx) => {
        if (ctx?.theme) theme = ctx.theme;
      },
    });
  });

  // The single tool-result entry: the initial host push AND every nav re-fetch flow through
  // here. Only a week payload is applied; anything else (a recipe push, an action result) is
  // ignored unless nothing has loaded yet — then it's the initial read failing.
  function receive(result: ReceivedResult | null | undefined) {
    const w = parseWeek(result?.structuredContent);
    if (w) {
      applyWeek(w);
      return;
    }
    if (phase === "loading") {
      errorMsg = errorText(result);
      phase = "error";
    }
  }

  function applyWeek(w: Week) {
    const firstLoad = !primed;
    primed = true;
    // Preserve the focused weekday across a navigation (same column, new week); on the first
    // load, focus today if it's in the window, else the week's Monday.
    const keptIdx = week ? indexInWeek(selectedDate, week.weekStart) : -1;
    week = w;
    phase = "week";
    errorMsg = null;
    if (keptIdx >= 0) selectedDate = addDays(w.weekStart, keptIdx);
    else
      selectedDate =
        indexInWeek(todayIso, w.weekStart) >= 0 ? todayIso : w.weekStart;
    // A no-arg read_meal_plan starts its window at TODAY (mid-week) even though weekStart is the
    // Monday, so the initial Monday→Sunday grid is partial: next week's spill is dropped and this
    // week's earlier days were never fetched. Re-fetch the aligned full week once, passing the
    // Monday as startDate (which reads the whole Mon–Sun week, past days included). On a Monday
    // weekStart === todayIso, so the window already aligns — no realign.
    // The PARTIAL payload must not be cached or prefetched from: under its Monday key it
    // looks complete, and a later cache-hit would render its never-fetched earlier days as
    // "Nothing planned". The realign's full re-read flows back through here and caches.
    if (firstLoad && w.weekStart < todayIso) {
      void realignToCurrentWeek(w.weekStart);
      return;
    }
    weekCache.set(w.weekStart, w);
    prefetchNeighbors(w.weekStart);
  }

  // One home for the widget-initiated week read: null on a tool error or a non-week payload.
  const fetchWeek = async (startDate: string): Promise<Week | null> => {
    const res = await callTool(app, "read_meal_plan", { startDate, days: 7 });
    return res.isError ? null : parseWeek(res.structuredContent);
  };

  // Fire-and-forget prefetch of the applied week's uncached neighbors (within the clamp).
  // Prefetched weeks go straight to the cache — never through applyWeek, so they can't
  // steal the view or re-trigger the realign. The response must echo the requested Monday
  // (a shifted weekStart under the wrong key would never be looked up, and the re-armed
  // prefetch would refetch it forever).
  function prefetchNeighbors(weekStart: string) {
    for (const delta of [-7, 7]) {
      const target = addDays(weekStart, delta);
      if (Math.abs(weeksFromToday(target)) > NAV_CLAMP_WEEKS) continue;
      if (weekCache.has(target) || prefetching.has(target)) continue;
      prefetching.add(target);
      void fetchWeek(target)
        .then((w) => {
          if (w && w.weekStart === target) weekCache.set(target, w);
        })
        .finally(() => prefetching.delete(target));
    }
  }

  // The re-read behind a cache-hit swap: refresh the cache, and re-apply only if the user is
  // still looking at this week (a late reconcile must never yank the view elsewhere) AND the
  // data actually changed (a no-op re-apply would re-diff both views for nothing). On failure
  // the entry is EVICTED — the instant swap already showed it, and unbounded silent staleness
  // is worse than paying a real fetch next visit — and the user is told once.
  const reconciling = new Set<string>();
  async function reconcile(weekStart: string) {
    if (reconciling.has(weekStart)) return;
    reconciling.add(weekStart);
    const w = await fetchWeek(weekStart);
    reconciling.delete(weekStart);
    if (!w) {
      weekCache.delete(weekStart);
      if (week?.weekStart === weekStart)
        showToast("Couldn’t refresh this week — it may be out of date.");
      return;
    }
    weekCache.set(w.weekStart, w);
    if (
      week?.weekStart === w.weekStart &&
      JSON.stringify(week) !== JSON.stringify(w)
    )
      applyWeek(w);
  }

  async function realignToCurrentWeek(weekStart: string) {
    if (navBusy) return;
    navBusy = true;
    const w = await fetchWeek(weekStart);
    navBusy = false;
    if (!w) {
      // Without the realign, days before today were never fetched — they'd read as
      // "Nothing planned" when the truth is "not loaded". Say so instead of staying silent.
      showToast(
        "Couldn’t load earlier days this week — they may not be empty.",
      );
      return;
    }
    applyWeek(w);
  }

  // Clear the in-flight recipe read: any move away from the meal the user tapped (Back, week
  // nav, or selecting another day) means its result should no longer open the detail pane.
  function cancelPendingRecipe() {
    loadingRecipeUid = null;
  }

  // Bumped on every explicit day pick; an async navigate captures it before awaiting and
  // skips its edge-focus if the user picked a day while the fetch was in flight — the
  // user's later choice must win over the swipe's older intent.
  let dayPick = 0;

  function selectDay(iso: string) {
    cancelPendingRecipe();
    dayPick++;
    slideDir = Math.sign(dayCount(selectedDate, iso));
    selectedDate = iso;
  }

  // `focus` overrides the kept-weekday default after the week applies: a cross-week day
  // swipe lands on the entered edge (Monday going forward, Sunday going back), not the
  // same column. A cached target swaps instantly (reconciled in the background); only a
  // cache miss pays the fetch (and shows the busy dim).
  async function navigate(deltaWeeks: number, focus?: "start" | "end") {
    if (!week || navBusy) return;
    const target = addDays(week.weekStart, deltaWeeks * 7);
    // weekStart is Monday-aligned, so the target is exactly `deltaWeeks` from the current offset.
    const targetWeeks = weeksFromNow + deltaWeeks;
    if (targetWeeks < -NAV_CLAMP_WEEKS || targetWeeks > NAV_CLAMP_WEEKS) return;
    cancelPendingRecipe();
    slideDir = Math.sign(deltaWeeks);
    const focusIn = (w: Week) => {
      if (focus)
        selectedDate =
          focus === "start" ? w.weekStart : addDays(w.weekStart, 6);
    };
    const cached = weekCache.get(target);
    if (cached) {
      applyWeek(cached);
      focusIn(cached);
      void reconcile(target);
      return;
    }
    const pickBefore = dayPick;
    navBusy = true;
    const w = await fetchWeek(target);
    navBusy = false;
    if (!w) {
      showToast("Couldn’t load that week — try again.");
      return;
    }
    applyWeek(w);
    // Focus the edge only if the fetch landed on the target week AND the user didn't pick
    // a day while it was in flight — their later choice wins over the swipe's older intent.
    if (week && week.weekStart === target && dayPick === pickBefore)
      focusIn(week);
  }

  // Swipe paging: the previous/next day, rolling into the adjacent week at the edges.
  // Cross-week rolls ride the week cache, so they're usually as instant as an in-week move.
  // Returns false when the roll can't happen (clamp boundary, fetch in flight) so the pane
  // springs back instead of committing a page that never turns.
  function swipeDay(dir: number): boolean {
    if (!week) return false;
    const target = addDays(selectedDate, dir);
    if (indexInWeek(target, week.weekStart) >= 0) {
      selectDay(target);
      return true;
    }
    if (navBusy || Math.abs(weeksFromNow + dir) > NAV_CLAMP_WEEKS) return false;
    void navigate(dir, dir > 0 ? "start" : "end");
    return true;
  }

  async function openRecipe(meal: { uid: string; recipeUid: string | null }) {
    if (meal.recipeUid === null || loadingRecipeUid !== null) return;
    loadingRecipeUid = meal.uid;
    const res = await callTool(app, "read_recipe", {
      lookup: { uid: meal.recipeUid },
    });
    // Discard if the user moved away (Back, nav, day change) while this read was in flight — the
    // token (keyed on the MEAL) no longer matches the meal we read for.
    if (loadingRecipeUid !== meal.uid) return;
    loadingRecipeUid = null;
    const recipe = parseRecipeDetail(res.structuredContent);
    if (res.isError || recipe === null) {
      showToast("Couldn’t open that recipe — try again.");
      return;
    }
    // Drill-in push (shared helper: reduced-motion + capability gated): the week slides
    // under to the left while the detail pushes in from the right — deeper is rightward,
    // the same spatial grammar as the day/week glides. The `data-mwp-vt` root attr keys
    // the `::view-transition` rules below; a shared-element TITLE morph was tried and
    // dropped — bitmap text scaling from a 12.5px cell to a 19px heading reads as a
    // blurry rubber stretch.
    viewTransition(() => {
      detail = recipe;
    }, ["mwpVt", "in"]);
  }

  function backToWeek() {
    cancelPendingRecipe();
    // Reverse push: the detail slides off right, revealing the week beneath.
    viewTransition(() => {
      detail = null;
    }, ["mwpVt", "out"]);
  }

  // Empty slot → hand the planning to the assistant: plan_meals needs a recipe + date +
  // mealTypeUid, which the widget can't supply without a recipe picker, so it routes a
  // natural-language request to the chat thread. The AI has the scheduling context.
  // The narrow view plans the focused day; the board passes each cell's own date.
  // An impatient double-tap would send the assistant two identical requests — the
  // same-slot dedupe window swallows the repeat.
  let lastPlan = { key: "", at: 0 };
  function planSlot(label: string, dateIso: string) {
    const key = `${label}|${dateIso}`;
    const now = Date.now();
    if (lastPlan.key === key && now - lastPlan.at < 1500) return;
    lastPlan = { key, at: now };
    const when = dateIso === todayIso ? "today" : fmtLong(dateIso);
    app.sendMessage({
      role: "user",
      content: [
        {
          type: "text",
          text: `Help me plan ${label.toLowerCase()} for ${when}.`,
        },
      ],
    });
    showToast("Asked the assistant to help plan this.", "info");
  }

  function showToast(msg: string, kind: "error" | "info" = "error") {
    clearTimeout(toastTimer);
    toast = { kind, msg };
    toastTimer = setTimeout(() => {
      toast = null;
    }, 2600);
  }

  function parseWeek(data: Record<string, unknown> | undefined): Week | null {
    if (!data) return null;
    const weekStart = data["weekStart"];
    const rawMeals = data["meals"];
    const rawTypes = data["mealTypes"];
    if (
      typeof weekStart !== "string" ||
      // Not just a string: every rendered date derives from weekStart via parseIso, and
      // toIso on an Invalid Date THROWS — a malformed date would blank the whole widget.
      !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) ||
      !Array.isArray(rawMeals) ||
      !Array.isArray(rawTypes)
    )
      return null;
    // Shape confirmed (a `weekStart` + meals + mealTypes arrays); trust the rest as read_meal_plan's
    // week. The type registry is taken as-is; meals narrow to the board's slice.
    const src = data as unknown as MealWeekStructured;
    return {
      weekStart: src.weekStart,
      meals: src.meals.map(toMeal),
      mealTypes: src.mealTypes,
    };
  }

  function toMeal(r: MealRow): Meal {
    return {
      uid: r.uid,
      name: r.name,
      recipeUid: r.recipeUid,
      date: r.date,
      typeUid: r.typeUid,
      typeName: r.typeName,
    };
  }
</script>

<WidgetShell dark={theme === "dark"}>
  {#if phase === "loading"}
    <StatusScreen desc="Loading your week…" />
  {:else if phase === "error"}
    <StatusScreen
      icon="📅"
      title="Couldn’t load your meal plan"
      desc={errorMsg ?? undefined}
    />
  {:else if detail}
    <RecipeDetail
      recipe={detail}
      {loadPhoto}
      onBack={backToWeek}
      backLabel="Back to the week"
    />
  {:else}
    <header>
      <BrandMark title="Meal plan" />
      <span
        class="planned"
        class:full={plannedCount === 7}
        class:celebrate={celebrating}
      >
        {#if plannedCount === 7}
          <!-- Done is green (The Green-Means-Done Rule) — as a tick graphic, not text:
               the light success value is fill-tuned (3.9:1) and only clears the 3:1
               component floor, so the label itself stays muted. -->
          <svg class="tick" viewBox="0 0 16 16" aria-hidden="true"
            ><path d="M3 8.5 6.5 12 13 4.5" /></svg
          >
        {/if}
        {plannedCount} of 7 planned
      </span>
    </header>
    {#if wide.current}
      <WeekBoard
        days={dayInfos}
        todayDate={todayIso}
        bands={boardBands}
        animKey={week?.weekStart ?? ""}
        dir={slideDir}
        {canPrev}
        {canNext}
        busy={navBusy}
        loadingUid={loadingRecipeUid}
        onPrev={() => navigate(-1)}
        onNext={() => navigate(1)}
        onOpenRecipe={openRecipe}
        onPlan={planSlot}
      />
    {:else}
      <DayStrip
        {weekLabel}
        days={dayInfos}
        {selectedDate}
        todayDate={todayIso}
        hasActivity={activity}
        {canPrev}
        {canNext}
        busy={navBusy}
        onPrev={() => navigate(-1)}
        onNext={() => navigate(1)}
        onSelect={selectDay}
      />
      <SlotPane
        {dayLabel}
        {daySub}
        {slots}
        animKey={selectedDate}
        dir={slideDir}
        busy={navBusy}
        loadingUid={loadingRecipeUid}
        onOpenRecipe={openRecipe}
        onPlan={(label) => planSlot(label, selectedDate)}
        onSwipeDay={swipeDay}
      />
    {/if}
  {/if}

  <Toast {toast} />
</WidgetShell>

<style>
  /* Header + DayStrip are fixed chrome (flex: none) so only SlotPane's scroll region absorbs the
     overflow when a day is taller than WidgetShell's host-height cap. */
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
  .planned {
    flex: none;
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* The week-complete beat: the tick draws itself and a single brand-tinted sheen sweeps the
     count — the planner's quieter cousin of the cooking widget's completion beat. Both
     animate ONLY under .celebrate (a state flag set once per week when the count first hits
     7 — see the $effect), because the header unmounts whenever the recipe detail opens and a
     mount-triggered animation would replay on every Back. At rest the tick is simply drawn.
     CSS animations, so WidgetShell's reduced-motion block completes them instantly. */
  .planned.full {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    position: relative;
    overflow: hidden;
    border-radius: 4px;
  }
  .planned .tick {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: var(--success);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .planned .tick path {
    /* Path length ≈ 14.9 → 15 covers it. Drawn at rest; the draw plays under .celebrate. */
    stroke-dasharray: 15;
    stroke-dashoffset: 0;
  }
  .planned.celebrate .tick path {
    stroke-dashoffset: 15;
    animation: tick-draw 0.35s cubic-bezier(0.25, 1, 0.5, 1) forwards;
  }
  @keyframes tick-draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  .planned.celebrate::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(
      105deg,
      transparent 32%,
      color-mix(in oklch, var(--brand) 50%, transparent) 50%,
      transparent 68%
    );
    transform: translateX(-100%);
    animation: sheen 0.7s cubic-bezier(0.25, 1, 0.5, 1) 0.3s forwards;
  }
  @keyframes sheen {
    to {
      transform: translateX(100%);
    }
  }

  /* Week ↔ recipe-detail drill-in push, keyed on the `data-mwp-vt` root attr the shared
     viewTransition helper sets for the transition's duration (the cooking flow's pattern —
     same duration/easing). Opening: the week slides under to the left while the detail
     pushes in from the right. Back: the detail slides off right ABOVE the returning week
     (the z-index bump — ::view-transition-new paints on top by default, which would put
     the week over the departing detail). `::view-transition-*` are document-level pseudos,
     so :global. Reduced motion never reaches these: the helper falls back to an instant
     swap before the API runs. */
  :global(::view-transition-old(root)),
  :global(::view-transition-new(root)) {
    animation-duration: 0.34s;
    animation-timing-function: cubic-bezier(0.32, 0.72, 0, 1);
  }
  :global(html[data-mwp-vt="in"]::view-transition-old(root)) {
    animation-name: mwp-under-out;
  }
  :global(html[data-mwp-vt="in"]::view-transition-new(root)) {
    animation-name: mwp-push-in;
  }
  :global(html[data-mwp-vt="out"]::view-transition-old(root)) {
    animation-name: mwp-push-out;
    z-index: 1;
  }
  :global(html[data-mwp-vt="out"]::view-transition-new(root)) {
    animation-name: mwp-under-in;
  }
  /* The under layer travels a fraction of the width (iOS-push parallax); the top layer
     travels the full width. Pure translate — no opacity, so no crossfade shimmer. */
  @keyframes mwp-push-in {
    from {
      transform: translateX(100%);
    }
  }
  @keyframes mwp-push-out {
    to {
      transform: translateX(100%);
    }
  }
  @keyframes mwp-under-out {
    to {
      transform: translateX(-28%);
    }
  }
  @keyframes mwp-under-in {
    from {
      transform: translateX(-28%);
    }
  }
</style>
