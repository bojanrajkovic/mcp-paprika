<script lang="ts">
  // The collapsed browse row: a recipe compressed into a list line — name (primary), a
  // category + the single most relevant cook time (secondary), rating dots (right), an
  // optional colour tile, and a chevron that rotates when the row is expanded. The whole
  // line is one button so the host gives it keyboard focus and a tap target for free.
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

  // The thumbnail slot is 48px; request ~2× for crisp rendering on hi-dpi screens.
  const THUMB_REQUEST_PX = 96;

  // The cover photo, loaded lazily once the row scrolls into view (a browse list can be long, and
  // each load is a server round-trip). `null` until loaded or when the recipe has no photo — the
  // OKLCH placeholder tile shows underneath until then.
  let photoSrc = $state<string | null>(null);
  let loadStarted = false;

  async function ensureLoaded() {
    if (loadStarted || recipe.photoResourceUri === null) return;
    loadStarted = true;
    photoSrc = await loadPhoto(
      `${recipe.photoResourceUri}?w=${THUMB_REQUEST_PX.toString()}`,
    );
  }

  // Svelte action: load when the thumb nears the viewport. Falls back to an immediate load where
  // IntersectionObserver is unavailable.
  function lazyLoad(node: HTMLElement) {
    if (recipe.photoResourceUri === null) return;
    if (typeof IntersectionObserver === "undefined") {
      void ensureLoaded();
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void ensureLoaded();
            obs.disconnect();
            break;
          }
        }
      },
      { rootMargin: "100px" },
    );
    obs.observe(node);
    return {
      destroy() {
        obs.disconnect();
      },
    };
  }

  // The browse line shows ONE duration — the most decision-relevant of cook → total → prep.
  // Prep and cook separated belong to the expanded strip, not the collapsed line.
  const time = $derived(recipe.cookTime ?? recipe.totalTime ?? recipe.prepTime);
  const category = $derived(recipe.categories[0] ?? "");

  // Deterministic placeholder tile in the absence of real photos: a food-range hue
  // (38–130, clear of the brand red at 22–35) derived from the name's char codes, with
  // lightness/chroma fixed per theme. Stable per recipe, intentional-looking, not random.
  const hue = $derived.by(() => {
    let sum = 0;
    for (let i = 0; i < recipe.name.length; i++)
      sum += recipe.name.charCodeAt(i);
    return 38 + (sum % 92);
  });
  const tile = $derived(`oklch(${dark ? "0.32" : "0.7"} 0.06 ${hue})`);
</script>

<button class="main" class:open onclick={onToggle} aria-expanded={open}>
  <span class="info">
    <span class="name">{recipe.name}</span>
    <span class="sub">
      {#if category}<span class="cat">{category}</span>{/if}
      {#if category && time}<span class="sep">·</span>{/if}
      {#if time}<span class="time">{time}</span>{/if}
      <span class="dots" role="img" aria-label="Rated {recipe.rating} of 5">
        {#each [0, 1, 2, 3, 4] as i (i)}<span
            class="dot"
            class:on={i < recipe.rating}
          ></span>{/each}
      </span>
    </span>
  </span>
  {#if photos}<span
      class="thumb"
      use:lazyLoad
      style={photoSrc ? "" : `background: ${tile};`}
      aria-hidden="true"
      >{#if photoSrc}<img class="thumbimg" src={photoSrc} alt="" />{/if}</span
    >{/if}
  <svg class="chev" viewBox="0 0 16 16" aria-hidden="true"
    ><path d="M6 4l4 4-4 4" /></svg
  >
</button>

<style>
  .main {
    appearance: none;
    width: 100%;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
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
    outline: 2px solid var(--accent);
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
  .dots {
    display: flex;
    gap: 2px;
    margin-left: auto;
    flex: none;
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    opacity: 0.2;
  }
  .dot.on {
    opacity: 1;
  }
  .thumb {
    flex: none;
    width: 48px;
    height: 48px;
    border-radius: 8px;
    overflow: hidden;
  }
  .thumbimg {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .chev {
    flex: none;
    width: 16px;
    height: 16px;
    fill: none;
    stroke: var(--faint);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 0.15s;
  }
  .main.open .chev {
    transform: rotate(90deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
  }
</style>
