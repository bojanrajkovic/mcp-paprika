<script>
  import { onMount } from "svelte";
  import { flip } from "svelte/animate";

  // The ext-apps App instance, constructed in main.ts and handed in as a prop.
  let { app } = $props();

  // Local, mutable copy of read_grocery_list's structuredContent rows, so taps can update
  // optimistically. Replaced wholesale whenever the host feeds a fresh tool result.
  let listMeta = $state(null); // { uid, name } | null
  let items = $state([]); // [{ uid, ingredient, quantity, aisle, purchased, _busy, _error }]
  let phase = $state("loading"); // "loading" | "ready" | "error"
  let theme = $state("light");
  let toast = $state(null); // { kind: "error" | "info", msg } | null
  let errorMsg = $state(null); // the tool's own error text (not-found / disambiguation), for the error state
  let confirmingClear = $state(false);

  const DEBOUNCE_MS = 300;
  const lastTap = new Map(); // uid -> performance.now(), for the per-row flap-guard
  let toastTimer;

  // Group consecutive same-aisle rows (read_grocery_list already emits store-walk order);
  // purchased items sink to the bottom of their aisle group.
  const groups = $derived.by(() => {
    const out = [];
    for (const item of items) {
      const key = item.aisle ?? "Other";
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(item);
      else out.push({ key, items: [item] });
    }
    for (const g of out)
      g.items.sort((a, b) => Number(a.purchased) - Number(b.purchased));
    return out;
  });

  const total = $derived(items.length);
  const purchasedCount = $derived(items.filter((i) => i.purchased).length);

  onMount(() => {
    // Handlers must be set BEFORE connect() completes the handshake.
    app.ontoolresult = (result) => receive(result);
    app.onhostcontextchanged = (ctx) => {
      if (ctx?.theme) theme = ctx.theme;
    };
    Promise.resolve(app.connect()).then(() => {
      const hc = app.getHostContext?.();
      if (hc?.theme) theme = hc.theme;
    });
  });

  // The widget renders only off the structured channel. A host that renders the widget but
  // drops structuredContent gets a neutral state — never parse the human Markdown.
  function receive(result) {
    const data = result?.structuredContent;
    if (!data || typeof data !== "object" || !Array.isArray(data.items)) {
      // No structured payload — an error result (unknown UID / no match / disambiguation) carries
      // its remediation in the text block, or a host dropped structuredContent. Surface that text
      // verbatim (display only, never parsed for data); don't clobber an already-loaded list on a
      // later failed read.
      if (phase !== "ready") {
        const text = result?.content?.find((c) => c?.type === "text")?.text;
        errorMsg = typeof text === "string" && text.trim() !== "" ? text : null;
        phase = "error";
      }
      return;
    }
    listMeta = { uid: data.uid, name: data.name };
    items = data.items.map(toRow);
    errorMsg = null;
    confirmingClear = false;
    phase = "ready";
  }

  // Map a structured grocery row into the local model (+ transient flags). Shared by the host
  // re-read and the optimistic re-add so the row shape lives in one place.
  function toRow(r) {
    return {
      uid: r.uid,
      ingredient: r.ingredient,
      quantity: r.quantity ?? null,
      aisle: r.aisle ?? null,
      purchased: Boolean(r.purchased),
      _busy: false,
      _error: false,
    };
  }

  // Call a server tool through the host bridge, treating a transport rejection the same as a
  // tool-reported error so an in-flight row is never left stuck.
  async function callTool(name, args) {
    try {
      const res = await app.callServerTool({ name, arguments: args });
      return {
        isError: Boolean(res?.isError),
        structuredContent: res?.structuredContent,
      };
    } catch {
      return { isError: true };
    }
  }

  function showToast(msg, kind = "error") {
    clearTimeout(toastTimer);
    toast = { msg, kind };
    toastTimer = setTimeout(() => {
      toast = null;
    }, 2600);
  }

  // A tap is ignored only if it follows another tap on the SAME row within the debounce window.
  // Guard on "has a prior tap", not against 0, so the first tap is never eaten near page load.
  function tapThrottled(uid) {
    const now = performance.now();
    const last = lastTap.get(uid);
    if (last !== undefined && now - last < DEBOUNCE_MS) return true;
    lastTap.set(uid, now);
    return false;
  }

  function onRow(item) {
    if (item._busy) return; // per-row in-flight lock
    if (!item.purchased) doMark(item);
    else doReadd(item);
  }

  async function doMark(item) {
    if (tapThrottled(item.uid)) return;
    item.purchased = true; // optimistic
    item._busy = true;
    const res = await callTool("mark_grocery_item_purchased", {
      uid: item.uid,
    });
    item._busy = false;
    if (res.isError) {
      item.purchased = false; // revert
      item._error = true;
      showToast("Couldn’t mark that purchased — try again.");
      setTimeout(() => {
        item._error = false;
      }, 1100);
    }
  }

  async function doReadd(item) {
    if (tapThrottled(item.uid)) return;
    // Exact-match dedup vs unpurchased rows (same rule add_recipe_to_grocery_list uses) — guards a
    // rapid double-tap or an existing to-buy copy of the same ingredient.
    const dup = items.some(
      (i) =>
        !i.purchased &&
        i.ingredient.toLowerCase() === item.ingredient.toLowerCase(),
    );
    if (dup) {
      showToast(`“${item.ingredient}” is already on your list.`, "info");
      return;
    }
    item._busy = true;
    // Re-add as a true toggle: mark is one-way (no un-purchase verb), so "put it back" is a fresh
    // to-buy row via add_grocery_items, then delete the bought copy so the item reads as a single
    // unchecked row instead of lingering as a duplicate.
    const add = await callTool("add_grocery_items", {
      listUid: listMeta.uid,
      items: [
        {
          ingredient: item.ingredient,
          quantity: item.quantity ?? undefined,
          // "" re-adds a no-aisle row as no-aisle; omitting aisle would auto-resolve it to a
          // catalog/Miscellaneous aisle, moving the row the user just tapped.
          aisle: item.aisle ?? "",
        },
      ],
    });
    if (add.isError) {
      item._busy = false;
      showToast("Couldn’t add that back — try again.");
      return;
    }
    const del = await callTool("delete_grocery_item", { uid: item.uid });
    item._busy = false;
    const added = add.structuredContent?.items?.[0];
    const idx = items.indexOf(item);
    if (idx < 0) return;
    if (!del.isError) {
      // Replace the bought row in place with the new to-buy row (keyed each → no scroll jump). If the
      // host omitted the new row, just drop the bought one; the next read surfaces the addition.
      if (added) items.splice(idx, 1, toRow(added));
      else items.splice(idx, 1);
    } else {
      // Couldn't remove the bought copy: keep it and show the new row beside it — a visible,
      // clearable duplicate rather than a lost re-add.
      if (added) items.splice(idx + 1, 0, toRow(added));
      showToast("Re-added, but couldn’t remove the bought copy.", "info");
    }
  }

  function onClear() {
    confirmingClear = true;
  }
  function cancelClear() {
    confirmingClear = false;
  }
  async function confirmClear() {
    confirmingClear = false;
    if (!items.some((i) => i.purchased)) return;
    const res = await callTool("clear_purchased_grocery_items", {
      listUid: listMeta.uid,
    });
    if (res.isError) {
      showToast("Couldn’t clear — try again.");
      return;
    }
    // A non-error clear result can't be told apart from a declined server-confirm — both are
    // non-error and carry no structuredContent — so re-read the list and rebuild from the
    // authoritative state instead of blindly sweeping purchased rows.
    const fresh = await callTool("read_grocery_list", {
      lookup: { uid: listMeta.uid },
    });
    if (fresh.structuredContent) receive(fresh);
    else items = items.filter((i) => !i.purchased); // re-read unavailable: the clear succeeded, so sweep
  }
