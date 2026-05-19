import { describe, it, expect, beforeEach, afterEach, afterAll, beforeAll, vi } from "vitest";
import { URL } from "node:url";
import { MintingOAuthServerProvider } from "./provider.js";
import { DiskClientRegistrationStore } from "./client-registration.js";
import { TokenStore } from "./token-store.js";
import { AuthRequestStore } from "./auth-request-store.js";
import { AuthCodeStore } from "./auth-code-store.js";
import { DiskCache } from "../cache/disk-cache.js";
import { createOidcStub } from "./__fixtures__/oidc-stub.js";
import { makeAuthCodeState, makeVerifiedIdentity } from "./__fixtures__/oauth-state.js";
import { setupServer } from "msw/node";
import { ACCESS_TOKEN_TTL_SECONDS } from "./tokens.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthCodeState } from "./types.js";

/**
 * Local helper that wraps makeAuthCodeState with this test file's defaults
 * (clientId from mockClient, the standard `user@example.com` identity, the
 * `https://claude.ai/callback` redirect, etc.). Each call site only needs
 * to specify what diverges.
 */
function makeProviderAuthCode(
  mockClient: OAuthClientInformationFull,
  overrides: Partial<AuthCodeState> = {},
): AuthCodeState {
  return makeAuthCodeState({
    clientId: mockClient.client_id,
    codeChallenge: "challenge-123",
    redirectUri: "https://claude.ai/callback",
    resource: "https://mcp.example.com/",
    scope: "openid email",
    identity: makeVerifiedIdentity({ email: "user@example.com", sub: "user-sub-123" }),
    ...overrides,
  });
}

