<script lang="ts">
  import type { App } from "@modelcontextprotocol/ext-apps";

  import { flip } from "svelte/animate";
  import { onMount } from "svelte";
  import { slide } from "svelte/transition";

  import BrandMark from "../shared/BrandMark.svelte";
  import GroupedList from "../shared/GroupedList.svelte";
  import ItemRow from "../shared/ItemRow.svelte";
  import PillButton from "../shared/PillButton.svelte";
  import StatusScreen from "../shared/StatusScreen.svelte";
  import Toast from "../shared/Toast.svelte";
  import WidgetShell from "../shared/WidgetShell.svelte";
  import { groupConsecutive } from "../shared/group.js";
  import {
    callTool,
    connectHost,
    errorText,
    type ReceivedResult,
  } from "../shared/host-bridge.js";
  import { motion } from "../shared/motion.js";

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
    return groupConsecutive(sorted, (item) => item.aisle ?? "Other");
  });

  onMount(() => {
    connectHost(app, {
      onResult: receive,
      onContext: (ctx) => {
        if (ctx?.theme) theme = ctx.theme;
        // Prefer the host's declared capability; fall back to a coarse-pointer media query.
        touchDevice =
          ctx?.deviceCapabilities?.touch ??
          (typeof matchMedia === "function" &&
            matchMedia("(pointer: coarse)").matches);
      },
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
        errorMsg = errorText(result);
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

  // Mark out of stock: optimistic same-UID flip (the row leaves the in-stock list for the drawer),
  // revert on error. No confirm — the verb is reversible; an Undo toast is the safety net.
  async function onOut(item: Row) {
    if (item._busy) return; // per-row in-flight lock (the row sits in the drawer while in flight)
    item._busy = true;
    item.inStock = false; // optimistic — derived lists move it to the drawer
    const res = await callTool(app, "mark_pantry_item_out_of_stock", {
      uid: item.uid,
    });
    item._busy = false;
    if (res.isError) {
      item.inStock = true; // revert
      showToast("Couldn’t update that — try again.");
    } else {
      showToast(`${item.ingredient} — out of stock`, "info", {
        label: "Undo",
        fn: () => {
          dismissToast();
          doRestock(item);
        },
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
    const res = await callTool(app, "restock_pantry_item", { uid: live.uid });
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
      // Resist past the commit threshold so the row can't be dragged fully off — enough to reveal the
      // action, not slide the whole row away. The row stays opaque; the action shows behind it.
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

<WidgetShell dark={theme === "dark"}>
  {#if phase === "loading"}
    <StatusScreen desc="Loading…" />
  {:else if phase === "error"}
    <StatusScreen
      icon="🧺"
      title="Couldn’t load your pantry"
      desc={errorMsg ?? undefined}
    />
  {:else if items.length === 0}
    <StatusScreen
      icon="🧺"
      title="Your pantry is empty"
      desc="Items you add to your pantry show up here, grouped by aisle."
    />
  {:else}
    <header>
      <div class="htop">
        <BrandMark title="Pantry" />
        <span class="count">{inStockCount} in stock</span>
      </div>
      {#if touchDevice && inStockCount > 0}
        <p class="subhint">Swipe a row left to mark it out of stock.</p>
      {/if}
    </header>

    {#if inStockCount === 0}
      <div class="fill">
        <StatusScreen
          inline
          icon="🧺"
          title="Nothing in stock right now"
          desc="Restock items from the drawer below."
        />
      </div>
    {:else}
      <GroupedList
        {groups}
        headerExtra={aisleHeader}
        rows={rowList}
        padBottom={false}
      />
    {/if}

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
                <PillButton variant="accent" onclick={() => onRestock(item)}
                  >Restock</PillButton
                >
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}

  <Toast {toast} />
</WidgetShell>

{#snippet aisleHeader(group: { key: string; items: Row[] })}
  <span class="acount">{group.items.length}</span>
{/snippet}

{#snippet rowList(rowItems: Row[])}
  {#each rowItems as item (item.uid)}
    {@const es = expState(item.expirationDate)}
    <div
      class="item-wrap"
      animate:flip={{ duration: motion(200) }}
      transition:slide={{ duration: motion(200) }}
    >
      {#if touchDevice}
        <!-- Revealed behind the row as it swipes left (iOS-Mail style). -->
        <div class="swipe-action" aria-hidden="true">Out of Stock</div>
      {/if}
      <div
        class="item"
        class:busy={item._busy}
        class:exp-soon={es === "soon"}
        class:exp-expired={es === "expired"}
        use:swipe={{ enabled: touchDevice, commit: () => onOut(item) }}
      >
        <ItemRow ingredient={item.ingredient} quantity={item.quantity}>
          {#snippet extra()}
            {#if es}<span class="badge {es}"
                >{expLabel(item.expirationDate)}</span
              >{/if}
          {/snippet}
        </ItemRow>
        {#if !touchDevice}
          <PillButton
            variant="danger"
            onclick={() => onOut(item)}
            ariaLabel="Mark {item.ingredient} out of stock"
            >Out of Stock</PillButton
          >
        {/if}
      </div>
    </div>
  {/each}
{/snippet}

<style>
  header {
    padding: 16px 16px 8px;
    padding-top: calc(16px + env(safe-area-inset-top));
    background: linear-gradient(var(--bg) 80%, transparent);
  }
  .htop {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
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

  /* Holds the in-flow "nothing in stock" state in the scroll area above the drawer. */
  .fill {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  /* Trailing content for the sticky aisle header (rendered through GroupedList's headerExtra slot). */
  .acount {
    font-size: 11px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }

  /* The row footprint: it clips the swipe so the translated row + revealed action never bleed past it.
     Rows carry no per-row divider — the category separators (GroupedList's `.aisle` top border) are
     the only horizontal lines in the list. */
  .item-wrap {
    position: relative;
    z-index: 0; /* own stacking context: scopes .item's z-index to the row so a scrolling row can't tie and paint over the sticky aisle header */
    overflow: hidden;
  }

  /* Revealed behind the row as it swipes left (touch). The row's opaque bg covers it at rest; swiping
     uncovers it from the right edge — the iOS-Mail affordance. */
  .swipe-action {
    position: absolute;
    inset: 0;
    z-index: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 22px;
    background: oklch(0.56 0.215 29);
    color: oklch(0.99 0.02 29);
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

  @media (prefers-reduced-motion: reduce) {
    * {
      animation-duration: 0.001ms !important;
      transition-duration: 0.001ms !important;
    }
  }
</style>
