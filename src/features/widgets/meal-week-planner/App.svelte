<script lang="ts">
  import type { App } from "@modelcontextprotocol/ext-apps";

  import { onMount } from "svelte";

  import BrandMark from "../shared/BrandMark.svelte";
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
  import {
    parseRecipeDetail,
    type RecipeDetailData,
  } from "../shared/recipe-detail.js";
  import DayStrip from "./DayStrip.svelte";
  import SlotPane from "./SlotPane.svelte";

  // One planned meal, denormalized by read_meal_plan: `typeName` is resolved at the server,
  // so the widget never joins the meal-type catalog itself.
  interface Meal {
    uid: string;
    name: string;
    recipeUid: string | null;
    date: string;
    typeUid: string | null;
    typeName: string | null;
  }
  interface TypeRef {
    uid: string;
    name: string;
  }
  // A validated read_meal_plan week payload.
  interface Week {
    weekStart: string;
    meals: Meal[];
    mealTypes: TypeRef[];
  }

  const NAV_CLAMP_WEEKS = 4; // prev/next reach ±4 weeks from the current week

  let { app }: { app: App } = $props();

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
  // The meal whose recipe is being read — drives the per-row spinner in SlotPane.
  let loadingRecipeUid = $state<string | null>(null);
  // Non-reactive race token: the recipe UID the user is currently waiting on. Any move away
  // — Back, week nav, or selecting another day — clears it, so a read_recipe result that lands
  // after the user left is discarded rather than hijacking the new view.
  let pendingRecipeUid: string | null = null;
  // Set true on the first applyWeek, so the one-time current-week realignment runs only on
  // the initial host payload, never on a widget-driven navigation.
  let primed = false;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

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
  const weeksFromNow = $derived(
    week ? Math.round(dayCount(mondayOf(todayIso), week.weekStart) / 7) : 0,
  );
  const canPrev = $derived(week !== null && weeksFromNow > -NAV_CLAMP_WEEKS);
  const canNext = $derived(week !== null && weeksFromNow < NAV_CLAMP_WEEKS);

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
  // One slot per registry meal type (ordered), plus a trailing "Meal" slot for any meal whose
  // type is missing from the registry (dangling/null typeUid) so none hide.
  const slots = $derived.by(() => {
    if (!week) return [];
    const known = new Set(week.mealTypes.map((t) => t.uid));
    const out = week.mealTypes.map((t) => ({
      key: t.uid,
      label: t.name,
      meals: focusedMeals.filter((m) => m.typeUid === t.uid),
    }));
    const orphans = focusedMeals.filter(
      (m) => m.typeUid === null || !known.has(m.typeUid),
    );
    if (orphans.length > 0)
      out.push({ key: "__other", label: "Meal", meals: orphans });
    return out;
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
    // A no-arg read_meal_plan anchors its window at TODAY, not the week's Monday, so a
    // mid-week first load is a partial Monday→Sunday grid: next week's spill is dropped and
    // this week's earlier days were never fetched. Re-fetch the aligned full week once, with
    // the Monday as startDate (the today-floor is lifted server-side, so past days fill in).
    // weekStart === todayIso on a Monday means the window already aligns — no realign needed.
    if (firstLoad && w.weekStart < todayIso)
      void realignToCurrentWeek(w.weekStart);
  }

  async function realignToCurrentWeek(weekStart: string) {
    if (navBusy) return;
    navBusy = true;
    const res = await callTool(app, "read_meal_plan", {
      startDate: weekStart,
      days: 7,
    });
    navBusy = false;
    if (!res.isError) receive(res);
  }

  // Clear the in-flight recipe read: any move away from the meal the user tapped (Back, week
  // nav, or selecting another day) means its result should no longer open the detail pane.
  function cancelPendingRecipe() {
    pendingRecipeUid = null;
    loadingRecipeUid = null;
  }

  function selectDay(iso: string) {
    cancelPendingRecipe();
    selectedDate = iso;
  }

  async function navigate(deltaWeeks: number) {
    if (!week || navBusy) return;
    const target = addDays(week.weekStart, deltaWeeks * 7);
    const targetWeeks = Math.round(dayCount(mondayOf(todayIso), target) / 7);
    if (targetWeeks < -NAV_CLAMP_WEEKS || targetWeeks > NAV_CLAMP_WEEKS) return;
    cancelPendingRecipe();
    navBusy = true;
    const res = await callTool(app, "read_meal_plan", {
      startDate: target,
      days: 7,
    });
    navBusy = false;
    if (res.isError) {
      showToast("Couldn’t load that week — try again.");
      return;
    }
    receive(res);
  }

  async function openRecipe(meal: { uid: string; recipeUid: string | null }) {
    if (meal.recipeUid === null || loadingRecipeUid !== null) return;
    loadingRecipeUid = meal.uid;
    pendingRecipeUid = meal.recipeUid;
    const res = await callTool(app, "read_recipe", {
      lookup: { uid: meal.recipeUid },
    });
    // Discard if the user moved away (Back, nav, or day change) while this read was in flight —
    // cancelPendingRecipe() nulls the token, so it no longer matches the meal we read for.
    if (pendingRecipeUid !== meal.recipeUid) {
      return;
    }
    loadingRecipeUid = null;
    pendingRecipeUid = null;
    const recipe = parseRecipeDetail(res.structuredContent);
    if (res.isError || recipe === null) {
      showToast("Couldn’t open that recipe — try again.");
      return;
    }
    detail = recipe;
  }

  function backToWeek() {
    detail = null;
    cancelPendingRecipe();
  }

  // Empty slot → hand the planning to the assistant: plan_meals needs a recipe + date +
  // mealTypeUid, which the widget can't supply without a recipe picker, so it routes a
  // natural-language request to the chat thread. The AI has the scheduling context.
  function planSlot(label: string) {
    const when = selectedDate === todayIso ? "today" : fmtLong(selectedDate);
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
      !Array.isArray(rawMeals) ||
      !Array.isArray(rawTypes)
    )
      return null;
    return {
      weekStart,
      meals: rawMeals.map(toMeal),
      mealTypes: rawTypes
        .map(toTypeRef)
        .filter((t): t is TypeRef => t !== null),
    };
  }

  function toMeal(r: unknown): Meal {
    const o = (typeof r === "object" && r !== null ? r : {}) as Record<
      string,
      unknown
    >;
    return {
      uid: typeof o["uid"] === "string" ? o["uid"] : "",
      name: typeof o["name"] === "string" ? o["name"] : "",
      recipeUid: typeof o["recipeUid"] === "string" ? o["recipeUid"] : null,
      date: typeof o["date"] === "string" ? o["date"] : "",
      typeUid: typeof o["typeUid"] === "string" ? o["typeUid"] : null,
      typeName: typeof o["typeName"] === "string" ? o["typeName"] : null,
    };
  }

  function toTypeRef(r: unknown): TypeRef | null {
    const o = (typeof r === "object" && r !== null ? r : {}) as Record<
      string,
      unknown
    >;
    return typeof o["uid"] === "string" && typeof o["name"] === "string"
      ? { uid: o["uid"], name: o["name"] }
      : null;
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
    <RecipeDetail recipe={detail} onBack={backToWeek} />
  {:else}
    <header>
      <BrandMark title="Meal plan" />
      <span class="planned">{plannedCount} of 7 planned</span>
    </header>
    <DayStrip
      {weekLabel}
      {weekDates}
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
      loadingUid={loadingRecipeUid}
      onOpenRecipe={openRecipe}
      onPlan={planSlot}
    />
  {/if}

  <Toast {toast} />
</WidgetShell>

<style>
  /* The week-mode rows (header, DayStrip, SlotPane) size to content and never shrink: the host's
     autoResize measures the document at `max-content`, so the widget must overflow WidgetShell's
     `max-height: 100dvh` cap VISIBLY rather than scroll inside it — an internal scroll would report
     only the capped height and pin the iframe at the min-height floor. */
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
</style>