describe("MintingOAuthServerProvider", () => {
  let cacheDir: string;
  let cache: DiskCache;
  let clientStore: DiskClientRegistrationStore;
  let tokenStore: TokenStore;
  let authRequests: AuthRequestStore;
  let authCodes: AuthCodeStore;
  let oidcStub: ReturnType<typeof createOidcStub>;
  let provider: MintingOAuthServerProvider;
  let mockClient: OAuthClientInformationFull;
  let server: ReturnType<typeof setupServer>;

  beforeAll(() => {
    // Create OIDC stub at module level (shared across all tests)
    oidcStub = createOidcStub({
      issuer: "https://idp.stub.example.com",
      clientId: "stub-client-id",
      clientSecret: "stub-client-secret",
      defaultIdentity: {
        email: "user@example.com",
        sub: "user-sub-123",
        emailVerified: true,
      },
    });

    // Setup MSW server at module level
    server = setupServer(...oidcStub.handlers);
    server.listen();
  });

  afterEach(() => {
    server.resetHandlers();
    oidcStub.resetOverrides();
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(async () => {
    // Setup test directory
    cacheDir = `/tmp/test-oauth-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Initialize cache and stores
    cache = new DiskCache(cacheDir);
    await cache.init();

    clientStore = new DiskClientRegistrationStore(cache, "https://mcp.example.com");
    tokenStore = new TokenStore(cache);
    authRequests = new AuthRequestStore();
    authCodes = new AuthCodeStore();

    // Initialize provider
    const discovery = {
      issuer: oidcStub.issuer,
      authorization_endpoint: `${oidcStub.issuer}/authorize`,
      token_endpoint: `${oidcStub.issuer}/token`,
      jwks_uri: `${oidcStub.issuer}/jwks`,
      id_token_signing_alg_values_supported: ["RS256"],
    };

    provider = new MintingOAuthServerProvider(
      clientStore,
      tokenStore,
      authRequests,
      authCodes,
      discovery,
      {
        discoveryUrl: `${oidcStub.issuer}/.well-known/openid-configuration`,
        publicUrl: "https://mcp.example.com",
        presetName: null,
        clientId: "stub-client-id",
        clientSecret: "stub-client-secret",
        scopes: ["openid", "email"],
        emailVerifiedPolicy: "if-present",
        allowlist: { emails: ["user@example.com"], subs: [] },
        allowedAlgs: ["RS256"],
      },
      "https://mcp.example.com",
    );

    // Create mock client for testing
    const stored = await clientStore.registerClient({
      client_name: "Test Client",
      redirect_uris: ["https://claude.ai/callback"],
    });

    mockClient = {
      client_id: stored.client_id,
      client_name: "Test Client",
      redirect_uris: ["https://claude.ai/callback"],
    } as OAuthClientInformationFull;
  });

  describe("authorize", () => {
    it("AC2.3: redirects to upstream /authorize with state, nonce, scope, and our client_id", async () => {
      const ctx = {
        redirect: vi.fn((url: string, status: number) => {
          return new Response(null, {
            status,
            headers: {
              Location: url,
            },
          });
        }),
      };

      await provider.authorize(
        mockClient,
        {
          state: "claude-state-123",
          scopes: ["openid", "email"],
          redirectUri: "https://claude.ai/callback",
          codeChallenge: "challenge123456789",
        },
        ctx as any,
      );

      expect(ctx.redirect).toHaveBeenCalled();
      const redirectUrl = ctx.redirect.mock.calls[0]![0]!;
      const parsed = new URL(redirectUrl);

      expect(parsed.origin).toBe("https://idp.stub.example.com");
      expect(parsed.pathname).toBe("/authorize");
      expect(parsed.searchParams.get("response_type")).toBe("code");
      expect(parsed.searchParams.get("client_id")).toBe("stub-client-id");
      expect(parsed.searchParams.get("redirect_uri")).toBe("https://mcp.example.com/oauth/callback");
      expect(parsed.searchParams.has("state")).toBe(true);
      expect(parsed.searchParams.has("nonce")).toBe(true);
      expect(parsed.searchParams.get("scope")).toBe("openid email");
    });

    it("stores AuthRequestState keyed by ourState before redirect", async () => {
      const ctx = {
        redirect: vi.fn((_url: string, status: number) => new Response(null, { status })),
      };

      await provider.authorize(
        mockClient,
        {
          state: "claude-state-123",
          scopes: ["openid", "email"],
          redirectUri: "https://claude.ai/callback",
          codeChallenge: "challenge123456789",
        },
        ctx as any,
      );

      // Extract ourState from redirect URL
      const redirectUrl = ctx.redirect.mock.calls[0]![0]!;
      const parsed = new URL(redirectUrl);
      const ourState = parsed.searchParams.get("state");

      expect(ourState).toBeTruthy();

      // Verify AuthRequest was stored
      const stored = authRequests.consume(ourState!);
      expect(stored).not.toBeNull();
      expect(stored?.clientId).toBe(mockClient.client_id);
      expect(stored?.codeChallenge).toBe("challenge123456789");
      expect(stored?.redirectUri).toBe("https://claude.ai/callback");
      expect(stored?.claudeState).toBe("claude-state-123");
    });
  });

  describe("exchangeAuthorizationCode (AC2.4)", () => {
    it("AC2.4: valid auth_code → returns access+refresh+expires_in=86400+token_type=Bearer", async () => {
      // PLAN says (phase_06.md:295): Set up a complete exchange. Put an AuthCodeState into authCodes via `authCodes.put(code, state)`, then call `provider.exchangeAuthorizationCode(client, code, codeVerifier, redirectUri, resource)`. Assert the returned `OAuthTokens` has `access_token` (starts with `mcp_at_` or whatever prefix tokens.ts uses), `refresh_token`, `token_type === "Bearer"`, `expires_in === ACCESS_TOKEN_TTL_SECONDS` (24h = 86400), and `scope` equal to the AuthCodeState scope.
      const code = "test-code-123";
      const resourceUrl = new URL("https://mcp.example.com");
      authCodes.put(code, makeProviderAuthCode(mockClient));

      const tokens = await provider.exchangeAuthorizationCode(
        mockClient,
        code,
        undefined,
        "https://claude.ai/callback",
        resourceUrl,
      );

      expect(tokens.access_token).toMatch(/^mcp_at_/);
      expect(tokens.refresh_token).toMatch(/^mcp_rt_/);
      expect(tokens.token_type).toBe("Bearer");
      expect(tokens.expires_in).toBe(ACCESS_TOKEN_TTL_SECONDS);
      expect(tokens.scope).toBe("openid email");
    });

    it("AC2.11: consumed auth_code → InvalidGrantError on second exchange", async () => {
      // PLAN says (phase_06.md:296): Exchange once successfully, then call again with the same code. Second call must reject with `InvalidGrantError` (assert `.rejects.toMatchObject({ errorCode: "invalid_grant" })`).
      const code = "test-code-consumed";
      const resourceUrl = new URL("https://mcp.example.com");
      authCodes.put(code, makeProviderAuthCode(mockClient));

      // First exchange succeeds
      const result1 = await provider.exchangeAuthorizationCode(
        mockClient,
        code,
        undefined,
        "https://claude.ai/callback",
        resourceUrl,
      );
      expect(result1.access_token).toBeDefined();

      // Second exchange with same code fails
      await expect(
        provider.exchangeAuthorizationCode(mockClient, code, undefined, "https://claude.ai/callback", resourceUrl),
      ).rejects.toMatchObject({ errorCode: "invalid_grant" });
    });

    it("AC2.10: resource mismatch → invalid_target error", async () => {
      // PLAN says (phase_06.md:297): Stored AuthCodeState has resource="https://m.example.com/mcp"; call exchange with `resource: new URL("https://wrong/")`. Reject with `errorCode: "invalid_target"`.
      const code = "test-code-resource-mismatch";
      authCodes.put(code, makeProviderAuthCode(mockClient, { resource: "https://m.example.com/mcp" }));

      await expect(
        provider.exchangeAuthorizationCode(
          mockClient,
          code,
          undefined,
          "https://claude.ai/callback",
          new URL("https://wrong/"),
        ),
      ).rejects.toMatchObject({ errorCode: "invalid_target" });
    });
  });

  describe("exchangeRefreshToken", () => {
    it("happy path: returns new pair, old refresh invalidated", async () => {
      // PLAN says (phase_06.md:307): Issue a token pair via `tokenStore.issueAccessRefreshPair(...)`, then call `provider.exchangeRefreshToken(undefined as any, oldRefresh)`. Assert new pair returned, old refresh token invalidated (subsequent `provider.exchangeRefreshToken(_, oldRefresh)` rejects).
      const pair = await tokenStore.issueAccessRefreshPair({
        clientId: mockClient.client_id,
        identity: makeVerifiedIdentity({ email: "user@example.com", sub: "user-sub-123" }),
        scope: "openid email",
        resource: "https://mcp.example.com/",
      });

      const newPair = await provider.exchangeRefreshToken(undefined as any, pair.refresh.plaintext);

      expect(newPair.access_token).toMatch(/^mcp_at_/);
      expect(newPair.refresh_token).toMatch(/^mcp_rt_/);
      expect(newPair.token_type).toBe("Bearer");
      expect(newPair.expires_in).toBe(ACCESS_TOKEN_TTL_SECONDS);

      // Old refresh token is invalidated
      await expect(provider.exchangeRefreshToken(undefined as any, pair.refresh.plaintext)).rejects.toMatchObject({
        errorCode: "invalid_grant",
      });
    });

    it("AC2.10: mismatched resource → invalid_target", async () => {
      // PLAN says (phase_06.md:308): Issue pair with resource="A"; call `exchangeRefreshToken` with `resource: new URL("B/")`. Reject with `errorCode: "invalid_target"`.
      const pair = await tokenStore.issueAccessRefreshPair({
        clientId: mockClient.client_id,
        identity: makeVerifiedIdentity({ email: "user@example.com", sub: "user-sub-123" }),
        scope: "openid email",
        resource: "https://a.example.com/",
      });

      await expect(
        provider.exchangeRefreshToken(
          undefined as any,
          pair.refresh.plaintext,
          undefined,
          new URL("https://b.example.com"),
        ),
      ).rejects.toMatchObject({ errorCode: "invalid_target" });
    });
  });

  describe("verifyAccessToken", () => {
    it("returns AuthInfo for valid token", async () => {
      // PLAN says (phase_06.md:312): Issue pair, call `provider.verifyAccessToken(pair.access.plaintext)`. Resolves to AuthInfo with `clientId`, `scopes`, `extra.identity`, etc.
      const pair = await tokenStore.issueAccessRefreshPair({
        clientId: mockClient.client_id,
        identity: makeVerifiedIdentity({ email: "user@example.com", sub: "user-sub-123" }),
        scope: "openid email",
        resource: "https://mcp.example.com/",
      });

      const authInfo = await provider.verifyAccessToken(pair.access.plaintext);

      expect(authInfo.clientId).toBe(mockClient.client_id);
      expect(authInfo.scopes).toEqual(["openid", "email"]);
      expect(authInfo.extra?.["email"]).toBe("user@example.com");
      expect(authInfo.extra?.["sub"]).toBe("user-sub-123");
    });

    it("throws InvalidTokenError for unknown/expired token", async () => {
      // PLAN says (phase_06.md:313): Call with random string. Reject with `errorCode: "invalid_token"`.
      await expect(provider.verifyAccessToken("random-invalid-token")).rejects.toMatchObject({
        errorCode: "invalid_token",
      });
    });
  });

  describe("revokeToken (AC2.5)", () => {
    it("AC2.5: removes token; subsequent verifyAccessToken throws InvalidTokenError", async () => {
      // PLAN says (phase_06.md:317): Issue pair, call `provider.revokeToken({} as any, { token: pair.access.plaintext, token_type_hint: "access_token" })`. Then `provider.verifyAccessToken(pair.access.plaintext)` rejects with `errorCode: "invalid_token"`.
      const pair = await tokenStore.issueAccessRefreshPair({
        clientId: mockClient.client_id,
        identity: makeVerifiedIdentity({ email: "user@example.com", sub: "user-sub-123" }),
        scope: "openid email",
        resource: "https://mcp.example.com/",
      });

      await provider.revokeToken({} as any, {
        token: pair.access.plaintext,
        token_type_hint: "access_token",
      });

      // Token is now revoked
      await expect(provider.verifyAccessToken(pair.access.plaintext)).rejects.toMatchObject({
        errorCode: "invalid_token",
      });
    });

    it("idempotent — revoking unknown token returns void without throw", async () => {
      // PLAN says (phase_06.md:319): Call with a random token. Resolves to undefined without throwing.
      await expect(
        provider.revokeToken({} as any, {
          token: "random-unknown-token",
          token_type_hint: "access_token",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("challengeForAuthorizationCode", () => {
    it("returns the code_challenge stored at /authorize time", async () => {
      // PLAN says (phase_06.md:322): Put an AuthCodeState with `codeChallenge: "abc"`. Call `provider.challengeForAuthorizationCode(client, code)`. Resolves to "abc".
      const code = "test-code-challenge";
      const challenge = "abc123def456";
      authCodes.put(code, makeProviderAuthCode(mockClient, { codeChallenge: challenge }));

      const result = await provider.challengeForAuthorizationCode(mockClient, code);
      expect(result).toBe(challenge);
    });

    it("does NOT consume the auth_code (subsequent exchangeAuthorizationCode succeeds)", async () => {
      // PLAN says (phase_06.md:324): Call challenge, then call exchange with same code. Both succeed (the code is only consumed by `exchangeAuthorizationCode`, not by `challengeForAuthorizationCode`'s peek).
      const code = "test-code-peek-not-consume";
      const resourceUrl = new URL("https://mcp.example.com");
      authCodes.put(code, makeProviderAuthCode(mockClient));

      // Challenge call does NOT consume
      const challenge = await provider.challengeForAuthorizationCode(mockClient, code);
      expect(challenge).toBe("challenge-123");

      // Exchange succeeds with same code
      const tokens = await provider.exchangeAuthorizationCode(
        mockClient,
        code,
        undefined,
        "https://claude.ai/callback",
        resourceUrl,
      );
      expect(tokens.access_token).toBeDefined();
    });

    it("unknown code → InvalidGrantError", async () => {
      // PLAN says (phase_06.md:325): Call with random code. Reject with `errorCode: "invalid_grant"`.
      await expect(provider.challengeForAuthorizationCode(mockClient, "unknown-code")).rejects.toMatchObject({
        errorCode: "invalid_grant",
      });
    });
  });
});
