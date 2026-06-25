<script lang="ts">
  // The collapsed browse row: a recipe compressed into a list line — name (primary), a
  // category + the single most relevant cook time (secondary), rating dots (right), an
  // optional colour tile, and a chevron that rotates when the row is expanded. The whole
  // line is one button so the host gives it keyboard focus and a tap target for free.
  import Chevron from "../shared/Chevron.svelte";
  import RatingDots from "../shared/RatingDots.svelte";
  import RecipeThumb from "../shared/RecipeThumb.svelte";
  import { relevantTime } from "../shared/recipe-time.js";

  interface RowRecipe {
    uid: string;
    name: string;
    categories: string[];
    rating: number;
    prepTime: string | null;
    cookTime: string | null;
    totalTime: string | null;
    photoResourceUri: string | null;
  }

  let {
    recipe,
    open,
    photos,
    dark,
    loadPhoto,
    onToggle,
  }: {
    recipe: RowRecipe;
    open: boolean;
    photos: boolean;
    dark: boolean;
    loadPhoto: (uri: string) => Promise<string | null>;
    onToggle: () => void;
  } = $props();

  // The browse line shows ONE duration (relevantTime: cook → total → prep). Prep and cook
  // separated belong to the expanded strip, not the collapsed line.
  const time = $derived(relevantTime(recipe));
  const category = $derived(recipe.categories[0] ?? "");
</script>

<button class="main" class:open onclick={onToggle} aria-expanded={open}>
  <span class="info">
    <span class="name">{recipe.name}</span>
    <span class="sub">
      {#if category}<span class="cat">{category}</span>{/if}
      {#if category && time}<span class="sep">·</span>{/if}
      {#if time}<span class="time">{time}</span>{/if}
      <RatingDots rating={recipe.rating} />
    </span>
  </span>
  {#if photos}<RecipeThumb
      photoResourceUri={recipe.photoResourceUri}
      name={recipe.name}
      {dark}
      {loadPhoto}
    />{/if}
  <Chevron size={16} {open} />
</button>

<style>
  .main {
    width: 100%;
    text-align: left;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: background 0.1s;
  }
  .main:hover,
  .main.open {
    background: var(--hover);
  }
  .main:focus-visible {
    outline-offset: -2px;
  }
  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .name {
    font-size: 15px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 3px;
    min-width: 0;
  }
  .cat {
    font-size: 12px;
    color: var(--muted);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sep {
    font-size: 10px;
    color: var(--faint);
    flex: none;
  }
  .time {
    font-size: 12px;
    color: var(--faint);
    white-space: nowrap;
    flex: none;
  }
</style>
