<script lang="ts">
  import type { App } from "@modelcontextprotocol/ext-apps";

  import { onMount } from "svelte";

  import PillButton from "../shared/PillButton.svelte";
  import StatusScreen from "../shared/StatusScreen.svelte";
  import Toast from "../shared/Toast.svelte";
  import WidgetShell from "../shared/WidgetShell.svelte";
  import { groupConsecutive } from "../shared/group.js";
  import {
    blobDataUri,
    callTool,
    connectHost,
    errorText,
    readResource,
    type ReceivedResult,
  } from "../shared/host-bridge.js";

  // The ext-apps App instance, constructed in main.ts and handed in as a prop.
  let { app }: { app: App } = $props();

  interface Ingredient {
    text: string;
    group: string | null;
  }
  interface Step {
    text: string;
    group: string | null;
    ingredientRefs: number[];
    produces: string | null;
    usesIntermediate: string[];
    phase: "prep" | "cook";
  }
  interface CookData {
    recipeUid: string;
    name: string;
    servings: string | null;
    totalTime: string | null;
    prepTime: string | null;
    prepActiveMin: number;
    prepPassiveMin: number;
    photoResourceUri: string | null;
    ingredients: Ingredient[];
    steps: Step[];
  }

  // The cover photo at a hero width, read from the ui://recipe/{uid}/photo proxy into a
  // data: URI; null until loaded, when the recipe has no photo, or when the read fails
  // (the widget just shows no photo). The same image backs the header thumbnail and the
  // done-screen hero — one read, downscaled by CSS.
  const HERO_PX = 600;

  let data = $state<CookData | null>(null);
  let phase = $state<"loading" | "ready" | "error">("loading");
  let theme = $state<"light" | "dark">("light");
  let mode = $state<"review" | "cook">("review");
  // The cooking flow has two phases. `cookPhase === "prep"` is the mise-en-place screen —
  // the stepper's slot 0; `"steps"` is the per-step stepper. `stepPos` indexes the COOK-phase
  // steps only (prep-phase steps live on the prep screen); `stepPos === cookCount` is the
  // done/log screen — the stepper's final screen, NOT a separate tab.
  let cookPhase = $state<"prep" | "steps">("prep");
  let stepPos = $state(0);
  // The log action's selectable meal types: the user's full catalog (built-in + custom)
  // once list_meal_types loads in receive(), the built-ins (4th is "Snacks", plural) until
  // then. `mealType` is the selected name — {name} resolves against the catalog, so a custom
  // type logs without auto-creating a duplicate.
  let mealTypes = $state<string[]>(["Breakfast", "Lunch", "Dinner", "Snacks"]);
  let mealType = $state<string>("Dinner");
  // Per-(step,ref) UI sets: chips checked off while cooking, and raw chips flagged wrong
  // in review. Keys are `${stepIdx}:${ref}`. Both are display-only — the model is only
  // re-engaged through the "Re-anchor differently" path, never on a single chip toggle.
  let checked = $state<Set<string>>(new Set());
  let removed = $state<Set<string>>(new Set());
  // Prep-screen check-off: keys `i<ingredientIdx>` for gather chips, `s<stepIdx>` for
  // prep-action rows. Display-only, like `checked`/`removed`.
  let prepChecked = $state<Set<string>>(new Set());
  let reanchorOpen = $state(false);
  let reanchorText = $state("");
  let logState = $state<"idle" | "logging" | "logged">("idle");
  let photoSrc = $state<string | null>(null);
  // The error result's remediation text (cold-start / not-found / a validateCookParse
  // hint), shown verbatim on the error screen — display only, never parsed.
  let errorMsg = $state<string | null>(null);
  let toast = $state<{ kind: "error" | "info"; msg: string } | null>(null);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  // Per-global-step element refs, so an intermediate chip can scroll its producing step
  // into view in review mode.
  const stepEls: HTMLElement[] = [];
  const reduced =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Steps tagged with their global index, then grouped into consecutive same-component
  // runs (the mise-en-place sections). A flat recipe (all groups null) yields one
  // unnamed run and renders without section headers.
  const groups = $derived(
    data
      ? groupConsecutive(
          data.steps.map((step, gi) => ({ step, gi })),
          (it) => it.step.group ?? "",
        )
      : [],
  );

  // Intermediate name → the index of the step that produces it (validated server-side to
  // be a single earlier step), for the chip-to-producer jump.
  const producerIndex = $derived.by(() => {
    const m = new Map<string, number>();
    if (data)
      data.steps.forEach((s, i) => s.produces !== null && m.set(s.produces, i));
    return m;
  });

  // Steps tagged with their global index, split by phase: the cook stepper pages the
  // cook-phase steps; the prep screen lists the prep-phase ones. `cookCount` is the stepper
  // length — the done/log screen sits at `stepPos === cookCount`.
  const cookSteps = $derived(
    data
      ? data.steps
          .map((step, gi) => ({ step, gi }))
          .filter((x) => x.step.phase === "cook")
      : [],
  );
  const prepStepItems = $derived(
    data
      ? data.steps
          .map((step, gi) => ({ step, gi }))
          .filter((x) => x.step.phase === "prep")
      : [],
  );
  // The mise-en-place gather list: every ingredient tagged with its index, grouped into
  // consecutive same-component runs (a flat recipe yields one run, headed "Gather").
  const ingredientGroups = $derived(
    data
      ? groupConsecutive(
          data.ingredients.map((ing, ii) => ({ ing, ii })),
          (x) => x.ing.group ?? "",
        )
      : [],
  );
  const cookCount = $derived(cookSteps.length);
  // Progress spans the prep screen (slot 0) plus every cook step.
  const progressMax = $derived(cookCount + 1);

  onMount(() => {
    connectHost(app, {
      onResult: receive,
      onContext: (ctx) => {
        if (ctx?.theme) theme = ctx.theme;
      },
    });
  });

  // The widget renders only off the structured channel (the model-authored, server-
  // validated parse). A result without it gets the error state — never parse the text.
  function receive(result: ReceivedResult | null | undefined) {
    const d = result?.structuredContent;
    const uid = d?.["recipeUid"] ?? d?.["recipe_uid"];
    if (
      !d ||
      typeof uid !== "string" ||
      !Array.isArray(d["steps"]) ||
      d["steps"].length === 0 ||
      !Array.isArray(d["ingredients"])
    ) {
      // Don't clobber an already-loaded cook view on a later non-cooking result the
      // host may route through this channel (e.g. the log_cooked_meal echo); only
      // surface an error before anything has loaded.
      if (phase !== "ready") {
        errorMsg = errorText(result);
        phase = "error";
      }
      return;
    }
    const photoUri = d["photoResourceUri"];
    const prepRaw = (
      typeof d["prep"] === "object" && d["prep"] !== null ? d["prep"] : {}
    ) as Record<string, unknown>;
    const nonNegInt = (v: unknown): number =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
    data = {
      recipeUid: uid,
      name: typeof d["name"] === "string" ? d["name"] : "Recipe",
      servings: typeof d["servings"] === "string" ? d["servings"] : null,
      totalTime: typeof d["totalTime"] === "string" ? d["totalTime"] : null,
      prepTime: typeof d["prepTime"] === "string" ? d["prepTime"] : null,
      prepActiveMin: nonNegInt(prepRaw["activeMin"]),
      prepPassiveMin: nonNegInt(prepRaw["passiveWaitMin"]),
      photoResourceUri: typeof photoUri === "string" ? photoUri : null,
      ingredients: (d["ingredients"] as unknown[]).map(toIngredient),
      steps: (d["steps"] as unknown[]).map(toStep),
    };
    mode = "review";
    cookPhase = "prep";
    stepPos = 0;
    checked = new Set();
    removed = new Set();
    prepChecked = new Set();
    logState = "idle";
    errorMsg = null;
    phase = "ready";
    void loadHeroPhoto(data.photoResourceUri);
    void loadMealTypes();
  }

  // Load the user's meal-type catalog (built-in + custom) for the log dropdown, falling
  // back to the built-ins on failure (e.g. the preview shim no-ops callServerTool, or the
  // catalog is still syncing). Re-points the selected type if the user renamed the Dinner
  // built-in so the default name always exists in the catalog.
  async function loadMealTypes() {
    const res = await callTool(app, "list_meal_types", {});
    const items = res.structuredContent?.["items"];
    if (!Array.isArray(items)) return;
    const names = items
      .map((i) =>
        typeof i === "object" && i !== null
          ? (i as Record<string, unknown>)["name"]
          : null,
      )
      .filter((n): n is string => typeof n === "string" && n !== "");
    if (names.length === 0) return;
    mealTypes = names;
    if (!names.includes(mealType)) mealType = names[0]!;
  }

  // Read the cover photo into a data: URI for the header thumbnail + done-screen hero.
  // Guarded against a late landing: if the recipe changed underneath us (a re-anchor to
  // a different recipe), the stored photoResourceUri no longer matches and we drop it.
  async function loadHeroPhoto(uri: string | null) {
    photoSrc = null;
    if (uri === null) return;
    const src = blobDataUri(
      await readResource(app, `${uri}?w=${HERO_PX.toString()}`),
      "image/jpeg",
    );
    if (data?.photoResourceUri === uri) photoSrc = src;
  }

  function toIngredient(raw: unknown): Ingredient {
    const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
      string,
      unknown
    >;
    return {
      text: typeof r["text"] === "string" ? r["text"] : "",
      group: typeof r["group"] === "string" ? r["group"] : null,
    };
  }
  function toStep(raw: unknown): Step {
    const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
      string,
      unknown
    >;
    const refs = Array.isArray(r["ingredientRefs"]) ? r["ingredientRefs"] : [];
    const uses = Array.isArray(r["usesIntermediate"])
      ? r["usesIntermediate"]
      : [];
    return {
      text: typeof r["text"] === "string" ? r["text"] : "",
      group: typeof r["group"] === "string" ? r["group"] : null,
      ingredientRefs: refs.filter(
        (n): n is number =>
          typeof n === "number" && Number.isInteger(n) && n >= 0,
      ),
      produces: typeof r["produces"] === "string" ? r["produces"] : null,
      usesIntermediate: uses.filter(
        (n): n is string => typeof n === "string" && n !== "",
      ),
      phase: r["phase"] === "prep" ? "prep" : "cook",
    };
  }

  function showToast(msg: string, kind: "error" | "info" = "info") {
    clearTimeout(toastTimer);
    toast = { msg, kind };
    toastTimer = setTimeout(() => {
      toast = null;
    }, 2600);
  }

  const key = (stepIdx: number, ref: number): string =>
    `${stepIdx.toString()}:${ref.toString()}`;

  function startCooking() {
    mode = "cook";
    cookPhase = "prep";
    stepPos = 0;
  }

  // Leave the prep screen for the first cook step (or straight to the done screen for a
  // no-cook assembly, where cookCount is 0).
  function beginSteps() {
    cookPhase = "steps";
    stepPos = 0;
  }

  // Return to the stepper from the done screen — its last cook step, or the prep screen
  // when there are no cook steps at all.
  function backToSteps() {
    if (cookCount === 0) {
      cookPhase = "prep";
      return;
    }
    cookPhase = "steps";
    stepPos = cookCount - 1;
  }

  function togglePrep(k: string) {
    const next = new Set(prepChecked);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    prepChecked = next;
  }

  // Whole minutes → "45 min" / "1 hr" / "1 hr 30 min", for the prep-time budget.
  function formatMinutes(min: number): string {
    if (min < 60) return `${min.toString()} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    const hrs = `${h.toString()} hr`;
    return m === 0 ? hrs : `${hrs} ${m.toString()} min`;
  }

  function jumpToProducer(name: string) {
    const gi = producerIndex.get(name);
    if (gi === undefined || !data) return;
    if (mode === "cook") {
      // A producer on the prep screen (a made-ahead sub-component) sends the cook to prep;
      // otherwise map its global index to the cook stepper's position.
      if (data.steps[gi]?.phase === "prep") {
        cookPhase = "prep";
      } else {
        const pos = cookSteps.findIndex((c) => c.gi === gi);
        if (pos >= 0) {
          cookPhase = "steps";
          stepPos = pos;
        }
      }
    } else {
      stepEls[gi]?.scrollIntoView({
        behavior: reduced ? "auto" : "smooth",
        block: "center",
      });
    }
  }

  function toggleChecked(stepIdx: number, ref: number) {
    const k = key(stepIdx, ref);
    const next = new Set(checked);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    checked = next;
  }

  function toggleRemoved(stepIdx: number, ref: number) {
    const k = key(stepIdx, ref);
    const next = new Set(removed);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    removed = next;
  }

  function askAssistant(text: string) {
    // Mirrors the recipe-browser escape: a follow-up user turn the host routes to the model.
    void app.sendMessage({ role: "user", content: [{ type: "text", text }] });
  }

  function sendReanchor() {
    const note = reanchorText.trim();
    if (note === "" || !data) return;
    askAssistant(
      `Re-anchor the cooking steps for ${data.name} differently: ${note}`,
    );
    reanchorText = "";
    reanchorOpen = false;
    showToast("Asked the assistant to re-anchor the steps.");
  }

  function logDifferentDay() {
    if (!data) return;
    askAssistant(
      `I cooked ${data.name}. Log it as ${mealType.toLowerCase()} for a different day — ask me which day, then log it.`,
    );
    showToast("Asked the assistant to log it for another day.");
  }

  async function logToday() {
    if (!data || logState === "logging") return;
    logState = "logging";
    const res = await callTool(app, "log_cooked_meal", {
      recipe_uid: data.recipeUid,
      type: { name: mealType },
    });
    if (res.isError) {
      logState = "idle";
      showToast("Couldn’t log that — try again.", "error");
      return;
    }
    logState = "logged";
  }
</script>

<WidgetShell dark={theme === "dark"}>
  {#if phase === "loading"}
    <StatusScreen desc="Loading…" />
  {:else if phase === "error" || !data}
    <StatusScreen
      icon="🍳"
      title="Couldn’t open the cooking view"
      desc={errorMsg ??
        "Ask to cook a recipe and the step-anchored view will appear here."}
    />
  {:else}
    <header>
      <div class="head-left">
        {#if photoSrc}
          <img class="thumb" src={photoSrc} alt="" />
        {/if}
        <div class="title">
          <h1>{data.name}</h1>
          {#if data.servings || data.totalTime}
            <p class="meta">
              {[
                data.servings ? `${data.servings} servings` : null,
                data.totalTime,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          {/if}
        </div>
      </div>
      <div class="tabs">
        <button
          class="tab"
          class:on={mode === "review"}
          aria-pressed={mode === "review"}
          onclick={() => (mode = "review")}>Review</button
        >
        <button
          class="tab"
          class:on={mode === "cook"}
          aria-pressed={mode === "cook"}
          onclick={() => (mode = "cook")}>Cook</button
        >
      </div>
    </header>

    {#if mode === "review"}
      <div class="scroll">
        {#each groups as group (group.items[0]!.gi)}
          {#if group.items[0]?.step.group}
            <h2 class="section">{group.items[0].step.group}</h2>
          {/if}
          {#each group.items as { step, gi } (gi)}
            <div class="step" bind:this={stepEls[gi]}>
              <div class="step-head">
                <span class="num">{gi + 1}</span>
                <p class="text">{step.text}</p>
              </div>
              {@render chipRow(step, gi, false)}
            </div>
          {/each}
        {/each}

        <div class="reanchor">
          {#if reanchorOpen}
            <textarea
              class="reanchor-box"
              bind:value={reanchorText}
              placeholder="e.g. the marinade belongs with the pork, not the paste"
            ></textarea>
            <div class="reanchor-actions">
              <PillButton variant="accent" onclick={sendReanchor}
                >Send</PillButton
              >
              <PillButton onclick={() => (reanchorOpen = false)}
                >Cancel</PillButton
              >
            </div>
          {:else}
            <button class="reanchor-open" onclick={() => (reanchorOpen = true)}
              >Re-anchor differently…</button
            >
          {/if}
        </div>
      </div>

      <footer class="bar">
        <button class="cta" onclick={startCooking}>Start cooking →</button>
      </footer>
    {:else if cookPhase === "prep"}
      <!-- Prep screen: the stepper's slot 0 — gather + mise-en-place before first heat. -->
      <div class="cook prep">
        {@render progressBar(1)}
        <p class="kn">Prep · gather &amp; measure</p>

        <div class="budget">
          <p class="budget-active">
            ⏱ ~{formatMinutes(data.prepActiveMin)} hands-on
          </p>
          {#if data.prepPassiveMin > 0}
            <p class="budget-passive">
              ⧖ {formatMinutes(data.prepPassiveMin)} hands-off — start it first
            </p>
          {/if}
          {#if data.prepTime}
            <p class="budget-stated">recipe says {data.prepTime}</p>
          {/if}
        </div>

        {#each ingredientGroups as group (group.items[0]!.ii)}
          <h2 class="section">{group.items[0]!.ing.group ?? "Gather"}</h2>
          <div class="chips gather">
            {#each group.items as { ing, ii } (ii)}
              <button
                class="chip raw"
                class:checked={prepChecked.has(`i${ii.toString()}`)}
                onclick={() => togglePrep(`i${ii.toString()}`)}
              >
                {#if prepChecked.has(`i${ii.toString()}`)}<span
                    class="tick"
                    aria-hidden="true">✓</span
                  >{/if}{ing.text}
              </button>
            {/each}
          </div>
        {/each}

        {#if prepStepItems.length > 0}
          <h2 class="section">Prep</h2>
          <ul class="prep-actions">
            {#each prepStepItems as { step, gi } (gi)}
              <li>
                <button
                  class="prep-row"
                  class:done={prepChecked.has(`s${gi.toString()}`)}
                  aria-pressed={prepChecked.has(`s${gi.toString()}`)}
                  onclick={() => togglePrep(`s${gi.toString()}`)}
                >
                  <span class="box" aria-hidden="true"
                    >{prepChecked.has(`s${gi.toString()}`) ? "☑" : "☐"}</span
                  >
                  <span class="prep-text">{step.text}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      <footer class="bar">
        <button class="cta" onclick={beginSteps}>Start cooking →</button>
      </footer>
    {:else if stepPos >= cookCount}
      <!-- Done/log screen — the stepper's final screen, not a separate tab. -->
      <div class="done">
        {#if logState === "logged"}
          <div class="done-icon">✓</div>
          <p class="done-title">Logged to your cooking history.</p>
          <button class="link" onclick={() => (mode = "review")}
            >Review the recipe again</button
          >
        {:else}
          {#if photoSrc}
            <img class="hero" src={photoSrc} alt={data.name} />
          {:else}
            <div class="done-icon">🍽️</div>
          {/if}
          <p class="done-title">Nicely done — you made {data.name}.</p>
          <div class="split">
            <button
              class="split-main"
              disabled={logState === "logging"}
              onclick={logToday}>Log as today’s</button
            >
            <select
              class="split-select"
              bind:value={mealType}
              aria-label="Meal type"
            >
              {#each mealTypes as t (t)}
                <option value={t}>{t}</option>
              {/each}
            </select>
          </div>
          <button class="link" onclick={logDifferentDay}
            >Log a different day…</button
          >
          <button class="link subtle" onclick={backToSteps}
            >Back to steps</button
          >
        {/if}
      </div>
    {:else}
      {@const item = cookSteps[stepPos]}
      <!-- Cook stepper: one big-type cook-phase step at a time (prep is slot 0). -->
      <div class="cook">
        {@render progressBar(stepPos + 2)}
        <p class="kn">
          Step {stepPos + 1} of {cookCount}{item?.step.group
            ? ` · ${item.step.group}`
            : ""}
        </p>
        <p class="cook-text">{item?.step.text}</p>
        {#if item}{@render chipRow(item.step, item.gi, true)}{/if}
      </div>
      <footer class="bar nav">
        <button
          class="navbtn"
          onclick={() =>
            stepPos === 0 ? (cookPhase = "prep") : (stepPos -= 1)}
          >{stepPos === 0 ? "← Prep" : "← Prev"}</button
        >
        <button class="navbtn primary" onclick={() => (stepPos += 1)}>
          {stepPos === cookCount - 1 ? "Finish →" : "Next →"}
        </button>
      </footer>
    {/if}
  {/if}

  <Toast {toast} />
</WidgetShell>

<!-- The cook-flow progress bar — `now` of `progressMax` slots (slot 1 is the prep screen,
     slots 2..cookCount+1 the cook steps). Shared by the prep screen and the stepper. -->
{#snippet progressBar(now: number)}
  <div
    class="progress"
    role="progressbar"
    aria-valuenow={now}
    aria-valuemin={1}
    aria-valuemax={progressMax}
  >
    <div
      class="progress-fill"
      style:width={`${((now / progressMax) * 100).toString()}%`}
    ></div>
  </div>
{/snippet}

{#snippet chipRow(step: Step, stepIdx: number, cookMode: boolean)}
  {#if step.ingredientRefs.length > 0 || step.usesIntermediate.length > 0}
    <div class="chips">
      {#each step.usesIntermediate as name, i (i)}
        <button
          class="chip inter"
          onclick={() => jumpToProducer(name)}
          title="Made earlier — tap to jump to that step"
        >
          <span class="lead" aria-hidden="true">↑</span>{name}
        </button>
      {/each}
      {#each step.ingredientRefs as ref, i (i)}
        {@const text = data?.ingredients[ref]?.text ?? ""}
        {#if cookMode}
          <button
            class="chip raw"
            class:checked={checked.has(key(stepIdx, ref))}
            onclick={() => toggleChecked(stepIdx, ref)}
          >
            {#if checked.has(key(stepIdx, ref))}<span
                class="tick"
                aria-hidden="true">✓</span
              >{/if}{text}
          </button>
        {:else}
          <span class="chip raw" class:off={removed.has(key(stepIdx, ref))}>
            {text}
            <button
              class="x"
              aria-label="Toggle this ingredient off"
              onclick={() => toggleRemoved(stepIdx, ref)}>×</button
            >
          </span>
        {/if}
      {/each}
    </div>
  {/if}
{/snippet}

<style>
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    padding: 16px 16px 10px;
    padding-top: calc(16px + env(safe-area-inset-top));
    background: linear-gradient(var(--bg) 80%, transparent);
    flex: none;
  }
  .head-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .thumb {
    flex: none;
    width: 42px;
    height: 42px;
    border-radius: 9px;
    object-fit: cover;
    border: 1px solid color-mix(in oklch, var(--ink) 12%, transparent);
  }
  .title h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    line-height: 1.25;
  }
  .meta {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .tabs {
    display: flex;
    gap: 4px;
    flex: none;
  }
  .tab {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
    padding: 5px 10px;
    border-radius: 999px;
    transition:
      background 0.13s,
      color 0.13s;
  }
  .tab:hover {
    background: var(--hover);
    color: var(--ink);
  }
  .tab.on {
    background: color-mix(in oklch, var(--accent) 14%, transparent);
    color: var(--accent);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 16px 16px;
  }

  /* Accent section headers — the mise-en-place components. */
  .section {
    margin: 18px 0 4px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .section:first-child {
    margin-top: 6px;
  }

  .step {
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }
  .section + .step {
    border-top: 0;
  }
  .step-head {
    display: flex;
    gap: 10px;
    align-items: baseline;
  }
  .num {
    flex: none;
    font-size: 12px;
    font-weight: 700;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
    min-width: 1.2em;
  }
  .text {
    margin: 0;
    font-size: 14px;
    line-height: 1.45;
  }

  /* The chip language. Raw = accent-tinted filled pill; intermediate = accent dashed
     outline that jumps to its producing step. Both wrap to full text — ingredient
     labels never truncate. */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 8px 0 0 calc(1.2em + 10px);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    font-weight: 500;
    line-height: 1.35;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid transparent;
    white-space: normal;
    text-align: left;
    max-width: 100%;
  }
  .chip.raw {
    background: color-mix(in oklch, var(--accent) 11%, transparent);
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 22%, transparent);
  }
  button.chip.raw {
    font-weight: 500;
    transition:
      opacity 0.13s,
      background 0.13s;
  }
  button.chip.raw:hover {
    background: color-mix(in oklch, var(--accent) 18%, transparent);
  }
  .chip.raw.checked {
    opacity: 0.5;
    text-decoration: line-through;
  }
  .chip .tick {
    font-weight: 700;
    text-decoration: none;
  }
  .chip.raw.off {
    opacity: 0.4;
    text-decoration: line-through;
  }
  .chip .x {
    font-size: 14px;
    line-height: 1;
    padding: 0 0 0 2px;
    margin: 0;
    opacity: 0.65;
  }
  .chip .x:hover {
    opacity: 1;
  }
  .chip.inter {
    font-weight: 500;
    color: var(--accent);
    border: 1px dashed color-mix(in oklch, var(--accent) 55%, transparent);
    transition: background 0.13s;
  }
  .chip.inter:hover {
    background: color-mix(in oklch, var(--accent) 10%, transparent);
  }
  .chip.inter .lead {
    font-weight: 700;
    opacity: 0.8;
  }

  .reanchor {
    margin-top: 18px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
  .reanchor-open {
    font-size: 12.5px;
    color: var(--muted);
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .reanchor-open:hover {
    color: var(--accent);
  }
  .reanchor-box {
    width: 100%;
    box-sizing: border-box;
    min-height: 64px;
    resize: vertical;
    font: inherit;
    font-size: 13px;
    color: var(--ink);
    background: var(--hover);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
  }
  .reanchor-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  /* Bottom action bar (shared by review's CTA and cook's nav), pinned with safe-area pad. */
  .bar {
    flex: none;
    display: flex;
    gap: 10px;
    padding: 12px 16px;
    padding-bottom: calc(12px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--line);
    background: var(--bg);
  }
  .cta {
    flex: 1;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 14px;
    font-weight: 600;
    padding: 11px 14px;
    border-radius: 10px;
    transition: filter 0.13s;
  }
  .cta:hover {
    filter: brightness(1.05);
  }

  .cook {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 8px 18px 16px;
  }
  .progress {
    height: 4px;
    border-radius: 999px;
    background: var(--line);
    overflow: hidden;
    flex: none;
  }
  .progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .kn {
    margin: 12px 0 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .cook-text {
    margin: 8px 0 0;
    font-size: 20px;
    line-height: 1.4;
    font-weight: 500;
  }
  .cook .chips {
    margin-left: 0;
    margin-top: 16px;
  }

  /* Prep screen — the time budget, the component-grouped gather list, and the
     prep-phase actions, all above the stepper it leads into. */
  .prep .section:first-of-type {
    margin-top: 14px;
  }
  .prep .gather {
    margin-top: 6px;
  }
  .budget {
    margin: 14px 0 2px;
    padding: 10px 12px;
    border-radius: 10px;
    background: color-mix(in oklch, var(--accent) 8%, transparent);
    border: 1px solid color-mix(in oklch, var(--accent) 18%, transparent);
  }
  .budget p {
    margin: 0;
  }
  .budget p + p {
    margin-top: 3px;
  }
  .budget-active {
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .budget-passive {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .budget-stated {
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .prep-actions {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
  }
  .prep-actions li {
    border-top: 1px solid var(--line);
  }
  .prep-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    width: 100%;
    text-align: left;
    padding: 10px 2px;
    color: var(--ink);
    transition: opacity 0.13s;
  }
  .prep-row .box {
    flex: none;
    font-size: 15px;
    line-height: 1.4;
    color: var(--accent);
  }
  .prep-row .prep-text {
    font-size: 14px;
    line-height: 1.45;
  }
  .prep-row.done {
    opacity: 0.5;
  }
  .prep-row.done .prep-text {
    text-decoration: line-through;
  }
  .prep-row:hover {
    color: var(--accent);
  }

  .nav .navbtn {
    flex: 1;
    border: 1px solid var(--line);
    color: var(--ink);
    font-size: 14px;
    font-weight: 600;
    padding: 11px 14px;
    border-radius: 10px;
    transition:
      background 0.13s,
      opacity 0.13s;
  }
  /* Scope the subtle hover to the non-primary (Prev) button — on the filled primary it
     would swap the accent fill for --hover while keeping dark --accent-ink text
     (unreadable dark-on-dark). The primary brightens its own fill instead. */
  .nav .navbtn:not(.primary):hover:not(:disabled) {
    background: var(--hover);
  }
  .nav .navbtn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .nav .navbtn.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
  }
  .nav .navbtn.primary:hover:not(:disabled) {
    filter: brightness(1.06);
  }

  .done {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 12px;
    padding: 32px 24px calc(32px + env(safe-area-inset-bottom));
  }
  .done-icon {
    font-size: 34px;
  }
  .hero {
    width: 100%;
    max-width: 260px;
    max-height: 190px;
    object-fit: cover;
    border-radius: 16px;
    border: 1px solid color-mix(in oklch, var(--ink) 12%, transparent);
  }
  .done-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    max-width: 30ch;
  }

  /* Split log button: one action ("Log as today’s") joined to a native meal-type select.
     The button text never repeats the meal type — that lives only in the dropdown. */
  .split {
    display: inline-flex;
    align-items: stretch;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid var(--accent);
    margin-top: 4px;
  }
  .split-main {
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 14px;
    font-weight: 600;
    padding: 10px 14px;
    transition: filter 0.13s;
  }
  .split-main:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .split-main:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .split-select {
    appearance: auto;
    border: 0;
    border-left: 1px solid
      color-mix(in oklch, var(--accent-ink) 35%, var(--accent));
    background: color-mix(in oklch, var(--accent) 86%, black 6%);
    color: var(--accent-ink);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    padding: 0 8px;
    cursor: pointer;
  }

  .link {
    font-size: 13px;
    font-weight: 500;
    color: var(--accent);
    padding: 2px 4px;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link.subtle {
    color: var(--muted);
  }
  .link:hover {
    filter: brightness(1.08);
  }
  .link:focus-visible {
    border-radius: 6px;
  }
</style>
