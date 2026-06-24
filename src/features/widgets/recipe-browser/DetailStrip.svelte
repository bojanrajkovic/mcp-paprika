<script lang="ts">
  // The expanded strip under a tapped row: the prep/cook/serves metadata (prep and cook
  // SEPARATED here — the collapsed row shows only one), then the three actions. "Read recipe"
  // reads the full recipe inline (a spinner while in flight); "Add to grocery" and "Plan meal"
  // hand off to the chat thread (the ↗ marks the context switch) — both need work the widget
  // can't do from a browse row (ingredient parsing; a date + meal-type picker).
  import Spinner from "../shared/Spinner.svelte";

  interface StripRecipe {
    prepTime: string | null;
    cookTime: string | null;
    servings: string | null;
  }

  let {
    recipe,
    loading,
    onRead,
    onGrocery,
    onPlan,
  }: {
    recipe: StripRecipe;
    loading: boolean;
    onRead: () => void;
    onGrocery: () => void;
    onPlan: () => void;
  } = $props();

  const meta = $derived(
    [
      recipe.prepTime !== null ? `Prep ${recipe.prepTime}` : null,
      recipe.cookTime !== null ? `Cook ${recipe.cookTime}` : null,
      recipe.servings !== null ? `Serves ${recipe.servings}` : null,
    ].filter((v): v is string => v !== null),
  );
</script>

<div class="strip">
  {#if meta.length > 0}<p class="meta">{meta.join(" · ")}</p>{/if}
  <div class="acts">
    <button class="act primary" onclick={onRead} disabled={loading}>
      {#if loading}<Spinner size={13} color="var(--accent-ink)" />{/if}
      <span>Read recipe</span>
    </button>
    <button class="act" onclick={onGrocery}>Add to grocery ↗</button>
    <button class="act" onclick={onPlan}>Plan meal ↗</button>
  </div>
</div>

<style>
  .strip {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 4px 16px 14px;
    background: var(--hover);
    border-bottom: 1px solid var(--line);
  }
  .meta {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
  }
  .acts {
    display: flex;
    gap: 6px;
  }
  .act {
    flex: 1;
    appearance: none;
    /* Adaptive outline: a percentage of the theme's ink, so the border stays visible against
       the `--hover` strip background in both light and dark — `--line` washes out on dark. */
    border: 1px solid color-mix(in oklch, var(--ink) 22%, transparent);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    padding: 6px 10px;
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
    text-align: center;
    transition: background 0.1s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }
  .act:hover {
    background: color-mix(in oklch, var(--ink) 6%, var(--bg));
  }
  .act.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
  }
  .act.primary:hover {
    background: color-mix(in oklch, var(--accent) 88%, black);
  }
  .act.primary:disabled {
    cursor: default;
    opacity: 0.8;
  }
</style>
