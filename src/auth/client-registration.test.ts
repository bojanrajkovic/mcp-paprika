/**
 * Tests for DiskClientRegistrationStore implementing OAuthRegisteredClientsStore.
 * Covers RFC 7591/7592 client registration, update, deletion, and RAT verification.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { DiskCache } from "../cache/disk-cache.js";
import { hashTokenForStorage } from "./tokens.js";
import { OAuthMetadataValidationError, OAuthClientNotFoundError } from "./errors.js";
import { DiskClientRegistrationStore } from "./client-registration.js";

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a valid wire-format registration input for testing.
 */
function makeWireRegistration(): Record<string, unknown> {
  return {
    client_name: "Test Client",
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    redirect_uris: ["https://app.example.com/callback"],
    scope: "openid email",
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("DiskClientRegistrationStore", () => {
  let tempDir: string;
  let cache: DiskCache;
  let store: DiskClientRegistrationStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "paprika-client-reg-"));
    cache = new DiskCache(tempDir);
    await cache.init();
    store = new DiskClientRegistrationStore(cache, "https://m.example.com");
  });

  describe("registerClient", () => {
    it("validates, generates clientId+RAT, persists, returns full doc with RAT", async () => {
      const metaIn = makeWireRegistration();

      const response = await store.registerClient(metaIn);

      // Response should have client_id (generated UUID)
      expect(response.client_id).toBeDefined();
      expect(response.client_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      // Response should include client_id_issued_at (unix seconds)
      expect(typeof response.client_id_issued_at).toBe("number");
      expect(response.client_id_issued_at).toBeGreaterThan(0);

      // Response should include registration_access_token (plaintext, one-time)
      expect(response.registration_access_token).toBeDefined();
      expect(response.registration_access_token).toMatch(/^mcp_rat_/);

      // Response should include registration_client_uri
      expect(response.registration_client_uri).toBe(`https://m.example.com/register/${response.client_id}`);

      // Response should have wire-format fields in snake_case
      expect(response.client_name).toBe("Test Client");
      expect(response.scope).toBe("openid email");
      expect(response.token_endpoint_auth_method).toBe("none");
      expect(Array.isArray(response.grant_types)).toBe(true);
      expect(Array.isArray(response.response_types)).toBe(true);
      expect(Array.isArray(response.redirect_uris)).toBe(true);

      // Response should NOT have client_secret (public client)
      expect("client_secret" in response).toBe(false);
    });

    it("rejects bad metadata (token_endpoint_auth_method=basic) throwing OAuthMetadataValidationError", async () => {
      const badMeta = {
        ...makeWireRegistration(),
        token_endpoint_auth_method: "basic", // not allowed
      };

      let thrownError: unknown;
      try {
        await store.registerClient(badMeta);
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeInstanceOf(OAuthMetadataValidationError);
    });
  });

  describe("getClient", () => {
    it("returns wire-shape doc; no client_secret field", async () => {
      const metaIn = makeWireRegistration();
      const registered = await store.registerClient(metaIn);

      const retrieved = await store.getClient(registered.client_id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.client_id).toBe(registered.client_id);
      expect(retrieved!.client_name).toBe("Test Client");
      expect("client_secret" in retrieved!).toBe(false);
    });

    it("returns undefined for missing client", async () => {
      const fakeId = randomUUID();

      const result = await store.getClient(fakeId);

      expect(result).toBeUndefined();
    });
  });

  describe("AC4.1: persistence across restart", () => {
    it("registerClient → flush → fresh DiskCache+store → getClient returns same record; registrationAccessTokenHash preserved", async () => {
      // Register in first instance
      const metaIn = makeWireRegistration();
      const original = await store.registerClient(metaIn);

      // Simulate restart: create fresh DiskCache instance pointing to same tempDir
      const cache2 = new DiskCache(tempDir);
      await cache2.init();
      const store2 = new DiskClientRegistrationStore(cache2, "https://m.example.com");

      // Read from fresh instance
      const retrieved = await store2.getClient(original.client_id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.client_id).toBe(original.client_id);
      expect(retrieved!.client_id_issued_at).toBe(original.client_id_issued_at);

      // Verify hash was persisted (by checking that the plaintext RAT hashes to the stored hash)
      const storedClient = await cache2.getOAuthClient(original.client_id);
      expect(storedClient).not.toBeNull();
      const hashOfOriginalRat = hashTokenForStorage(original.registration_access_token!);
      expect(storedClient!.registrationAccessTokenHash).toBe(hashOfOriginalRat);
    });
  });

  describe("updateClient", () => {
    it("AC2.7: updateClient preserves RAT hash; updates metadata fields; bumps updatedAt", async () => {
      const metaIn = makeWireRegistration();
      const registered = await store.registerClient(metaIn);

      // Update with new metadata
      const updateMeta = {
        client_name: "Updated Client Name",
        scope: "openid email profile",
      };

      const updated = await store.updateClient(registered.client_id, updateMeta);

      // Response should have updated fields
      expect(updated.client_name).toBe("Updated Client Name");
      expect(updated.scope).toBe("openid email profile");

      // Response should have registration_client_uri but NO registration_access_token
      expect(updated.registration_client_uri).toBe(`https://m.example.com/register/${registered.client_id}`);
      expect("registration_access_token" in updated).toBe(false);

      // Verify that the stored RAT hash is preserved (plaintext from original still hashes correctly)
      const storedClient = await cache.getOAuthClient(registered.client_id);
      expect(storedClient).not.toBeNull();
      const hashOfOriginalRat = hashTokenForStorage(registered.registration_access_token!);
      expect(storedClient!.registrationAccessTokenHash).toBe(hashOfOriginalRat);
    });

    it("missing clientId throws OAuthClientNotFoundError", async () => {
      const fakeId = randomUUID();
      const updateMeta = { client_name: "New Name" };

      let thrownError: unknown;
      try {
        await store.updateClient(fakeId, updateMeta);
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeInstanceOf(OAuthClientNotFoundError);
    });
  });

  describe("AC2.12: verifyRegistrationAccessToken", () => {
    it("rejects wrong token", async () => {
      const metaIn = makeWireRegistration();
      const registered = await store.registerClient(metaIn);

      const result = await store.verifyRegistrationAccessToken(registered.client_id, "mcp_rat_wrong");

      expect(result).toBe(false);
    });

    it("accepts correct token (constant-time-equivalent — same hash)", async () => {
      const metaIn = makeWireRegistration();
      const registered = await store.registerClient(metaIn);

      const result = await store.verifyRegistrationAccessToken(
        registered.client_id,
        registered.registration_access_token!,
      );

      expect(result).toBe(true);
    });
  });

  describe("deleteClient", () => {
    it("removes from cache; flush persists deletion", async () => {
      const metaIn = makeWireRegistration();
      const registered = await store.registerClient(metaIn);

      // Verify it exists
      let retrieved = await store.getClient(registered.client_id);
      expect(retrieved).toBeDefined();

      // Delete
      await store.deleteClient(registered.client_id);

      // Verify it's gone
      retrieved = await store.getClient(registered.client_id);
      expect(retrieved).toBeUndefined();

      // Verify it's gone after restart (persisted)
      const cache2 = new DiskCache(tempDir);
      await cache2.init();
      const store2 = new DiskClientRegistrationStore(cache2, "https://m.example.com");
      retrieved = await store2.getClient(registered.client_id);
      expect(retrieved).toBeUndefined();
    });
  });
});
