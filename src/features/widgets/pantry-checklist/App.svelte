<script lang="ts">
  import type { App } from "@modelcontextprotocol/ext-apps";

  import { flip } from "svelte/animate";
  import { onMount } from "svelte";
  import { slide } from "svelte/transition";

  // A pantry row: a structured pantry item plus transient per-row UI flags. `inStock` drives which
  // list the row lives in (the in-stock checklist vs. the out-of-stock drawer).
  interface Row {
    uid: string;
    ingredient: string;
    quantity: string | null;
    aisle: string | null;
    inStock: boolean;
    expirationDate: string | null;
    _busy: boolean;
  }

  // What receive() accepts: a real ext-apps tool result, or callTool()'s narrowed wrapper. Both
  // expose the structured channel; only the former carries `content` (the error-text fallback).
  // Untrusted host payload — every field is checked (the SDK does not validate notification params).
  interface ReceivedResult {
    readonly structuredContent?: Record<string, unknown> | undefined;
    readonly content?:
      | readonly { readonly type: string; readonly text?: string }[]
      | undefined;
  }

  // The ext-apps App instance, constructed in main.ts and handed in as a prop.
  let { app }: { app: App } = $props();

  // Local, mutable copy of list_pantry_items' rows (in AND out of stock — the drawer is fed from the
  // same read), so taps update optimistically. Replaced wholesale on a fresh tool result.
  let items = $state<Row[]>([]);
  let phase = $state<"loading" | "ready" | "error">("loading");
  let theme = $state<"light" | "dark">("light");
  // Touch hosts get swipe-to-remove (the Out button hides); pointer hosts get the button.
  let touchDevice = $state(false);
  let drawerOpen = $state(false);
  let toast = $state<{
    kind: "error" | "info";
    msg: string;
    action?: { label: string; fn: () => void };
  } | null>(null);
  // The tool's own error text, for the error state.
  let errorMsg = $state<string | null>(null);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const SOON_DAYS = 7; // an item expiring within this many days is flagged "expiring soon"
  const reduced =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motion = (ms: number) => (reduced ? 0 : ms);

  const inStockCount = $derived(items.filter((i) => i.inStock).length);
  const outOfStock = $derived(items.filter((i) => !i.inStock));

  // In-stock rows grouped by aisle. The feed is alphabetical by ingredient and the row carries no
  // aisle orderFlag, so grouping is by aisle NAME (walk-order would need the aisle catalog — deferred);
  // items with no aisle sort last under "Other".
  const groups = $derived.by(() => {
    const sorted = items
      .filter((i) => i.inStock)
      .sort((a, b) => {
        if ((a.aisle === null) !== (b.aisle === null))
          return a.aisle === null ? 1 : -1;
        if (a.aisle !== null && b.aisle !== null && a.aisle !== b.aisle)
          return a.aisle.localeCompare(b.aisle);
        return a.ingredient.localeCompare(b.ingredient);
      });
    const out: { key: string; items: Row[] }[] = [];
    for (const item of sorted) {
      const key = item.aisle ?? "Other";
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(item);
      else out.push({ key, items: [item] });
    }
    return out;
  });

  onMount(() => {
    // Handlers must be set BEFORE connect() completes the handshake.
    app.ontoolresult = (result) => receive(result);
    app.onhostcontextchanged = (ctx) => {
      if (ctx.theme) theme = ctx.theme;
      if (ctx.deviceCapabilities?.touch !== undefined)
        touchDevice = ctx.deviceCapabilities.touch;
    };
    Promise.resolve(app.connect()).then(() => {
      const hc = app.getHostContext();
      if (hc?.theme) theme = hc.theme;
      // Prefer the host's declared capability; fall back to a coarse-pointer media query.
      touchDevice =
        hc?.deviceCapabilities?.touch ??
        (typeof matchMedia === "function" &&
          matchMedia("(pointer: coarse)").matches);
    });
  });

  // The widget renders only off the structured channel; never parse the human Markdown.
  function receive(result: ReceivedResult | null | undefined) {
    const data = result?.structuredContent;
    const rawItems = data?.["items"];
    if (!data || !Array.isArray(rawItems)) {
      // No structured payload — surface the error result's text verbatim (display only); don't clobber
      // an already-loaded pantry on a later failed read.
      if (phase !== "ready") {
        const block = result?.content?.find((c) => c.type === "text");
        const text = typeof block?.text === "string" ? block.text : undefined;
        errorMsg = text && text.trim() !== "" ? text : null;
        phase = "error";
      }
      return;
    }
    items = rawItems.map((r) => toRow(r));
    errorMsg = null;
    phase = "ready";
  }

  // Map an untrusted structured row into the local model. A missing `inStock` defaults to in-stock
  // (show the item rather than hide it on a malformed field); only an explicit `false` hides it.
  function toRow(r: unknown): Row {
    const row = (typeof r === "object" && r !== null ? r : {}) as Record<
      string,
      unknown
    >;
    return {
      uid: typeof row["uid"] === "string" ? row["uid"] : "",
      ingredient:
        typeof row["ingredient"] === "string" ? row["ingredient"] : "",
      quantity: typeof row["quantity"] === "string" ? row["quantity"] : null,
      aisle: typeof row["aisle"] === "string" ? row["aisle"] : null,
      inStock: row["inStock"] !== false,
      expirationDate:
        typeof row["expirationDate"] === "string"
          ? row["expirationDate"]
          : null,
      _busy: false,
    };
  }

  // Call a server tool through the host bridge, treating a transport rejection the same as a
  // tool-reported error so an in-flight row is never left stuck.
  async function callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ isError: boolean }> {
    try {
      const res = await app.callServerTool({ name, arguments: args });
      return { isError: Boolean(res.isError) };
    } catch {
      return { isError: true };
    }
  }

  function showToast(
    msg: string,
    kind: "error" | "info" = "error",
    action?: { label: string; fn: () => void },
  ) {
    clearTimeout(toastTimer);
    toast = action ? { kind, msg, action } : { kind, msg };
    toastTimer = setTimeout(
      () => {
        toast = null;
      },
      action ? 3500 : 2600,
    );
  }

  function dismissToast() {
    clearTimeout(toastTimer);
    toast = null;
  }

  function onUndo() {
    const fn = toast?.action?.fn;
    dismissToast();
    fn?.();
  }

  // Mark out of stock: optimistic same-UID flip (the row leaves the in-stock list for the drawer),
  // revert on error. No confirm — the verb is reversible; an Undo toast is the safety net.
  async function onOut(item: Row) {
    if (item._busy) return; // per-row in-flight lock (the row sits in the drawer while in flight)
    item._busy = true;
    item.inStock = false; // optimistic — derived lists move it to the drawer
    const res = await callTool("mark_pantry_item_out_of_stock", {
      uid: item.uid,
    });
    item._busy = false;
    if (res.isError) {
      item.inStock = true; // revert
      showToast("Couldn’t update that — try again.");
    } else {
      showToast(`${item.ingredient} — out of stock`, "info", {
        label: "Undo",
        fn: () => doRestock(item),
      });
    }
  }

  async function onRestock(item: Row) {
    dismissToast();
    await doRestock(item);
  }

  // Restock: the inverse same-UID flip (the row leaves the drawer for its aisle), revert on error.
  // Resolve the live row by uid first: the Undo toast captures the item OBJECT, and a wholesale
  // receive() (a fresh read) replaces `items` with new objects — the captured one is then orphaned,
  // so the optimistic flip must target the currently-rendered row, not the detached copy.
  async function doRestock(item: Row) {
    const live = items.find((i) => i.uid === item.uid) ?? item;
    if (live._busy) return;
    live._busy = true;
    live.inStock = true; // optimistic
    const res = await callTool("restock_pantry_item", { uid: live.uid });
    live._busy = false;
    if (res.isError) {
      live.inStock = false; // revert
      showToast("Couldn’t restock that — try again.");
    }
  }

  // Whole days from today to the item's expiry, in LOCAL calendar days. The feed is
  // "YYYY-MM-DD HH:mm:ss" at midnight, so a raw timestamp diff against "now" reads the expiry day
  // itself as already past (midnight < this afternoon) — off by one. Parse only the Y-M-D and diff
  // local-midnight to local-midnight so today's item is 0, tomorrow's is 1. Unparseable → no expiry.
  function expDays(date: string | null): number | null {
    if (!date) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
    if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined)
      return null;
    const exp = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
    ).getTime();
    const now = new Date();
    const today = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    return Math.round((exp - today) / 86_400_000); // round is DST-safe (a day can be 23/25h)
  }
  function expState(date: string | null): "soon" | "expired" | null {
    const days = expDays(date);
    if (days === null) return null;
    if (days < 0) return "expired";
    if (days <= SOON_DAYS) return "soon";
    return null;
  }
  function expLabel(date: string | null): string {
    const days = expDays(date);
    if (days === null) return "";
    if (days < 0) return `expired ${(-days).toString()}d ago`;
    if (days === 0) return "expires today";
    return `expires in ${days.toString()}d`;
  }

  // Swipe-left to mark out, on touch hosts only. The Out button is the pointer-host path; this is the
  // touch path (the button is hidden there). A no-op when `enabled` is false (pointer host).
  function swipe(
    node: HTMLElement,
    param: { enabled: boolean; commit: () => void },
  ) {
    let p = param;
    let x0: number | null = null;
    let dx = 0;
    // Clear the in-progress drag's inline transform. Centralized so every exit path (commit, cancel,
    // a capability flip mid-drag) leaves no row stuck translated.
    const reset = () => {
      x0 = null;
      node.style.transform = "";
    };
    const down = (e: PointerEvent) => {
      if (!p.enabled) return;
      x0 = e.clientX;
      dx = 0;
      node.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (x0 === null) return;
      if (!p.enabled) return reset(); // host flipped to pointer mid-drag — abandon the gesture
      // Resist past the commit threshold so the row can't be dragged fully off — enough to reveal
      // the action, not slide the whole row away. The row stays opaque; the action shows behind it.
      dx = Math.max(-120, Math.min(0, e.clientX - x0));
      node.style.transform = `translateX(${dx.toString()}px)`;
    };
    const up = () => {
      if (x0 === null) return;
      const commit = p.enabled && dx < -80;
      reset();
      if (commit) p.commit();
    };
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
    return {
      update(next: { enabled: boolean; commit: () => void }) {
        p = next;
      },
      destroy() {
        node.removeEventListener("pointerdown", down);
        node.removeEventListener("pointermove", move);
        node.removeEventListener("pointerup", up);
        node.removeEventListener("pointercancel", up);
      },
    };
  }
