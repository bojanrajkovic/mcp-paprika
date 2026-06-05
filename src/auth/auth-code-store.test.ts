import { describe, expect, it } from "vitest";

import type { AuthCodeState } from "./types.js";

import { AuthCodeStore } from "./auth-code-store.js";
import { nowSeconds } from "./tokens.js";

/**
 * Create a minimal AuthCodeState for testing.
 */
function makeAuthCodeState(overrides?: Partial<AuthCodeState>): AuthCodeState {
  return {
    clientId: "123e4567-e89b-12d3-a456-426614174000",
    codeChallenge: "E9Mrozoa2owUzMr4pCW6-p2XVPpNuU8iMV2OvR-PwDI",
    codeChallengeMethod: "S256",
    redirectUri: "https://example.com/callback",
    resource: "https://example.com",
    scope: "openid profile email",
    identity: {
      email: "user@example.com",
      sub: "sub_123",
      source: "email",
    },
    createdAt: 1000, // seconds
    ...overrides,
  };
}

describe("AuthCodeStore", () => {
  it("put then consume returns the entry", () => {
    const now = nowSeconds();
    const store = new AuthCodeStore({ now: () => now * 1000 });
    const state = makeAuthCodeState({ createdAt: now });
    store.put("auth_code_1", state);

    const result = store.consume("auth_code_1");

    expect(result).not.toBeNull();
    expect(result).toEqual(state);
  });

  it("consume deletes — second consume returns null", () => {
    const now = nowSeconds();
    const store = new AuthCodeStore({ now: () => now * 1000 });
    const state = makeAuthCodeState({ createdAt: now });
    store.put("auth_code_1", state);

    // First consume succeeds
    expect(store.consume("auth_code_1")).not.toBeNull();
    // Second consume returns null
    expect(store.consume("auth_code_1")).toBeNull();
  });

  it("entry past TTL returns null (and is deleted)", () => {
    const clock = { value: 1_000_000_000 }; // milliseconds
    const store = new AuthCodeStore({ ttlMs: 60_000, now: () => clock.value });
    const nowSeconds = Math.floor(clock.value / 1000);
    store.put("auth_code_1", makeAuthCodeState({ createdAt: nowSeconds - 100 }));

    // Move time forward past TTL
    clock.value = 1_000_000_000 + 61_000;

    expect(store.consume("auth_code_1")).toBeNull();
    expect(store.size).toBe(0);
  });

  it("sweepExpired removes only stale entries; returns the count", () => {
    const clock = { value: 1_000_000_000 }; // milliseconds
    const store = new AuthCodeStore({ ttlMs: 60_000, now: () => clock.value });

    const nowSeconds = Math.floor(clock.value / 1000);
    // Add three entries: one stale, two fresh
    store.put("auth_code_1", makeAuthCodeState({ createdAt: nowSeconds - 100 })); // very old, will expire
    store.put("auth_code_2", makeAuthCodeState({ createdAt: nowSeconds })); // just created, fresh
    store.put("auth_code_3", makeAuthCodeState({ createdAt: nowSeconds })); // just created, fresh

    // Move time forward past TTL for auth_code_1 only
    clock.value = 1_000_000_000 + 61_000;

    const nowSeconds2 = Math.floor(clock.value / 1000);
    // Re-put fresh entries at new time to keep them fresh
    store.put("auth_code_2", makeAuthCodeState({ createdAt: nowSeconds2 }));
    store.put("auth_code_3", makeAuthCodeState({ createdAt: nowSeconds2 }));

    const removed = store.sweepExpired();

    expect(removed).toBe(1);
    expect(store.size).toBe(2);
    expect(store.consume("auth_code_2")).not.toBeNull();
    expect(store.consume("auth_code_3")).not.toBeNull();
  });

  it("consume of nonexistent key returns null (no throw)", () => {
    const store = new AuthCodeStore();

    const result = store.consume("nonexistent");

    expect(result).toBeNull();
  });

  it("consumed auth code returns null on second consume", () => {
    // Single-use is enforced at the store layer via consume's atomic delete.
    const now = nowSeconds();
    const store = new AuthCodeStore({ now: () => now * 1000 });
    store.put("mcp_ac_xyz", makeAuthCodeState({ createdAt: now }));
    expect(store.consume("mcp_ac_xyz")).not.toBeNull();
    expect(store.consume("mcp_ac_xyz")).toBeNull();
  });

  it("peek does NOT decrement remaining-uses: peek + consume + consume → first consume succeeds, second returns null", () => {
    const now = nowSeconds();
    const store = new AuthCodeStore({ now: () => now * 1000 });
    const state = makeAuthCodeState({ createdAt: now });
    store.put("auth_code_1", state);

    // Peek should not consume
    const peeked = store.peek("auth_code_1");
    expect(peeked).not.toBeNull();
    expect(peeked).toEqual(state);

    // Peek again should still work
    const peeked2 = store.peek("auth_code_1");
    expect(peeked2).not.toBeNull();

    // Now consume should succeed
    const consumed = store.consume("auth_code_1");
    expect(consumed).not.toBeNull();

    // Second consume returns null
    const consumed2 = store.consume("auth_code_1");
    expect(consumed2).toBeNull();
  });

  it("peek still evicts expired entries", () => {
    const clock = { value: 1_000_000_000 }; // milliseconds
    const store = new AuthCodeStore({ ttlMs: 60_000, now: () => clock.value });
    const nowSeconds = Math.floor(clock.value / 1000);
    store.put("auth_code_1", makeAuthCodeState({ createdAt: nowSeconds - 100 }));

    // Move time forward past TTL
    clock.value = 1_000_000_000 + 61_000;

    // Peek should return null and evict the expired entry
    expect(store.peek("auth_code_1")).toBeNull();
    expect(store.size).toBe(0);
  });
});
