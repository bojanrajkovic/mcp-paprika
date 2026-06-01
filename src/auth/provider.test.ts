import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { MintingOAuthServerProvider } from "./provider.js";
import { DiskClientRegistrationStore } from "./client-registration.js";
import { TokenStore } from "./token-store.js";
import { AuthRequestStore } from "./auth-request-store.js";
import { AuthCodeStore } from "./auth-code-store.js";
import { PendingAuthorizationStore } from "./pending-authorization-store.js";
import { DiskCacheRoot } from "../cache/disk/index.js";
import { makeDefaultOidcStub, makeDiscoveryDoc } from "./__fixtures__/oidc-stub.js";
import { makeAuthCodeState, makeVerifiedIdentity } from "./__fixtures__/oauth-state.js";
import { ACCESS_TOKEN_TTL_SECONDS, hashTokenForStorage } from "./tokens.js";
import { makePinoCapture } from "../tools/tool-test-utils.js";
import { SILENT_LOG } from "../utils/log.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthCodeState } from "./types.js";
import { useMswServer } from "../__fixtures__/msw.js";

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

// Created at module scope so handlers can be passed as permanent initial handlers
// to useMswServer (permanent = not removed by resetHandlers).
const oidcStub = makeDefaultOidcStub();

describe("MintingOAuthServerProvider", () => {
  let cacheDir: string;
  let cache: DiskCacheRoot;
  let clientStore: DiskClientRegistrationStore;
  let tokenStore: TokenStore;
  let authRequests: AuthRequestStore;
  let authCodes: AuthCodeStore;
  let pendingAuthorizations: PendingAuthorizationStore;
  let provider: MintingOAuthServerProvider;
  let mockClient: OAuthClientInformationFull;

  // useMswServer wires beforeAll(listen) + afterEach(resetHandlers + onReset) + afterAll(close).
  // oidcStub.handlers are passed as permanent handlers so resetHandlers() preserves them.
  useMswServer([...oidcStub.handlers], { onReset: () => oidcStub.resetOverrides() });

  beforeEach(async () => {
    // Setup test directory
    cacheDir = await mkdtemp(join(tmpdir(), "paprika-provider-"));

    // Initialize cache and stores
    cache = new DiskCacheRoot(cacheDir);
    await cache.init();

    clientStore = new DiskClientRegistrationStore(cache, "https://mcp.example.com", SILENT_LOG);
    tokenStore = new TokenStore(cache);
    authRequests = new AuthRequestStore();
    authCodes = new AuthCodeStore();
    pendingAuthorizations = new PendingAuthorizationStore();

    // Initialize provider
    const discovery = makeDiscoveryDoc(oidcStub.issuer);

    provider = new MintingOAuthServerProvider(
      clientStore,
      tokenStore,
      authRequests,
      authCodes,
      pendingAuthorizations,
      discovery,
      {
        discoveryUrl: `${oidcStub.issuer}/.well-known/openid-configuration`,
        publicUrl: "https://mcp.example.com",
        presetName: null,
        clientId: "stub-client-id",
        clientSecret: "stub-client-secret",
        scopes: ["openid", "email"],
        emailVerifiedPolicy: "if-present",
        trustProxy: false,
        allowlist: { emails: ["user@example.com"], subs: [] },
        allowedAlgs: ["RS256"],
        // Recognize claude.ai so the existing authorize tests exercise the
        // straight-to-upstream (recognized) path; the consent branch is covered
        // by its own tests below.
        redirectAllowlist: ["https://claude.ai"],
      },
      "https://mcp.example.com",
      SILENT_LOG,
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

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
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

  describe("authorize — confused-deputy consent gate (#147)", () => {
    it("an unrecognized redirect origin renders the consent screen and holds a pending authorization", async () => {
      const stored = await clientStore.registerClient({
        client_name: "Sneaky",
        redirect_uris: ["https://paprika-sync.app/cb"],
      });
      const unknownClient = {
        client_id: stored.client_id,
        client_name: "Sneaky",
        redirect_uris: ["https://paprika-sync.app/cb"],
      } as OAuthClientInformationFull;

      const ctx = {
        html: vi.fn(
          (body: string, status: number, headers: Record<string, string>) => new Response(body, { status, headers }),
        ),
        redirect: vi.fn(),
      };

      await provider.authorize(
        unknownClient,
        {
          state: "claude-state-123",
          scopes: ["openid", "email"],
          redirectUri: "https://paprika-sync.app/cb",
          codeChallenge: "challenge123456789",
        },
        ctx as any,
      );

      // No upstream redirect, and nothing minted into AuthRequestStore yet.
      expect(ctx.redirect).not.toHaveBeenCalled();
      expect(ctx.html).toHaveBeenCalledOnce();

      const [body, status, headers] = ctx.html.mock.calls[0]!;
      expect(status).toBe(200);
      expect(body).toContain("paprika-sync.app");
      expect(body).toContain("Sneaky");
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");

      // The downstream request is held under a ticket, awaiting consent.
      expect(pendingAuthorizations.size).toBe(1);
    });

    it("a recognized redirect origin bypasses consent and goes straight upstream", async () => {
      const ctx = {
        html: vi.fn(),
        redirect: vi.fn((url: string, status: number) => new Response(null, { status, headers: { Location: url } })),
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

      expect(ctx.html).not.toHaveBeenCalled();
      expect(ctx.redirect).toHaveBeenCalled();
      expect(pendingAuthorizations.size).toBe(0);
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

    it("RFC 6749 §4.1.3: omitted redirect_uri rejected when /authorize stored one", async () => {
      // The /authorize request always includes redirect_uri (it's a required
      // field on AuthCodeState). RFC 6749 §4.1.3 requires the matching
      // redirect_uri to be presented at /token. Silently accepting requests
      // that drop the parameter would let a stolen auth_code be redeemed from
      // an unrelated endpoint.
      const code = "test-code-omit-redirect";
      const resourceUrl = new URL("https://mcp.example.com");
      authCodes.put(code, makeProviderAuthCode(mockClient));

      await expect(
        provider.exchangeAuthorizationCode(mockClient, code, undefined, undefined, resourceUrl),
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

      const newPair = await provider.exchangeRefreshToken(mockClient, pair.refresh.plaintext);

      expect(newPair.access_token).toMatch(/^mcp_at_/);
      expect(newPair.refresh_token).toMatch(/^mcp_rt_/);
      expect(newPair.token_type).toBe("Bearer");
      expect(newPair.expires_in).toBe(ACCESS_TOKEN_TTL_SECONDS);

      // Old refresh token is invalidated
      await expect(provider.exchangeRefreshToken(mockClient, pair.refresh.plaintext)).rejects.toMatchObject({
        errorCode: "invalid_grant",
      });
    });

    it("cross-client: requesting client ≠ stored clientId → invalid_grant, token preserved", async () => {
      // Registered client A obtains a refresh_token; registered client B then
      // submits a refresh-token grant carrying A's refresh_token. The provider
      // MUST reject the rotation (otherwise B keeps A's session alive and
      // receives access tokens for A's identity).
      const pair = await tokenStore.issueAccessRefreshPair({
        clientId: mockClient.client_id,
        identity: makeVerifiedIdentity({ email: "user@example.com", sub: "user-sub-123" }),
        scope: "openid email",
        resource: "https://mcp.example.com/",
      });

      const otherClient = await clientStore.registerClient({
        client_name: "Other Client",
        redirect_uris: ["https://other.example.com/callback"],
      });

      await expect(
        provider.exchangeRefreshToken(
          {
            client_id: otherClient.client_id,
            redirect_uris: ["https://other.example.com/callback"],
          } as OAuthClientInformationFull,
          pair.refresh.plaintext,
        ),
      ).rejects.toMatchObject({ errorCode: "invalid_grant" });

      // The owning client can still use its refresh token.
      const ownerResult = await provider.exchangeRefreshToken(mockClient, pair.refresh.plaintext);
      expect(ownerResult.access_token).toMatch(/^mcp_at_/);
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
        provider.exchangeRefreshToken(mockClient, pair.refresh.plaintext, undefined, new URL("https://b.example.com")),
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

      await provider.revokeToken(mockClient, {
        token: pair.access.plaintext,
        token_type_hint: "access_token",
      });

      // Token is now revoked
      await expect(provider.verifyAccessToken(pair.access.plaintext)).rejects.toMatchObject({
        errorCode: "invalid_token",
      });
    });

    it("RFC 7009 §2.2: caller client mismatched → silently no-op, token still valid", async () => {
      // RFC 7009 §2.1: "If the server is unable to locate the token using the
      // given hint, it MUST extend its search across all of its supported
      // token types"; §2.2: "An authorization server MAY revoke its own
      // tokens, but the requesting client must be the same as the client
      // associated with the token." Mismatch must NOT revoke (and must not
      // leak existence).
      const pair = await tokenStore.issueAccessRefreshPair({
        clientId: mockClient.client_id,
        identity: makeVerifiedIdentity({ email: "user@example.com", sub: "user-sub-123" }),
        scope: "openid email",
        resource: "https://mcp.example.com/",
      });

      const otherClient = await clientStore.registerClient({
        client_name: "Other Client",
        redirect_uris: ["https://other.example.com/callback"],
      });

      await provider.revokeToken(
        {
          client_id: otherClient.client_id,
          redirect_uris: ["https://other.example.com/callback"],
        } as OAuthClientInformationFull,
        { token: pair.access.plaintext, token_type_hint: "access_token" },
      );

      // Token belongs to mockClient — it MUST still be valid.
      const stillValid = await provider.verifyAccessToken(pair.access.plaintext);
      expect(stillValid.clientId).toBe(mockClient.client_id);
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

  describe("logging (AC9.6)", () => {
    // Separate capture setup for logging tests — don't pollute the shared fixture.
    let logProvider: MintingOAuthServerProvider;
    let logRecords: ReadonlyArray<Record<string, unknown>>;

    beforeEach(async () => {
      const { log: captureLog, records } = makePinoCapture();
      logRecords = records;

      // Fresh clientStore with silent logger (we're only capturing logProvider's logger)
      const logClientStore = new DiskClientRegistrationStore(cache, "https://mcp.example.com", SILENT_LOG);
      const discovery = makeDiscoveryDoc(oidcStub.issuer);

      logProvider = new MintingOAuthServerProvider(
        logClientStore,
        tokenStore,
        authRequests,
        authCodes,
        pendingAuthorizations,
        discovery,
        {
          discoveryUrl: `${oidcStub.issuer}/.well-known/openid-configuration`,
          publicUrl: "https://mcp.example.com",
          presetName: null,
          clientId: "stub-client-id",
          clientSecret: "stub-client-secret",
          scopes: ["openid", "email"],
          emailVerifiedPolicy: "if-present",
          trustProxy: false,
          allowlist: { emails: ["user@example.com"], subs: [] },
          allowedAlgs: ["RS256"],
          redirectAllowlist: ["https://claude.ai"],
        },
        "https://mcp.example.com",
        captureLog,
      );

      // Register a client for logProvider to use
      const stored = await logClientStore.registerClient({
        client_name: "Log Test Client",
        redirect_uris: ["https://claude.ai/callback"],
      });
      mockClient = {
        client_id: stored.client_id,
        client_name: "Log Test Client",
        redirect_uris: ["https://claude.ai/callback"],
      } as OAuthClientInformationFull;
    });

    it("AC9.6: emits info record on authorization_code grant token mint", async () => {
      const code = "log-test-ac-code";
      authCodes.put(code, makeProviderAuthCode(mockClient));

      const tokens = await logProvider.exchangeAuthorizationCode(
        mockClient,
        code,
        undefined,
        "https://claude.ai/callback",
        new URL("https://mcp.example.com/"),
      );

      const expectedHash = hashTokenForStorage(tokens.access_token);
      expect(logRecords).toContainEqual(
        expect.objectContaining({
          level: 30, // info
          msg: "access token minted (authorization_code grant)",
          tokenHash: expectedHash,
          clientId: mockClient.client_id,
          sub: "user-sub-123",
        }),
      );
    });

    it("AC9.6: emits info record on refresh_token grant token mint", async () => {
      const pair = await tokenStore.issueAccessRefreshPair({
        clientId: mockClient.client_id,
        identity: makeVerifiedIdentity({ email: "user@example.com", sub: "user-sub-123" }),
        scope: "openid email",
        resource: "https://mcp.example.com/",
      });

      const newTokens = await logProvider.exchangeRefreshToken(mockClient, pair.refresh.plaintext);

      const expectedHash = hashTokenForStorage(newTokens.access_token);
      expect(logRecords).toContainEqual(
        expect.objectContaining({
          level: 30, // info
          msg: "access token minted (refresh_token grant)",
          tokenHash: expectedHash,
          clientId: mockClient.client_id,
          sub: "user-sub-123",
        }),
      );
    });

    it("AC9.6: emits info record on token revocation", async () => {
      const pair = await tokenStore.issueAccessRefreshPair({
        clientId: mockClient.client_id,
        identity: makeVerifiedIdentity({ email: "user@example.com", sub: "user-sub-123" }),
        scope: "openid email",
        resource: "https://mcp.example.com/",
      });

      await logProvider.revokeToken(mockClient, {
        token: pair.access.plaintext,
        token_type_hint: "access_token",
      });

      const expectedHash = hashTokenForStorage(pair.access.plaintext);
      expect(logRecords).toContainEqual(
        expect.objectContaining({
          level: 30, // info
          msg: "access token revoked",
          tokenHash: expectedHash,
          clientId: mockClient.client_id,
          sub: "user-sub-123",
        }),
      );
    });

    it("AC9.6: no revocation log on no-op revoke (unknown token)", async () => {
      await logProvider.revokeToken(mockClient, {
        token: "unknown-token-does-not-exist",
        token_type_hint: "access_token",
      });

      // No revocation record should be emitted for a no-op
      const revocationRecords = logRecords.filter((r) => r["msg"] === "access token revoked");
      expect(revocationRecords).toHaveLength(0);
    });
  });
});
