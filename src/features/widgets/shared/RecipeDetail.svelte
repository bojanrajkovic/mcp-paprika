<script lang="ts">
  // The inline recipe-detail pane: a back button, the recipe name + a meta line, and the
  // ingredient / direction lists. Rendered over a widget's primary view when the user taps
  // a recipe (the dual-mode "browse → detail" pattern). Shared by the meal-week-planner and
  // the recipe-browse widget — both feed it the same read_recipe slice (RecipeDetailData), so
  // the visual treatment lives once. `onBack` returns to the host view; this component owns no
  // fetch.
  import type { RecipeDetailData } from "./recipe-detail.js";

  import PillButton from "./PillButton.svelte";

  let { recipe, onBack }: { recipe: RecipeDetailData; onBack: () => void } =
    $props();

  // read_recipe emits ingredients/directions as newline-delimited prose; split to lines,
  // dropping blanks, so each renders on its own row. Directions render as paragraphs (not an
  // <ol>) — Paprika directions often already carry their own step numbers, so an ordered
  // list would double-number them.
  const lines = (text: string): string[] =>
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");

  const ingredients = $derived(lines(recipe.ingredients));
  const directions = $derived(lines(recipe.directions));
  const meta = $derived(
    [recipe.servings, recipe.totalTime].filter((v): v is string => v !== null),
  );
</script>

<header>
  <PillButton onclick={onBack} ariaLabel="Back to the week">
    <span class="back"
      ><svg viewBox="0 0 16 16" aria-hidden="true"
        ><path d="M10 3.5 5.5 8l4.5 4.5" /></svg
      >Back</span
    >
  </PillButton>
</header>

<div class="detail">
  <h2 class="rname">{recipe.name}</h2>
  {#if meta.length > 0}<p class="meta">{meta.join(" · ")}</p>{/if}

  {#if ingredients.length > 0}
    <section>
      <h3>Ingredients</h3>
      <ul>
        {#each ingredients as line, i (i)}<li>{line}</li>{/each}
      </ul>
    </section>
  {/if}

  {#if directions.length > 0}
    <section>
      <h3>Directions</h3>
      <div class="steps">
        {#each directions as line, i (i)}<p>{line}</p>{/each}
      </div>
    </section>
  {/if}

  {#if ingredients.length === 0 && directions.length === 0}
    <p class="bare">No ingredients or directions recorded for this recipe.</p>
  {/if}
</div>

<style>
  /* Chrome that never shrinks (flex: none), so only `.detail` absorbs overflow. */
  header {
    flex: none;
    display: flex;
    align-items: center;
    padding: 12px 16px 8px;
    padding-top: calc(12px + env(safe-area-inset-top));
    background: linear-gradient(var(--bg) 80%, transparent);
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .back svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The scroll region: a long recipe scrolls inside the card once `main` hits the host-height cap
     (WidgetShell's `--widget-max-h`); below the cap it sizes to content. */
  .detail {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 16px 20px;
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
  }
  .rname {
    font-size: 19px;
    font-weight: 650;
    letter-spacing: -0.01em;
    margin: 6px 0 2px;
    line-height: 1.25;
  }
  .meta {
    font-size: 12.5px;
    color: var(--muted);
    margin: 0 0 4px;
  }
  section {
    margin-top: 18px;
  }
  h3 {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0 0 8px;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  ul li {
    position: relative;
    padding: 4px 0 4px 16px;
    font-size: 14px;
    line-height: 1.4;
    border-top: 1px solid var(--line);
  }
  ul li:first-child {
    border-top: 0;
  }
  ul li::before {
    content: "";
    position: absolute;
    left: 2px;
    top: 12px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--accent);
  }
  .steps p {
    margin: 0 0 10px;
    font-size: 14px;
    line-height: 1.5;
  }
  .steps p:last-child {
    margin-bottom: 0;
  }
  .bare {
    margin-top: 18px;
    font-size: 13px;
    color: var(--faint);
  }
</style>
