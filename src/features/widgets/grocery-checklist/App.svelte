<script lang="ts">
  import type { App } from "@modelcontextprotocol/ext-apps";

  import { onMount } from "svelte";
  import { flip } from "svelte/animate";

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

  // A checklist row: a structured grocery item plus transient per-row UI flags.
  interface Row {
    uid: string;
    ingredient: string;
    quantity: string | null;
    aisle: string | null;
    purchased: boolean;
    _busy: boolean;
    _error: boolean;
  }

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
  // Suppresses the widget's inline two-tap confirm when the server's confirmGate is active.
  // Set once in onMount from window.__MCP_SERVER_CAPS__ (injected at resources/read time).
  let elicitation = $state(false);

  const DEBOUNCE_MS = 300;
  const lastTap = new Map<string, number>(); // uid -> performance.now(), for the per-row flap-guard
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  // Group consecutive same-aisle rows (read_grocery_list already emits store-walk order); purchased
  // items sink to the bottom of their aisle group.
  const groups = $derived.by(() => {
    const out = groupConsecutive(items, (item) => item.aisle ?? "Other");
    for (const g of out)
      g.items.sort((a, b) => Number(a.purchased) - Number(b.purchased));
    return out;
  });

  const purchasedCount = $derived(items.filter((i) => i.purchased).length);

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
    listMeta = {
      uid,
      name: typeof data["name"] === "string" ? data["name"] : "",
    };
    items = rawItems.map((r) => toRow(r));
    errorMsg = null;
    confirmingClear = false;
    confirmingMove = false;
    phase = "ready";
  }

  // Map a structured grocery row into the local model (+ transient flags). Shared by the host re-read
  // and the optimistic re-add so the row shape lives in one place; every field is coerced defensively.
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
      purchased: Boolean(row["purchased"]),
      _busy: false,
      _error: false,
    };
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
    const added = Array.isArray(addedRows) ? addedRows[0] : undefined;
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
  {:else if items.length === 0}
    <StatusScreen
      icon="🧺"
      title="Nothing on this list yet"
      desc="Add items and they’ll appear here, grouped by aisle in the order you walk the store."
    />
  {:else}
    <header>
      <BrandMark title={listMeta?.name ?? ""} />
      <div class="head-right">
        {#if confirmingClear}
          <span class="progress">Clear {purchasedCount} purchased?</span>
          <PillButton variant="danger-strong" onclick={confirmClear}
            >Clear</PillButton
          >
          <PillButton onclick={cancelClear}>Keep</PillButton>
        {:else if confirmingMove}
          <span class="progress">Move {purchasedCount} to pantry?</span>
          <PillButton variant="accent" onclick={confirmMove}>Move</PillButton>
          <PillButton onclick={cancelMove}>Keep</PillButton>
        {:else}
          <span class="progress">{purchasedCount}/{items.length} done</span>
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
  <span class="count"
    >{group.items.filter((i) => !i.purchased).length}/{group.items.length}</span
  >
{/snippet}

{#snippet rowList(rowItems: Row[])}
  {#each rowItems as item (item.uid)}
    <button
      class="row"
      class:done={item.purchased}
      class:busy={item._busy}
      class:err={item._error}
      role="checkbox"
      aria-checked={item.purchased}
      onclick={() => onRow(item)}
      animate:flip={{ duration: motion(220) }}
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
  {/each}
{/snippet}

{#snippet hint()}
  <p class="hint">Tap a purchased item to add it back to the list.</p>
{/snippet}

<style>
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
    display: flex;
    /* baseline so the "n/n done" count reads on the same line as the pill labels beside it. */
    align-items: baseline;
    gap: 8px;
    flex: none;
  }
  .progress {
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* Trailing flavor text for the sticky aisle header (rendered through GroupedList's headerExtra
     slot) — the per-aisle done count, beside the heading. */
  .count {
    font-size: 11px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 11px 16px;
    text-align: left;
    transition: background 0.13s;
  }
  .row:hover {
    background: var(--hover);
  }
  .row:focus-visible {
    outline-offset: -2px;
    border-radius: 6px;
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
