/**
 * Tests for OIDC discovery loading and id_token verification.
 * Uses MSW to intercept fetch calls to discovery and JWKS endpoints.
 */

import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { OAuthMetadataValidationError } from "./errors.js";
import { loadDiscovery } from "./oidc-client.js";

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("loadDiscovery", () => {
  it("happy path: returns parsed doc when all required fields present + https + alg overlaps", async () => {
    server.use(
      http.get("https://idp.example.com/.well-known/openid-configuration", () =>
        HttpResponse.json({
          issuer: "https://idp.example.com",
          authorization_endpoint: "https://idp.example.com/authorize",
          token_endpoint: "https://idp.example.com/token",
          jwks_uri: "https://idp.example.com/jwks",
          userinfo_endpoint: "https://idp.example.com/userinfo",
          id_token_signing_alg_values_supported: ["RS256", "ES256"],
          response_types_supported: ["code"],
          scopes_supported: ["openid", "profile", "email"],
        }),
      ),
    );

    const doc = await loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256", "ES256"]);

    expect(doc.issuer).toBe("https://idp.example.com");
    expect(doc.authorization_endpoint).toBe("https://idp.example.com/authorize");
    expect(doc.token_endpoint).toBe("https://idp.example.com/token");
    expect(doc.jwks_uri).toBe("https://idp.example.com/jwks");
    expect(doc.userinfo_endpoint).toBe("https://idp.example.com/userinfo");
    expect(doc.id_token_signing_alg_values_supported).toContain("RS256");
    expect(doc.id_token_signing_alg_values_supported).toContain("ES256");
  });

  describe("AC7.5: All endpoint URLs must be https://", () => {
    it("AC7.5: rejects discovery with http:// authorization_endpoint", async () => {
      server.use(
        http.get("https://idp.example.com/.well-known/openid-configuration", () =>
          HttpResponse.json({
            issuer: "https://idp.example.com",
            authorization_endpoint: "http://idp.example.com/authorize", // ← http
            token_endpoint: "https://idp.example.com/token",
            jwks_uri: "https://idp.example.com/jwks",
            id_token_signing_alg_values_supported: ["RS256"],
          }),
        ),
      );

      // PLAN says (phase_04.md:26): AC7.5 requires all endpoint URLs to be https://
      await expect(
        loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"]),
      ).rejects.toThrow(OAuthMetadataValidationError);
    });

    it("AC7.5: rejects discovery with http:// token_endpoint", async () => {
      server.use(
        http.get("https://idp.example.com/.well-known/openid-configuration", () =>
          HttpResponse.json({
            issuer: "https://idp.example.com",
            authorization_endpoint: "https://idp.example.com/authorize",
            token_endpoint: "http://idp.example.com/token", // ← http
            jwks_uri: "https://idp.example.com/jwks",
            id_token_signing_alg_values_supported: ["RS256"],
          }),
        ),
      );

      // PLAN says (phase_04.md:26): AC7.5 requires all endpoint URLs to be https://
      await expect(
        loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"]),
      ).rejects.toThrow(OAuthMetadataValidationError);
    });

    it("AC7.5: rejects discovery with http:// jwks_uri", async () => {
      server.use(
        http.get("https://idp.example.com/.well-known/openid-configuration", () =>
          HttpResponse.json({
            issuer: "https://idp.example.com",
            authorization_endpoint: "https://idp.example.com/authorize",
            token_endpoint: "https://idp.example.com/token",
            jwks_uri: "http://idp.example.com/jwks", // ← http
            id_token_signing_alg_values_supported: ["RS256"],
          }),
        ),
      );

      // PLAN says (phase_04.md:26): AC7.5 requires all endpoint URLs to be https://
      await expect(
        loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"]),
      ).rejects.toThrow(OAuthMetadataValidationError);
    });

    it("AC7.5: rejects discovery with http:// userinfo_endpoint (when present)", async () => {
      server.use(
        http.get("https://idp.example.com/.well-known/openid-configuration", () =>
          HttpResponse.json({
            issuer: "https://idp.example.com",
            authorization_endpoint: "https://idp.example.com/authorize",
            token_endpoint: "https://idp.example.com/token",
            jwks_uri: "https://idp.example.com/jwks",
            userinfo_endpoint: "http://idp.example.com/userinfo", // ← http
            id_token_signing_alg_values_supported: ["RS256"],
          }),
        ),
      );

      // PLAN says (phase_04.md:26): AC7.5 requires all endpoint URLs to be https://
      await expect(
        loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"]),
      ).rejects.toThrow(OAuthMetadataValidationError);
    });

    it("AC7.5: rejects discovery with http:// issuer", async () => {
      server.use(
        http.get("https://idp.example.com/.well-known/openid-configuration", () =>
          HttpResponse.json({
            issuer: "http://idp.example.com", // ← http
            authorization_endpoint: "https://idp.example.com/authorize",
            token_endpoint: "https://idp.example.com/token",
            jwks_uri: "https://idp.example.com/jwks",
            id_token_signing_alg_values_supported: ["RS256"],
          }),
        ),
      );

      // PLAN says (phase_04.md:26): AC7.5 requires all endpoint URLs to be https://
      await expect(
        loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"]),
      ).rejects.toThrow(OAuthMetadataValidationError);
    });

    it("AC7.5: rejects discoveryUrl itself when http://", async () => {
      // PLAN says (phase_04.md:26): AC7.5 requires discoveryUrl itself to be https://
      await expect(loadDiscovery("http://idp.example.com/.well-known/openid-configuration", ["RS256"])).rejects.toThrow(
        OAuthMetadataValidationError,
      );
    });
  });

  it("missing required field (jwks_uri) → throws", async () => {
    server.use(
      http.get("https://idp.example.com/.well-known/openid-configuration", () =>
        HttpResponse.json({
          issuer: "https://idp.example.com",
          authorization_endpoint: "https://idp.example.com/authorize",
          token_endpoint: "https://idp.example.com/token",
          // jwks_uri is missing
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
    );

    await expect(loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"])).rejects.toThrow(
      OAuthMetadataValidationError,
    );
  });

  it("non-2xx response → throws", async () => {
    server.use(
      http.get(
        "https://idp.example.com/.well-known/openid-configuration",
        () => new HttpResponse(null, { status: 404 }),
      ),
    );

    await expect(loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"])).rejects.toThrow(
      OAuthMetadataValidationError,
    );
  });

  it("alg-allowlist mismatch (upstream advertises only HS256) → throws", async () => {
    server.use(
      http.get("https://idp.example.com/.well-known/openid-configuration", () =>
        HttpResponse.json({
          issuer: "https://idp.example.com",
          authorization_endpoint: "https://idp.example.com/authorize",
          token_endpoint: "https://idp.example.com/token",
          jwks_uri: "https://idp.example.com/jwks",
          id_token_signing_alg_values_supported: ["HS256"], // Only HS256, not in our allowlist
        }),
      ),
    );

    await expect(loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"])).rejects.toThrow(
      OAuthMetadataValidationError,
    );
  });

  it("upstream supports both RS256 and HS256; allowed = [RS256] → accepted (overlap = [RS256])", async () => {
    server.use(
      http.get("https://idp.example.com/.well-known/openid-configuration", () =>
        HttpResponse.json({
          issuer: "https://idp.example.com",
          authorization_endpoint: "https://idp.example.com/authorize",
          token_endpoint: "https://idp.example.com/token",
          jwks_uri: "https://idp.example.com/jwks",
          id_token_signing_alg_values_supported: ["RS256", "HS256"],
        }),
      ),
    );

    const doc = await loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"]);

    expect(doc.id_token_signing_alg_values_supported).toContain("RS256");
    expect(doc.id_token_signing_alg_values_supported).toContain("HS256");
  });
});