</script>

<main class:dark={theme === "dark"}>
  {#if phase === "loading"}
    <div class="empty"><p class="d">Loading…</p></div>
  {:else if phase === "error"}
    <div class="empty">
      <div class="big">🛒</div>
      <p class="t">Couldn’t load this list</p>
      {#if errorMsg}<p class="d">{errorMsg}</p>{/if}
    </div>
  {:else if total === 0}
    <div class="empty">
      <div class="big">🧺</div>
      <p class="t">Nothing on this list yet</p>
      <p class="d">
        Add items and they’ll appear here, grouped by aisle in the order you
        walk the store.
      </p>
    </div>
  {:else}
    <header>
      <h1>{listMeta.name}</h1>
      <div class="head-right">
        {#if confirmingClear}
          <span class="progress">Clear {purchasedCount} purchased?</span>
          <button class="clear danger" onclick={confirmClear}>Clear</button>
          <button class="clear" onclick={cancelClear}>Keep</button>
        {:else}
          <span class="progress">{purchasedCount}/{total} done</span>
          {#if purchasedCount > 0}
            <button class="clear" onclick={onClear}
              >Clear {purchasedCount}</button
            >
          {/if}
        {/if}
      </div>
    </header>

    <div class="scroll">
      {#each groups as group (group.key)}
        <section class="group">
          <div class="aisle">
            <h2>{group.key}</h2>
            <span class="count"
              >{group.items.filter((i) => !i.purchased).length}/{group.items
                .length}</span
            >
            <span class="rule"></span>
          </div>
          {#each group.items as item (item.uid)}
            <button
              class="row"
              class:done={item.purchased}
              class:busy={item._busy}
              class:err={item._error}
              role="checkbox"
              aria-checked={item.purchased}
              onclick={() => onRow(item)}
              animate:flip={{ duration: 220 }}
            >
              <span class="box">
                {#if item._busy}
                  <span class="spin"></span>
                {:else}
                  <svg viewBox="0 0 16 16" aria-hidden="true"
                    ><path class="tick" d="M3.5 8.5l3 3 6-6.5" /></svg
                  >
                {/if}
              </span>
              <span class="body">
                <span class="name"
                  >{item.ingredient}{#if item.quantity}<span class="qty">
                      · {item.quantity}</span
                    >{/if}</span
                >
              </span>
            </button>
          {/each}
        </section>
      {/each}
      <p class="hint">Tap a purchased item to add it back to the list.</p>
    </div>
  {/if}

  {#if toast}
    <div class="toast {toast.kind}" role="status">{toast.msg}</div>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
  }

  main {
    /* Theme tokens — light by default, overridden under .dark. Colors live in custom props so a
       host-context theme flip re-skins the whole widget in one place. */
    --bg: oklch(0.99 0.003 250);
    --ink: oklch(0.27 0.012 265);
    --muted: oklch(0.52 0.012 265);
    --faint: oklch(0.64 0.01 265);
    --line: oklch(0.92 0.005 265);
    --hover: oklch(0.96 0.004 265);
    --accent: oklch(0.58 0.13 150);
    --accent-ink: oklch(0.99 0.02 150);
    --danger: oklch(0.55 0.17 25);
    --danger-bg: oklch(0.96 0.04 25);
    color-scheme: light;

    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    position: relative;
    background: var(--bg);
    color: var(--ink);
    font:
      15px/1.45 system-ui,
      -apple-system,
      "Segoe UI",
      Roboto,
      sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main.dark {
    --bg: oklch(0.21 0.012 265);
    --ink: oklch(0.95 0.005 265);
    --muted: oklch(0.72 0.012 265);
    --faint: oklch(0.58 0.012 265);
    --line: oklch(0.3 0.013 265);
    --hover: oklch(0.25 0.014 265);
    --accent: oklch(0.74 0.14 150);
    --accent-ink: oklch(0.16 0.03 150);
    --danger: oklch(0.72 0.16 25);
    --danger-bg: oklch(0.28 0.06 25);
    color-scheme: dark;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 16px 16px 10px;
    padding-top: calc(16px + env(safe-area-inset-top));
    background: linear-gradient(var(--bg) 80%, transparent);
  }
  h1 {
    font-size: 17px;
    font-weight: 650;
    letter-spacing: -0.01em;
    margin: 0;
  }
  .head-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .progress {
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .clear {
    appearance: none;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    padding: 5px 11px;
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.13s,
      color 0.13s,
      border-color 0.13s;
  }
  .clear:hover {
    background: var(--hover);
    color: var(--ink);
  }
  .clear:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .clear.danger {
    border-color: color-mix(in oklch, var(--danger) 55%, transparent);
    color: var(--danger);
  }
  .clear.danger:hover {
    background: var(--danger-bg);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
  }

  .aisle {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 12px 16px 5px;
    position: sticky;
    top: 0;
    background: var(--bg);
  }
  .aisle h2 {
    margin: 0;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .aisle .count {
    font-size: 11px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  .aisle .rule {
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 11px 16px;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: transparent;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
    transition: background 0.13s;
  }
  .row:hover {
    background: var(--hover);
  }
  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    border-radius: 4px;
  }
  .row.err {
    animation: errFlash 1.1s ease-out;
  }
  @keyframes errFlash {
    0%,
    100% {
      background: transparent;
    }
    18% {
      background: var(--danger-bg);
    }
  }

  .box {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 7px;
    border: 2px solid color-mix(in oklch, var(--ink) 28%, transparent);
    display: grid;
    place-items: center;
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .box svg {
    width: 14px;
    height: 14px;
  }
  .tick {
    stroke: var(--accent-ink);
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
    stroke-dasharray: 20;
    stroke-dashoffset: 20;
  }
  .row.done .box {
    background: var(--accent);
    border-color: var(--accent);
  }
  .row.done .tick {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) 0.02s;
  }

  .spin {
    width: 15px;
    height: 15px;
    border: 2px solid color-mix(in oklch, var(--accent) 35%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .body {
    flex: 1;
    min-width: 0;
  }
  .name {
    display: block;
    overflow-wrap: anywhere;
  }
  .qty {
    color: var(--muted);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .row.done .name {
    color: var(--faint);
    text-decoration: line-through;
    text-decoration-color: color-mix(in oklch, var(--faint) 60%, transparent);
  }
  .row.done .qty {
    color: var(--faint);
  }

  .hint {
    padding: 12px 16px;
    margin: 0;
    font-size: 12px;
    color: var(--faint);
  }

  .empty {
    flex: 1;
    display: grid;
    place-content: center;
    justify-items: center;
    text-align: center;
    gap: 6px;
    padding: 40px 24px;
    color: var(--muted);
  }
  .empty .big {
    font-size: 30px;
  }
  .empty .t {
    color: var(--ink);
    font-weight: 600;
    margin: 0;
  }
  .empty .d {
    font-size: 13px;
    max-width: 34ch;
    margin: 0;
  }

  .toast {
    position: absolute;
    left: 12px;
    right: 12px;
    top: calc(12px + env(safe-area-inset-top));
    z-index: 5;
    background: var(--danger-bg);
    color: var(--danger);
    border: 1px solid color-mix(in oklch, var(--danger) 40%, transparent);
    border-radius: 10px;
    padding: 9px 12px;
    font-size: 13px;
    font-weight: 550;
    box-shadow: 0 8px 24px -12px oklch(0 0 0 / 0.5);
    animation: toastIn 0.2s ease-out;
  }
  .toast.info {
    background: var(--hover);
    color: var(--ink);
    border-color: var(--line);
  }
  @keyframes toastIn {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    .tick {
      animation-duration: 0.001ms !important;
      transition-duration: 0.001ms !important;
    }
    .tick {
      stroke-dashoffset: 0;
    }
  }
</style>
