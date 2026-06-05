import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeAuthCodeState, makeAuthRequestState } from "../../test/auth/__fixtures__/oauth-state.js";
import { makeOAuthClient, makeOAuthToken } from "../../test/auth/__fixtures__/oauth.js";
import { SILENT_LOG } from "../utils/log.js";
import { AuthCodeStore } from "./auth-code-store.js";
import { AuthRequestStore } from "./auth-request-store.js";
import { AuthCleanup } from "./cleanup.js";
import { DiskClientRegistrationStore } from "./client-registration.js";
import { type AuthCache, buildAuthCaches } from "./disk.js";
import { PendingAuthorizationStore } from "./pending-authorization-store.js";
import { TokenStore } from "./token-store.js";
import { nowSeconds } from "./tokens.js";

// ---------------------------------------------------------------------------
// Test fixture setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let cache: AuthCache;
let clientStore: DiskClientRegistrationStore;
let tokenStore: TokenStore;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mcp-paprika-cleanup-test-"));
  cache = await buildAuthCaches(tmpDir);
  clientStore = new DiskClientRegistrationStore(cache, "https://example.com", SILENT_LOG);
  tokenStore = new TokenStore(cache);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// AC5.3: stale-client sweep
// ---------------------------------------------------------------------------

describe("sweepOnce", () => {
  it(// PLAN says (phase_07.md:210): AC5.3 — sweepOnce removes client with lastTokenActivityAt older than 90 days
  "AC5.3: sweepOnce removes a client with lastTokenActivityAt older than 90 days", async () => {
    const clock = { v: 1_700_000_000 };
    const staleClient = makeOAuthClient({
      clientId: "00000000-0000-0000-0000-000000000001",
      lastTokenActivityAt: clock.v - 91 * 86400,
    });
    const freshClient = makeOAuthClient({
      clientId: "00000000-0000-0000-0000-000000000002",
      lastTokenActivityAt: clock.v - 10 * 86400,
    });
    await cache.oauthClients.put(staleClient);
    await cache.oauthClients.put(freshClient);
    await cache.flush();

    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();
    const cleanup = new AuthCleanup(
      clientStore,
      tokenStore,
      cache,
      authRequests,
      authCodes,
      new PendingAuthorizationStore(),
      SILENT_LOG,
      () => clock.v,
    );
    const result = await cleanup.sweepOnce();

    expect(result.clientsRemoved).toBe(1);
    expect(await cache.oauthClients.get("00000000-0000-0000-0000-000000000001")).toBeNull();
    expect(await cache.oauthClients.get("00000000-0000-0000-0000-000000000002")).not.toBeNull();
  });

  it(// PLAN says (phase_07.md:228): AC5.4 — stale-client deletion cascades: all tokens with matching clientId removed
  "AC5.4: stale-client deletion cascades — all tokens with matching clientId removed", async () => {
    const clock = { v: 1_700_000_000 };
    const staleClientId = "00000000-0000-0000-0000-000000000010";
    const freshClientId = "00000000-0000-0000-0000-000000000011";

    const staleClient = makeOAuthClient({ clientId: staleClientId, lastTokenActivityAt: clock.v - 91 * 86400 });
    const freshClient = makeOAuthClient({ clientId: freshClientId, lastTokenActivityAt: clock.v - 5 * 86400 });
    await cache.oauthClients.put(staleClient);
    await cache.oauthClients.put(freshClient);

    // Mint 3 tokens for the stale client
    const staleToken1 = makeOAuthToken({ clientId: staleClientId });
    const staleToken2 = makeOAuthToken({ clientId: staleClientId });
    const staleToken3 = makeOAuthToken({ clientId: staleClientId });
    // Mint 1 token for the fresh client
    const freshToken = makeOAuthToken({ clientId: freshClientId });

    await cache.oauthTokens.put(staleToken1);
    await cache.oauthTokens.put(staleToken2);
    await cache.oauthTokens.put(staleToken3);
    await cache.oauthTokens.put(freshToken);
    await cache.flush();

    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();
    const cleanup = new AuthCleanup(
      clientStore,
      tokenStore,
      cache,
      authRequests,
      authCodes,
      new PendingAuthorizationStore(),
      SILENT_LOG,
      () => clock.v,
    );
    const result = await cleanup.sweepOnce();

    expect(result.clientsRemoved).toBe(1);
    expect(result.tokensRemoved).toBe(3);
    // All 3 stale-client tokens removed
    expect(await cache.oauthTokens.get(staleToken1.tokenHash)).toBeNull();
    expect(await cache.oauthTokens.get(staleToken2.tokenHash)).toBeNull();
    expect(await cache.oauthTokens.get(staleToken3.tokenHash)).toBeNull();
    // Fresh-client token still present
    expect(await cache.oauthTokens.get(freshToken.tokenHash)).not.toBeNull();
  });

  it(// PLAN says (phase_07.md:233): AC5.5 — sweepOnce is idempotent: second run on same state is a no-op
  "AC5.5: sweepOnce is idempotent — second run on the same state is a no-op", async () => {
    const clock = { v: 1_700_000_000 };
    const staleClient = makeOAuthClient({
      clientId: "00000000-0000-0000-0000-000000000020",
      lastTokenActivityAt: clock.v - 91 * 86400,
    });
    await cache.oauthClients.put(staleClient);
    await cache.flush();

    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();
    const cleanup = new AuthCleanup(
      clientStore,
      tokenStore,
      cache,
      authRequests,
      authCodes,
      new PendingAuthorizationStore(),
      SILENT_LOG,
      () => clock.v,
    );

    const first = await cleanup.sweepOnce();
    expect(first.clientsRemoved).toBe(1);

    const second = await cleanup.sweepOnce();
    expect(second.clientsRemoved).toBe(0);
    expect(second.tokensRemoved).toBe(0);
  });

  it("sweepOnce evicts expired in-memory auth-request and auth-code entries", async () => {
    const clock = { v: 1_700_000_000 };
    // Clock injects milliseconds into AuthRequestStore/AuthCodeStore
    const authRequests = new AuthRequestStore({ now: () => clock.v * 1000 });
    const authCodes = new AuthCodeStore({ now: () => clock.v * 1000 });

    // Insert entries with createdAt well in the past (expired)
    authRequests.put("state-1", makeAuthRequestState({ createdAt: clock.v - 10 * 60 })); // > 5min old
    authCodes.put("code-1", makeAuthCodeState({ createdAt: clock.v - 120 })); // > 60s old

    const cleanup = new AuthCleanup(
      clientStore,
      tokenStore,
      cache,
      authRequests,
      authCodes,
      new PendingAuthorizationStore(),
      SILENT_LOG,
      () => clock.v,
    );
    const result = await cleanup.sweepOnce();

    expect(result.authRequestsRemoved).toBe(1);
    expect(result.authCodesRemoved).toBe(1);
    expect(authRequests.size).toBe(0);
    expect(authCodes.size).toBe(0);
  });

  it("sweepOnce returns zero counts when nothing is stale", async () => {
    const clock = { v: 1_700_000_000 };
    const freshClient = makeOAuthClient({ lastTokenActivityAt: clock.v - 1 * 86400 });
    await cache.oauthClients.put(freshClient);
    await cache.flush();

    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();
    const cleanup = new AuthCleanup(
      clientStore,
      tokenStore,
      cache,
      authRequests,
      authCodes,
      new PendingAuthorizationStore(),
      SILENT_LOG,
      () => clock.v,
    );
    const result = await cleanup.sweepOnce();

    expect(result.clientsRemoved).toBe(0);
    expect(result.tokensRemoved).toBe(0);
    expect(result.expiredTokensRemoved).toBe(0);
    expect(result.authRequestsRemoved).toBe(0);
    expect(result.authCodesRemoved).toBe(0);
  });

  it("sweepOnce evicts expired OAuth tokens whose owning client is still active", async () => {
    // `rotateRefresh` deletes the prior refresh token but not the prior access
    // token, so an active session leaves one expired access record on disk per
    // refresh. The stale-client cascade only fires after 90 days of inactivity,
    // which means an actively-refreshing client accumulates expired access
    // tokens indefinitely between cascade ticks. This sweep is the bounding
    // mechanism.
    const clock = { v: 1_700_000_000 };
    const activeClientId = "00000000-0000-0000-0000-000000000030";
    await cache.oauthClients.put(makeOAuthClient({ clientId: activeClientId, lastTokenActivityAt: clock.v - 86400 }));

    // Expired access token belonging to the active client — should be removed.
    const expiredAccess = makeOAuthToken({
      clientId: activeClientId,
      kind: "access",
      expiresAt: clock.v - 60, // expired 60s ago
    });
    // Live access token, also active client — must be preserved.
    const liveAccess = makeOAuthToken({
      clientId: activeClientId,
      kind: "access",
      expiresAt: clock.v + 3600,
    });
    // Live refresh token — must be preserved.
    const liveRefresh = makeOAuthToken({
      clientId: activeClientId,
      kind: "refresh",
      expiresAt: clock.v + 30 * 86400,
    });
    await cache.oauthTokens.put(expiredAccess);
    await cache.oauthTokens.put(liveAccess);
    await cache.oauthTokens.put(liveRefresh);
    await cache.flush();

    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();
    const cleanup = new AuthCleanup(
      clientStore,
      tokenStore,
      cache,
      authRequests,
      authCodes,
      new PendingAuthorizationStore(),
      SILENT_LOG,
      () => clock.v,
    );
    const result = await cleanup.sweepOnce();

    expect(result.expiredTokensRemoved).toBe(1);
    expect(result.clientsRemoved).toBe(0); // client wasn't stale
    expect(await cache.oauthTokens.get(expiredAccess.tokenHash)).toBeNull();
    expect(await cache.oauthTokens.get(liveAccess.tokenHash)).not.toBeNull();
    expect(await cache.oauthTokens.get(liveRefresh.tokenHash)).not.toBeNull();
  });

  it("sweeps expired pending-authorization (consent) entries (#147)", async () => {
    const clock = { v: 1_700_000_000 };
    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();
    // 10-min TTL store on the same injected clock.
    const pending = new PendingAuthorizationStore({ ttlMs: 600_000, now: () => clock.v * 1000 });
    pending.put("stale-ticket", {
      clientId: "00000000-0000-0000-0000-000000000050",
      codeChallenge: "c",
      codeChallengeMethod: "S256",
      redirectUri: "https://paprika-sync.app/cb",
      resource: "",
      claudeState: "s",
      scope: "openid",
      createdAt: clock.v - 1000, // created well over 10 min ago
    });

    const cleanup = new AuthCleanup(
      clientStore,
      tokenStore,
      cache,
      authRequests,
      authCodes,
      pending,
      SILENT_LOG,
      () => clock.v,
    );
    const result = await cleanup.sweepOnce();

    expect(result.pendingAuthorizationsRemoved).toBe(1);
    expect(pending.size).toBe(0);
  });

  it("expired tokens belonging to a stale client are counted in the cascade, not double-counted", async () => {
    // The cascade in step (1) removes ALL tokens for the stale client.
    // Without the partition, the orphan sweep in step (3) would also try to
    // remove the same already-deleted token and either double-count or
    // duplicate the disk op. Assert tokensRemoved (cascade) covers it and
    // expiredTokensRemoved (orphan sweep) does not.
    const clock = { v: 1_700_000_000 };
    const staleClientId = "00000000-0000-0000-0000-000000000040";
    await cache.oauthClients.put(
      makeOAuthClient({ clientId: staleClientId, lastTokenActivityAt: clock.v - 91 * 86400 }),
    );
    const expiredTokenForStaleClient = makeOAuthToken({
      clientId: staleClientId,
      expiresAt: clock.v - 60,
    });
    await cache.oauthTokens.put(expiredTokenForStaleClient);
    await cache.flush();

    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();
    const cleanup = new AuthCleanup(
      clientStore,
      tokenStore,
      cache,
      authRequests,
      authCodes,
      new PendingAuthorizationStore(),
      SILENT_LOG,
      () => clock.v,
    );
    const result = await cleanup.sweepOnce();

    expect(result.clientsRemoved).toBe(1);
    expect(result.tokensRemoved).toBe(1);
    expect(result.expiredTokensRemoved).toBe(0); // not double-counted
  });
});

