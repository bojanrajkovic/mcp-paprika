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

  it("identifies the authorization server as 'Paprika MCP Connector' (not the raw package name)", () => {
    const { html } = renderConsentPage(base);
    expect(html).toContain("Paprika MCP Connector");
    expect(html).not.toContain("mcp-paprika");
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

  it("strips an RLO override from the client name (bidi-spoofing hardening)", () => {
    // U+202E (RLO) would visually reverse everything after it — e.g. disguise
    // "eviltrusted.com" as something else in an RTL-rendered run.
    const { html } = renderConsentPage({ ...base, clientName: "safe‮gnisufnoc" });
    expect(html).not.toContain("‮");
    expect(html).toContain("safegnisufnoc");
  });

  it("strips zero-width characters from the client name", () => {
    const { html } = renderConsentPage({ ...base, clientName: "Cl​aude" });
    expect(html).not.toContain("​");
    expect(html).toContain("Claude");
  });

  it("strips every invisible format character, not just the bidi and zero-width ranges", () => {
    // U+2060 word joiner, U+061C Arabic letter mark, U+00AD soft hyphen, U+180E Mongolian
    // vowel separator: each renders as nothing, so "Claude" + one of them would pass for "Claude".
    for (const invisible of ["\u2060", "\u061C", "\u00AD", "\u180E"]) {
      const { html } = renderConsentPage({ ...base, clientName: `Claude${invisible}` });
      expect(html).not.toContain(invisible);
      expect(html).toContain("Claude <span");
    }
  });

  it("falls back to 'Unnamed client' when the name is only bidi/zero-width characters", () => {
    const { html } = renderConsentPage({ ...base, clientName: "​‮⁦" });
    expect(html).toContain("Unnamed client");
  });

  it("falls back to 'Unnamed client' when the name is only whitespace", () => {
    const { html } = renderConsentPage({ ...base, clientName: "   " });
    expect(html).toContain("Unnamed client");
  });

  it("renders a correct avatar initial for a name starting with an astral character (emoji)", () => {
    // .charAt(0) would grab only the first UTF-16 code unit of a surrogate
    // pair, producing an orphan half instead of the emoji.
    const { html } = renderConsentPage({ ...base, clientName: "🎉Party Client" });
    expect(html).toContain('<div class="avatar">🎉</div>');
  });

  it('renders dir="auto" on the client name so a hostile RTL name doesn\'t flip the row', () => {
    const { html } = renderConsentPage(base);
    expect(html).toMatch(/<div class="nm" dir="auto">/);
  });

  it("does not crash and still escapes a very long client name", () => {
    const longName = "A".repeat(500);
    const { html } = renderConsentPage({ ...base, clientName: longName });
    expect(html).toContain(longName);
  });

  it("flags a blank redirect host as an unknown destination instead of rendering empty", () => {
    const { html } = renderConsentPage({ ...base, redirectHost: "" });
    expect(html).toContain("Unknown destination");
    expect(html).toContain("dest-warn");
  });

  it("flags a redirect host that's only whitespace/invisible characters the same way", () => {
    const { html } = renderConsentPage({ ...base, redirectHost: "​ ​" });
    expect(html).toContain("Unknown destination");
  });

  it("does not flag a normal redirect host as an unknown destination", () => {
    const { html } = renderConsentPage(base);
    // "dest-warn" always appears in the inlined stylesheet's rule definition;
    // what matters is the destination element itself doesn't carry the class.
    expect(html).toContain('<div class="dest">');
    expect(html).not.toContain("Unknown destination");
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

  it("keeps form-action 'self'-only when no upstream origin is given (terminal pages have no form)", () => {
    const csp = consentSecurityHeaders("N")["Content-Security-Policy"];
    expect(csp).toContain("form-action 'self';");
  });

  it("allows the upstream IdP origin in form-action when given (the consent form 302s there)", () => {
    const csp = consentSecurityHeaders("N", "https://accounts.google.com")["Content-Security-Policy"];
    expect(csp).toContain("form-action 'self' https://accounts.google.com");
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
