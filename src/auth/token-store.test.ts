/**
 * Tests for TokenStore — access + refresh token lifecycle
 *
 * Verifies:
 * - issueAccessRefreshPair: mint distinct tokens, persist, return plaintexts once
 * - lookupAccessToken: find by hash, return AuthInfo with identity, handle expiry/kind/missing
 * - lookupRefreshToken: find by hash, return OAuthToken, handle expiry/kind/missing
 * - rotateRefresh: exchange old for new pair, invalidate old immediately (AC7.7)
 * - revoke: remove token idempotently
 * - removeAllForClient: cascade delete
 *
 * AC2.10 (phase_05.md:21): resource mismatch → invalid_target
 * AC4.2 (phase_05.md:27): access token persists across restart
 * AC4.3 (phase_05.md:28): refresh token persists + rotation works post-restart
 * AC4.4 (phase_05.md:29): auth stores (request, code) do NOT persist (in-memory only)
 * AC7.7 (phase_05.md:32): old refresh invalidated immediately after successful rotation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiskCache } from "../cache/disk-cache.js";
import { DiskCache as DiskCacheImpl } from "../cache/disk-cache.js";
import type { DiskClientRegistrationStore } from "./client-registration.js";
import { DiskClientRegistrationStore as DiskClientRegistrationStoreImpl } from "./client-registration.js";
import { TokenStore } from "./token-store.js";
import { hashTokenForStorage, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from "./tokens.js";
import type { VerifiedIdentity } from "./types.js";
import { AuthRequestStore } from "./auth-request-store.js";
import { AuthCodeStore } from "./auth-code-store.js";

function makeVerifiedIdentity(overrides?: Partial<VerifiedIdentity>): VerifiedIdentity {
  return {
    email: "user@example.com",
    sub: "sub-123",
    source: "email",
    ...overrides,
  };
}

function makeTokenStoreInput(overrides?: Partial<Parameters<TokenStore["issueAccessRefreshPair"]>[0]>) {
  return {
    clientId: "00000000-0000-0000-0000-000000000001",
    identity: makeVerifiedIdentity(),
    scope: "read write",
    resource: "https://m.example.com",
    ...overrides,
  };
}

function makeWireRegistration(overrides?: Partial<Record<string, unknown>>) {
  return {
    redirect_uris: ["https://client.example.com/callback"],
    ...overrides,
  };
}

describe("TokenStore", () => {
  let tempDir: string;
  let cache: DiskCache;
  let clientStore: DiskClientRegistrationStore;
  let store: TokenStore;
  let now: number;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "paprika-token-store-"));
    cache = new DiskCacheImpl(tempDir);
    await cache.init();
    clientStore = new DiskClientRegistrationStoreImpl(cache, "https://m.example.com");

    now = Math.floor(Date.now() / 1000);
    const nowFn = vi.fn(() => now);

    store = new TokenStore(cache, nowFn);

    // Pre-register a client for tests that need it
    await clientStore.registerClient(makeWireRegistration());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("issueAccessRefreshPair", () => {
    it("mints two distinct tokens, persists both, returns plaintexts only once", async () => {
      const input = makeTokenStoreInput();
      const pair1 = await store.issueAccessRefreshPair(input);

      // Access and refresh should be different
      expect(pair1.access.plaintext).not.toBe(pair1.refresh.plaintext);

      // Both should have prefixes indicating their types
      expect(pair1.access.plaintext).toMatch(/^mcp_at_/);
      expect(pair1.refresh.plaintext).toMatch(/^mcp_rt_/);

      // Both should have expiration times set correctly
      expect(pair1.access.expiresAt).toBe(now + ACCESS_TOKEN_TTL_SECONDS);
      expect(pair1.refresh.expiresAt).toBe(now + REFRESH_TOKEN_TTL_SECONDS);

      // Hashes should retrieve the stored tokens
      const accessHash = hashTokenForStorage(pair1.access.plaintext);
      const refreshHash = hashTokenForStorage(pair1.refresh.plaintext);

      const stored1 = await cache.getOAuthToken(accessHash);
      const stored2 = await cache.getOAuthToken(refreshHash);

      expect(stored1).not.toBeNull();
      expect(stored2).not.toBeNull();
      expect(stored1?.kind).toBe("access");
      expect(stored2?.kind).toBe("refresh");
    });
  });

  describe("lookupAccessToken", () => {
    it("returns AuthInfo with identity in extra", async () => {
      const input = makeTokenStoreInput({
        identity: { email: "alice@example.com", sub: "alice-sub", source: "email" as const },
      });
      const { access } = await store.issueAccessRefreshPair(input);

      const result = await store.lookupAccessToken(access.plaintext);

      expect(result).not.toBeNull();
      expect(result?.token).toBe(access.plaintext);
      expect(result?.clientId).toBe(input.clientId);
      expect(result?.scopes).toEqual(["read", "write"]);
      expect(result?.expiresAt).toBe(now + ACCESS_TOKEN_TTL_SECONDS);
      expect(result?.extra?.email).toBe("alice@example.com");
      expect(result?.extra?.sub).toBe("alice-sub");
      expect(result?.extra?.source).toBe("email");
    });

    it("returns AuthInfo with resource as URL when present", async () => {
      const input = makeTokenStoreInput({ resource: "https://api.example.com" });
      const { access } = await store.issueAccessRefreshPair(input);

      const result = await store.lookupAccessToken(access.plaintext);

      expect(result?.resource).not.toBeUndefined();
      expect(result?.resource?.toString()).toBe("https://api.example.com/");
    });

    it("omits resource from AuthInfo when resource is empty string", async () => {
      const input = makeTokenStoreInput({ resource: "" });
      const { access } = await store.issueAccessRefreshPair(input);

      const result = await store.lookupAccessToken(access.plaintext);

      expect(result?.resource).toBeUndefined();
    });

    it("expired token returns null", async () => {
      const input = makeTokenStoreInput();
      const { access } = await store.issueAccessRefreshPair(input);

      // Advance time past expiration
      now = now + ACCESS_TOKEN_TTL_SECONDS + 1;

      const result = await store.lookupAccessToken(access.plaintext);
      expect(result).toBeNull();
    });

    it("unknown token returns null", async () => {
      const result = await store.lookupAccessToken("mcp_at_doesnotexist");
      expect(result).toBeNull();
    });

    it("refresh-token kind returns null when queried as access", async () => {
      const input = makeTokenStoreInput();
      const { refresh } = await store.issueAccessRefreshPair(input);

      const result = await store.lookupAccessToken(refresh.plaintext);
      expect(result).toBeNull();
    });

    it("handles scopes with leading/trailing spaces and empty entries", async () => {
      const input = makeTokenStoreInput({ scope: "read  write  " });
      const { access } = await store.issueAccessRefreshPair(input);

      const result = await store.lookupAccessToken(access.plaintext);
      // split and filter should remove empty strings
      expect(result?.scopes).toEqual(["read", "write"]);
    });
  });

  describe("lookupRefreshToken", () => {
    it("returns OAuthToken when found", async () => {
      const input = makeTokenStoreInput();
      const { refresh } = await store.issueAccessRefreshPair(input);

      const result = await store.lookupRefreshToken(refresh.plaintext);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe("refresh");
      expect(result?.clientId).toBe(input.clientId);
      expect(result?.scope).toBe("read write");
    });

    it("expired refresh token returns null", async () => {
      const input = makeTokenStoreInput();
      const { refresh } = await store.issueAccessRefreshPair(input);

      now = now + REFRESH_TOKEN_TTL_SECONDS + 1;

      const result = await store.lookupRefreshToken(refresh.plaintext);
      expect(result).toBeNull();
    });

    it("unknown token returns null", async () => {
      const result = await store.lookupRefreshToken("mcp_rt_doesnotexist");
      expect(result).toBeNull();
    });

    it("access-token kind returns null when queried as refresh", async () => {
      const input = makeTokenStoreInput();
      const { access } = await store.issueAccessRefreshPair(input);

      const result = await store.lookupRefreshToken(access.plaintext);
      expect(result).toBeNull();
    });
  });

  describe("rotateRefresh", () => {
    it("returns new pair; old refresh is invalidated immediately (AC7.7)", async () => {
      const input = makeTokenStoreInput();
      const { refresh: r1 } = await store.issueAccessRefreshPair(input);

      const result = await store.rotateRefresh(r1.plaintext);

      result.match(
        (pair) => {
          // new pair works
          expect(pair.refresh.plaintext).not.toBe(r1.plaintext);
          expect(pair.access.plaintext).toMatch(/^mcp_at_/);
          expect(pair.refresh.plaintext).toMatch(/^mcp_rt_/);
        },
        () => expect.fail("expected ok"),
      );

      // PLAN says (phase_05.md:32): old refresh now invalid
      const second = await store.rotateRefresh(r1.plaintext);
      const errorCode = second.match(
        () => null,
        (e) => e.errorCode,
      );
      expect(errorCode).toBe("invalid_grant");
    });

    it("AC2.10: rotateRefresh with mismatched resource → invalid_target", async () => {
      const input = makeTokenStoreInput({ resource: "https://m.example.com" });
      const { refresh } = await store.issueAccessRefreshPair(input);

      // PLAN says (phase_05.md:21): requested resource does not match → invalid_target
      const result = await store.rotateRefresh(refresh.plaintext, undefined, "https://other.example.com");

      const errorCode = result.match(
        () => null,
        (e) => e.errorCode,
      );
      expect(errorCode).toBe("invalid_target");
    });

    it("AC2.10: rotateRefresh with matching resource succeeds", async () => {
      const input = makeTokenStoreInput({ resource: "https://m.example.com" });
      const { refresh } = await store.issueAccessRefreshPair(input);

      const result = await store.rotateRefresh(refresh.plaintext, undefined, "https://m.example.com");

      result.match(
        (pair) => {
          expect(pair.refresh.plaintext).not.toBe(refresh.plaintext);
        },
        () => expect.fail("expected ok"),
      );
    });

    it("scope widening → invalid_scope", async () => {
      const input = makeTokenStoreInput({ scope: "read" });
      const { refresh } = await store.issueAccessRefreshPair(input);

      const result = await store.rotateRefresh(refresh.plaintext, ["read", "write"]);

      const errorCode = result.match(
        () => null,
        (e) => e.errorCode,
      );
      expect(errorCode).toBe("invalid_scope");
    });

    it("scope narrowing succeeds; new tokens have narrowed scope", async () => {
      const input = makeTokenStoreInput({ scope: "read write delete" });
      const { refresh, access: a1 } = await store.issueAccessRefreshPair(input);

      const result = await store.rotateRefresh(refresh.plaintext, ["read", "write"]);

      result.match(
        (pair) => {
          expect(pair.access.plaintext).not.toBe(a1.plaintext);
          expect(pair.refresh.plaintext).not.toBe(refresh.plaintext);
        },
        () => expect.fail("expected ok"),
      );

      // Verify the new tokens have the narrowed scope
      const newAccessInfo = await store.lookupAccessToken(
        result.match(
          (p) => p.access.plaintext,
          () => null,
        )!,
      );
      expect(newAccessInfo?.scopes).toEqual(["read", "write"]);
    });

    it("links new refresh to old via rotatedFromHash", async () => {
      const input = makeTokenStoreInput();
      const { refresh: r1 } = await store.issueAccessRefreshPair(input);

      const result = await store.rotateRefresh(r1.plaintext);

      const r2Plaintext = result.match(
        (p) => p.refresh.plaintext,
        () => null,
      )!;
      const r2Hash = hashTokenForStorage(r2Plaintext);
      const r2Record = await cache.getOAuthToken(r2Hash);

      expect(r2Record?.rotatedFromHash).toBe(hashTokenForStorage(r1.plaintext));
    });

    it("returns invalid_grant when refresh token is missing/invalid", async () => {
      const result = await store.rotateRefresh("mcp_rt_doesnotexist");

      const errorCode = result.match(
        () => null,
        (e) => e.errorCode,
      );
      expect(errorCode).toBe("invalid_grant");
    });
  });

  describe("revoke", () => {
    it("removes token; subsequent lookup returns null", async () => {
      const input = makeTokenStoreInput();
      const { access } = await store.issueAccessRefreshPair(input);

      await store.revoke(access.plaintext);

      const result = await store.lookupAccessToken(access.plaintext);
      expect(result).toBeNull();
    });

    it("idempotent — second call on revoked token doesn't throw", async () => {
      const input = makeTokenStoreInput();
      const { access } = await store.issueAccessRefreshPair(input);

      await store.revoke(access.plaintext);
      // Should not throw
      await store.revoke(access.plaintext);

      expect(true).toBe(true);
    });
  });

  describe("removeAllForClient", () => {
    it("removes all tokens with matching clientId; leaves other clients' tokens intact", async () => {
      const client1 = "00000000-0000-0000-0000-000000000001";
      const client2 = "00000000-0000-0000-0000-000000000002";

      const input1 = makeTokenStoreInput({ clientId: client1 });
      const input2 = makeTokenStoreInput({ clientId: client2 });

      const pair1 = await store.issueAccessRefreshPair(input1);
      const pair2 = await store.issueAccessRefreshPair(input2);

      await store.removeAllForClient(client1);

      // Client1 tokens should be gone
      expect(await store.lookupAccessToken(pair1.access.plaintext)).toBeNull();
      expect(await store.lookupRefreshToken(pair1.refresh.plaintext)).toBeNull();

      // Client2 tokens should remain
      expect(await store.lookupAccessToken(pair2.access.plaintext)).not.toBeNull();
      expect(await store.lookupRefreshToken(pair2.refresh.plaintext)).not.toBeNull();
    });
  });

  describe("AC4.2: access token persists across DiskCache restart", () => {
    it("access token persists across restart", async () => {
      const input = makeTokenStoreInput();
      const { access } = await store.issueAccessRefreshPair(input);

      // Simulate restart with fresh DiskCache and TokenStore on the same directory
      const cache2 = new DiskCacheImpl(tempDir);
      await cache2.init();
      const store2 = new TokenStore(cache2);

      // PLAN says (phase_05.md:27): token should persist and lookup should work
      const result = await store2.lookupAccessToken(access.plaintext);
      expect(result).not.toBeNull();
      expect(result?.clientId).toBe(input.clientId);
    });
  });

  describe("AC4.3: refresh token persists across restart; rotation works", () => {
    it("refresh token persists across restart; rotation works post-restart", async () => {
      const input = makeTokenStoreInput();
      const { refresh: r1 } = await store.issueAccessRefreshPair(input);

      // Simulate restart with fresh DiskCache and TokenStore on the same directory
      const cache2 = new DiskCacheImpl(tempDir);
      await cache2.init();
      const store2 = new TokenStore(cache2);

      // PLAN says (phase_05.md:28): refresh token should persist
      const found = await store2.lookupRefreshToken(r1.plaintext);
      expect(found).not.toBeNull();

      // Rotation should work post-restart
      const result = await store2.rotateRefresh(r1.plaintext);
      result.match(
        (pair) => {
          expect(pair.refresh.plaintext).not.toBe(r1.plaintext);
        },
        () => expect.fail("expected ok"),
      );
    });
  });

  describe("AC4.4: auth stores do NOT persist (in-memory only)", () => {
    it("auth-request-store entries do NOT persist (new instance is empty)", () => {
      const store1 = new AuthRequestStore();
      store1.put("state-1", {
        clientId: "00000000-0000-0000-0000-000000000001",
        codeChallenge: "challenge-1",
        codeChallengeMethod: "S256" as const,
        redirectUri: "https://example.com/callback",
        resource: "https://m.example.com",
        claudeState: "claude-state-1",
        scope: "read",
        ourNonce: "nonce-1",
        createdAt: now,
      });

      const store2 = new AuthRequestStore();
      // PLAN says (phase_05.md:29): entries should NOT persist
      expect(store2.consume("state-1")).toBeNull();
    });

    it("auth-code-store entries do NOT persist", () => {
      const store1 = new AuthCodeStore();
      store1.put("code-1", {
        clientId: "00000000-0000-0000-0000-000000000001",
        codeChallenge: "challenge-1",
        codeChallengeMethod: "S256" as const,
        redirectUri: "https://example.com/callback",
        resource: "https://m.example.com",
        scope: "read",
        identity: makeVerifiedIdentity(),
        createdAt: now,
      });

      const store2 = new AuthCodeStore();
      // PLAN says (phase_05.md:29): entries should NOT persist
      expect(store2.consume("code-1")).toBeNull();
    });
  });
});
