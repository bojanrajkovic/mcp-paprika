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
import { callTool, connectHost, errorText } from "./host-bridge.js";

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
    expect(setProperty).toHaveBeenCalledTimes(2);
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
