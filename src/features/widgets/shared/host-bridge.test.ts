import type { App } from "@modelcontextprotocol/ext-apps";
/**
 * Unit tests for the three host-bridge helpers: `connectHost`, `callTool`, `errorText`.
 *
 * These tests are in the widget browser tier (`src/features/widgets/shared/`) — excluded from the
 * node-side tsconfigs (same as the source files here) and typechecked by `tsconfig.widgets.json`.
 * `document` is stubbed via `vi.stubGlobal` so the Node vitest environment can exercise
 * `applyHostStyles` (the one browser-DOM call that `connectHost` triggers via `host-style.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks, useExtApp } from "../../../../test/support/widget-ext-app.js";
import { blobDataUri, callTool, connectHost, errorText, readResource, reportWidgetTiming } from "./host-bridge.js";
import { TRACEPARENT_KEY } from "./server-caps-key.js";

// host-style.ts calls document.documentElement.style.setProperty; stub the minimum needed.
const setProperty = vi.fn();
beforeEach(() => {
  vi.stubGlobal("document", { documentElement: { style: { setProperty } } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// connectHost
// ---------------------------------------------------------------------------
describe("connectHost", () => {
  it("sets ontoolresult and onhostcontextchanged BEFORE calling connect", () => {
    const { app } = useExtApp();
    let handlersSetBeforeConnect = false;
    app.connect.mockImplementationOnce(() => {
      handlersSetBeforeConnect =
        typeof app.ontoolresult === "function" && typeof app.onhostcontextchanged === "function";
      return Promise.resolve();
    });

    connectHost(app as unknown as App, { onResult: vi.fn() });

    expect(handlersSetBeforeConnect).toBe(true);
  });

  it("calls connect()", () => {
    const { app } = useExtApp();
    connectHost(app as unknown as App, { onResult: vi.fn() });
    expect(app.connect).toHaveBeenCalledOnce();
  });

  it("calls onContext with getHostContext() result after connect resolves", async () => {
    const ctx = { theme: "dark" as const, userAgent: "claude" };
    const { app } = useExtApp(ctx);
    const onContext = vi.fn();

    connectHost(app as unknown as App, { onResult: vi.fn(), onContext });

    await flushMicrotasks();

    expect(onContext).toHaveBeenCalledWith(ctx);
  });

  it("calls applyHostStyles (sets --widget-font) after connect resolves", async () => {
    const { app } = useExtApp({ theme: "light", userAgent: "claude" });

    connectHost(app as unknown as App, { onResult: vi.fn() });
    await flushMicrotasks();

    expect(setProperty).toHaveBeenCalledWith("--widget-font", expect.stringContaining("serif"));
  });

  it("delivers tool results to onResult via the ontoolresult handler", async () => {
    const { app, fireToolResult } = useExtApp();
    const onResult = vi.fn();
    const payload = { structuredContent: { uid: "abc", items: [] } };

    connectHost(app as unknown as App, { onResult });
    await flushMicrotasks();
    fireToolResult(payload);

    expect(onResult).toHaveBeenCalledWith(payload);
  });

  it("re-runs onContext and applyHostStyles when onhostcontextchanged fires", async () => {
    const { app, fireHostContextChanged } = useExtApp({ theme: "light" });
    const onContext = vi.fn();

    connectHost(app as unknown as App, { onResult: vi.fn(), onContext });
    await flushMicrotasks();

    const updatedCtx = { theme: "dark" as const, userAgent: "somehost" };
    fireHostContextChanged(updatedCtx);

    expect(onContext).toHaveBeenLastCalledWith(updatedCtx);
    // applyHostStyles ran twice (connect + context change); count its --widget-font writes rather
    // than total setProperty calls, since each run also sets --widget-max-h.
    expect(setProperty.mock.calls.filter(([k]) => k === "--widget-font")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// reportWidgetTiming
// ---------------------------------------------------------------------------
describe("reportWidgetTiming", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when no traceparent was injected", async () => {
    const { app } = useExtApp();
    reportWidgetTiming(app as unknown as App);
    await vi.runAllTimersAsync();
    expect(app.callServerTool).not.toHaveBeenCalled();
  });

  it("reports only the paprika-widget measures to record_widget_timing, deferred", async () => {
    const { app } = useExtApp();
    app.callServerTool.mockResolvedValue({});
    vi.stubGlobal(TRACEPARENT_KEY, "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");
    vi.stubGlobal("performance", {
      timeOrigin: 1_700_000_000_000,
      getEntriesByType: (type: string) =>
        type === "measure"
          ? [
              { name: "paprika-widget:boot-to-mounted", startTime: 5, duration: 42 },
              { name: "other:thing", startTime: 0, duration: 1 },
            ]
          : [],
    });

    reportWidgetTiming(app as unknown as App);
    // Deferred: nothing sent synchronously.
    expect(app.callServerTool).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: "record_widget_timing",
      arguments: {
        traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        timeOrigin: 1_700_000_000_000,
        clientReportTime: expect.any(Number),
        // The non-widget measure is filtered out.
        measures: [{ name: "paprika-widget:boot-to-mounted", startTime: 5, duration: 42 }],
      },
    });
  });

  it("does not report when there are no widget measures", async () => {
    const { app } = useExtApp();
    vi.stubGlobal(TRACEPARENT_KEY, "00-aaa-bbb-01");
    vi.stubGlobal("performance", { timeOrigin: 1, getEntriesByType: () => [] });

    reportWidgetTiming(app as unknown as App);
    await vi.runAllTimersAsync();

    expect(app.callServerTool).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// callTool
// ---------------------------------------------------------------------------
describe("callTool", () => {
  it("returns isError:false and structuredContent on a successful call", async () => {
    const { app } = useExtApp();
    app.callServerTool.mockResolvedValueOnce({
      isError: false,
      structuredContent: { uid: "x", items: [] },
    });

    const result = await callTool(app as unknown as App, "read_grocery_list", { lookup: { uid: "x" } });

    expect(result).toEqual({ isError: false, structuredContent: { uid: "x", items: [] } });
  });

  it("returns isError:true and undefined structuredContent when the server reports an error", async () => {
    const { app } = useExtApp();
    app.callServerTool.mockResolvedValueOnce({ isError: true, structuredContent: undefined });

    const result = await callTool(app as unknown as App, "mark_grocery_item_purchased", { uid: "x" });

    expect(result).toEqual({ isError: true, structuredContent: undefined });
  });

  it("returns isError:true when callServerTool rejects (transport failure)", async () => {
    const { app } = useExtApp();
    app.callServerTool.mockRejectedValueOnce(new Error("network error"));

    const result = await callTool(app as unknown as App, "read_grocery_list", {});

    expect(result).toEqual({ isError: true, structuredContent: undefined });
  });
});

// ---------------------------------------------------------------------------
// errorText
// ---------------------------------------------------------------------------
describe("errorText", () => {
  it("returns the text of the first text content block", () => {
    expect(errorText({ content: [{ type: "text", text: "Item not found." }] })).toBe("Item not found.");
  });

  it("returns null when there is no text block", () => {
    expect(errorText({ content: [{ type: "image" }] })).toBeNull();
  });

  it("returns null when the text block is blank", () => {
    expect(errorText({ content: [{ type: "text", text: "   " }] })).toBeNull();
  });

  it("returns null for null or undefined result", () => {
    expect(errorText(null)).toBeNull();
    expect(errorText(undefined)).toBeNull();
  });

  it("returns null when content array is missing", () => {
    expect(errorText({ structuredContent: {} })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readResource
// ---------------------------------------------------------------------------
describe("readResource", () => {
  it("returns the first content block, content-type-agnostic", async () => {
    const { app } = useExtApp();
    const block = { uri: "ui://recipe/r1/photo", mimeType: "image/jpeg", blob: "QUJD" };
    app.readServerResource.mockResolvedValueOnce({ contents: [block, { uri: "x", text: "second" }] });

    const result = await readResource(app as unknown as App, "ui://recipe/r1/photo");

    expect(app.readServerResource).toHaveBeenCalledWith({ uri: "ui://recipe/r1/photo" });
    expect(result).toEqual(block);
  });

  it("returns a text content block unchanged (no image assumption)", async () => {
    const { app } = useExtApp();
    app.readServerResource.mockResolvedValueOnce({ contents: [{ uri: "u", text: "hi" }] });
    expect(await readResource(app as unknown as App, "u")).toEqual({ uri: "u", text: "hi" });
  });

  it("returns null when there are no contents", async () => {
    const { app } = useExtApp();
    app.readServerResource.mockResolvedValueOnce({ contents: [] });
    expect(await readResource(app as unknown as App, "u")).toBeNull();
  });

  it("returns null when the read rejects", async () => {
    const { app } = useExtApp();
    app.readServerResource.mockRejectedValueOnce(new Error("not found"));
    expect(await readResource(app as unknown as App, "u")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// blobDataUri
// ---------------------------------------------------------------------------
describe("blobDataUri", () => {
  it("builds a data: URI from the blob using the content's own mimeType", () => {
    expect(blobDataUri({ uri: "u", mimeType: "image/png", blob: "QUJD" }, "image/jpeg")).toBe(
      "data:image/png;base64,QUJD",
    );
  });

  it("uses the fallback mimeType when the server didn't set one", () => {
    expect(blobDataUri({ uri: "u", blob: "QUJD" }, "image/jpeg")).toBe("data:image/jpeg;base64,QUJD");
  });

  it("is content-type-agnostic (any media family, fallback chosen by the caller)", () => {
    expect(blobDataUri({ uri: "u", mimeType: "audio/mpeg", blob: "QUJD" }, "audio/mpeg")).toBe(
      "data:audio/mpeg;base64,QUJD",
    );
  });

  it("returns null for a text (non-blob) content, for null, and for an empty blob", () => {
    expect(blobDataUri({ uri: "u", text: "hi" }, "image/jpeg")).toBeNull();
    expect(blobDataUri(null, "image/jpeg")).toBeNull();
    expect(blobDataUri({ uri: "u", blob: "" }, "image/jpeg")).toBeNull();
  });
});
