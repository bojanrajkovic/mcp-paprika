/**
 * Consent-screen HTML renderers for the confused-deputy gate (#147).
 *
 * Rendered at `/authorize` when a downstream client's redirect origin is NOT on
 * the operator allowlist, before any upstream redirect. The screen's job is to
 * make the *destination* legible: the redirect host is the visual anchor (the
 * one field an attacker cannot forge), the DCR-supplied client name is shown
 * but tagged self-reported, and the grant text is fixed coarse copy.
 *
 * Security contract (enforced + tested):
 * - Every attacker-controlled field (`clientName`, `redirectHost`) is
 *   HTML-escaped. `client_name` comes from open DCR, so an unescaped value is
 *   stored XSS — worse than the bug this screen closes.
 * - The requested OAuth `scope` is never rendered (this renderer takes no scope
 *   parameter); the grant description is fixed.
 * - Styles are inline under a per-render CSP nonce; `consentSecurityHeaders`
 *   returns the matching `Content-Security-Policy` plus `X-Frame-Options: DENY`
 *   (anti-clickjacking — a framed consent screen defeats human review) and
 *   `Cache-Control: no-store`. The caller sets these on the response.
 * - The form posts same-origin to `/oauth/consent`; the opaque single-use
 *   ticket is the CSRF token (only present in the victim's rendered page).
 */

import { randomBytes } from "node:crypto";

/** A rendered page plus the CSP nonce its inline styles are pinned to. */
export interface RenderedPage {
  readonly html: string;
  readonly nonce: string;
}

/** HTML-escape for text and double-quoted-attribute contexts. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Per-render CSPRNG nonce (128 bits, base64) for the inline <style>. */
function generateNonce(): string {
  return randomBytes(16).toString("base64");
}

/**
 * The authorization server's display name in the consent brandbar and page
 * titles. This is the OAuth-surface identity (distinct from the host-facing
 * connector card name in `src/utils/branding.ts`); a connecting user reads it as
 * "the Paprika MCP Connector wants to connect."
 */
const DISPLAY_NAME = "Paprika MCP Connector";

const STYLES = `
  :root {
    --paper: oklch(0.985 0.006 75); --card: oklch(0.995 0.004 75);
    --ink: oklch(0.26 0.012 70); --muted: oklch(0.53 0.012 70); --faint: oklch(0.66 0.010 70);
    --line: oklch(0.90 0.008 70); --line-2: oklch(0.83 0.010 70);
    --paprika-red: oklch(0.543 0.174 30); --paprika-red-ink: oklch(0.99 0.01 75); --dest-bg: oklch(0.965 0.012 70); /* --paprika-red = #C0392B, the connector identity color */
    --mono: ui-monospace, "SF Mono", Menlo, monospace;
    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--paper); color: var(--ink);
    font-family: var(--sans); line-height: 1.5; display: grid; place-items: center; padding: 24px; }
  .screen { width: 100%; max-width: 440px; background: var(--card); border: 1px solid var(--line);
    border-radius: 14px; overflow: clip;
    box-shadow: 0 1px 2px oklch(0.5 0.02 70 / 0.05), 0 8px 24px oklch(0.5 0.02 70 / 0.06); }
  .brandbar { font-size: 0.72rem; color: var(--faint); letter-spacing: 0.04em;
    padding: 12px 22px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 7px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--paprika-red); }
  .body { padding: 20px 22px 6px; }
  .head { display: flex; align-items: center; gap: 13px; margin-bottom: 18px; }
  .avatar { width: 42px; height: 42px; border-radius: 10px; flex: none; background: oklch(0.92 0.03 250);
    color: oklch(0.43 0.10 250); display: grid; place-items: center; font-weight: 700; font-size: 1.1rem; }
  .nm { font-weight: 670; font-size: 1.08rem; letter-spacing: -0.005em; }
  .tag { font-weight: 500; font-size: 0.7rem; color: var(--faint); border: 1px solid var(--line-2);
    border-radius: 5px; padding: 1px 5px; margin-left: 7px; vertical-align: 1px; }
  .sub2 { font-size: 0.86rem; color: var(--muted); }
  .dest { background: var(--dest-bg); border: 1px solid var(--line-2); border-radius: 11px;
    padding: 13px 15px; margin-bottom: 16px; }
  .dest .lbl { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); margin-bottom: 5px; }
  .dest .host { font-family: var(--mono); font-size: 1.3rem; font-weight: 700;
    letter-spacing: -0.01em; word-break: break-all; line-height: 1.2; }
  .grants .lbl { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--faint); margin-bottom: 4px; }
  .grants p { margin: 0; font-size: 0.9rem; color: var(--muted); }
  .denyline { font-size: 0.82rem; color: var(--muted); padding: 14px 0 0; }
  .denyline b { color: var(--ink); }
  .actions { display: flex; gap: 10px; padding: 14px 0 20px; }
  .btn { flex: 1; text-align: center; padding: 11px 14px; border-radius: 9px; font: inherit;
    font-size: 0.92rem; font-weight: 600; border: 1px solid transparent; cursor: pointer; }
  .btn-ghost { background: transparent; color: var(--ink); border-color: var(--line-2); }
  .btn-fill { background: var(--paprika-red); color: var(--paprika-red-ink); }
  .foot { padding: 0 0 18px; font-size: 0.78rem; color: var(--faint); }
  .terminal { padding: 28px 24px; text-align: center; }
  .terminal h1 { font-size: 1.2rem; font-weight: 650; margin: 0 0 8px; }
  .terminal p { margin: 0; color: var(--muted); font-size: 0.9rem; }
`;