// ---------------------------------------------------------------------------
// Lifecycle: start/stop idempotency
// ---------------------------------------------------------------------------

describe("lifecycle", () => {
  it("start() is idempotent — second start() is a no-op", async () => {
    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();
    // Use a very long interval so the loop doesn't actually trigger
    const cleanup = new AuthCleanup(
      clientStore,
      tokenStore,
      cache,
      authRequests,
      authCodes,
      new PendingAuthorizationStore(),
      SILENT_LOG,
      () => nowSeconds(),
      24 * 60 * 60 * 1000,
    );

    cleanup.start();
    cleanup.start(); // second call — must not throw or create a second loop

    cleanup.stop();
    // If we get here without hanging or throwing, idempotency holds
    expect(true).toBe(true);
  });

  it("stop() is idempotent — second stop() is a no-op", async () => {
    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();
    const cleanup = new AuthCleanup(
      clientStore,
      tokenStore,
      cache,
      authRequests,
      authCodes,
      new PendingAuthorizationStore(),
      SILENT_LOG,
      () => nowSeconds(),
      24 * 60 * 60 * 1000,
    );

    cleanup.start();
    cleanup.stop();
    cleanup.stop(); // second call — must not throw

    expect(true).toBe(true);
  });

  it("loop never throws — a synthetic cache error in sweepOnce doesn't crash the loop", async () => {
    vi.spyOn(cache.oauthClients, "getAll").mockRejectedValueOnce(new Error("disk full"));

    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();
    // Short interval so at least one cycle completes in 100ms
    const cleanup = new AuthCleanup(
      clientStore,
      tokenStore,
      cache,
      authRequests,
      authCodes,
      new PendingAuthorizationStore(),
      SILENT_LOG,
      () => nowSeconds(),
      50,
    );

    cleanup.start();
    await new Promise((r) => setTimeout(r, 100)); // let one error cycle run + recover
    cleanup.stop();

    // No unhandled rejections (vitest fails automatically if any propagated)
    expect(true).toBe(true);
  });
});
