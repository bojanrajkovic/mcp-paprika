/**
 * Shared upstream-OIDC authorize redirect (#147).
 *
 * Mints `ourState`/`ourNonce`, persists the pre-callback `AuthRequestState`, and
 * sets the 302 to the upstream IdP authorize endpoint on the Hono context.
 * Both approval paths funnel through here so they cannot drift:
 * - `provider.authorize()` for a recognized redirect origin (no consent needed);
 * - the `/oauth/consent` "allow" handler after a user consents to an
 *   unrecognized origin.
 *
 * Deps are narrow (only what the redirect needs) so the function is decoupled
 * from the provider instance and trivially testable.
 */

import type { Context } from "hono";
import { generateOpaqueToken, nowSeconds } from "./tokens.js";
import type { AuthRequestStore } from "./auth-request-store.js";

export interface UpstreamRedirectDeps {
  readonly authRequests: AuthRequestStore;
  readonly authorizationEndpoint: string;
  readonly upstreamClientId: string;
  readonly upstreamScopes: ReadonlyArray<string>;
  readonly publicUrl: string;
}

/**
 * An authorization the server has decided to forward upstream — either because
 * its redirect origin was recognized, or because the user consented. All fields
 * are already normalized to the wire shapes `AuthRequestState` stores.
 */
export interface ApprovedAuthorization {
  readonly clientId: string;
  readonly codeChallenge: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly claudeState: string;
  readonly scope: string;
}

export function redirectUpstream(c: Context, deps: UpstreamRedirectDeps, approved: ApprovedAuthorization): void {
  const ourState = generateOpaqueToken("mcp_state_");
  const ourNonce = generateOpaqueToken("mcp_nonce_");

  deps.authRequests.put(ourState, {
    clientId: approved.clientId,
    codeChallenge: approved.codeChallenge,
    codeChallengeMethod: "S256",
    redirectUri: approved.redirectUri,
    resource: approved.resource,
    claudeState: approved.claudeState,
    scope: approved.scope,
    ourNonce,
    createdAt: nowSeconds(),
  });

  const upstreamUrl = new URL(deps.authorizationEndpoint);
  upstreamUrl.searchParams.set("response_type", "code");
  upstreamUrl.searchParams.set("client_id", deps.upstreamClientId);
  upstreamUrl.searchParams.set("redirect_uri", `${deps.publicUrl}/oauth/callback`);
  upstreamUrl.searchParams.set("scope", deps.upstreamScopes.join(" "));
  upstreamUrl.searchParams.set("state", ourState);
  upstreamUrl.searchParams.set("nonce", ourNonce);

  // @hono/mcp passes a Hono Context as `res`; it reads c.res after authorize returns.
  c.res = c.redirect(upstreamUrl.toString(), 302);
}
