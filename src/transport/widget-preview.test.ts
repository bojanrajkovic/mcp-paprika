import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTempDir } from "../../test/support/disk-caches.js";
import { SERVER_CAPS_KEY } from "../features/widgets/shared/server-caps-key.js";
import { SILENT_LOG } from "../utils/log.js";
import { buildWidgetPreviewRouter, SHIMMED_EXTAPPS_HELPERS, SHIMMED_HOST_METHODS } from "./widget-preview.js";

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /></head>
  <body>
    <!-- __widget-inject__ -->
    <div id="app"></div>
    <!-- __widget-vendor__ -->
    <script type="module">import { App } from "@modelcontextprotocol/ext-apps"; new App();</script>
  </body>
</html>
`;

/** Decode the shim ES module from the served import map's `data:text/javascript;base64,…` target. */
function decodeShim(body: string): string {
  const b64 = body.match(/"@modelcontextprotocol\/ext-apps":"data:text\/javascript;base64,([^"]+)"/)?.[1];
  return b64 !== undefined ? Buffer.from(b64, "base64").toString("utf8") : "";
}

// The shape a shim tool result satisfies (a subset of ext-apps' real result type — this test never
// imports ext-apps as a value, only this local structural interface).
interface ShimToolResult {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly structuredContent?: Record<string, unknown>;
}
interface PreviewApp {
  ontoolresult?: (result: ShimToolResult) => void;
  connect(): Promise<void>;
  callServerTool(req: { readonly name: string; readonly arguments?: Record<string, unknown> }): Promise<ShimToolResult>;
}

describe("widget-preview route", () => {
  const tmp = useTempDir("mcp-paprika-widget-preview-");

  beforeEach(async () => {
    await tmp.setup();
    await writeFile(join(tmp.dir(), "demo.html"), FIXTURE_HTML, "utf8");
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await tmp.teardown();
  });

  it("resolves the widget's ext-apps import to the host shim module via an import map", async () => {
    const router = buildWidgetPreviewRouter(SILENT_LOG, { dir: tmp.dir() });
    const res = await router.request("/widget-preview?widget=demo");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();

    // An import map resolves the bare ext-apps specifier, and it must precede the module that imports
    // it (an import map is only honored ahead of the first module import).
    expect(body).toContain('<script type="importmap">');
    expect(body.indexOf('type="importmap"')).toBeLessThan(body.indexOf('type="module"'));

    // The shim module (carried as the import map's data: URL) implements every pinned host method and
    // top-level style helper, so it can't silently drop one the widgets rely on.
    const shim = decodeShim(body);
    expect(shim).not.toBe("");
    for (const method of SHIMMED_HOST_METHODS) {
      expect(shim).toContain(method);
    }
    // The two helpers host-style.ts actually calls are pinned unconditionally so dropping one from
    // SHIMMED_EXTAPPS_HELPERS doesn't silently remove the assertion; the rest ride the shared list.
    expect(shim).toContain("applyHostStyleVariables");
    expect(shim).toContain("applyHostFonts");
    for (const helper of SHIMMED_EXTAPPS_HELPERS) {
      expect(shim).toContain(helper);
    }

    // The App constructor sets window[SERVER_CAPS_KEY] from ?elicitation= so the grocery checklist's
    // elicitation-aware confirm can be exercised in the preview.
    expect(shim).toContain(SERVER_CAPS_KEY);
    expect(shim).toContain("supportsElicitation");
  });

  it("never reflects ?payload= into the served HTML (the shim reads it client-side)", async () => {
    const router = buildWidgetPreviewRouter(SILENT_LOG, { dir: tmp.dir() });
    const res = await router.request(
      `/widget-preview?widget=demo&payload=${encodeURIComponent("<script>alert(1)</script>")}`,
    );

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("alert(1)");
  });

  it("rejects an oversized payload (413) before serving", async () => {
    const router = buildWidgetPreviewRouter(SILENT_LOG, { dir: tmp.dir() });
    const huge = "x".repeat(64 * 1024 + 1);
    const res = await router.request(`/widget-preview?widget=demo&payload=${huge}`);
    expect(res.status).toBe(413);
  });

  it("answers 404 for an unknown widget and 400 when none is named", async () => {
    const router = buildWidgetPreviewRouter(SILENT_LOG, { dir: tmp.dir() });

    expect((await router.request("/widget-preview?widget=missing")).status).toBe(404);
    expect((await router.request("/widget-preview")).status).toBe(400);
  });

  // Serve the fixture, decode the import map's data: URL, import it as a real ES module.
  // `/* @vite-ignore */` is REQUIRED: it stops Vite from trying to transform/resolve the dynamic
  // specifier, so Node's native ESM loader handles the data: URL.
  async function loadShim(dir: string): Promise<{ App: new () => PreviewApp }> {
    const router = buildWidgetPreviewRouter(SILENT_LOG, { dir });
    const body = await (await router.request("/widget-preview?widget=demo")).text();
    const b64 = Buffer.from(decodeShim(body)).toString("base64");
    return import(/* @vite-ignore */ `data:text/javascript;base64,${b64}`);
  }

  // Per-test App factory: the constructor reads location + writes window[SERVER_CAPS_KEY], so stub
  // BOTH before constructing; the constructor also parses the payload straight into the mini-store, so
  // callServerTool works with no connect() call first.
  function makeApp(
    mod: { App: new () => PreviewApp },
    payload: unknown,
    opts: { viaQuery?: boolean; elicitation?: boolean } = {},
  ): PreviewApp {
    const encoded = encodeURIComponent(JSON.stringify(payload));
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("location", {
      search: `?widget=x${opts.elicitation ? "&elicitation=1" : ""}${opts.viaQuery ? `&payload=${encoded}` : ""}`,
      hash: opts.viaQuery ? "" : `#payload=${encoded}`,
    });
    return new mod.App();
  }

  // Pull the `items` rows off a result's structured content, or [] when absent — avoids an unsafe
  // optional-chain-then-index on every call site that just wants the uid list.
  function rowsOf(result: ShimToolResult): { readonly uid: string }[] {
    const items = result.structuredContent?.["items"];
    return Array.isArray(items) ? (items as { readonly uid: string }[]) : [];
  }

  it("reads the payload from the fragment, preferring it over the query, with query-only as a fallback", async () => {
    const mod = await loadShim(tmp.dir());
    const payload = { uid: "g-list", name: "Test", items: [] };
    const encoded = encodeURIComponent(JSON.stringify(payload));

    // Fragment wins when both are present.
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("location", { search: "?widget=x&payload=stale", hash: `#payload=${encoded}` });
    const fromFragment = new mod.App();
    const fragmentResults: ShimToolResult[] = [];
    fromFragment.ontoolresult = (r) => fragmentResults.push(r);
    await fromFragment.connect();
    expect(fragmentResults).toEqual([
      { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload },
    ]);

    // Query-only still works (the hand-typed fallback).
    const fromQuery = makeApp(mod, payload, { viaQuery: true });
    const queryResults: ShimToolResult[] = [];
    fromQuery.ontoolresult = (r) => queryResults.push(r);
    await fromQuery.connect();
    expect(queryResults).toEqual([
      { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload },
    ]);
  });

  it("re-dates read_meal_plan's meals into the requested window, falling back to the payload's own week", async () => {
    const mod = await loadShim(tmp.dir());
    const payload = {
      weekStart: "2026-06-29",
      meals: [
        {
          uid: "w1",
          date: "2026-06-29",
          name: "Pancakes",
          recipeUid: null,
          typeUid: "mt1",
          typeName: "Breakfast",
          scale: null,
        },
        {
          uid: "w2",
          date: "2026-07-01",
          name: "Roast Chicken",
          recipeUid: "r2",
          typeUid: "mt2",
          typeName: "Dinner",
          scale: null,
        },
      ],
      mealTypes: [{ uid: "mt1", name: "Breakfast" }],
    };
    const app = makeApp(mod, payload);

    const shifted = await app.callServerTool({
      name: "read_meal_plan",
      arguments: { startDate: "2026-07-06", days: 7 },
    });
    expect(shifted.structuredContent).toMatchObject({
      weekStart: "2026-07-06",
      meals: [
        { uid: "w1", date: "2026-07-06" },
        { uid: "w2", date: "2026-07-08" },
      ],
    });

    const noStart = await app.callServerTool({ name: "read_meal_plan", arguments: {} });
    expect(noStart.structuredContent).toMatchObject({
      weekStart: "2026-06-29",
      meals: [
        { uid: "w1", date: "2026-06-29" },
        { uid: "w2", date: "2026-07-01" },
      ],
    });
  });

  it("echoes add_grocery_items rows with fresh uids and normalized defaults, visible on the next read", async () => {
    const mod = await loadShim(tmp.dir());
    const payload = { uid: "g-list", name: "Test", items: [] };
    const app = makeApp(mod, payload);

    const add = await app.callServerTool({
      name: "add_grocery_items",
      arguments: { listUid: "g-list", items: [{ ingredient: "Lemons", aisle: "" }] },
    });
    expect(add.structuredContent).toMatchObject({
      listUid: "g-list",
      skipped: [],
      items: [{ ingredient: "Lemons", quantity: null, aisle: null, purchased: false }],
    });
    const addedUid = rowsOf(add)[0]?.uid;
    expect(addedUid).toMatch(/^preview-add-\d+$/);

    const read = await app.callServerTool({ name: "read_grocery_list", arguments: { lookup: { uid: "g-list" } } });
    expect(rowsOf(read).map((i) => i.uid)).toContain(addedUid);
  });

  it("clears an item marked purchased earlier in the same session, not just the initially-purchased ones", async () => {
    const mod = await loadShim(tmp.dir());
    const payload = {
      uid: "g-list",
      name: "Test",
      items: [
        { uid: "i1", ingredient: "Eggs", quantity: null, aisle: null, purchased: false },
        { uid: "i2", ingredient: "Milk", quantity: null, aisle: null, purchased: true },
        { uid: "i3", ingredient: "Bread", quantity: null, aisle: null, purchased: false },
      ],
    };
    const app = makeApp(mod, payload);

    await app.callServerTool({ name: "mark_grocery_item_purchased", arguments: { uid: "i1" } });
    await app.callServerTool({ name: "clear_purchased_grocery_items", arguments: { listUid: "g-list" } });
    const read = await app.callServerTool({ name: "read_grocery_list", arguments: { lookup: { uid: "g-list" } } });
    expect(rowsOf(read).map((i) => i.uid)).toEqual(["i3"]);
  });

  it("declines clear_purchased_grocery_items on confirm() cancel, leaving items unchanged", async () => {
    const mod = await loadShim(tmp.dir());
    const payload = {
      uid: "g-list",
      name: "Test",
      items: [{ uid: "i1", ingredient: "Eggs", quantity: null, aisle: null, purchased: true }],
    };
    const app = makeApp(mod, payload, { elicitation: true });
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);

    const clear = await app.callServerTool({ name: "clear_purchased_grocery_items", arguments: { listUid: "g-list" } });
    expect(clear).toEqual({ content: [] });

    const read = await app.callServerTool({ name: "read_grocery_list", arguments: { lookup: { uid: "g-list" } } });
    expect(read.structuredContent?.["items"]).toEqual(payload.items);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it("clears on confirm() accept, and proceeds without calling confirm when elicitation isn't flagged", async () => {
    const mod = await loadShim(tmp.dir());
    const payload = {
      uid: "g-list",
      name: "Test",
      items: [{ uid: "i1", ingredient: "Eggs", quantity: null, aisle: null, purchased: true }],
    };

    const acceptApp = makeApp(mod, payload, { elicitation: true });
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    await acceptApp.callServerTool({ name: "clear_purchased_grocery_items", arguments: { listUid: "g-list" } });
    const acceptRead = await acceptApp.callServerTool({
      name: "read_grocery_list",
      arguments: { lookup: { uid: "g-list" } },
    });
    expect(acceptRead.structuredContent?.["items"]).toEqual([]);
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals(); // simulate a host with no confirm() global at all
    const noFlagApp = makeApp(mod, payload);
    await noFlagApp.callServerTool({ name: "clear_purchased_grocery_items", arguments: { listUid: "g-list" } });
    const noFlagRead = await noFlagApp.callServerTool({
      name: "read_grocery_list",
      arguments: { lookup: { uid: "g-list" } },
    });
    expect(noFlagRead.structuredContent?.["items"]).toEqual([]);
  });

  it("flips pantry inStock and clears only items with inStock !== false", async () => {
    const mod = await loadShim(tmp.dir());
    const payload = {
      items: [
        { uid: "p1", ingredient: "Flour", quantity: null, aisle: null, inStock: true, expirationDate: null },
        { uid: "p2", ingredient: "Butter", quantity: null, aisle: null, inStock: false, expirationDate: null },
      ],
    };
    const app = makeApp(mod, payload);

    await app.callServerTool({ name: "mark_pantry_item_out_of_stock", arguments: { uid: "p1" } });
    await app.callServerTool({ name: "restock_pantry_item", arguments: { uid: "p2" } });
    const afterFlip = await app.callServerTool({ name: "list_pantry_items", arguments: {} });
    expect(afterFlip.structuredContent).toMatchObject({
      items: [
        { uid: "p1", inStock: false },
        { uid: "p2", inStock: true },
      ],
    });

    await app.callServerTool({ name: "clear_out_of_stock_pantry_items", arguments: {} });
    const afterClear = await app.callServerTool({ name: "list_pantry_items", arguments: {} });
    expect(rowsOf(afterClear).map((i) => i.uid)).toEqual(["p2"]);
  });

  it("resolves read_recipe from all three payload shapes, with canned defaults for an unmatched uid", async () => {
    const mod = await loadShim(tmp.dir());

    const browse = makeApp(mod, {
      items: [{ uid: "r1", name: "Eggs Benedict", servings: "2", totalTime: "30 min", photoResourceUri: "ui://photo" }],
    });
    const browseHit = await browse.callServerTool({ name: "read_recipe", arguments: { lookup: { uid: "r1" } } });
    expect(browseHit.structuredContent).toMatchObject({
      uid: "r1",
      name: "Eggs Benedict",
      servings: "2",
      totalTime: "30 min",
      photoResourceUri: "ui://photo",
    });

    const menu = makeApp(mod, {
      items: [
        {
          uid: "m1",
          name: "Eggs Benedict (menu label)",
          recipeUid: "r1",
          recipe: { servings: "2", totalTime: "30 min", photoResourceUri: "ui://photo" },
        },
      ],
    });
    const menuHit = await menu.callServerTool({ name: "read_recipe", arguments: { lookup: { uid: "r1" } } });
    expect(menuHit.structuredContent).toMatchObject({
      uid: "r1",
      name: "Eggs Benedict (menu label)",
      servings: "2",
      totalTime: "30 min",
      photoResourceUri: "ui://photo",
    });

    const week = makeApp(mod, {
      weekStart: "2026-06-29",
      meals: [
        {
          uid: "w1",
          date: "2026-06-29",
          name: "Roast Chicken",
          recipeUid: "r2",
          typeUid: "mt1",
          typeName: "Dinner",
          scale: null,
        },
      ],
      mealTypes: [],
    });
    const weekHit = await week.callServerTool({ name: "read_recipe", arguments: { lookup: { uid: "r2" } } });
    expect(weekHit.structuredContent).toMatchObject({ uid: "r2", name: "Roast Chicken", servings: "", totalTime: "" });

    const missing = await browse.callServerTool({ name: "read_recipe", arguments: { lookup: { uid: "nope" } } });
    expect(missing.structuredContent).toMatchObject({
      uid: "nope",
      name: "Sample Recipe",
      servings: "",
      totalTime: "",
    });
  });

  it("no-ops an unknown tool, and a payload-less App answers every tool without throwing", async () => {
    const mod = await loadShim(tmp.dir());
    const app = makeApp(mod, { uid: "g-list", name: "Test", items: [] });
    const unknown = await app.callServerTool({ name: "record_widget_timing", arguments: {} });
    expect(unknown).toEqual({ content: [] });

    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("location", { search: "?widget=x", hash: "" });
    const empty = new mod.App();
    const names = [
      "read_grocery_list",
      "list_pantry_items",
      "read_meal_plan",
      "read_recipe",
      "mark_grocery_item_purchased",
      "add_grocery_items",
      "delete_grocery_item",
      "clear_purchased_grocery_items",
      "move_grocery_items_to_pantry",
      "mark_pantry_item_out_of_stock",
      "restock_pantry_item",
      "clear_out_of_stock_pantry_items",
      "record_widget_timing",
      "unknown_tool",
    ];
    for (const name of names) {
      await expect(empty.callServerTool({ name, arguments: {} })).resolves.toBeDefined();
    }
  });
});
