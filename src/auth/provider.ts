import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  InvalidGrantError,
  InvalidTokenError,
  InvalidTargetError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { DiskClientRegistrationStore } from "./client-registration.js";
import type { TokenStore } from "./token-store.js";
import type { AuthRequestStore } from "./auth-request-store.js";
import type { AuthCodeStore } from "./auth-code-store.js";
import { generateOpaqueToken, ACCESS_TOKEN_TTL_SECONDS } from "./tokens.js";
import type { Context } from "hono";
import type { DiscoveryDoc } from "./oidc-client.js";
import type { ResolvedOAuthConfig } from "./types.js";

/**
 * Minting OAuth 2.1 server provider implementing OAuthServerProvider.
 *
 * Composes the four auth stores (auth-request, auth-code, client-registration, token-store)
 * to implement the OAuth flow:
 * - authorize: redirects to upstream IdP with chained state/nonce
 * - exchangeAuthorizationCode: validates PKCE, verifies against our stored state, mints tokens
 * - exchangeRefreshToken: rotates refresh token, mints new access token
 * - verifyAccessToken: looks up token, returns identity
 * - revokeToken: invalidates token (idempotent)
 * - challengeForAuthorizationCode: returns PKCE challenge for the library to validate
 */
export class MintingOAuthServerProvider implements OAuthServerProvider {
  constructor(
    private readonly _clientStore: DiskClientRegistrationStore,
    private readonly _tokenStore: TokenStore,
    private readonly _authRequests: AuthRequestStore,
    private readonly _authCodes: AuthCodeStore,
    private readonly _discovery: DiscoveryDoc,
    private readonly _oidcConfig: ResolvedOAuthConfig,
    private readonly _publicUrl: string,
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    // Type mismatch: SDK's OAuthRegisteredClientsStore interface requires mutable arrays
    // in the returned OAuthClientInformationFull, while our DiskClientRegistrationStore returns
    // readonly arrays. In practice, the SDK never mutates these arrays, so the cast is sound.
    return this._clientStore as unknown as OAuthRegisteredClientsStore;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Context | unknown,
  ): Promise<void> {
    // Library has already validated code_challenge + code_challenge_method=S256 (AC2.9).
    const ourState = generateOpaqueToken("mcp_state_");
    const ourNonce = generateOpaqueToken("mcp_nonce_");

    this._authRequests.put(ourState, {
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: "S256",
      redirectUri: params.redirectUri,
      resource: params.resource?.toString() ?? "",
      claudeState: params.state ?? "",
      scope: params.scopes?.join(" ") ?? "",
      ourNonce,
      createdAt: Math.floor(Date.now() / 1000),
    });

    // Build upstream redirect. PKCE is NOT chained — see design notes.
    const upstreamUrl = new URL(this._discovery.authorization_endpoint);
    upstreamUrl.searchParams.set("response_type", "code");
    upstreamUrl.searchParams.set("client_id", this._oidcConfig.clientId);
    upstreamUrl.searchParams.set("redirect_uri", `${this._publicUrl}/oauth/callback`);
    upstreamUrl.searchParams.set("scope", this._oidcConfig.scopes.join(" "));
    upstreamUrl.searchParams.set("state", ourState);
    upstreamUrl.searchParams.set("nonce", ourNonce);

    // @hono/mcp library passes Hono Context as the third parameter, not express Response.
    // The library reads c.res after calling this, so we set it via redirect.
    // Cast for SDK type compatibility (SDK declares Response, library passes Context).
    const c = res as unknown as Context;
    c.res = c.redirect(upstreamUrl.toString(), 302);
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    // Library calls this BEFORE exchangeAuthorizationCode in the same /token request.
    // Use peek (non-consuming) — the actual consume happens in exchangeAuthorizationCode.
    const state = this._authCodes.peek(authorizationCode);
    if (state === null) throw new InvalidGrantError("authorization code unknown or expired");
    return state.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string, // library has verified PKCE before this call (AC7.6)
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const state = this._authCodes.consume(authorizationCode);
    if (state === null) throw new InvalidGrantError("authorization code consumed or expired"); // AC2.11
    if (state.clientId !== client.client_id) throw new InvalidGrantError("clientId mismatch");
    if (redirectUri !== undefined && redirectUri !== state.redirectUri) {
      throw new InvalidGrantError("redirect_uri mismatch");
    }
    if (resource !== undefined && resource.toString() !== state.resource) {
      // RFC 8707 - AC2.10.
      throw new InvalidTargetError("resource mismatch with original /authorize");
    }

    const pair = await this._tokenStore.issueAccessRefreshPair({
      clientId: state.clientId,
      identity: state.identity,
      scope: state.scope,
      resource: state.resource,
    });

    return {
      access_token: pair.access.plaintext,
      refresh_token: pair.refresh.plaintext,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: state.scope,
    };
  }

  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: Array<string>,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const result = await this._tokenStore.rotateRefresh(refreshToken, scopes, resource?.toString());
    return result.match(
      (pair) => ({
        access_token: pair.access.plaintext,
        refresh_token: pair.refresh.plaintext,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
      }),
      (e) => {
        throw e; // OAuthTokenError factories return SDK error subclasses, which the library serializes
      },
    );
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const info = await this._tokenStore.lookupAccessToken(token);
    if (info === null) throw new InvalidTokenError("token invalid or expired");
    return info;
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await this._tokenStore.revoke(request.token);
    // Always returns void (200 from library); no existence leak.
  }
}
