<script lang="ts">
  import type { App } from "@modelcontextprotocol/ext-apps";

  import { onMount } from "svelte";
  import { flip } from "svelte/animate";
  import { fade } from "svelte/transition";

  import BrandMark from "../shared/BrandMark.svelte";
  import GroupedList from "../shared/GroupedList.svelte";
  import ItemRow from "../shared/ItemRow.svelte";
  import PillButton from "../shared/PillButton.svelte";
  import Spinner from "../shared/Spinner.svelte";
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
  import { SERVER_CAPS_KEY } from "../shared/server-caps-key.js";
  import type {
    GroceryItemRow,
    GroceryListReadStructured,
  } from "../shared/server-types.js";

  // A checklist row: the server's structured grocery item (B1 — a rename of its fields breaks this
  // widget at compile time) plus transient per-row UI flags.
  type Row = GroceryItemRow & {
    _busy: boolean;
    _error: boolean;
  };

  // The ext-apps App instance, constructed in main.ts and handed in as a prop.
  let { app }: { app: App } = $props();

  // Local, mutable copy of read_grocery_list's structuredContent rows, so taps can update
  // optimistically. Replaced wholesale whenever the host feeds a fresh tool result.
  let listMeta = $state<{ uid: string; name: string } | null>(null);
  let items = $state<Row[]>([]);
  let phase = $state<"loading" | "ready" | "error">("loading");
  let theme = $state<"light" | "dark">("light");
  let toast = $state<{ kind: "error" | "info"; msg: string } | null>(null);
  // The tool's own error text (not-found / disambiguation), for the error state.
  let errorMsg = $state<string | null>(null);
  let confirmingClear = $state(false);
  let confirmingMove = $state(false);
  // True only right after confirmClear() empties the list — distinguishes the "you just finished
  // shopping" empty state from the plain "never added anything" one. Reset whenever a fresh host
  // read lands, so a genuinely different (never-populated) list never inherits a stale "cleared" beat.
  let justCleared = $state(false);
  // Fires the one-time "you're done" toast the instant a tap completes the list — never again this
  // mount, and never for a list that merely *loads* fully purchased (only doMark's own tap flips
  // this). Reset alongside justCleared so a fresh host read re-arms it for its own completion.
  let celebratedComplete = $state(false);
  // Suppresses the widget's inline two-tap confirm when the server's confirmGate is active.
  // Set once in onMount from window.__MCP_SERVER_CAPS__ (injected at resources/read time).
  let elicitation = $state(false);
  // Touch hosts get an additive swipe-right-to-mark gesture alongside the tap (unlike pantry's swipe,
  // which replaces its button — grocery's checkbox stays fully live either way). Detected the same
  // way pantry does: the host's declared capability, falling back to a coarse-pointer media query.
  let touchDevice = $state(false);

  const DEBOUNCE_MS = 300;
  const lastTap = new Map<string, number>(); // uid -> performance.now(), for the per-row flap-guard
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  // Group consecutive same-aisle rows (read_grocery_list already emits store-walk order); purchased
  // items sink to the bottom of their aisle group. Defensive merge below: groupConsecutive only
  // merges ADJACENT same-aisle runs, so an items array that ever arrives (or gets locally spliced)
  // out of walk-order would otherwise emit two separate groups sharing one aisle name — and
  // GroupedList's `{#each groups as group (group.key)}` requires unique keys, so that would crash
  // the whole widget rather than just misgroup a row. Pantry avoids this by sorting before grouping;
  // grocery can't (it depends on walk-order), so it merges by key here instead.
  const groups = $derived.by(() => {
    const consecutive = groupConsecutive(
      items,
      (item) => item.aisle ?? "Other",
    );
    const byKey = new Map<string, { key: string; items: Row[] }>();
    const out: { key: string; items: Row[] }[] = [];
    for (const g of consecutive) {
      const existing = byKey.get(g.key);
      if (existing) existing.items.push(...g.items);
      else {
        const merged = { key: g.key, items: [...g.items] };
        byKey.set(g.key, merged);
        out.push(merged);
      }
    }
    for (const g of out)
      g.items.sort((a, b) => Number(a.purchased) - Number(b.purchased));
    return out;
  });

  const purchasedCount = $derived(items.filter((i) => i.purchased).length);
  // Drives the header ring's conic-gradient sweep (registered as an animatable <number> below, so the
  // browser tweens the fill natively instead of jump-cutting it).
  const pct = $derived(
    items.length > 0 ? (purchasedCount / items.length) * 100 : 0,
  );

  onMount(() => {
    const serverCaps = (globalThis as Record<string, unknown>)[SERVER_CAPS_KEY];
    if (serverCaps !== null && typeof serverCaps === "object") {
      elicitation = Boolean(
        (serverCaps as Record<string, unknown>)["supportsElicitation"],
      );
    }
    connectHost(app, {
      onResult: receive,
      onContext: (ctx) => {
        if (ctx?.theme) theme = ctx.theme;
        touchDevice =
          ctx?.deviceCapabilities?.touch ??
          (typeof matchMedia === "function" &&
            matchMedia("(pointer: coarse)").matches);
      },
    });
  });

  // The widget renders only off the structured channel. A host that renders the widget but drops
  // structuredContent gets a neutral state — never parse the human Markdown.
  function receive(result: ReceivedResult | null | undefined) {
    const data = result?.structuredContent;
    const uid = data?.["uid"];
    const rawItems = data?.["items"];
    if (!data || typeof uid !== "string" || !uid || !Array.isArray(rawItems)) {
      // No structured payload — surface the error result's remediation text verbatim (display only),
      // and don't clobber an already-loaded list on a later failed read.
      if (phase !== "ready") {
        errorMsg = errorText(result);
        phase = "error";
      }
      return;
    }
    // Shape confirmed (a `uid` + an items array); trust the rest as the server's grocery-list read.
    const src = data as unknown as GroceryListReadStructured;
    listMeta = { uid, name: src.name };
    items = src.items.map(toRow);
    errorMsg = null;
    confirmingClear = false;
    confirmingMove = false;
    justCleared = false;
    celebratedComplete = false;
    phase = "ready";
  }

  // Wrap a structured grocery row in the local model (+ transient flags). Shared by the host re-read
  // and the optimistic re-add so the row shape lives in one place.
  function toRow(r: GroceryItemRow): Row {
    return { ...r, _busy: false, _error: false };
  }

  function showToast(msg: string, kind: "error" | "info" = "error") {
    clearTimeout(toastTimer);
    toast = { msg, kind };
    toastTimer = setTimeout(() => {
      toast = null;
    }, 2600);
  }

  // A tap is ignored only if it follows another tap on the SAME row within the debounce window. Guard
  // on "has a prior tap", not against 0, so the first tap is never eaten near page load.
  function tapThrottled(uid: string): boolean {
    const now = performance.now();
    const last = lastTap.get(uid);
    if (last !== undefined && now - last < DEBOUNCE_MS) return true;
    lastTap.set(uid, now);
    return false;
  }

  function onRow(item: Row) {
    if (item._busy) return; // per-row in-flight lock
    if (!item.purchased) doMark(item);
    else doReadd(item);
  }

  async function doMark(item: Row) {
    if (tapThrottled(item.uid)) return;
    item.purchased = true; // optimistic
    item._busy = true;
    const res = await callTool(app, "mark_grocery_item_purchased", {
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
    } else if (
      !celebratedComplete &&
      items.every((i) => i.purchased && !i._busy)
    ) {
      // Rows still in flight can revert, so the moment only counts once every mark has landed.
      // The tap that finishes the list, once — a quiet acknowledgment of the moment plus a nudge
      // toward the two pills that just appeared, not a fireworks show over a checkbox.
      celebratedComplete = true;
      showToast("That’s the list — clear it or move it to pantry.", "info");
    }
  }

  async function doReadd(item: Row) {
    if (!listMeta) return;
    if (tapThrottled(item.uid)) return;
    const listUid = listMeta.uid;
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
    const add = await callTool(app, "add_grocery_items", {
      listUid,
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
    const del = await callTool(app, "delete_grocery_item", { uid: item.uid });
    item._busy = false;
    const addedRows = add.structuredContent?.["items"];
    const added = Array.isArray(addedRows)
      ? (addedRows[0] as GroceryItemRow | undefined)
      : undefined;
    const idx = items.indexOf(item);
    if (idx < 0) return;
    if (!del.isError) {
      // Replace the bought row in place with the new to-buy row (keyed each → no scroll jump). If the
      // host omitted the new row, just drop the bought one; the next read surfaces the addition.
      if (added) items.splice(idx, 1, toRow(added));
      else items.splice(idx, 1);
    } else {
      // Couldn't remove the bought copy: keep it and show the new row beside it — a visible, clearable
      // duplicate rather than a lost re-add.
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
    if (!listMeta) return;
    if (!items.some((i) => i.purchased)) return;
    const listUid = listMeta.uid;
    const res = await callTool(app, "clear_purchased_grocery_items", {
      listUid,
    });
    if (res.isError) {
      showToast("Couldn’t clear — try again.");
      return;
    }
    // A non-error clear result can't be told apart from a declined server-confirm — both are non-error
    // and carry no structuredContent — so re-read the list and rebuild from the authoritative state
    // instead of blindly sweeping purchased rows.
    const fresh = await callTool(app, "read_grocery_list", {
      lookup: { uid: listUid },
    });
    if (fresh.structuredContent) receive(fresh);
    else items = items.filter((i) => !i.purchased); // re-read unavailable: the clear succeeded, so sweep
    justCleared = items.length === 0;
  }

  function onMove() {
    confirmingMove = true;
  }
  function cancelMove() {
    confirmingMove = false;
  }
  // Send the same purchased set the clear action operates on to the pantry. move_grocery_items_to_pantry
  // creates the pantry items then soft-deletes the grocery rows; we re-read rather than reconcile its
  // pantry-shaped structuredContent into this grocery view.
  async function confirmMove() {
    confirmingMove = false;
    if (!listMeta) return;
    const purchased = items.filter((i) => i.purchased);
    if (purchased.length === 0) return;
    const listUid = listMeta.uid;
    const res = await callTool(app, "move_grocery_items_to_pantry", {
      uids: purchased.map((i) => i.uid),
    });
    if (res.isError) {
      showToast("Couldn’t move to pantry — try again.");
      return;
    }
    // Like the clear path, a non-error move can't be told apart from a declined server-confirm (both
    // non-error, neither carrying this list's rows), and a partial move can leave items in both stores
    // — so re-read the list and rebuild from authoritative state instead of blindly sweeping.
    const fresh = await callTool(app, "read_grocery_list", {
      lookup: { uid: listUid },
    });
    if (fresh.structuredContent) receive(fresh);
    else items = items.filter((i) => !i.purchased); // re-read unavailable: the move succeeded, so sweep
    justCleared = items.length === 0;
  }

  // Swipe-right to mark purchased, on touch hosts only, additive to the tap (the checkbox stays live
  // either way — unlike pantry's swipe, this never replaces the primary affordance). Mirrors pantry's
  // swipe action with the sign flipped: "complete" reads as a rightward gesture, "remove" as leftward.
  function swipe(
    node: HTMLElement,
    param: { enabled: boolean; commit: () => void },
  ) {
    let p = param;
    let x0: number | null = null;
    let dx = 0;
    // Clear the in-progress drag's inline transform. Centralized so every exit path (commit, cancel,
    // an enabled flip mid-drag) leaves no row stuck translated.
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
      if (!p.enabled) return reset(); // item got marked mid-drag — abandon the gesture
      // Resist past the commit threshold so the row can't be dragged fully away — enough to reveal the
      // action, not slide the row off. The row stays opaque; the action shows behind it.
      dx = Math.max(0, Math.min(120, e.clientX - x0));
      node.style.transform = `translateX(${dx.toString()}px)`;
    };
    const up = () => {
      if (x0 === null) return;
      const commit = p.enabled && dx > 80;
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
      icon="🛒"
      title="Couldn’t load this list"
      desc={errorMsg ?? undefined}
    />
  {:else if items.length === 0 && justCleared}
    <StatusScreen
      icon="🧺"
      title="List’s clear"
      desc="Nice work — ask when you’re ready to start a fresh list."
    />
  {:else if items.length === 0}
    <StatusScreen
      icon="🧺"
      title="Nothing on this list yet"
      desc="Ask to add items and they’ll appear here, grouped by aisle in the order you walk the store."
    />
  {:else}
    <header>
      <BrandMark title={listMeta?.name ?? ""} />
      <div class="head-right">
        {#if confirmingClear}
          <div class="mode" transition:fade={{ duration: motion(140) }}>
            <span class="progress">Clear {purchasedCount} purchased?</span>
            <PillButton variant="danger-strong" onclick={confirmClear}
              >Clear</PillButton
            >
            <PillButton onclick={cancelClear}>Keep</PillButton>
          </div>
        {:else if confirmingMove}
          <div class="mode" transition:fade={{ duration: motion(140) }}>
            <span class="progress">Move {purchasedCount} to pantry?</span>
            <PillButton variant="accent" onclick={confirmMove}>Move</PillButton>
            <PillButton onclick={cancelMove}>Keep</PillButton>
          </div>
        {:else}
          <div class="mode" transition:fade={{ duration: motion(140) }}>
            <div
              class="ring"
              class:done={purchasedCount === items.length}
              style:--pct={pct}
              role="img"
              aria-label="{purchasedCount} of {items.length} done"
            >
              <span class="ring-count" aria-hidden="true"
                >{purchasedCount}/{items.length}</span
              >
            </div>
            {#if purchasedCount > 0}
              <PillButton
                variant="accent"
                onclick={elicitation ? confirmMove : onMove}
                >Move {purchasedCount} → pantry</PillButton
              >
              <PillButton onclick={elicitation ? confirmClear : onClear}
                >Clear {purchasedCount}</PillButton
              >
            {/if}
          </div>
        {/if}
      </div>
    </header>

    <GroupedList
      {groups}
      headerExtra={aisleHeader}
      rows={rowList}
      footer={hint}
    />
  {/if}

  <Toast {toast} />
</WidgetShell>

{#snippet aisleHeader(group: { key: string; items: Row[] })}
  {@const remaining = group.items.filter((i) => !i.purchased).length}
  <span class="count" class:done={remaining === 0}
    >{remaining}/{group.items.length}</span
  >
{/snippet}

{#snippet rowList(rowItems: Row[])}
  {#each rowItems as item (item.uid)}
    <div class="row-wrap" animate:flip={{ duration: motion(220) }}>
      {#if touchDevice && !item.purchased}
        <!-- Revealed behind the row as it swipes right (mirrors pantry's iOS-Mail-style reveal). -->
        <div class="swipe-mark" aria-hidden="true">Purchased</div>
      {/if}
      <button
        class="row"
        class:done={item.purchased}
        class:busy={item._busy}
        class:err={item._error}
        role="checkbox"
        aria-checked={item.purchased}
        aria-busy={item._busy}
        onclick={() => onRow(item)}
        use:swipe={{
          enabled: touchDevice && !item.purchased,
          commit: () => onRow(item),
        }}
      >
        <span class="box">
          {#if item._busy}
            <Spinner size={15} color="var(--success)" />
          {:else}
            <svg viewBox="0 0 16 16" aria-hidden="true"
              ><path class="tick" d="M3.5 8.5l3 3 6-6.5" /></svg
            >
          {/if}
        </span>
        <ItemRow
          ingredient={item.ingredient}
          quantity={item.quantity}
          done={item.purchased}
        />
      </button>
    </div>
  {/each}
{/snippet}

{#snippet hint()}
  <p class="hint">Tap a purchased item to add it back to the list.</p>
{/snippet}

<style>
  /* Registers --pct as an animatable <number> — a bare custom property can't be transitioned (the
     browser treats it as an opaque token), so without this the ring's conic-gradient stop would jump
     instead of sweep. Unsupported browsers (pre-2023 evergreen) just skip the animation; the ring
     itself renders identically either way. */
  @property --pct {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
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
  .head-right {
    /* Positioning shell only — .mode carries the flex row, so the three head-right states (idle /
       confirm-clear / confirm-move) can crossfade against each other via Svelte's block transitions
       without the wrapper itself re-mounting. */
    flex: none;
  }
  .mode {
    display: flex;
    /* baseline so the "n/n done" count reads on the same line as the pill labels beside it. */
    align-items: baseline;
    gap: 8px;
  }
  .progress {
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* The idle-state completion ring — a glanceable donut in place of plain "n/m" text, readable at a
     glance while pushing a cart one-handed. --pct sweeps natively via the @property registration
     above; the fill color hard-swaps to --success at 100% rather than crossfading, matching how the
     row tick and the aisle/progress counts already treat "done" as a discrete state, not a gradient. */
  .ring {
    --pct: 0;
    --ring-color: var(--accent);
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: conic-gradient(
      var(--ring-color) calc(var(--pct) * 1%),
      var(--line) 0
    );
    display: grid;
    place-items: center;
    transition: --pct 0.4s cubic-bezier(0.25, 1, 0.5, 1);
  }
  .ring.done {
    --ring-color: var(--success);
  }
  .ring-count {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--bg);
    display: grid;
    place-items: center;
    font-size: 8.5px;
    font-weight: 700;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .ring.done .ring-count {
    color: var(--success);
  }

  /* Trailing flavor text for the sticky aisle header (rendered through GroupedList's headerExtra
     slot) — the per-aisle done count, beside the heading. */
  .count {
    font-size: 11px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  /* A fully-checked aisle reads green — a real wayfinding cue while walking the store ("this aisle's
     done, move on"), not decoration. Still clears its own bar: 3.93:1 in light / 7.94:1 in dark beats
     the --faint baseline this label already ran at (3.27:1 / 4.04:1) for the same non-body caption role. */
  .count.done {
    color: var(--success);
  }

  /* Own stacking context, clipped: hosts the swipe-mark reveal behind the row and scopes .row's own
     z-index locally so a scrolling row can never paint over GroupedList's sticky aisle header (same
     technique pantry's .item-wrap uses). */
  .row-wrap {
    position: relative;
    z-index: 0;
    overflow: hidden;
    /* A row is a fixed, known shape — this is the one property genuinely worth handing the browser a
       render-skip hint for: on a very long list, an off-screen row's layout/paint is skipped entirely
       until it nears the viewport. contain-intrinsic-size holds the scrollbar's math steady in the
       meantime; it's an estimate the browser corrects once the row is actually measured, not a cap. */
    content-visibility: auto;
    contain-intrinsic-size: auto 44px;
  }

  /* Revealed behind the row as it swipes right (touch only). Green, not the danger red pantry's
     swipe-to-remove uses — this is a forward/positive action, not a subtractive one. */
  .swipe-mark {
    position: absolute;
    inset: 0;
    z-index: 0;
    display: flex;
    align-items: center;
    padding-left: 22px;
    background: var(--success);
    color: var(--success-ink);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .row {
    position: relative;
    z-index: 1; /* paints above .swipe-mark; its opaque bg hides the reveal until swiped */
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 11px 16px;
    text-align: left;
    background: var(--bg);
    touch-action: pan-y;
    transition:
      background 0.13s,
      transform 0.1s cubic-bezier(0.25, 1, 0.5, 1);
  }
  .row:hover {
    background: var(--hover);
  }
  /* Immediate tactile feedback on tap — this surface is used one-handed in a store aisle, so the
     press has to read before the network round-trip (mark_grocery_item_purchased) resolves, not
     after. A row press is the highest-frequency interaction here, so it earns the touch. */
  .row:active {
    background: var(--hover);
    transform: scale(0.985);
  }
  .row:focus-visible {
    outline-offset: -2px;
    border-radius: 6px;
  }
  .row.err {
    animation: errFlash 1.1s ease-out;
  }
  @keyframes errFlash {
    /* Opaque at rest, not transparent: on touch hosts the green swipe reveal sits behind every
       unpurchased row and would show through. */
    0%,
    100% {
      background: var(--bg);
    }
    18% {
      background: var(--danger-bg);
    }
  }

  .box {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 6px;
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
    stroke: var(--success-ink);
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
    stroke-dasharray: 20;
    stroke-dashoffset: 20;
  }
  .row.done .box {
    background: var(--success);
    border-color: var(--success);
  }
  .row.done .tick {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) 0.02s;
  }

  .hint {
    padding: 12px 16px;
    margin: 0;
    border-top: 1px solid var(--line);
    font-size: 12px;
    color: var(--faint);
  }

  @media (prefers-reduced-motion: reduce) {
    .tick {
      stroke-dashoffset: 0;
    }
  }
</style>
