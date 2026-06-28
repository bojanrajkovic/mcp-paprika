/**
 * Unit tests for `applyHostStyles` — the font-selection and host-style-variable application
 * logic in `host-style.ts`.
 *
 * Browser tier: excluded from node-side tsconfigs, typechecked by `tsconfig.widgets.json`.
 * `document` is stubbed via `vi.stubGlobal`, and `@modelcontextprotocol/ext-apps` is mocked (the
 * helpers are now real value imports the import map resolves at runtime — ADR-0025), so neither the
 * DOM nor the real ext-apps runtime is needed.
 */
import { applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyHostStyles } from "./host-style.js";

vi.mock("@modelcontextprotocol/ext-apps", () => ({
  applyHostStyleVariables: vi.fn(),
  applyHostFonts: vi.fn(),
}));

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
    applyHostStyles({ userAgent: "claude" });
    expect(setProperty).toHaveBeenCalledWith("--widget-font", expect.stringContaining("serif"));
  });

  it("sets a serif font stack for an anthropic userAgent", () => {
    applyHostStyles({ userAgent: "Anthropic Desktop" });
    expect(setProperty).toHaveBeenCalledWith("--widget-font", expect.stringContaining("serif"));
  });

  it("sets the sans stack for a non-serif host", () => {
    applyHostStyles({ userAgent: "cursor" });
    const call = setProperty.mock.calls.find(([k]) => k === "--widget-font");
    expect(call?.[1]).toContain("--font-sans");
  });

  it("sets the sans stack when userAgent is absent", () => {
    applyHostStyles({});
    const call = setProperty.mock.calls.find(([k]) => k === "--widget-font");
    expect(call?.[1]).toContain("--font-sans");
  });

  it("sets the sans stack for a null context", () => {
    applyHostStyles(null);
    const call = setProperty.mock.calls.find(([k]) => k === "--widget-font");
    expect(call?.[1]).toContain("--font-sans");
  });
});

describe("applyHostStyles — height cap (--widget-max-h)", () => {
  const maxH = (): unknown => setProperty.mock.calls.find(([k]) => k === "--widget-max-h")?.[1];

  it("caps at the host's container maxHeight in px", () => {
    applyHostStyles({ containerDimensions: { maxHeight: 720 } });
    expect(maxH()).toBe("720px");
  });

  it("prefers maxHeight over a fixed height", () => {
    applyHostStyles({ containerDimensions: { height: 900, maxHeight: 600 } });
    expect(maxH()).toBe("600px");
  });

  it("falls back to the fixed container height when no maxHeight", () => {
    applyHostStyles({ containerDimensions: { height: 800 } });
    expect(maxH()).toBe("800px");
  });

  it("sets `none` (no cap) when the host provides no dimensions", () => {
    applyHostStyles({ userAgent: "cursor" });
    expect(maxH()).toBe("none");
  });
});

describe("applyHostStyles — style variable delegation", () => {
  it("calls applyHostStyleVariables when variables are provided", () => {
    const variables = { "--font-sans": "Inter, sans-serif" } as unknown as HostStyleVariables;
    applyHostStyles({ styles: { variables } });
    expect(vi.mocked(applyHostStyleVariables)).toHaveBeenCalledWith(variables);
  });

  it("skips applyHostStyleVariables when no variables are provided", () => {
    applyHostStyles({ styles: {} });
    expect(vi.mocked(applyHostStyleVariables)).not.toHaveBeenCalled();
  });

  it("calls applyHostFonts when font css is provided", () => {
    // A generic font CSS fragment — we test that it is forwarded verbatim, not its content.
    const fonts = "@font-face { src: url(host.woff2) format('woff2'); }" as unknown as HostFontCss;
    applyHostStyles({ styles: { css: { fonts } } });
    expect(vi.mocked(applyHostFonts)).toHaveBeenCalledWith(fonts);
  });

  it("skips applyHostFonts when no font css is provided", () => {
    applyHostStyles({ styles: {} });
    expect(vi.mocked(applyHostFonts)).not.toHaveBeenCalled();
  });
});
