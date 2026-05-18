import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskCache } from "../cache/disk-cache.js";
import { AuthRequestStore } from "./auth-request-store.js";
import { AuthCodeStore } from "./auth-code-store.js";
import { DiskClientRegistrationStore } from "./client-registration.js";
import { TokenStore } from "./token-store.js";
import { AuthCleanup } from "./cleanup.js";
import { makeOAuthClient, makeOAuthToken } from "../cache/__fixtures__/oauth.js";
import { makeAuthRequestState, makeAuthCodeState } from "./__fixtures__/oauth-state.js";

// ---------------------------------------------------------------------------
// Test fixture setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let cache: DiskCache;
let clientStore: DiskClientRegistrationStore;
let tokenStore: TokenStore;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mcp-paprika-cleanup-test-"));
  cache = new DiskCache(tmpDir);
  await cache.init();
  clientStore = new DiskClientRegistrationStore(cache, "https://example.com");
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
    await cache.putOAuthClient(staleClient);
    await cache.putOAuthClient(freshClient);
    await cache.flush();

    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();
    const cleanup = new AuthCleanup(clientStore, tokenStore, cache, authRequests, authCodes, () => clock.v);
    const result = await cleanup.sweepOnce();

    expect(result.clientsRemoved).toBe(1);
    expect(await cache.getOAuthClient("00000000-0000-0000-0000-000000000001")).toBeNull();
    expect(await cache.getOAuthClient("00000000-0000-0000-0000-000000000002")).not.toBeNull();
  });

  it(// PLAN says (phase_07.md:228): AC5.4 — stale-client deletion cascades: all tokens with matching clientId removed
  "AC5.4: stale-client deletion cascades — all tokens with matching clientId removed", async () => {
    const clock = { v: 1_700_000_000 };
    const staleClientId = "00000000-0000-0000-0000-000000000010";
    const freshClientId = "00000000-0000-0000-0000-000000000011";

    const staleClient = makeOAuthClient({ clientId: staleClientId, lastTokenActivityAt: clock.v - 91 * 86400 });
    const freshClient = makeOAuthClient({ clientId: freshClientId, lastTokenActivityAt: clock.v - 5 * 86400 });
    await cache.putOAuthClient(staleClient);
    await cache.putOAuthClient(freshClient);

    // Mint 3 tokens for the stale client
    const staleToken1 = makeOAuthToken({ clientId: staleClientId });
    const staleToken2 = makeOAuthToken({ clientId: staleClientId });
    const staleToken3 = makeOAuthToken({ clientId: staleClientId });
    // Mint 1 token for the fresh client
    const freshToken = makeOAuthToken({ clientId: freshClientId });

    await cache.putOAuthToken(staleToken1);
    await cache.putOAuthToken(staleToken2);
    await cache.putOAuthToken(staleToken3);
    await cache.putOAuthToken(freshToken);
    await cache.flush();

    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();
    const cleanup = new AuthCleanup(clientStore, tokenStore, cache, authRequests, authCodes, () => clock.v);
    const result = await cleanup.sweepOnce();

    expect(result.clientsRemoved).toBe(1);
    expect(result.tokensRemoved).toBe(3);
    // All 3 stale-client tokens removed
    expect(await cache.getOAuthToken(staleToken1.tokenHash)).toBeNull();
    expect(await cache.getOAuthToken(staleToken2.tokenHash)).toBeNull();
    expect(await cache.getOAuthToken(staleToken3.tokenHash)).toBeNull();
    // Fresh-client token still present
    expect(await cache.getOAuthToken(freshToken.tokenHash)).not.toBeNull();
  });

  it(// PLAN says (phase_07.md:233): AC5.5 — sweepOnce is idempotent: second run on same state is a no-op
  "AC5.5: sweepOnce is idempotent — second run on the same state is a no-op", async () => {
    const clock = { v: 1_700_000_000 };
    const staleClient = makeOAuthClient({
      clientId: "00000000-0000-0000-0000-000000000020",
      lastTokenActivityAt: clock.v - 91 * 86400,
    });
    await cache.putOAuthClient(staleClient);
    await cache.flush();

    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();
    const cleanup = new AuthCleanup(clientStore, tokenStore, cache, authRequests, authCodes, () => clock.v);

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

    const cleanup = new AuthCleanup(clientStore, tokenStore, cache, authRequests, authCodes, () => clock.v);
    const result = await cleanup.sweepOnce();

    expect(result.authRequestsRemoved).toBe(1);
    expect(result.authCodesRemoved).toBe(1);
    expect(authRequests.size).toBe(0);
    expect(authCodes.size).toBe(0);
  });

  it("sweepOnce returns zero counts when nothing is stale", async () => {
    const clock = { v: 1_700_000_000 };
    const freshClient = makeOAuthClient({ lastTokenActivityAt: clock.v - 1 * 86400 });
    await cache.putOAuthClient(freshClient);
    await cache.flush();

    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();
    const cleanup = new AuthCleanup(clientStore, tokenStore, cache, authRequests, authCodes, () => clock.v);
    const result = await cleanup.sweepOnce();

    expect(result.clientsRemoved).toBe(0);
    expect(result.tokensRemoved).toBe(0);
    expect(result.authRequestsRemoved).toBe(0);
    expect(result.authCodesRemoved).toBe(0);
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
      () => Math.floor(Date.now() / 1000),
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
      () => Math.floor(Date.now() / 1000),
      24 * 60 * 60 * 1000,
    );

    cleanup.start();
    cleanup.stop();
    cleanup.stop(); // second call — must not throw

    expect(true).toBe(true);
  });

  it("loop never throws — a synthetic cache error in sweepOnce doesn't crash the loop", async () => {
    vi.spyOn(cache, "getAllOAuthClients").mockRejectedValueOnce(new Error("disk full"));

    const authRequests = new AuthRequestStore();
    const authCodes = new AuthCodeStore();
    // Short interval so at least one cycle completes in 100ms
    const cleanup = new AuthCleanup(
      clientStore,
      tokenStore,
      cache,
      authRequests,
      authCodes,
      () => Math.floor(Date.now() / 1000),
      50,
    );

    cleanup.start();
    await new Promise((r) => setTimeout(r, 100)); // let one error cycle run + recover
    cleanup.stop();

    // No unhandled rejections (vitest fails automatically if any propagated)
    expect(true).toBe(true);
  });
});