</script>

<main class:dark={theme === "dark"}>
  {#if phase === "loading"}
    <div class="empty"><p class="d">Loading…</p></div>
  {:else if phase === "error"}
    <div class="empty">
      <div class="big">🧺</div>
      <p class="t">Couldn’t load your pantry</p>
      {#if errorMsg}<p class="d">{errorMsg}</p>{/if}
    </div>
  {:else if items.length === 0}
    <div class="empty">
      <div class="big">🧺</div>
      <p class="t">Your pantry is empty</p>
      <p class="d">
        Items you add to your pantry show up here, grouped by aisle.
      </p>
    </div>
  {:else}
    <header>
      <div class="htop">
        <h1>Pantry</h1>
        <span class="count">{inStockCount} in stock</span>
      </div>
      {#if touchDevice && inStockCount > 0}
        <p class="subhint">Swipe a row left to mark it out of stock.</p>
      {/if}
    </header>

    <div class="scroll">
      {#if inStockCount === 0}
        <div class="empty inline">
          <div class="big">🧺</div>
          <p class="t">Nothing in stock right now</p>
          <p class="d">Restock items from the drawer below.</p>
        </div>
      {:else}
        {#each groups as group (group.key)}
          <section class="group">
            <div class="aisle">
              <h2>{group.key}</h2>
              <span class="acount">{group.items.length}</span>
            </div>
            {#each group.items as item (item.uid)}
              {@const es = expState(item.expirationDate)}
              <div
                class="item-wrap"
                animate:flip={{ duration: motion(200) }}
                transition:slide={{ duration: motion(200) }}
              >
                {#if touchDevice}
                  <!-- Revealed behind the row as it swipes left (iOS-Mail style). -->
                  <div class="swipe-action" aria-hidden="true">
                    Out of Stock
                  </div>
                {/if}
                <div
                  class="item"
                  class:busy={item._busy}
                  class:exp-soon={es === "soon"}
                  class:exp-expired={es === "expired"}
                  use:swipe={{
                    enabled: touchDevice,
                    commit: () => onOut(item),
                  }}
                >
                  <span class="body">
                    <span class="name"
                      >{item.ingredient}{#if item.quantity}<span class="qty">
                          · {item.quantity}</span
                        >{/if}</span
                    >
                    {#if es}<span class="badge {es}"
                        >{expLabel(item.expirationDate)}</span
                      >{/if}
                  </span>
                  {#if !touchDevice}
                    <button
                      class="out"
                      onclick={() => onOut(item)}
                      aria-label="Mark {item.ingredient} out of stock"
                      >Out of Stock</button
                    >
                  {/if}
                </div>
              </div>
            {/each}
          </section>
        {/each}
      {/if}
    </div>

    {#if outOfStock.length > 0}
      <div class="drawer" class:open={drawerOpen}>
        <button
          class="drawer-head"
          onclick={() => (drawerOpen = !drawerOpen)}
          aria-expanded={drawerOpen}
        >
          <span class="chev">▸</span>
          <span class="grow">Out of stock ({outOfStock.length})</span>
        </button>
        {#if drawerOpen}
          <div class="drawer-body">
            {#each outOfStock as item (item.uid)}
              <div class="oos" class:busy={item._busy}>
                <span class="oname">{item.ingredient}</span>
                <button class="restock" onclick={() => onRestock(item)}
                  >Restock</button
                >
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}

  {#if toast}
    <div class="toast {toast.kind}" role="status">
      <span class="tmsg">{toast.msg}</span>
      {#if toast.action}
        <button class="undo" onclick={onUndo}>{toast.action.label}</button>
      {/if}
    </div>
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
    --warn: oklch(0.62 0.13 70);
    --warn-bg: oklch(0.96 0.05 80);
    --danger: oklch(0.55 0.19 25);
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
    --warn: oklch(0.82 0.13 80);
    --warn-bg: oklch(0.3 0.06 80);
    --danger: oklch(0.72 0.16 25);
    --danger-bg: oklch(0.28 0.06 25);
    color-scheme: dark;
  }

  header {
    padding: 16px 16px 8px;
    padding-top: calc(16px + env(safe-area-inset-top));
    background: linear-gradient(var(--bg) 80%, transparent);
  }
  .htop {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  h1 {
    font-size: 17px;
    font-weight: 650;
    letter-spacing: -0.01em;
    margin: 0;
  }
  .htop .count {
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .subhint {
    margin: 5px 0 0;
    font-size: 12px;
    color: var(--muted);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .aisle {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 12px 16px 5px;
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 1;
  }
  .aisle h2 {
    margin: 0;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .aisle .acount {
    font-size: 11px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  /* The row footprint: it owns the divider so the line stays put while the inner .item swipes,
     and clips the swipe so the translated row + revealed action never bleed past it. */
  .item-wrap {
    position: relative;
    z-index: 0; /* own stacking context: scopes .item's z-index to the row so a scrolling row can't tie and paint over the sticky aisle header */
    overflow: hidden;
    border-bottom: 1px solid var(--line);
  }

  /* Revealed behind the row as it swipes left (touch). The row's opaque bg covers it at rest;
     swiping uncovers it from the right edge — the iOS-Mail affordance. */
  .swipe-action {
    position: absolute;
    inset: 0;
    z-index: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 22px;
    background: oklch(0.55 0.2 25);
    color: oklch(0.99 0.02 25);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .item {
    position: relative;
    z-index: 1; /* paints above .swipe-action; its opaque bg hides the action until swiped */
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 16px;
    background: var(--bg);
    touch-action: pan-y;
  }
  .item.busy {
    opacity: 0.5;
  }
  .item.exp-soon {
    box-shadow: inset 3px 0 0 var(--warn);
  }
  .item.exp-expired {
    box-shadow: inset 3px 0 0 var(--danger);
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
  .badge {
    display: inline-block;
    margin-top: 3px;
    font-size: 11px;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .badge.soon {
    color: var(--warn);
    background: var(--warn-bg);
  }
  .badge.expired {
    color: var(--danger);
    background: var(--danger-bg);
  }

  .out {
    appearance: none;
    flex: none;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    padding: 5px 12px;
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.13s,
      color 0.13s,
      border-color 0.13s;
  }
  .out:hover {
    background: var(--danger-bg);
    color: var(--danger);
    border-color: color-mix(in oklch, var(--danger) 50%, transparent);
  }
  .out:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .drawer {
    flex: none;
    border-top: 1px solid var(--line);
    background: var(--bg);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .drawer-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    padding: 12px 16px;
    cursor: pointer;
    text-align: left;
  }
  .drawer-head .chev {
    transition: transform 0.18s;
  }
  .drawer.open .drawer-head .chev {
    transform: rotate(90deg);
  }
  .drawer-head .grow {
    flex: 1;
  }
  .drawer-body {
    max-height: 38vh;
    overflow-y: auto;
  }
  .oos {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 16px;
    border-top: 1px solid var(--line);
  }
  .oos.busy {
    opacity: 0.5;
  }
  .oname {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--faint);
    text-decoration: line-through;
    text-decoration-color: color-mix(in oklch, var(--faint) 55%, transparent);
  }
  .restock {
    appearance: none;
    flex: none;
    border: 1px solid color-mix(in oklch, var(--accent) 45%, transparent);
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    padding: 4px 12px;
    border-radius: 999px;
    cursor: pointer;
  }
  .restock:hover {
    background: color-mix(in oklch, var(--accent) 12%, transparent);
  }
  .restock:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
  .empty.inline {
    padding: 32px 24px;
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: var(--hover);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 9px 12px;
    font-size: 13px;
    font-weight: 550;
    box-shadow: 0 8px 24px -12px oklch(0 0 0 / 0.5);
    animation: toastIn 0.2s ease-out;
  }
  .toast.error {
    background: var(--danger-bg);
    color: var(--danger);
    border-color: color-mix(in oklch, var(--danger) 40%, transparent);
  }
  .tmsg {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .undo {
    appearance: none;
    flex: none;
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    padding: 2px 4px;
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
    * {
      animation-duration: 0.001ms !important;
      transition-duration: 0.001ms !important;
    }
  }
</style>
