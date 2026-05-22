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
import type { Logger } from "pino";
import { generateOpaqueToken, ACCESS_TOKEN_TTL_SECONDS, nowSeconds, hashTokenForStorage } from "./tokens.js";
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
    private readonly log: Logger,
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
      createdAt: nowSeconds(),
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
    // RFC 6749 §4.1.3: if the /authorize request included redirect_uri (it
    // always does in our flow — AuthCodeState requires it), the token request
    // MUST include and match the same value. Allowing omission lets a stolen
    // code be redeemed against a different endpoint.
    if (redirectUri === undefined || redirectUri !== state.redirectUri) {
      throw new InvalidGrantError("redirect_uri missing or mismatch");
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

    const tokenHash = hashTokenForStorage(pair.access.plaintext);
    this.log.info(
      { tokenHash, clientId: state.clientId, sub: state.identity.sub },
      "access token minted (authorization_code grant)",
    );

    return {
      access_token: pair.access.plaintext,
      refresh_token: pair.refresh.plaintext,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: state.scope,
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: Array<string>,
    resource?: URL,
  ): Promise<OAuthTokens> {
    // RFC 6749 §6 / OAuth 2.1 §4.3.1 — a refresh_token belongs to the client
    // it was issued to. TokenStore.rotateRefresh enforces that by comparing
    // expectedClientId to the stored record (atomically under its mutex).
    // Look up old token BEFORE rotation to capture sub for logging (rotateRefresh
    // deletes the old token before returning, so it wouldn't be available after).
    const oldRecord = await this._tokenStore.getTokenRecord(refreshToken);
    const result = await this._tokenStore.rotateRefresh(refreshToken, client.client_id, scopes, resource?.toString());
    return result.match(
      (pair) => {
        const tokenHash = hashTokenForStorage(pair.access.plaintext);
        this.log.info(
          { tokenHash, clientId: client.client_id, sub: oldRecord?.identity.sub ?? null },
          "access token minted (refresh_token grant)",
        );
        return {
          access_token: pair.access.plaintext,
          refresh_token: pair.refresh.plaintext,
          token_type: "Bearer",
          expires_in: ACCESS_TOKEN_TTL_SECONDS,
        };
      },
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

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    // RFC 7009 §2.1: "If the server is unable to locate the token using the
    // given hint, it MUST extend its search across all of its supported token
    // types" and §2.2: "The authorization server first validates the client
    // credentials [...] and then verifies whether the token was issued to the
    // client". A token issued to a different client MUST NOT be revoked;
    // returning void either way (no existence leak) preserves §2.2's privacy
    // intent.
    const record = await this._tokenStore.getTokenRecord(request.token);
    if (record === null) return;
    if (record.clientId !== client.client_id) return;
    await this._tokenStore.revoke(request.token);
    this.log.info(
      { tokenHash: record.tokenHash, clientId: client.client_id, sub: record.identity.sub },
      "access token revoked",
    );
  }
}