/** Wrap body HTML in the shared document shell with a nonce'd <style>. */
function shell(nonce: string, title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style nonce="${nonce}">${STYLES}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export interface ConsentPageParams {
  readonly ticket: string;
  readonly clientName?: string;
  readonly redirectHost: string;
}

/**
 * The consent screen for an unrecognized redirect origin. Returns the HTML and
 * the CSP nonce its inline styles are pinned to.
 */
export function renderConsentPage(params: ConsentPageParams): RenderedPage {
  const nonce = generateNonce();
  const name = params.clientName && params.clientName.length > 0 ? params.clientName : "Unnamed client";
  const safeName = escapeHtml(name);
  const safeHost = escapeHtml(params.redirectHost);
  const safeTicket = escapeHtml(params.ticket);
  const initial = escapeHtml(name.charAt(0).toUpperCase() || "?");

  const body = `<main class="screen">
  <div class="brandbar"><span class="dot"></span> ${DISPLAY_NAME}</div>
  <form class="body" method="post" action="/oauth/consent">
    <input type="hidden" name="ticket" value="${safeTicket}">
    <div class="head">
      <div class="avatar">${initial}</div>
      <div>
        <div class="nm">${safeName} <span class="tag">name self-reported</span></div>
        <div class="sub2">wants to connect to your Paprika account</div>
      </div>
    </div>
    <div class="dest">
      <div class="lbl">Authorization code will be sent to</div>
      <div class="host">${safeHost}</div>
    </div>
    <div class="grants">
      <div class="lbl">It will be able to</div>
      <p>Read and write your recipes, meals, grocery lists, and pantry.</p>
    </div>
    <div class="denyline">Didn&#39;t just start this connection yourself? <b>Deny.</b></div>
    <div class="actions">
      <button type="submit" name="decision" value="deny" class="btn btn-ghost">Deny</button>
      <button type="submit" name="decision" value="allow" class="btn btn-fill">Allow</button>
    </div>
    <div class="foot">You&#39;ll sign in after allowing. Only you can complete this.</div>
  </form>
</main>`;

  return { html: shell(nonce, `Authorize access — ${DISPLAY_NAME}`, body), nonce };
}

/** Terminal page shown on Deny. Stays on our origin; never redirects to the redirect_uri. */
export function renderDeniedPage(): RenderedPage {
  const nonce = generateNonce();
  const body = `<main class="screen">
  <div class="brandbar"><span class="dot"></span> ${DISPLAY_NAME}</div>
  <div class="terminal">
    <h1>Access denied</h1>
    <p>No connection was authorized. You can close this tab.</p>
  </div>
</main>`;
  return { html: shell(nonce, `Access denied — ${DISPLAY_NAME}`, body), nonce };
}

/** Terminal page shown when a consent ticket is unknown or expired. */
export function renderExpiredPage(): RenderedPage {
  const nonce = generateNonce();
  const body = `<main class="screen">
  <div class="brandbar"><span class="dot"></span> ${DISPLAY_NAME}</div>
  <div class="terminal">
    <h1>Request expired</h1>
    <p>This authorization request is no longer valid. Start the connection again from your app.</p>
  </div>
</main>`;
  return { html: shell(nonce, `Request expired — ${DISPLAY_NAME}`, body), nonce };
}

/**
 * Security headers for every consent-flow response. The CSP pins inline styles
 * to `nonce`, denies all other resource loads, restricts form submission, and
 * forbids framing; `X-Frame-Options` backs frame-ancestors for older browsers;
 * `Cache-Control` keeps the page (and its ticket) out of shared caches.
 *
 * `form-action` is enforced across redirects: the Allow form posts same-origin to
 * `/oauth/consent`, which 302-redirects to the upstream IdP authorize endpoint,
 * so `'self'` alone blocks the approve navigation. Callers rendering the consent
 * *form* must pass `formActionOrigin` (the IdP authorize-endpoint origin) so that
 * redirect is allowed; terminal pages (denied/expired) carry no form and omit it,
 * keeping `form-action 'self'`.
 */
export function consentSecurityHeaders(nonce: string, formActionOrigin?: string): Record<string, string> {
  const formAction = formActionOrigin ? `form-action 'self' ${formActionOrigin}` : "form-action 'self'";
  return {
    "Content-Security-Policy": [
      "default-src 'none'",
      `style-src 'nonce-${nonce}'`,
      formAction,
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };
}
