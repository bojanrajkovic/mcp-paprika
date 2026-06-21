import type { applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
/**
 * Unit tests for `applyHostStyles` — the font-selection and host-style-variable application
 * logic in `host-style.ts`.
 *
 * Browser tier: excluded from node-side tsconfigs, typechecked by `tsconfig.widgets.json`.
 * `document` is stubbed via `vi.stubGlobal` and `globalThis.ExtApps` is installed via `useExtApp`
 * so neither the DOM nor the real ext-apps runtime is needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useExtApp } from "../../../../test/support/widget-ext-app.js";
import { applyHostStyles } from "./host-style.js";

// Type aliases matching what host-style.ts infers from the ext-apps signatures.
type HostStyleVariables = Parameters<typeof applyHostStyleVariables>[0];
type HostFontCss = Parameters<typeof applyHostFonts>[0];

const setProperty = vi.fn();
beforeEach(() => {
  vi.stubGlobal("document", { documentElement: { style: { setProperty } } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("applyHostStyles — font selection", () => {
  it("sets a serif font stack for a claude userAgent", () => {
    useExtApp({ userAgent: "claude" });
    applyHostStyles({ userAgent: "claude" });
    expect(setProperty).toHaveBeenCalledWith("--widget-font", expect.stringContaining("serif"));
  });

  it("sets a serif font stack for an anthropic userAgent", () => {
    useExtApp({ userAgent: "Anthropic Desktop" });
    applyHostStyles({ userAgent: "Anthropic Desktop" });
    expect(setProperty).toHaveBeenCalledWith("--widget-font", expect.stringContaining("serif"));
  });

  it("sets the sans stack for a non-serif host", () => {
    useExtApp({ userAgent: "cursor" });
    applyHostStyles({ userAgent: "cursor" });
    const call = setProperty.mock.calls.find(([k]) => k === "--widget-font");
    expect(call?.[1]).toContain("--font-sans");
  });

  it("sets the sans stack when userAgent is absent", () => {
    useExtApp();
    applyHostStyles({});
    const call = setProperty.mock.calls.find(([k]) => k === "--widget-font");
    expect(call?.[1]).toContain("--font-sans");
  });

  it("sets the sans stack for a null context", () => {
    useExtApp();
    applyHostStyles(null);
    const call = setProperty.mock.calls.find(([k]) => k === "--widget-font");
    expect(call?.[1]).toContain("--font-sans");
  });
});

describe("applyHostStyles — style variable delegation", () => {
  it("calls applyHostStyleVariables when variables are provided", () => {
    const { extApps } = useExtApp();
    const variables = { "--font-sans": "Inter, sans-serif" } as unknown as HostStyleVariables;
    applyHostStyles({ styles: { variables } });
    expect(extApps.applyHostStyleVariables).toHaveBeenCalledWith(variables);
  });

  it("skips applyHostStyleVariables when no variables are provided", () => {
    const { extApps } = useExtApp();
    applyHostStyles({ styles: {} });
    expect(extApps.applyHostStyleVariables).not.toHaveBeenCalled();
  });

  it("calls applyHostFonts when font css is provided", () => {
    const { extApps } = useExtApp();
    // A generic font CSS fragment — we test that it is forwarded verbatim, not its content.
    const fonts = "@font-face { src: url(host.woff2) format('woff2'); }" as unknown as HostFontCss;
    applyHostStyles({ styles: { css: { fonts } } });
    expect(extApps.applyHostFonts).toHaveBeenCalledWith(fonts);
  });

  it("skips applyHostFonts when no font css is provided", () => {
    const { extApps } = useExtApp();
    applyHostStyles({ styles: {} });
    expect(extApps.applyHostFonts).not.toHaveBeenCalled();
  });

  it("is a no-op for style helpers when ExtApps is absent", () => {
    useExtApp();
    vi.stubGlobal("ExtApps", undefined);
    const variables = { "--font-sans": "Inter" } as unknown as HostStyleVariables;
    expect(() => applyHostStyles({ styles: { variables } })).not.toThrow();
  });
});
