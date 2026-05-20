import { describe, it, expect } from "vitest";
import {
  generateOpaqueToken,
  hashTokenForStorage,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  AUTH_REQUEST_TTL_SECONDS,
  JWKS_CACHE_TTL_MS,
  DISCOVERY_CACHE_TTL_MS,
  DCR_CLIENT_STALE_DAYS,
} from "./tokens.js";

describe("auth/tokens: opaque token generation and hashing", () => {
  describe("TTL constants", () => {
    it("ACCESS_TOKEN_TTL_SECONDS = 24h in seconds", () => {
      expect(ACCESS_TOKEN_TTL_SECONDS).toBe(24 * 60 * 60);
    });

    it("REFRESH_TOKEN_TTL_SECONDS = 30d in seconds", () => {
      expect(REFRESH_TOKEN_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    });

    it("AUTH_CODE_TTL_SECONDS = 60s", () => {
      expect(AUTH_CODE_TTL_SECONDS).toBe(60);
    });

    it("AUTH_REQUEST_TTL_SECONDS = 5 min in seconds", () => {
      expect(AUTH_REQUEST_TTL_SECONDS).toBe(5 * 60);
    });

    it("JWKS_CACHE_TTL_MS = 10 min in ms", () => {
      expect(JWKS_CACHE_TTL_MS).toBe(10 * 60 * 1000);
    });

    it("DISCOVERY_CACHE_TTL_MS = 24h in ms", () => {
      expect(DISCOVERY_CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    });

    it("DCR_CLIENT_STALE_DAYS = 90", () => {
      expect(DCR_CLIENT_STALE_DAYS).toBe(90);
    });
  });

  describe("generateOpaqueToken", () => {
    it("generated token starts with the provided prefix", () => {
      const token = generateOpaqueToken("mcp_at_");
      expect(token).toMatch(/^mcp_at_/);
    });

    it("generated token body is base64url (43 chars for 32 bytes)", () => {
      const token = generateOpaqueToken("mcp_rt_");
      const body = token.slice("mcp_rt_".length);
      expect(body).toHaveLength(43);
      expect(body).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it("generated token for mcp_ac_ prefix has correct length", () => {
      const token = generateOpaqueToken("mcp_ac_");
      expect(token).toHaveLength("mcp_ac_".length + 43);
    });

    it("generated tokens are distinct (1000 samples)", () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        tokens.add(generateOpaqueToken("mcp_state_"));
      }
      expect(tokens.size).toBe(1000);
    });

    it("all six token prefixes work: mcp_at_, mcp_rt_, mcp_ac_, mcp_rat_, mcp_state_, mcp_nonce_", () => {
      const prefixes = ["mcp_at_", "mcp_rt_", "mcp_ac_", "mcp_rat_", "mcp_state_", "mcp_nonce_"] as const;
      for (const prefix of prefixes) {
        const token = generateOpaqueToken(prefix);
        expect(token).toMatch(new RegExp(`^${prefix}`));
        expect(token).toHaveLength(prefix.length + 43);
      }
    });
  });

  describe("hashTokenForStorage", () => {
    it("returns a 64-character hex string", () => {
      const hash = hashTokenForStorage("mcp_at_example");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).toHaveLength(64);
    });

    it("is deterministic for the same input", () => {
      const input = "mcp_rt_testtoken";
      const hash1 = hashTokenForStorage(input);
      const hash2 = hashTokenForStorage(input);
      expect(hash1).toBe(hash2);
    });

    it("produces different hashes for different inputs", () => {
      const hash1 = hashTokenForStorage("mcp_ac_token1");
      const hash2 = hashTokenForStorage("mcp_ac_token2");
      expect(hash1).not.toBe(hash2);
    });

    it("works with empty string", () => {
      const hash = hashTokenForStorage("");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("works with unicode characters", () => {
      const hash = hashTokenForStorage("🔐token");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
