<script lang="ts">
  import type { App } from "@modelcontextprotocol/ext-apps";

  import { onMount } from "svelte";

  import PillButton from "../shared/PillButton.svelte";
  import StatusScreen from "../shared/StatusScreen.svelte";
  import Toast from "../shared/Toast.svelte";
  import WidgetShell from "../shared/WidgetShell.svelte";
  import { groupConsecutive } from "../shared/group.js";
  import {
    callTool,
    connectHost,
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
  }
  interface CookData {
    recipeUid: string;
    name: string;
    servings: string | null;
    totalTime: string | null;
    ingredients: Ingredient[];
    steps: Step[];
  }

  // The four built-in Paprika meal types, in day order; Dinner is the default for a
  // just-cooked meal (matches log_cooked_meal's own default).
  const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Snack"] as const;

  let data = $state<CookData | null>(null);
  let phase = $state<"loading" | "ready" | "error">("loading");
  let theme = $state<"light" | "dark">("light");
  let mode = $state<"review" | "cook">("review");
  // The cook stepper position. `cookIndex === steps.length` is the done/log screen —
  // the stepper's final screen, NOT a separate tab.
  let cookIndex = $state(0);
  let mealType = $state<string>("Dinner");
  // Per-(step,ref) UI sets: chips checked off while cooking, and raw chips flagged wrong
  // in review. Keys are `${stepIdx}:${ref}`. Both are display-only — the model is only
  // re-engaged through the "Re-anchor differently" path, never on a single chip toggle.
  let checked = $state<Set<string>>(new Set());
  let removed = $state<Set<string>>(new Set());
  let reanchorOpen = $state(false);
  let reanchorText = $state("");
  let logState = $state<"idle" | "logging" | "logged">("idle");
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

  const stepCount = $derived(data?.steps.length ?? 0);

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
      !Array.isArray(d["ingredients"])
    ) {
      phase = "error";
      return;
    }
    data = {
      recipeUid: uid,
      name: typeof d["name"] === "string" ? d["name"] : "Recipe",
      servings: typeof d["servings"] === "string" ? d["servings"] : null,
      totalTime: typeof d["totalTime"] === "string" ? d["totalTime"] : null,
      ingredients: (d["ingredients"] as unknown[]).map(toIngredient),
      steps: (d["steps"] as unknown[]).map(toStep),
    };
    mode = "review";
    cookIndex = 0;
    checked = new Set();
    removed = new Set();
    logState = "idle";
    phase = "ready";
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
    cookIndex = 0;
  }

  function jumpToProducer(name: string) {
    const i = producerIndex.get(name);
    if (i === undefined) return;
    if (mode === "cook") cookIndex = i;
    else
      stepEls[i]?.scrollIntoView({
        behavior: reduced ? "auto" : "smooth",
        block: "center",
      });
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
      desc="Ask to cook a recipe and the step-anchored view will appear here."
    />
  {:else}
    <header>
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
        {#each groups as group (group.key)}
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
    {:else if cookIndex >= stepCount}
      <!-- Done/log screen — the stepper's final screen, not a separate tab. -->
      <div class="done">
        {#if logState === "logged"}
          <div class="done-icon">✓</div>
          <p class="done-title">Logged to your cooking history.</p>
          <button class="link" onclick={() => (mode = "review")}
            >Review the recipe again</button
          >
        {:else}
          <div class="done-icon">🍽️</div>
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
              {#each MEAL_TYPES as t (t)}
                <option value={t}>{t}</option>
              {/each}
            </select>
          </div>
          <button class="link" onclick={logDifferentDay}
            >Log a different day…</button
          >
          <button
            class="link subtle"
            onclick={() => (cookIndex = stepCount - 1)}>Back to steps</button
          >
        {/if}
      </div>
    {:else}
      {@const step = data.steps[cookIndex]}
      <!-- Cook stepper: one big-type step at a time. -->
      <div class="cook">
        <div
          class="progress"
          role="progressbar"
          aria-valuenow={cookIndex + 1}
          aria-valuemin={1}
          aria-valuemax={stepCount}
        >
          <div
            class="progress-fill"
            style:width={`${(((cookIndex + 1) / stepCount) * 100).toString()}%`}
          ></div>
        </div>
        <p class="kn">
          Step {cookIndex + 1} of {stepCount}{step?.group
            ? ` · ${step.group}`
            : ""}
        </p>
        <p class="cook-text">{step?.text}</p>
        {#if step}{@render chipRow(step, cookIndex, true)}{/if}
      </div>
      <footer class="bar nav">
        <button
          class="navbtn"
          disabled={cookIndex === 0}
          onclick={() => (cookIndex -= 1)}>← Prev</button
        >
        <button class="navbtn primary" onclick={() => (cookIndex += 1)}>
          {cookIndex === stepCount - 1 ? "Finish →" : "Next →"}
        </button>
      </footer>
    {/if}
  {/if}

  <Toast {toast} />
</WidgetShell>

{#snippet chipRow(step: Step, stepIdx: number, cookMode: boolean)}
  {#if step.ingredientRefs.length > 0 || step.usesIntermediate.length > 0}
    <div class="chips">
      {#each step.usesIntermediate as name (name)}
        <button
          class="chip inter"
          onclick={() => jumpToProducer(name)}
          title="Made earlier — tap to jump to that step"
        >
          <span class="lead" aria-hidden="true">↑</span>{name}
        </button>
      {/each}
      {#each step.ingredientRefs as ref (ref)}
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
    appearance: none;
    border: 0;
    background: transparent;
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
    padding: 5px 10px;
    border-radius: 999px;
    cursor: pointer;
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
  .tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
    appearance: none;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
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
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 14px;
    line-height: 1;
    padding: 0 0 0 2px;
    margin: 0;
    cursor: pointer;
    opacity: 0.65;
  }
  .chip .x:hover {
    opacity: 1;
  }
  .chip.inter {
    appearance: none;
    font: inherit;
    font-weight: 500;
    background: transparent;
    color: var(--accent);
    border: 1px dashed color-mix(in oklch, var(--accent) 55%, transparent);
    cursor: pointer;
    transition: background 0.13s;
  }
  .chip.inter:hover {
    background: color-mix(in oklch, var(--accent) 10%, transparent);
  }
  .chip.inter .lead {
    font-weight: 700;
    opacity: 0.8;
  }
  .chip:focus-visible,
  .chip .x:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 999px;
  }

  .reanchor {
    margin-top: 18px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
  .reanchor-open {
    appearance: none;
    border: 0;
    background: transparent;
    font: inherit;
    font-size: 12.5px;
    color: var(--muted);
    cursor: pointer;
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
  .reanchor-box:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 0;
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
    appearance: none;
    flex: 1;
    border: 0;
    background: var(--accent);
    color: var(--accent-ink);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    padding: 11px 14px;
    border-radius: 10px;
    cursor: pointer;
    transition: filter 0.13s;
  }
  .cta:hover {
    filter: brightness(1.05);
  }
  .cta:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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

  .nav .navbtn {
    appearance: none;
    flex: 1;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    padding: 11px 14px;
    border-radius: 10px;
    cursor: pointer;
    transition:
      background 0.13s,
      opacity 0.13s;
  }
  .nav .navbtn:hover:not(:disabled) {
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
  .nav .navbtn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
    appearance: none;
    border: 0;
    background: var(--accent);
    color: var(--accent-ink);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    padding: 10px 14px;
    cursor: pointer;
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
  .split-main:focus-visible,
  .split-select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .link {
    appearance: none;
    border: 0;
    background: transparent;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    color: var(--accent);
    cursor: pointer;
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
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 6px;
  }

  @media (prefers-reduced-motion: reduce) {
    * {
      transition-duration: 0.001ms !important;
    }
  }
</style>
