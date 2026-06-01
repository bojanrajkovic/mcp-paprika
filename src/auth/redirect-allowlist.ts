/**
 * Redirect-origin allowlist matching for the confused-deputy consent gate (#147).
 *
 * Pure functional core — no I/O, no side effects.
 *
 * The unit of trust is the **origin** (`scheme://host:port`) of a downstream
 * client's `redirect_uri`: that is where an authorization code is physically
 * delivered, and the one part of a dynamically-registered client an attacker
 * cannot forge to look like a known-good destination. `provider.authorize()`
 * passes a request straight through to the upstream IdP only when its redirect
 * origin is recognized; everything else is routed through the consent screen.
 *
 * Matching rules (security-load-bearing):
 * - Exact origin equality. No substring/suffix matching — `claude.ai.evil.com`
 *   and `evil-claude.ai` must NOT match `claude.ai`.
 * - https only, with the same loopback exemption as `dcr-validator.ts`
 *   (`localhost` / `127.0.0.1` / `[::1]` over http). Protocol is checked BEFORE
 *   `URL.origin` is trusted, so opaque/non-special schemes can never slip through.
 * - Loopback is matched fail-closed including the port: `http://localhost` does
 *   NOT cover `http://localhost:51004` (RFC 8252 §7.3 ephemeral ports). A
 *   loopback client with a random port prompts unless its exact origin is listed.
 */

import { ok, err, type Result } from "neverthrow";
import { OAuthConfigError } from "./errors.js";

/**
 * True when `url`'s protocol is one we permit as a redirect target: https
 * anywhere, http only for the loopback literals. Mirrors `dcr-validator.ts`'s
 * `isValidRedirectUri` scheme rules so a URI that passes DCR is judged by the
 * same standard here. Node's WHATWG parser keeps the brackets on IPv6 hosts,
 * so `[::1]` is compared in bracketed form.
 */
export function hasPermittedScheme(url: URL): boolean {
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") {
    const host = url.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  }
  return false;
}

/**
 * Validate and canonicalize a single configured allowlist entry to its origin.
 *
 * Accepts a bare origin or a full redirect URL (path/query/userinfo are
 * discarded — only the origin matters). Returns `Err(OAuthConfigError)` for an
 * unparseable value or a non-permitted scheme, so misconfiguration fails fast
 * at startup inside `buildAuthContext` rather than silently allowing nothing.
 */
export function normalizeOrigin(value: string): Result<string, OAuthConfigError> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return err(new OAuthConfigError(`invalid redirect-allowlist origin (not an absolute URL): ${value}`));
  }

  if (!hasPermittedScheme(url)) {
    return err(
      new OAuthConfigError(
        `redirect-allowlist origin must be https:// (or http:// for localhost/127.0.0.1/[::1]): ${value}`,
      ),
    );
  }

  return ok(url.origin);
}

/**
 * True iff `redirectUri`'s origin is exactly a member of `allowlist`.
 *
 * Fails closed: an unparseable URI, a non-permitted scheme, or an empty
 * allowlist all yield `false`. The scheme is re-checked here (not just at
 * `normalizeOrigin` time) so the function never trusts an origin it would not
 * itself have admitted, regardless of how the set was built.
 */
export function isRecognizedOrigin(redirectUri: string, allowlist: ReadonlySet<string>): boolean {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  if (!hasPermittedScheme(url)) return false;
  return allowlist.has(url.origin);
}
