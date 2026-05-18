/**
 * Tests for OIDC discovery loading and id_token verification.
 * Uses MSW to intercept fetch calls to discovery and JWKS endpoints.
 */

import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { OAuthMetadataValidationError } from "./errors.js";
import { loadDiscovery, createJwksFor, verifyIdToken } from "./oidc-client.js";
import { makeRsaJwt, makeEs256Jwt, makeHs256Jwt } from "./__tests__/jose-keys.js";

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

describe("verifyIdToken", () => {
  const baseUrl = "https://idp.example.com";
  const discoveryUrl = `${baseUrl}/.well-known/openid-configuration`;
  const jwksUrl = `${baseUrl}/jwks`;
  const clientId = "client-x";
  const issuer = baseUrl;

  // AC7.1 - RS256 signature verification
  it("AC7.1: RS256-signed id_token verifies and returns payload", async () => {
    // PLAN says (phase_04.md:22): upstream id_token signed with RS256 verifies (default allowlist)
    const nonce = "n-1";
    const now = Math.floor(Date.now() / 1000);

    const { token, jwk } = await makeRsaJwt({
      iss: issuer,
      aud: clientId,
      sub: "user-1",
      email: "user@x.com",
      email_verified: true,
      nonce,
      exp: now + 60,
      iat: now,
    });

    server.use(
      http.get(discoveryUrl, () =>
        HttpResponse.json({
          issuer,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          jwks_uri: jwksUrl,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
      http.get(jwksUrl, () => HttpResponse.json({ keys: [jwk] })),
    );

    const discovery = await loadDiscovery(discoveryUrl, ["RS256"]);
    const jwks = createJwksFor(discovery);

    const payload = await verifyIdToken(token, jwks, {
      clientId,
      issuer,
      nonce,
      allowedAlgs: ["RS256"],
    });

    expect(payload.sub).toBe("user-1");
    expect(payload.email).toBe("user@x.com");
    expect(payload.email_verified).toBe(true);
  });

  // AC7.2 - ES256 signature verification
  it("AC7.2: ES256-signed id_token verifies", async () => {
    // PLAN says (phase_04.md:23): upstream id_token signed with ES256 verifies (default allowlist)
    const nonce = "n-2";
    const now = Math.floor(Date.now() / 1000);

    const { token, jwk } = await makeEs256Jwt({
      iss: issuer,
      aud: clientId,
      sub: "user-2",
      email: "user2@x.com",
      email_verified: true,
      nonce,
      exp: now + 60,
      iat: now,
    });

    server.use(
      http.get(discoveryUrl, () =>
        HttpResponse.json({
          issuer,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          jwks_uri: jwksUrl,
          id_token_signing_alg_values_supported: ["ES256"],
        }),
      ),
      http.get(jwksUrl, () => HttpResponse.json({ keys: [jwk] })),
    );

    const discovery = await loadDiscovery(discoveryUrl, ["ES256"]);
    const jwks = createJwksFor(discovery);

    const payload = await verifyIdToken(token, jwks, {
      clientId,
      issuer,
      nonce,
      allowedAlgs: ["ES256"],
    });

    expect(payload.sub).toBe("user-2");
    expect(payload.email).toBe("user2@x.com");
  });

  // AC7.3 - alg=none rejection
  it("AC7.3: id_token with alg=none is rejected", async () => {
    // PLAN says (phase_04.md:24): id_token with alg='none' rejected by verifyIdToken
    const nonce = "n-3";
    const now = Math.floor(Date.now() / 1000);

    // jose won't sign with alg=none, so construct manually
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payloadObj = {
      iss: issuer,
      aud: clientId,
      sub: "user-3",
      nonce,
      exp: now + 60,
      iat: now,
    };
    const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
    const noneToken = `${header}.${payload}.`;

    const { jwk } = await makeRsaJwt({
      iss: issuer,
      aud: clientId,
      sub: "dummy",
      nonce: "dummy",
      exp: now + 60,
      iat: now,
    });

    server.use(
      http.get(discoveryUrl, () =>
        HttpResponse.json({
          issuer,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          jwks_uri: jwksUrl,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
      http.get(jwksUrl, () => HttpResponse.json({ keys: [jwk] })),
    );

    const discovery = await loadDiscovery(discoveryUrl, ["RS256"]);
    const jwks = createJwksFor(discovery);

    await expect(
      verifyIdToken(noneToken, jwks, {
        clientId,
        issuer,
        nonce,
        allowedAlgs: ["RS256"],
      }),
    ).rejects.toThrow(OAuthMetadataValidationError);
  });

  // AC7.4 - HS256 rejection
  it("AC7.4: id_token signed with HS256 is rejected", async () => {
    // PLAN says (phase_04.md:25): id_token signed with HS256 rejected by verifyIdToken.
    // Tests defense against the JWS algorithm-confusion attack — jose's algorithms
    // allowlist must reject HS256 tokens even if (especially if) the JWKS happens to
    // contain matching key material.
    const nonce = "n-4";
    const now = Math.floor(Date.now() / 1000);

    const claims = {
      iss: issuer,
      aud: clientId,
      sub: "user-4",
      nonce,
      exp: now + 60,
      iat: now,
    };

    const { token: hs256Token } = await makeHs256Jwt(claims);

    // Mock the JWKS endpoint with the standard RSA public JWK (so resolver has SOMETHING
    // to look up but jose's algorithms guard should reject before key lookup matters).
    const { jwk: rsaJwk } = await makeRsaJwt({}, {});

    server.use(
      http.get(discoveryUrl, () =>
        HttpResponse.json({
          issuer,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          jwks_uri: jwksUrl,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
      http.get(jwksUrl, () => HttpResponse.json({ keys: [rsaJwk] })),
    );

    const discovery = await loadDiscovery(discoveryUrl, ["RS256"]);
    const jwks = createJwksFor(discovery);

    await expect(
      verifyIdToken(hs256Token, jwks, {
        clientId,
        issuer,
        nonce,
        allowedAlgs: ["RS256", "ES256"], // default allowlist
      }),
    ).rejects.toThrow(OAuthMetadataValidationError);
  });

  it("rejects expired id_token (exp in the past)", async () => {
    const nonce = "n-exp";
    const now = Math.floor(Date.now() / 1000);

    const { token, jwk } = await makeRsaJwt({
      iss: issuer,
      aud: clientId,
      sub: "user-exp",
      nonce,
      exp: now - 60, // Expired 60 seconds ago
      iat: now - 120,
    });

    server.use(
      http.get(discoveryUrl, () =>
        HttpResponse.json({
          issuer,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          jwks_uri: jwksUrl,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
      http.get(jwksUrl, () => HttpResponse.json({ keys: [jwk] })),
    );

    const discovery = await loadDiscovery(discoveryUrl, ["RS256"]);
    const jwks = createJwksFor(discovery);

    await expect(
      verifyIdToken(token, jwks, {
        clientId,
        issuer,
        nonce,
        allowedAlgs: ["RS256"],
      }),
    ).rejects.toThrow(OAuthMetadataValidationError);
  });

  it("rejects wrong audience", async () => {
    const nonce = "n-aud";
    const now = Math.floor(Date.now() / 1000);

    const { token, jwk } = await makeRsaJwt({
      iss: issuer,
      aud: "wrong-client",
      sub: "user-aud",
      nonce,
      exp: now + 60,
      iat: now,
    });

    server.use(
      http.get(discoveryUrl, () =>
        HttpResponse.json({
          issuer,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          jwks_uri: jwksUrl,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
      http.get(jwksUrl, () => HttpResponse.json({ keys: [jwk] })),
    );

    const discovery = await loadDiscovery(discoveryUrl, ["RS256"]);
    const jwks = createJwksFor(discovery);

    await expect(
      verifyIdToken(token, jwks, {
        clientId, // "client-x", but token has "wrong-client"
        issuer,
        nonce,
        allowedAlgs: ["RS256"],
      }),
    ).rejects.toThrow(OAuthMetadataValidationError);
  });

  it("rejects wrong issuer", async () => {
    const nonce = "n-iss";
    const now = Math.floor(Date.now() / 1000);

    const { token, jwk } = await makeRsaJwt({
      iss: "https://wrong-idp.example.com",
      aud: clientId,
      sub: "user-iss",
      nonce,
      exp: now + 60,
      iat: now,
    });

    server.use(
      http.get(discoveryUrl, () =>
        HttpResponse.json({
          issuer,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          jwks_uri: jwksUrl,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
      http.get(jwksUrl, () => HttpResponse.json({ keys: [jwk] })),
    );

    const discovery = await loadDiscovery(discoveryUrl, ["RS256"]);
    const jwks = createJwksFor(discovery);

    await expect(
      verifyIdToken(token, jwks, {
        clientId,
        issuer, // "https://idp.example.com", but token has wrong issuer
        nonce,
        allowedAlgs: ["RS256"],
      }),
    ).rejects.toThrow(OAuthMetadataValidationError);
  });

  // AC7.8 - nonce mismatch
  it("AC7.8: id_token with mismatched nonce is rejected after signature verification", async () => {
    // PLAN says (phase_04.md:27): mismatched nonce AND missing nonce are rejected
    const expectedNonce = "n-expected";
    const wrongNonce = "n-wrong";
    const now = Math.floor(Date.now() / 1000);

    const { token, jwk } = await makeRsaJwt({
      iss: issuer,
      aud: clientId,
      sub: "user-nonce",
      nonce: wrongNonce,
      exp: now + 60,
      iat: now,
    });

    server.use(
      http.get(discoveryUrl, () =>
        HttpResponse.json({
          issuer,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          jwks_uri: jwksUrl,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
      http.get(jwksUrl, () => HttpResponse.json({ keys: [jwk] })),
    );

    const discovery = await loadDiscovery(discoveryUrl, ["RS256"]);
    const jwks = createJwksFor(discovery);

    await expect(
      verifyIdToken(token, jwks, {
        clientId,
        issuer,
        nonce: expectedNonce, // Expects "n-expected" but token has "n-wrong"
        allowedAlgs: ["RS256"],
      }),
    ).rejects.toThrow(OAuthMetadataValidationError);
  });

  // AC7.8 - nonce required
  it("AC7.8: id_token with no nonce claim is rejected (nonce required)", async () => {
    // PLAN says (phase_04.md:27): mismatched nonce AND missing nonce are rejected
    const nonce = "n-required";
    const now = Math.floor(Date.now() / 1000);

    const { token, jwk } = await makeRsaJwt({
      iss: issuer,
      aud: clientId,
      sub: "user-no-nonce",
      // Missing nonce claim
      exp: now + 60,
      iat: now,
    });

    server.use(
      http.get(discoveryUrl, () =>
        HttpResponse.json({
          issuer,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          jwks_uri: jwksUrl,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
      http.get(jwksUrl, () => HttpResponse.json({ keys: [jwk] })),
    );

    const discovery = await loadDiscovery(discoveryUrl, ["RS256"]);
    const jwks = createJwksFor(discovery);

    await expect(
      verifyIdToken(token, jwks, {
        clientId,
        issuer,
        nonce,
        allowedAlgs: ["RS256"],
      }),
    ).rejects.toThrow(OAuthMetadataValidationError);
  });

  it("accepts array-valued aud claim (Microsoft Entra compatibility)", async () => {
    // PLAN deferred from Phase 1: Entra emits array `aud`. Schema must accept both.
    const nonce = "n-aud-array";
    const now = Math.floor(Date.now() / 1000);

    const { token, jwk } = await makeRsaJwt({
      iss: issuer,
      aud: [clientId, "other-client"],
      sub: "user-aud-array",
      nonce,
      exp: now + 60,
      iat: now,
    });

    server.use(
      http.get(discoveryUrl, () =>
        HttpResponse.json({
          issuer,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          jwks_uri: jwksUrl,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
      http.get(jwksUrl, () => HttpResponse.json({ keys: [jwk] })),
    );

    const discovery = await loadDiscovery(discoveryUrl, ["RS256"]);
    const jwks = createJwksFor(discovery);

    const payload = await verifyIdToken(token, jwks, {
      clientId,
      issuer,
      nonce,
      allowedAlgs: ["RS256"],
    });

    expect(Array.isArray(payload.aud)).toBe(true);
    expect(payload.aud).toContain(clientId);
    expect(payload.aud).toContain("other-client");
  });

  it("coerces string email_verified to boolean (older Entra/Keycloak compatibility)", async () => {
    // PLAN deferred from Phase 1: older Entra tenants emit "true"/"false" as strings.
    const nonce = "n-email-verified-string";
    const now = Math.floor(Date.now() / 1000);

    const { token, jwk } = await makeRsaJwt({
      iss: issuer,
      aud: clientId,
      sub: "user-email-string",
      email: "user@x.com",
      email_verified: "true" as unknown as boolean, // intentional cast to test coercion
      nonce,
      exp: now + 60,
      iat: now,
    });

    server.use(
      http.get(discoveryUrl, () =>
        HttpResponse.json({
          issuer,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          jwks_uri: jwksUrl,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
      http.get(jwksUrl, () => HttpResponse.json({ keys: [jwk] })),
    );

    const discovery = await loadDiscovery(discoveryUrl, ["RS256"]);
    const jwks = createJwksFor(discovery);

    const payload = await verifyIdToken(token, jwks, {
      clientId,
      issuer,
      nonce,
      allowedAlgs: ["RS256"],
    });

    expect(payload.email_verified).toBe(true);
    expect(typeof payload.email_verified).toBe("boolean");
  });
});
