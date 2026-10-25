<script lang="ts">
  import type { App } from "@modelcontextprotocol/ext-apps";

  import { flip } from "svelte/animate";
  import { onMount, tick } from "svelte";
  import { quartOut, quintOut } from "svelte/easing";
  import { SvelteSet } from "svelte/reactivity";
  import { fade, slide } from "svelte/transition";

  import BrandMark from "../shared/BrandMark.svelte";
  import Chevron from "../shared/Chevron.svelte";
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
  import { motion, reduced } from "../shared/motion.js";
  import { SERVER_CAPS_KEY } from "../shared/server-caps-key.js";
  import type {
    PantryItemRow,
    PantryListStructured,
  } from "../shared/server-types.js";
  import { createSwipeAction } from "../shared/swipe-action.js";

  // A pantry row: the server's structured pantry item (B1 — a rename of its fields breaks this widget
  // at compile time) plus transient per-row flags. `inStock` drives which list the row lives in (the
  // in-stock checklist vs. the out-of-stock drawer).
  type Row = PantryItemRow & {
    _busy: boolean;
    _error: boolean;
  };

  // The ext-apps App instance, constructed in main.ts and handed in as a prop.
  let { app }: { app: App } = $props();

  // Local, mutable copy of list_pantry_items' rows (in AND out of stock — the drawer is fed from the
  // same read), so taps update optimistically. Replaced wholesale on a fresh tool result.
  let items = $state<Row[]>([]);
  let phase = $state<"loading" | "ready" | "error">("loading");
  let theme = $state<"light" | "dark">("light");
  // Touch hosts get swipe-to-remove (the Out button hides); pointer hosts get the button.
  let touchDevice = $state(false);
  let elicitation = $state(false);
  let drawerOpen = $state(false);
  let confirmingClear = $state(false);
  let toast = $state<{
    kind: "error" | "info";
    msg: string;
    action?: { label: string; fn: () => void };
  } | null>(null);
  // The tool's own error text, for the error state.
  let errorMsg = $state<string | null>(null);

  // Transient motion state: the row mid-drag (lift shadow), the row past the commit threshold (the
  // reveal's armed pop), and the row that just landed back in its aisle (the fresh-green wash).
  let draggingUid = $state<string | null>(null);
  let armedUid = $state<string | null>(null);
  let restockedUid = $state<string | null>(null);
  // Fires the one-time "fully stocked" beat when a restock empties the drawer — never again this
  // mount, and never for a pantry that merely loads fully stocked. Reset on a fresh host read.
  let celebratedFull = $state(false);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let landedTimer: ReturnType<typeof setTimeout> | undefined;

  const SOON_DAYS = 7; // an item expiring within this many days is flagged "expiring soon"

  // ---- The drawer flight ------------------------------------------------------------------------
  // A clone of the moving row glides between the list and the drawer in a fixed overlay while the
  // real rows collapse/grow in place with plain local slides. Hand-rolled WAAPI rather than
  // svelte/transition's crossfade, deliberately: a Svelte outro removes its element only when its
  // animation finishes, so a frozen document timeline (a backgrounded host tab, a headless preview)
  // strands invisible ghost rows whose Restock buttons stay in the accessibility tree until the
  // timeline resumes — the clone instead cleans itself up on a plain timeout, which ticks even
  // hidden. The deferred pairing also has open multi-item issues (sveltejs/svelte#10252 / #11372)
  // and sits next to #13977 (iOS transforms break after flip/crossfade) — the swipe's own host.
  // Bonus: a fixed-position clone escapes both scroll clips, gliding over the drawer seam instead
  // of vanishing into it. Skipped wholesale under reduced motion; the state still swaps through
  // the motion()-gated slides.
  const listEls = new Map<string, HTMLElement>();
  const oosEls = new Map<string, HTMLElement>();
  let drawerHeadEl = $state<HTMLElement | null>(null);
  // Rows whose clone is currently airborne: the real destination row holds its slot invisibly
  // until the flight's handoff reveals it, so the item is never on screen twice.
  const flying = new SvelteSet<string>();

  // Tracks a row element by uid so a flight can find its source and destination rects.
  function reg(
    node: HTMLElement,
    p: { map: Map<string, HTMLElement>; uid: string },
  ) {
    p.map.set(p.uid, node);
    return {
      destroy() {
        // only forget the uid if this node is still its registrant (a re-added row's fresh
        // element may have re-registered the uid before the old element's teardown runs)
        if (p.map.get(p.uid) === node) p.map.delete(p.uid);
      },
    };
  }

  // Capture the departing row (rect + clone) BEFORE the state flip unmounts it; `to()` then flies
  // the clone to the destination row (rect-to-rect) or, with `swallow`, shrinks it into the drawer
  // head — the closed drawer visibly receiving the row. The handoff is a real one: the caller hides
  // the destination row (the `flying` set) so the item is never on screen twice, and `onArrive`
  // fires as the clone's end-fade begins — the row appears UNDER the fading clone, a crossfade
  // between the source-styled clone and the destination-styled row. `to()` returns false when the
  // flight can't launch, so the caller never hides a row no clone will ever reveal. The clone lives
  // inside <main> so the theme tokens cascade to it, floats under the toast (z 4 < 5), and
  // self-removes on finish, cancel, or the belt-and-braces timeout.
  function beginFlight(src: HTMLElement | undefined) {
    if (reduced || !src) return null;
    const main = src.closest("main");
    const a = src.getBoundingClientRect();
    const clone = src.cloneNode(true) as HTMLElement;
    return {
      to(
        dest: HTMLElement | null,
        opts: { swallow?: boolean; onArrive?: () => void } = {},
      ): boolean {
        if (!dest || !main) return false;
        const b = dest.getBoundingClientRect();
        clone.setAttribute("aria-hidden", "true");
        clone.style.position = "fixed";
        clone.style.left = `${a.left.toString()}px`;
        clone.style.top = `${a.top.toString()}px`;
        clone.style.width = `${a.width.toString()}px`;
        clone.style.height = `${a.height.toString()}px`;
        clone.style.margin = "0";
        clone.style.zIndex = "4";
        clone.style.pointerEvents = "none";
        clone.style.boxSizing = "border-box";
        // the toast's float shadow — the one vocabulary for something genuinely airborne
        clone.style.boxShadow = "0 8px 24px -12px oklch(0 0 0 / 0.5)";
        if (getComputedStyle(src).backgroundColor === "rgba(0, 0, 0, 0)") {
          clone.style.background = "var(--hover)"; // a drawer row's tray wash travels with it
        }
        let dx: number;
        let dy: number;
        if (opts.swallow) {
          // Shrink around the clone's own center, aimed center-to-center at the head — the row
          // collapses into the middle of the drawer bar, not off toward its left edge.
          clone.style.transformOrigin = "center";
          dx = b.left + b.width / 2 - (a.left + a.width / 2);
          dy = b.top + b.height / 2 - (a.top + a.height / 2);
        } else {
          dx = b.left - a.left;
          dy = b.top - a.top;
        }
        // Paced as a glide, not a throw: duration scales with distance into the 300–500ms layout
        // band, the ease-in-out reads as the row being CARRIED (a quint-out spends all its speed
        // in the first frames and looks like teleporting), and the clone stays opaque for the
        // first two-thirds of the travel so the flight is legible before it hands off to the
        // destination row underneath. Swallow flights start from a higher base: they're usually
        // short hops whose shrink needs the extra time to read.
        const dur = Math.min(
          560,
          (opts.swallow ? 340 : 240) + Math.sqrt(Math.hypot(dx, dy)) * 13,
        );
        main.appendChild(clone);
        const anim = clone.animate(
          [
            { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
            { offset: 0.65, opacity: 1 },
            opts.swallow
              ? {
                  transform: `translate(${dx.toString()}px, ${dy.toString()}px) scale(0.4)`,
                  opacity: 0,
                }
              : {
                  transform: `translate(${dx.toString()}px, ${dy.toString()}px) scale(1)`,
                  opacity: 0,
                },
          ],
          {
            duration: dur,
            easing: "cubic-bezier(0.45, 0.05, 0.25, 1)",
            fill: "forwards",
          },
        );
        const done = () => {
          clone.remove();
          opts.onArrive?.(); // idempotent at the call site; the fallback if the fade never ticked
        };
        anim.onfinish = done;
        anim.oncancel = done;
        setTimeout(done, dur + 120);
        // Reveal the destination as the end-fade begins, so the last stretch is a crossfade.
        if (opts.onArrive) setTimeout(opts.onArrive, dur * 0.65);
        return true;
      },
    };
  }
  // -------------------------------------------------------------------------------------------------

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

  // The drawer is the only content worth acting on when nothing is in stock, so open it rather than
  // pointing the empty state at a collapsed row; once everything is restocked, reset to closed (and
  // drop a stale clear-confirm) so the next out-of-stock item starts from the calm resting state.
  $effect(() => {
    if (phase !== "ready") return;
    if (inStockCount === 0 && outOfStock.length > 0) drawerOpen = true;
    else if (outOfStock.length === 0) {
      drawerOpen = false;
      confirmingClear = false;
    }
  });

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
    // Shape confirmed (an items array); trust the rows as list_pantry_items' output.
    const src = data as unknown as PantryListStructured;
    items = src.items.map(toRow);
    errorMsg = null;
    confirmingClear = false;
    celebratedFull = false;
    restockedUid = null;
    phase = "ready";
  }

  // Wrap a structured pantry row in the local model. A missing `inStock` defaults to in-stock (show
  // the item rather than hide it on a malformed field); only an explicit `false` hides it.
  function toRow(r: PantryItemRow): Row {
    return { ...r, inStock: r.inStock !== false, _busy: false, _error: false };
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

  function onClear() {
    confirmingClear = true;
  }
  function cancelClear() {
    confirmingClear = false;
  }
  async function confirmClear() {
    confirmingClear = false;
    const res = await callTool(app, "clear_out_of_stock_pantry_items", {});
    if (res.isError) {
      showToast("Couldn't clear — try again.");
      return;
    }
    // A declined server-confirm is non-error with no structuredContent — indistinguishable
    // from a successful clear — so re-read authoritatively rather than filtering blindly.
    const fresh = await callTool(app, "list_pantry_items", {});
    if (fresh.structuredContent) receive(fresh);
    else items = items.filter((i) => i.inStock); // re-read unavailable: the clear succeeded, sweep
  }

  // Mark out of stock: optimistic same-UID flip (the row leaves the in-stock list for the drawer),
  // revert on error. No confirm — the verb is reversible; an Undo toast is the safety net.
  // `fly` runs the drawer flight (the button path); the swipe path skips it — its row already left
  // through the edge, so the drawer's count bump alone acknowledges the catch.
  async function onOut(item: Row, opts: { fly?: boolean } = {}) {
    if (item._busy) return; // per-row in-flight lock (the row sits in the drawer while in flight)
    const flight = opts.fly ? beginFlight(listEls.get(item.uid)) : null;
    item._busy = true;
    item.inStock = false; // optimistic — derived lists move it to the drawer
    if (flight) {
      await tick(); // let the drawer row (or the newly-mounted drawer) render, then aim at it
      // Aim rect-to-rect only when the drawer is OPEN. Closed, the row still exists in the
      // always-mounted body but sits clipped and invisible — a flight to it reads as flying to
      // nowhere — so the head swallows the clone instead and the count bump acknowledges the catch.
      const destRow = drawerOpen ? oosEls.get(item.uid) : undefined;
      const launched = flight.to(destRow ?? drawerHeadEl, {
        swallow: !destRow,
        onArrive: () => flying.delete(item.uid),
      });
      if (launched && destRow) flying.add(item.uid);
    }
    const res = await callTool(app, "mark_pantry_item_out_of_stock", {
      uid: item.uid,
    });
    // Re-resolve by uid before settling: a receive() during the await replaces `items` with new
    // objects, orphaning the captured `item` — the busy unlock and error revert must land on the
    // currently-rendered row (the same guard doRestock carries, for the same reason).
    const live = items.find((i) => i.uid === item.uid) ?? item;
    live._busy = false;
    if (res.isError) {
      live.inStock = true; // revert — the row re-enters its aisle
      // Flash the returned row so the failure names its row, not just the toast.
      live._error = true;
      setTimeout(() => {
        live._error = false;
      }, 1100);
      showToast("Couldn’t update that — try again.");
    } else {
      showToast(`${live.ingredient} — out of stock`, "info", {
        label: "Undo",
        fn: () => {
          dismissToast();
          doRestock(live); // doRestock re-resolves again at tap time
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
    const flight = beginFlight(oosEls.get(live.uid));
    live._busy = true;
    live.inStock = true; // optimistic
    if (flight) {
      await tick(); // let the aisle row mount (a fresh group included), then fly home to it
      const launched = flight.to(listEls.get(live.uid) ?? null, {
        onArrive: () => flying.delete(live.uid),
      });
      if (launched) flying.add(live.uid);
    }
    const res = await callTool(app, "restock_pantry_item", { uid: live.uid });
    live._busy = false;
    if (res.isError) {
      live.inStock = false; // revert
      showToast("Couldn’t restock that — try again.");
    } else {
      // The landing wash: the row re-enters its aisle under a brief fresh-green fade — green is the
      // system's done/fresh signal, and it answers "where did it go?" after the flight up.
      restockedUid = live.uid;
      clearTimeout(landedTimer);
      landedTimer = setTimeout(() => {
        restockedUid = null;
      }, 1000);
      // Rows still in flight can revert, so the drawer only counts as empty once every restock has landed.
      if (!celebratedFull && items.every((i) => i.inStock && !i._busy)) {
        // The restock that empties the drawer, acknowledged once — a quiet beat, not fireworks.
        celebratedFull = true;
        showToast("Fully stocked.", "info");
      }
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

  // Swipe-left to mark out, on touch hosts only — the iOS-Mail affordance: a graded reveal that
  // tracks the finger, an armed pop past the commit threshold (with a haptic tick where the host
  // permits it), a mid-drag lift shadow, an eased settle when released early, and a sweep off the
  // edge on commit. The gesture math and the pointer/response wiring are both shared:
  // createSwipeAction wraps createSwipeRecognizer plus the physics grocery's swipe-to-
  // check shares; only the direction, the -120..0 resistance clamp, and the exit-transform commit
  // (this row leaves for the drawer, unlike grocery's, which stays and eases back to rest) are
  // pantry-specific. Click suppression IS needed here: the row wraps separate button targets (the
  // hidden `.sr-action` / visible `.rowact` pills) a stray post-drag click could activate. The Out
  // button is the pointer-host path; this is the touch path (the button is hidden there).
  const swipe = createSwipeAction({
    axis: "x",
    direction: "left",
    resist: (raw) => Math.max(-120, Math.min(0, raw)),
    armPx: 80,
    flick: { px: 40, velocityPxMs: 0.8 },
    commitTransform: "translateX(-110%)",
    suppressClick: true,
  });
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
      desc="Tell your assistant what’s on your shelves — “add flour, olive oil, and eggs to my pantry” — and they’ll show up here, grouped by aisle."
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
      <div class="fill" in:fade={{ duration: motion(160) }}>
        <StatusScreen
          inline
          icon="🧺"
          title="Everything’s out of stock"
          desc="Restock things as you replace them — each heads back to its aisle."
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

    <!-- The drawer animates by CSS alone (a 0fr↔1fr grid collapse for presence, a max-height clip
         for open/close) — no Svelte transitions in this subtree, so no element's REMOVAL ever waits
         on an animation finishing (a frozen timeline would strand ghost rows; see the flight note).
         Both are plain CSS, auto-gated by WidgetShell's reduced-motion block. The body stays
         mounted while closed (inert, so it leaves the tab order and the accessibility tree), which
         also lets an Undo restock's flight rise visibly out of the closed drawer's seam. -->
    <div
      class="drawer-shell"
      class:present={outOfStock.length > 0}
      inert={outOfStock.length === 0}
    >
      <div class="drawer">
        <div class="drawer-head-row">
          <button
            class="drawer-head"
            bind:this={drawerHeadEl}
            onclick={() => {
              drawerOpen = !drawerOpen;
              if (!drawerOpen) confirmingClear = false;
            }}
            aria-expanded={drawerOpen}
            aria-controls="oos-drawer"
          >
            <Chevron size={13} color="var(--muted)" open={drawerOpen} />
            <span>Out of stock</span>
            <!-- Keyed on the count so each change remounts the span and replays the bump — the
                 closed drawer's acknowledgment that it received (or surrendered) a row. -->
            {#key outOfStock.length}
              <span class="dcount">{outOfStock.length}</span>
            {/key}
          </button>
          <!-- Clear all lives behind the open drawer only: a destructive sweep is offered
               while the rows it removes are visible, never against a collapsed drawer. -->
          {#if drawerOpen}
            {#if confirmingClear}
              <span class="clear-confirm">Remove {outOfStock.length}?</span>
              <PillButton variant="danger-strong" onclick={confirmClear}
                >Clear</PillButton
              >
              <PillButton onclick={cancelClear}>Keep</PillButton>
            {:else}
              <PillButton
                variant="danger"
                onclick={elicitation ? confirmClear : onClear}
                >Clear all</PillButton
              >
            {/if}
          {/if}
        </div>
        <div
          class="drawer-body"
          id="oos-drawer"
          class:open={drawerOpen}
          inert={!drawerOpen}
        >
          <div class="drawer-scroll">
            {#each outOfStock as item (item.uid)}
              <div
                class="oos"
                class:busy={item._busy}
                class:flying={flying.has(item.uid)}
                use:reg={{ map: oosEls, uid: item.uid }}
              >
                <span class="oname">{item.ingredient}</span>
                <PillButton
                  variant="accent"
                  onclick={() => onRestock(item)}
                  ariaLabel="Restock {item.ingredient}">Restock</PillButton
                >
              </div>
            {/each}
          </div>
        </div>
      </div>
    </div>
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
      class:landed={item.uid === restockedUid}
      class:flying={flying.has(item.uid)}
      animate:flip={{ duration: motion(220), easing: quintOut }}
      transition:slide={{ duration: motion(200), easing: quartOut }}
    >
      {#if touchDevice}
        <!-- Revealed behind the row as it swipes left (iOS-Mail style). -->
        <div
          class="swipe-action"
          class:armed={armedUid === item.uid}
          aria-hidden="true"
        >
          <span class="swipe-label">Out of Stock</span>
        </div>
      {/if}
      <div
        class="item"
        class:busy={item._busy}
        class:err={item._error}
        class:touch={touchDevice}
        class:dragging={draggingUid === item.uid}
        use:reg={{ map: listEls, uid: item.uid }}
        use:swipe={{
          // A busy row can't start a swipe: onOut would refuse it after the sweep, stranding the row
          // off-screen.
          enabled: touchDevice && !item._busy,
          commit: () => onOut(item),
          drag: (on) => {
            draggingUid = on ? item.uid : null;
          },
          arm: (on) => {
            armedUid = on ? item.uid : null;
          },
        }}
      >
        <ItemRow ingredient={item.ingredient} quantity={item.quantity}>
          {#snippet extra()}
            {#if es}<span class="badge {es}"
                >{expLabel(item.expirationDate)}</span
              >{/if}
          {/snippet}
        </ItemRow>
        {#if touchDevice}
          <!-- The swipe has no assistive-tech analogue, so every touch row keeps a real
               button — visually clipped away but present in the accessibility tree and tab order,
               revealed as a pill on hardware-keyboard focus. The only non-gesture path to mark-out
               on a touch-only host; do not prune as unused. -->
          <button class="sr-action" onclick={() => onOut(item, { fly: true })}
            >Mark {item.ingredient} out of stock</button
          >
        {/if}
        {#if !touchDevice}
          <!-- Revealed on row hover / keyboard focus where hover exists (the wall of identical
               danger pills outweighed the data); always visible on hoverless pointer hosts. -->
          <span class="rowact">
            <PillButton
              variant="danger"
              onclick={() => onOut(item, { fly: true })}
              ariaLabel="Mark {item.ingredient} out of stock"
              >Out of Stock</PillButton
            >
          </span>
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
    /* A row is a fixed, known shape — the one property worth a render-skip hint: on a very long
       pantry an off-screen row's layout/paint is skipped until it nears the viewport, while
       contain-intrinsic-size keeps the scrollbar's math steady (an estimate the browser corrects
       once the row is measured, not a cap). Mirrors the grocery checklist's row-wrap. */
    content-visibility: auto;
    contain-intrinsic-size: auto 44px;
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
    background: var(--danger);
    color: var(--danger-ink);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  /* The label pops as the drag crosses the commit threshold — "release does it now". CSS-driven,
     so WidgetShell's reduced-motion block collapses the pop to an instant state change. */
  .swipe-label {
    display: inline-block;
    opacity: 0.85;
    transition:
      transform 0.12s cubic-bezier(0.25, 1, 0.5, 1),
      opacity 0.12s;
  }
  .swipe-action.armed .swipe-label {
    transform: scale(1.08);
    opacity: 1;
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
    transition: box-shadow 0.15s;
  }
  .item.busy {
    opacity: 0.5;
  }
  /* The flight's handoff: while this row's clone is airborne toward it, the real row holds its
     slot invisibly and appears under the clone's end-fade — one item on screen, never two. */
  .item-wrap.flying .item,
  .oos.flying {
    opacity: 0;
  }
  /* On touch, a long-press mid-gesture must not start selecting the ingredient text. */
  .item.touch {
    -webkit-user-select: none;
    user-select: none;
  }
  /* A failed mark-out returns the row to its aisle under a brief danger wash, so the failure names
     its row and not just the toast. Same vocabulary as the grocery checklist's errFlash. */
  .item.err {
    animation: errFlash 1.1s ease-out;
  }
  @keyframes errFlash {
    0%,
    100% {
      background: var(--bg);
    }
    18% {
      background: var(--danger-bg);
    }
  }
  /* The touch rows' real-but-clipped mark-out button — the assistive-tech path where the
     visible button is replaced by the swipe. Hardware-keyboard focus reveals it as a danger pill
     over the row's trailing edge. */
  .sr-action {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .sr-action:focus-visible {
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    width: auto;
    height: auto;
    clip-path: none;
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--bg);
    border: 1px solid color-mix(in oklch, var(--danger) 50%, transparent);
    color: var(--danger);
    font-size: 12px;
    font-weight: 600;
  }
  /* Mid-drag the row genuinely floats above the reveal, so it earns the one shadow: a soft cast off
     its trailing edge onto the uncovered action. will-change only while dragging, never at rest. */
  .item.dragging {
    will-change: transform;
    box-shadow: 12px 0 16px -10px oklch(0 0 0 / 0.22);
  }
  /* The just-restocked row lands under a brief fresh-green wash — the system's done/fresh signal
     answering "where did it go?" after the flight up. CSS animation, zeroed under reduced motion. */
  .item-wrap.landed .item {
    animation: landed 0.9s cubic-bezier(0.25, 1, 0.5, 1);
  }
  @keyframes landed {
    from {
      background-color: color-mix(in oklch, var(--success) 16%, var(--bg));
    }
  }

  /* The Out of Stock pill's home. On hover-capable pointers it rests hidden and surfaces on row
     hover or keyboard focus — the list reads as a calm inventory, the action stays one intent away.
     Hoverless hosts keep it always visible; the expiry badge stays the row's only resting color. */
  .rowact {
    flex: none;
  }
  @media (hover: hover) {
    .rowact {
      opacity: 0;
      transition: opacity 0.13s;
    }
    .item:hover .rowact,
    .item:focus-within .rowact {
      opacity: 1;
    }
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

  /* Presence collapse: the shell grows from 0fr when the first item goes out of stock and folds
     away when the drawer empties. Pure CSS (grid-template-rows), so reduced motion zeroes it. */
  .drawer-shell {
    flex: none;
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.22s cubic-bezier(0.25, 1, 0.5, 1);
  }
  .drawer-shell.present {
    grid-template-rows: 1fr;
  }
  .drawer {
    /* One cap shared by the open clip and the inner scroll — they must stay equal (a larger
       scroll cap strands clipped rows; a larger clip cap makes the open transition overshoot). */
    --drawer-cap: 38vh;
    min-height: 0;
    overflow: hidden;
    background: var(--bg);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .drawer-shell.present .drawer {
    border-top: 1px solid var(--line);
  }
  .drawer-head-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-right: 16px;
  }
  .drawer-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    color: var(--muted);
    font-size: 12.5px;
    font-weight: 600;
    padding: 12px 0 12px 16px;
    text-align: left;
  }
  /* A real thumb target for the drawer toggle on touch, like the shared pill's coarse bump. */
  @media (pointer: coarse) {
    .drawer-head {
      min-height: 44px;
    }
  }
  /* The out-of-stock count, in the aisle headers' trailing-count voice (.acount). Each change
     remounts it ({#key}) and replays the bump — the drawer acknowledging a received row. */
  .dcount {
    display: inline-block;
    font-size: 11px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
    animation: bump 0.24s cubic-bezier(0.25, 1, 0.5, 1);
  }
  @keyframes bump {
    from {
      transform: scale(1.35);
    }
  }
  .clear-confirm {
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }
  /* Open/close collapse: a plain max-height clip. Not the shell's 0fr↔1fr trick one level in —
     the open track's size would depend on a grandchild's capped scroll box (a scroll container's
     automatic track contribution collapses once content exceeds its cap, so a long list "opens" to
     nothing). The bounded 38vh cap keeps the boring max-height route honest; the scroll itself
     lives one level in so the clip box's height is simple. */
  .drawer-body {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.26s cubic-bezier(0.25, 1, 0.5, 1);
  }
  .drawer-body.open {
    max-height: var(--drawer-cap);
  }
  /* The recessed tray: depth by warm tonal shift (the system's hover wash), not shadows — and the
     wash replaces per-row hairlines, matching the one-separator-per-category rule of the main list. */
  .drawer-scroll {
    max-height: var(--drawer-cap);
    overflow-y: auto;
    background: var(--hover);
    border-top: 1px solid var(--line);
  }
  .oos {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 16px;
  }
  .oos.busy {
    opacity: 0.5;
  }
  .oname {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    /* muted, not faint: these rows are restock targets on the recessed wash, so the name stays
       AA-legible there; the strikethrough carries the "out" state. */
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-color: color-mix(in oklch, var(--muted) 55%, transparent);
  }
</style>
