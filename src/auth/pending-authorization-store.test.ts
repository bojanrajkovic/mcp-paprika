import { describe, expect, it } from "vitest";

import type { PendingAuthorization } from "./types.js";

import { PendingAuthorizationStore } from "./pending-authorization-store.js";
import { MAX_INMEMORY_AUTH_ENTRIES, nowSeconds } from "./tokens.js";

/**
 * Minimal PendingAuthorization for testing. `clientName` is optional (DCR
 * clients may register without one), so the default omits it; pass an override
 * to exercise the named case.
 */
function makePending(overrides?: Partial<PendingAuthorization>): PendingAuthorization {
  return {
    clientId: "123e4567-e89b-12d3-a456-426614174000",
    codeChallenge: "E9Mrozoa2owUzMr4pCW6-p2XVPpNuU8iMV2OvR-PwDI",
    codeChallengeMethod: "S256",
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    resource: "https://example.com",
    claudeState: "abc123",
    scope: "openid profile email",
    createdAt: 1000,
    ...overrides,
  };
}

describe("PendingAuthorizationStore", () => {
  it("put then consume returns the entry", () => {
    const now = nowSeconds();
    const store = new PendingAuthorizationStore({ now: () => now * 1000 });
    const pending = makePending({ createdAt: now });
    store.put("ticket-1", pending);

    expect(store.consume("ticket-1")).toEqual(pending);
  });

  it("round-trips an optional clientName", () => {
    const now = nowSeconds();
    const store = new PendingAuthorizationStore({ now: () => now * 1000 });
    const pending = makePending({ createdAt: now, clientName: "Claude" });
    store.put("ticket-1", pending);

    expect(store.consume("ticket-1")?.clientName).toBe("Claude");
  });

  it("consume is single-use — second consume returns null", () => {
    const now = nowSeconds();
    const store = new PendingAuthorizationStore({ now: () => now * 1000 });
    store.put("ticket-1", makePending({ createdAt: now }));

    expect(store.consume("ticket-1")).not.toBeNull();
    expect(store.consume("ticket-1")).toBeNull();
  });

  it("entry past TTL returns null and is evicted", () => {
    const clock = { value: 1_000_000 };
    const store = new PendingAuthorizationStore({ ttlMs: 600_000, now: () => clock.value });
    store.put("ticket-1", makePending({ createdAt: 1000 }));

    clock.value = 1_000_000 + 601_000; // past the 10-min TTL

    expect(store.consume("ticket-1")).toBeNull();
    expect(store.size).toBe(0);
  });

  it("defaults to a 10-minute TTL", () => {
    const clock = { value: 1_000_000_000 };
    const store = new PendingAuthorizationStore({ now: () => clock.value });
    const created = Math.floor(clock.value / 1000);
    store.put("ticket-1", makePending({ createdAt: created }));

    clock.value += 9 * 60 * 1000; // +9 min — still inside the window
    expect(store.consume("ticket-1")).not.toBeNull();

    store.put("ticket-2", makePending({ createdAt: created }));
    clock.value = 1_000_000_000 + 11 * 60 * 1000; // +11 min from creation — expired
    expect(store.consume("ticket-2")).toBeNull();
  });

  it("sweepExpired removes only stale entries and returns the count", () => {
    const clock = { value: 1_000_000_000 };
    const store = new PendingAuthorizationStore({ ttlMs: 600_000, now: () => clock.value });
    store.put("stale", makePending({ createdAt: Math.floor(clock.value / 1000) - 1000 }));

    clock.value += 601_000;
    const fresh = Math.floor(clock.value / 1000);
    store.put("fresh", makePending({ createdAt: fresh }));

    expect(store.sweepExpired()).toBe(1);
    expect(store.size).toBe(1);
    expect(store.consume("fresh")).not.toBeNull();
  });

  it("consume of an unknown ticket returns null without throwing", () => {
    const store = new PendingAuthorizationStore();
    expect(store.consume("nope")).toBeNull();
  });

  describe("entry cap (DoS bound)", () => {
    it("put returns true on success and false when the store is full of live entries", () => {
      const now = nowSeconds();
      const store = new PendingAuthorizationStore({ maxEntries: 2, now: () => now * 1000 });
      expect(store.put("a", makePending({ createdAt: now }))).toBe(true);
      expect(store.put("b", makePending({ createdAt: now }))).toBe(true);
      // Third live entry is rejected, not evicting an existing one.
      expect(store.put("c", makePending({ createdAt: now }))).toBe(false);
      expect(store.size).toBe(2);
      expect(store.consume("a")).not.toBeNull();
      expect(store.consume("b")).not.toBeNull();
    });

    it("sweeps expired entries to make room before rejecting a new put", () => {
      const clock = { value: 1_000_000_000 };
      const store = new PendingAuthorizationStore({ maxEntries: 2, ttlMs: 600_000, now: () => clock.value });
      const created = Math.floor(clock.value / 1000);
      expect(store.put("old1", makePending({ createdAt: created }))).toBe(true);
      expect(store.put("old2", makePending({ createdAt: created }))).toBe(true);

      clock.value += 601_000; // both old entries now expired
      // At cap, but a sweep reclaims the two expired slots, so the new put succeeds.
      expect(store.put("fresh", makePending({ createdAt: Math.floor(clock.value / 1000) }))).toBe(true);
      expect(store.size).toBe(1);
      expect(store.consume("fresh")).not.toBeNull();
    });

    it("re-keying an existing entry does not count against the cap", () => {
      const now = nowSeconds();
      const store = new PendingAuthorizationStore({ maxEntries: 1, now: () => now * 1000 });
      expect(store.put("a", makePending({ createdAt: now }))).toBe(true);
      // Overwriting the same key stays within cap.
      expect(store.put("a", makePending({ createdAt: now, claudeState: "updated" }))).toBe(true);
      expect(store.consume("a")?.claudeState).toBe("updated");
    });

    it("defaults to MAX_INMEMORY_AUTH_ENTRIES (50) when no cap is given", () => {
      const now = nowSeconds();
      const store = new PendingAuthorizationStore({ now: () => now * 1000 });
      for (let i = 0; i < MAX_INMEMORY_AUTH_ENTRIES; i++) {
        expect(store.put(`k${i}`, makePending({ createdAt: now }))).toBe(true);
      }
      expect(store.put("overflow", makePending({ createdAt: now }))).toBe(false);
      expect(store.size).toBe(MAX_INMEMORY_AUTH_ENTRIES);
    });
  });
});
