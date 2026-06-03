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

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiskCacheRoot as DiskCache } from "../cache/disk-cache-root.js";
import type { DiskClientRegistrationStore } from "./client-registration.js";

import { makeVerifiedIdentity } from "../../test/auth/__fixtures__/oauth-state.js";
import { DiskCacheRoot as DiskCacheImpl } from "../cache/disk-cache-root.js";
import { SILENT_LOG } from "../utils/log.js";
import { AuthCodeStore } from "./auth-code-store.js";
import { AuthRequestStore } from "./auth-request-store.js";
import { DiskClientRegistrationStore as DiskClientRegistrationStoreImpl } from "./client-registration.js";
import { TokenStore } from "./token-store.js";
import { ACCESS_TOKEN_TTL_SECONDS, hashTokenForStorage, nowSeconds, REFRESH_TOKEN_TTL_SECONDS } from "./tokens.js";

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
    clientStore = new DiskClientRegistrationStoreImpl(cache, "https://m.example.com", SILENT_LOG);

    now = nowSeconds();
    const nowFn = vi.fn(() => now);

    store = new TokenStore(cache, nowFn);

    // Pre-register a client for tests that need it
    await clientStore.registerClient(makeWireRegistration());
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await rm(tempDir, { recursive: true, force: true });
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

      const stored1 = await cache.oauthTokens.get(accessHash);
      const stored2 = await cache.oauthTokens.get(refreshHash);

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
      expect(result?.extra?.["email"]).toBe("alice@example.com");
      expect(result?.extra?.["sub"]).toBe("alice-sub");
      expect(result?.extra?.["source"]).toBe("email");
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

      const result = await store.rotateRefresh(r1.plaintext, input.clientId);

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
      const second = await store.rotateRefresh(r1.plaintext, input.clientId);
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
      const result = await store.rotateRefresh(
        refresh.plaintext,
        input.clientId,
        undefined,
        "https://other.example.com",
      );

      const errorCode = result.match(
        () => null,
        (e) => e.errorCode,
      );
      expect(errorCode).toBe("invalid_target");
    });

    it("AC2.10: rotateRefresh with matching resource succeeds", async () => {
      const input = makeTokenStoreInput({ resource: "https://m.example.com" });
      const { refresh } = await store.issueAccessRefreshPair(input);

      const result = await store.rotateRefresh(refresh.plaintext, input.clientId, undefined, "https://m.example.com");

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

      const result = await store.rotateRefresh(refresh.plaintext, input.clientId, ["read", "write"]);

      const errorCode = result.match(
        () => null,
        (e) => e.errorCode,
      );
      expect(errorCode).toBe("invalid_scope");
    });

    it("scope narrowing succeeds; new tokens have narrowed scope", async () => {
      const input = makeTokenStoreInput({ scope: "read write delete" });
      const { refresh, access: a1 } = await store.issueAccessRefreshPair(input);

      const result = await store.rotateRefresh(refresh.plaintext, input.clientId, ["read", "write"]);

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

      const result = await store.rotateRefresh(r1.plaintext, input.clientId);

      const r2Plaintext = result.match(
        (p) => p.refresh.plaintext,
        () => null,
      )!;
      const r2Hash = hashTokenForStorage(r2Plaintext);
      const r2Record = await cache.oauthTokens.get(r2Hash);

      expect(r2Record?.rotatedFromHash).toBe(hashTokenForStorage(r1.plaintext));
    });

    it("returns invalid_grant when refresh token is missing/invalid", async () => {
      const result = await store.rotateRefresh("mcp_rt_doesnotexist", "00000000-0000-0000-0000-000000000001");

      const errorCode = result.match(
        () => null,
        (e) => e.errorCode,
      );
      expect(errorCode).toBe("invalid_grant");
    });

    it("cross-client refresh: requesting client ≠ stored clientId → invalid_grant (no rotation)", async () => {
      // A registered client must not be able to rotate another client's refresh
      // token — the stored token's clientId must match the requesting client.
      const ownerInput = makeTokenStoreInput({ clientId: "00000000-0000-0000-0000-000000000001" });
      const { refresh } = await store.issueAccessRefreshPair(ownerInput);

      const result = await store.rotateRefresh(refresh.plaintext, "00000000-0000-0000-0000-000000000002");

      const errorCode = result.match(
        () => null,
        (e) => e.errorCode,
      );
      expect(errorCode).toBe("invalid_grant");

      // The original refresh token MUST still be valid (no rotation happened).
      const stillValid = await store.lookupRefreshToken(refresh.plaintext);
      expect(stillValid).not.toBeNull();
    });

    it("concurrent rotation with same refresh token: exactly one succeeds (TOCTOU)", async () => {
      // Two simultaneous rotateRefresh calls with the same plaintext race the
      // lookup-then-remove window in TokenStore. Without serialization both
      // would see the token as valid and both would mint a new pair, enabling
      // refresh-token replay.
      const input = makeTokenStoreInput();
      const { refresh } = await store.issueAccessRefreshPair(input);

      const [a, b] = await Promise.all([
        store.rotateRefresh(refresh.plaintext, input.clientId),
        store.rotateRefresh(refresh.plaintext, input.clientId),
      ]);

      const labels = [a, b]
        .map((r) =>
          r.match<"ok" | "err">(
            () => "ok",
            () => "err",
          ),
        )
        .sort();
      expect(labels).toEqual(["err", "ok"]);
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

    it("concurrent revoke + rotateRefresh on same refresh token: no double-spend", async () => {
      // Without revoke acquiring the rotation mutex, the sequence
      //   1) rotation reads refresh as valid
      //   2) revoke removes it
      //   3) rotation removes (no-op) and mints a new pair
      // leaves the caller having "revoked" a token that still produced a new
      // pair. With revoke serialized under _rotateLock, whichever side wins
      // runs atomically: either rotation succeeds and the old refresh is
      // gone, or revoke wins and rotation returns invalid_grant.
      //
      // The invariant we assert: after both complete, the old refresh
      // plaintext is invalid (lookupRefreshToken returns null) AND we never
      // observe both a successful rotation AND an "extra" issued pair from
      // the same plaintext.
      const input = makeTokenStoreInput();
      const { refresh } = await store.issueAccessRefreshPair(input);

      const [rotateResult] = await Promise.all([
        store.rotateRefresh(refresh.plaintext, input.clientId),
        store.revoke(refresh.plaintext),
      ]);

      // The OLD refresh plaintext must no longer be usable, regardless of who
      // won the race.
      expect(await store.lookupRefreshToken(refresh.plaintext)).toBeNull();

      // A second rotateRefresh on the same OLD plaintext must always fail —
      // either because revoke already removed it (revoke won) or because
      // rotation already rotated it away (rotation won).
      const second = await store.rotateRefresh(refresh.plaintext, input.clientId);
      const secondCode = second.match(
        () => null,
        (e) => e.errorCode,
      );
      expect(secondCode).toBe("invalid_grant");

      // Sanity: if rotation won, the new pair it minted is independent of the
      // old plaintext (different hash) and revoke of the old plaintext didn't
      // remove it. That's the intended behavior — revoke targets the OLD
      // refresh; a successful rotation has already replaced it.
      void rotateResult; // rotation outcome itself is non-deterministic under the race
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

    it("concurrent rotateRefresh + removeAllForClient: no new tokens survive the deregistration", async () => {
      // Without sharing _rotateLock, the sequence
      //   1) removeAllForClient takes a getAllOAuthTokens snapshot
      //   2) rotateRefresh mints a new pair and writes it to disk
      //   3) removeAllForClient deletes the snapshot tokens — the new pair survives
      // leaves still-valid tokens for a client that was just deregistered, which
      // /mcp would honor because bearerAuth only consults the token store. The
      // invariant under the shared lock: after both operations complete, NO
      // tokens remain for the client (whichever side wins, the other observes
      // the post-state and either tears down everything or fails to mint).
      const input = makeTokenStoreInput();
      const { refresh } = await store.issueAccessRefreshPair(input);

      await Promise.all([
        store.rotateRefresh(refresh.plaintext, input.clientId),
        store.removeAllForClient(input.clientId),
      ]);

      const remaining = (await cache.oauthTokens.getAll()).filter((t) => t.clientId === input.clientId);
      expect(remaining).toEqual([]);
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
      const result = await store2.rotateRefresh(r1.plaintext, input.clientId);
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
