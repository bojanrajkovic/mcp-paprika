import { describe, expect, it } from "vitest";

import { consentSecurityHeaders, renderConsentPage, renderDeniedPage, renderExpiredPage } from "./consent-page.js";

describe("renderConsentPage", () => {
  const base = { ticket: "mcp_consent_abc123", clientName: "Claude", redirectHost: "https://claude.ai" };

  it("renders a POST form targeting /oauth/consent with the ticket as a hidden field", () => {
    const { html } = renderConsentPage(base);
    expect(html).toMatch(/<form[^>]*method=["']post["']/i);
    expect(html).toMatch(/action=["']\/oauth\/consent["']/);
    expect(html).toContain('name="ticket"');
    expect(html).toContain("mcp_consent_abc123");
  });

  it("offers both an allow and a deny decision", () => {
    const { html } = renderConsentPage(base);
    expect(html).toMatch(/name=["']decision["'][^>]*value=["']allow["']|value=["']allow["'][^>]*name=["']decision["']/);
    expect(html).toMatch(/value=["']deny["']/);
  });

  it("shows the redirect host as the destination", () => {
    const { html } = renderConsentPage(base);
    expect(html).toContain("https://claude.ai");
  });

  it("shows the client name", () => {
    const { html } = renderConsentPage(base);
    expect(html).toContain("Claude");
  });

  it("falls back to 'Unnamed client' when clientName is absent", () => {
    const { html } = renderConsentPage({ ticket: base.ticket, redirectHost: base.redirectHost });
    expect(html).toContain("Unnamed client");
  });

  it("HTML-escapes an attacker-controlled client name (no raw script tag)", () => {
    const { html } = renderConsentPage({ ...base, clientName: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("HTML-escapes a double quote in the client name", () => {
    const { html } = renderConsentPage({ ...base, clientName: 'a"b' });
    expect(html).not.toContain('a"b');
    expect(html).toContain("a&quot;b");
  });

  it("HTML-escapes an attacker-controlled redirect host", () => {
    const { html } = renderConsentPage({ ...base, redirectHost: 'https://x"<i>.example' });
    expect(html).not.toContain('"<i>');
    expect(html).toContain("&quot;&lt;i&gt;");
  });

  it("renders fixed coarse grant copy, never an attacker scope string", () => {
    // The renderer takes no scope parameter at all — the grant text is fixed.
    const { html } = renderConsentPage(base);
    expect(html.toLowerCase()).toContain("recipes");
  });

  it("returns a nonce that appears in the inline <style> tag", () => {
    const { html, nonce } = renderConsentPage(base);
    expect(nonce.length).toBeGreaterThan(0);
    expect(html).toContain(`<style nonce="${nonce}">`);
  });

  it("generates a distinct nonce per render", () => {
    const a = renderConsentPage(base).nonce;
    const b = renderConsentPage(base).nonce;
    expect(a).not.toBe(b);
  });
});

describe("renderDeniedPage / renderExpiredPage", () => {
  it("denied page is a terminal page with no upstream form and its own nonce", () => {
    const { html, nonce } = renderDeniedPage();
    expect(nonce.length).toBeGreaterThan(0);
    expect(html).toContain(`<style nonce="${nonce}">`);
    expect(html).not.toContain("/oauth/consent");
    expect(html.toLowerCase()).toContain("denied");
  });

  it("expired page explains the request expired and has its own nonce", () => {
    const { html, nonce } = renderExpiredPage();
    expect(html).toContain(`<style nonce="${nonce}">`);
    expect(html.toLowerCase()).toContain("expired");
  });
});

describe("consentSecurityHeaders", () => {
  const headers = consentSecurityHeaders("NONCE123");

  it("sets a CSP that pins styles to the nonce and locks down default-src", () => {
    const csp = headers["Content-Security-Policy"];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("style-src 'nonce-NONCE123'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'none'");
  });

  it("forbids framing via CSP frame-ancestors and X-Frame-Options (anti-clickjacking)", () => {
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });

  it("forbids MIME sniffing on the consent response", () => {
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("forbids caching of the consent response", () => {
    expect(headers["Cache-Control"]).toBe("no-store");
  });
});
