import { describe, it, expect } from "vitest";
import type { AuthRequestState } from "./types.js";
import { AuthRequestStore } from "./auth-request-store.js";
import { nowSeconds } from "./tokens.js";

/**
 * Create a minimal AuthRequestState for testing.
 */
function makeAuthRequestState(overrides?: Partial<AuthRequestState>): AuthRequestState {
  return {
    clientId: "123e4567-e89b-12d3-a456-426614174000",
    codeChallenge: "E9Mrozoa2owUzMr4pCW6-p2XVPpNuU8iMV2OvR-PwDI",
    codeChallengeMethod: "S256",
    redirectUri: "https://example.com/callback",
    resource: "https://example.com",
    claudeState: "abc123",
    scope: "openid profile email",
    ourNonce: "nonce_xyz",
    createdAt: 1000, // seconds
    ...overrides,
  };
}

describe("AuthRequestStore", () => {
  it("put then consume returns the entry", () => {
    const now = nowSeconds();
    const store = new AuthRequestStore({ now: () => now * 1000 });
    const state = makeAuthRequestState({ createdAt: now });
    store.put("state-1", state);

    const result = store.consume("state-1");

    expect(result).not.toBeNull();
    expect(result).toEqual(state);
  });

  it("consume deletes — second consume returns null", () => {
    const now = nowSeconds();
    const store = new AuthRequestStore({ now: () => now * 1000 });
    const state = makeAuthRequestState({ createdAt: now });
    store.put("state-1", state);

    // First consume succeeds
    expect(store.consume("state-1")).not.toBeNull();
    // Second consume returns null
    expect(store.consume("state-1")).toBeNull();
  });

  it("entry past TTL returns null (and is deleted)", () => {
    const clock = { value: 1_000_000 };
    const store = new AuthRequestStore({ ttlMs: 60_000, now: () => clock.value });
    store.put("state-1", makeAuthRequestState({ createdAt: 1000 }));

    // Move time forward past TTL
    clock.value = 1_000_000 + 61_000;

    expect(store.consume("state-1")).toBeNull();
    expect(store.size).toBe(0);
  });

  it("sweepExpired removes only stale entries; returns the count", () => {
    const clock = { value: 1_000_000_000 }; // milliseconds
    const store = new AuthRequestStore({ ttlMs: 60_000, now: () => clock.value });

    const nowSeconds = Math.floor(clock.value / 1000);
    // Add three entries: one stale, two fresh
    store.put("state-1", makeAuthRequestState({ createdAt: nowSeconds - 100 })); // very old, will expire
    store.put("state-2", makeAuthRequestState({ createdAt: nowSeconds })); // just created, fresh
    store.put("state-3", makeAuthRequestState({ createdAt: nowSeconds })); // just created, fresh

    // Move time forward past TTL for state-1 only
    // state-1 was created 100s ago, TTL is 60s, so it expired at T+60
    // After advancing 61s, we're now at T+61, so state-1 is definitely expired
    // state-2 and state-3 were created at T+0, so they expire at T+60, and we're only at T+61... wait, that's wrong too
    // Let me recalculate: if state-2 was created at nowSeconds (T+0), and we advance 61s:
    // - new clock = 1_000_000_000 + 61_000
    // - new nowSeconds = (1_000_000_000 + 61_000) / 1000 = 1_000_000 + 61
    // - state-2 expiresAt = nowSeconds + 60 = T+0 + 60 = T+60
    // - current time = T+61, so state-2 is also expired
    // I need to create state-2 and state-3 AFTER moving the clock
    clock.value = 1_000_000_000 + 61_000;

    const nowSeconds2 = Math.floor(clock.value / 1000);
    store.put("state-2", makeAuthRequestState({ createdAt: nowSeconds2 })); // just created, fresh
    store.put("state-3", makeAuthRequestState({ createdAt: nowSeconds2 })); // just created, fresh

    const removed = store.sweepExpired();

    expect(removed).toBe(1);
    expect(store.size).toBe(2);
    expect(store.consume("state-2")).not.toBeNull();
    expect(store.consume("state-3")).not.toBeNull();
  });

  it("consume of nonexistent key returns null (no throw)", () => {
    const store = new AuthRequestStore();

    const result = store.consume("nonexistent");

    expect(result).toBeNull();
  });
});
