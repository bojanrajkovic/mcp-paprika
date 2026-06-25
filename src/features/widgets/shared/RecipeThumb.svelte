<script lang="ts">
  // The shared recipe cover thumbnail: a square tile that lazy-loads the cover photo once it
  // nears the viewport (a browse/menu list can be long, and each load is a server round-trip),
  // falling back to the deterministic name-hashed colour tile when the recipe has no photo or
  // before the bytes arrive. Reused by recipe-browse's RecipeRow and the menu's rich rows.
  import { nameTile } from "./tile.js";

  let {
    photoResourceUri,
    name,
    dark,
    loadPhoto,
    size = 48,
  }: {
    photoResourceUri: string | null;
    name: string;
    dark: boolean;
    loadPhoto: (uri: string) => Promise<string | null>;
    size?: number;
  } = $props();

  // Request ~2× the slot for crisp rendering on hi-dpi screens.
  const requestPx = $derived(size * 2);

  // The cover photo, loaded lazily once the tile scrolls into view; null until loaded or when the
  // recipe has no photo — the placeholder tile shows underneath until then.
  let photoSrc = $state<string | null>(null);
  let loadStarted = false;

  async function ensureLoaded() {
    if (loadStarted || photoResourceUri === null) return;
    loadStarted = true;
    photoSrc = await loadPhoto(`${photoResourceUri}?w=${requestPx.toString()}`);
  }

  // Svelte action: load when the tile nears the viewport. Falls back to an immediate load where
  // IntersectionObserver is unavailable.
  function lazyLoad(node: HTMLElement) {
    if (photoResourceUri === null) return;
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

  const tile = $derived(nameTile(name, dark));
</script>

<span
  class="thumb"
  use:lazyLoad
  style="--thumb-size: {size}px; {photoSrc ? '' : `background: ${tile};`}"
  aria-hidden="true"
  >{#if photoSrc}<img class="thumbimg" src={photoSrc} alt="" />{/if}</span
>

<style>
  .thumb {
    flex: none;
    width: var(--thumb-size);
    height: var(--thumb-size);
    border-radius: 8px;
    overflow: hidden;
  }
  .thumbimg {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
</style>
