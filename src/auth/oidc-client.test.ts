/**
 * Tests for OIDC discovery loading and id_token verification.
 * Uses MSW to intercept fetch calls to discovery and JWKS endpoints.
 */

import { fromAny } from "@total-typescript/shoehorn";
import type { JWK } from "jose";
import type { JWTVerifyGetKey } from "jose";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { makeEs256Jwt, makeHs256Jwt, makeRsaJwt } from "../../test/auth/__fixtures__/jose-keys.js";
import { useMswServer } from "../../test/support/msw.js";
import { makePinoCapture } from "../../test/support/tool-test-utils.js";
import { REDACT_PATHS } from "../utils/log.js";
import { OAuthMetadataValidationError } from "./errors.js";
import { createJwksFor, loadDiscovery, verifyIdToken } from "./oidc-client.js";
import { nowSeconds } from "./tokens.js";

const server = useMswServer();

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

    const doc = (
      await loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256", "ES256"])
    )._unsafeUnwrap();

    expect(doc.issuer).toBe("https://idp.example.com");
    expect(doc.authorization_endpoint).toBe("https://idp.example.com/authorize");
    expect(doc.token_endpoint).toBe("https://idp.example.com/token");
    expect(doc.jwks_uri).toBe("https://idp.example.com/jwks");
    expect(doc.userinfo_endpoint).toBe("https://idp.example.com/userinfo");
    expect(doc.id_token_signing_alg_values_supported).toContain("RS256");
    expect(doc.id_token_signing_alg_values_supported).toContain("ES256");
  });

  describe("All endpoint URLs must be https://", () => {
    it("rejects discovery with http:// authorization_endpoint", async () => {
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

      // all endpoint URLs must be https://
      expect(
        (await loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"]))._unsafeUnwrapErr(),
      ).toBeInstanceOf(OAuthMetadataValidationError);
    });

    it("rejects discovery with http:// token_endpoint", async () => {
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

      // all endpoint URLs must be https://
      expect(
        (await loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"]))._unsafeUnwrapErr(),
      ).toBeInstanceOf(OAuthMetadataValidationError);
    });

    it("rejects discovery with http:// jwks_uri", async () => {
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

      // all endpoint URLs must be https://
      expect(
        (await loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"]))._unsafeUnwrapErr(),
      ).toBeInstanceOf(OAuthMetadataValidationError);
    });

    it("rejects discovery with http:// userinfo_endpoint (when present)", async () => {
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

      // all endpoint URLs must be https://
      expect(
        (await loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"]))._unsafeUnwrapErr(),
      ).toBeInstanceOf(OAuthMetadataValidationError);
    });

    it("rejects discovery with http:// issuer", async () => {
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

      // all endpoint URLs must be https://
      expect(
        (await loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"]))._unsafeUnwrapErr(),
      ).toBeInstanceOf(OAuthMetadataValidationError);
    });

    it("rejects discoveryUrl itself when http://", async () => {
      // discoveryUrl itself must be https://
      expect(
        (await loadDiscovery("http://idp.example.com/.well-known/openid-configuration", ["RS256"]))._unsafeUnwrapErr(),
      ).toBeInstanceOf(OAuthMetadataValidationError);
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

    expect(
      (await loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"]))._unsafeUnwrapErr(),
    ).toBeInstanceOf(OAuthMetadataValidationError);
  });

  it("non-2xx response → throws", async () => {
    server.use(
      http.get(
        "https://idp.example.com/.well-known/openid-configuration",
        () => new HttpResponse(null, { status: 404 }),
      ),
    );

    expect(
      (await loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"]))._unsafeUnwrapErr(),
    ).toBeInstanceOf(OAuthMetadataValidationError);
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

    expect(
      (await loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"]))._unsafeUnwrapErr(),
    ).toBeInstanceOf(OAuthMetadataValidationError);
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

    const doc = (
      await loadDiscovery("https://idp.example.com/.well-known/openid-configuration", ["RS256"])
    )._unsafeUnwrap();

    expect(doc.id_token_signing_alg_values_supported).toContain("RS256");
    expect(doc.id_token_signing_alg_values_supported).toContain("HS256");
  });

  describe("per-attempt logging", () => {
    const discoveryUrl = "https://idp.example.com/.well-known/openid-configuration";
    const allowedAlgs = ["RS256"];

    it("emits debug record on successful discovery", async () => {
      server.use(
        http.get(discoveryUrl, () =>
          HttpResponse.json({
            issuer: "https://idp.example.com",
            authorization_endpoint: "https://idp.example.com/authorize",
            token_endpoint: "https://idp.example.com/token",
            jwks_uri: "https://idp.example.com/jwks",
            id_token_signing_alg_values_supported: ["RS256"],
          }),
        ),
      );

      const { log, records } = makePinoCapture();
      (await loadDiscovery(discoveryUrl, allowedAlgs, log))._unsafeUnwrap();

      const startRecord = records.find((r) => r["msg"] === "oidc discovery start");
      expect(startRecord).toBeDefined();
      expect(startRecord?.["method"]).toBe("GET");
      expect(startRecord?.["url"]).toBe(discoveryUrl);
      expect(startRecord?.["attempt"]).toBe(1);

      const okRecord = records.find((r) => r["msg"] === "oidc discovery ok");
      expect(okRecord).toBeDefined();
      expect(okRecord?.["method"]).toBe("GET");
      expect(okRecord?.["url"]).toBe(discoveryUrl);
      expect(okRecord?.["attempt"]).toBe(1);
      expect(typeof okRecord?.["status"]).toBe("number");
      expect(typeof okRecord?.["attemptDurationMs"]).toBe("number");
    });

    it("emits error record on non-ok HTTP response", async () => {
      server.use(http.get(discoveryUrl, () => new HttpResponse(null, { status: 503 })));

      const { log, records } = makePinoCapture();
      expect((await loadDiscovery(discoveryUrl, allowedAlgs, log))._unsafeUnwrapErr()).toBeInstanceOf(
        OAuthMetadataValidationError,
      );

      const errorRecord = records.find((r) => r["msg"] === "oidc discovery returned non-ok");
      expect(errorRecord).toBeDefined();
      expect(errorRecord?.["method"]).toBe("GET");
      expect(errorRecord?.["url"]).toBe(discoveryUrl);
      expect(errorRecord?.["attempt"]).toBe(1);
      expect(errorRecord?.["status"]).toBe(503);
      expect(typeof errorRecord?.["attemptDurationMs"]).toBe("number");
    });

    it("emits error record on fetch network failure", async () => {
      server.use(http.get(discoveryUrl, () => HttpResponse.error()));

      const { log, records } = makePinoCapture();
      expect((await loadDiscovery(discoveryUrl, allowedAlgs, log))._unsafeUnwrapErr()).toBeInstanceOf(
        OAuthMetadataValidationError,
      );

      const errorRecord = records.find((r) => r["msg"] === "oidc discovery fetch failed");
      expect(errorRecord).toBeDefined();
      expect(errorRecord?.["method"]).toBe("GET");
      expect(errorRecord?.["url"]).toBe(discoveryUrl);
      expect(errorRecord?.["attempt"]).toBe(1);
      expect(errorRecord?.["err"]).toBeDefined();
    });

    it("no token-like values appear in any oidc-client log record", async () => {
      server.use(
        http.get(discoveryUrl, () =>
          HttpResponse.json({
            issuer: "https://idp.example.com",
            authorization_endpoint: "https://idp.example.com/authorize",
            token_endpoint: "https://idp.example.com/token",
            jwks_uri: "https://idp.example.com/jwks",
            id_token_signing_alg_values_supported: ["RS256"],
          }),
        ),
      );

      const { log, records } = makePinoCapture();
      (await loadDiscovery(discoveryUrl, allowedAlgs, log))._unsafeUnwrap();

      // Verify REDACT_PATHS are not present as keys in any log record
      for (const record of records) {
        for (const path of REDACT_PATHS) {
          // Top-level path keys (e.g. "authorization" → check for "authorization" key)
          const topLevelKey = path.split(".")[0];
          if (topLevelKey !== undefined) {
            expect(record[topLevelKey], `log record should not contain '${topLevelKey}' (REDACT_PATH)`).toBeUndefined();
          }
        }
      }
    });
  });
});

describe("verifyIdToken", () => {
  const baseUrl = "https://idp.example.com";
  const discoveryUrl = `${baseUrl}/.well-known/openid-configuration`;
  const jwksUrl = `${baseUrl}/jwks`;
  const clientId = "client-x";
  const issuer = baseUrl;

  /**
   * F10: Installs MSW discovery + JWKS handlers, then loads the discovery doc
   * and creates a JWTVerifyGetKey — reducing the 3-step boilerplate that
   * appeared in every verifyIdToken test to a single await call.
   *
   * @param jwk  - The public JWK to serve from the /jwks endpoint
   * @param algs - Signing algorithms to advertise; defaults to ["RS256"]
   */
  async function setupJwks(jwk: JWK, algs: ReadonlyArray<string> = ["RS256"]): Promise<JWTVerifyGetKey> {
    server.use(
      http.get(discoveryUrl, () =>
        HttpResponse.json({
          issuer,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          jwks_uri: jwksUrl,
          id_token_signing_alg_values_supported: [...algs],
        }),
      ),
      http.get(jwksUrl, () => HttpResponse.json({ keys: [jwk] })),
    );
    const discovery = (await loadDiscovery(discoveryUrl, [...algs]))._unsafeUnwrap();
    return createJwksFor(discovery);
  }

  it("RS256-signed id_token verifies and returns payload", async () => {
    // upstream id_token signed with RS256 verifies (default allowlist)
    const nonce = "n-1";
    const now = nowSeconds();

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

    const jwks = await setupJwks(jwk);

    const payload = (
      await verifyIdToken(token, jwks, {
        clientId,
        issuer,
        nonce,
        allowedAlgs: ["RS256"],
      })
    )._unsafeUnwrap();

    expect(payload.sub).toBe("user-1");
    expect(payload.email).toBe("user@x.com");
    expect(payload.email_verified).toBe(true);
  });

  it("ES256-signed id_token verifies", async () => {
    // upstream id_token signed with ES256 verifies (default allowlist)
    const nonce = "n-2";
    const now = nowSeconds();

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

    const jwks = await setupJwks(jwk, ["ES256"]);

    const payload = (
      await verifyIdToken(token, jwks, {
        clientId,
        issuer,
        nonce,
        allowedAlgs: ["ES256"],
      })
    )._unsafeUnwrap();

    expect(payload.sub).toBe("user-2");
    expect(payload.email).toBe("user2@x.com");
  });

  it("id_token with alg=none is rejected", async () => {
    // id_token with alg='none' rejected by verifyIdToken
    const nonce = "n-3";
    const now = nowSeconds();

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

    const jwks = await setupJwks(jwk);

    expect(
      (
        await verifyIdToken(noneToken, jwks, {
          clientId,
          issuer,
          nonce,
          allowedAlgs: ["RS256"],
        })
      )._unsafeUnwrapErr(),
    ).toBeInstanceOf(OAuthMetadataValidationError);
  });

  it("id_token signed with HS256 is rejected", async () => {
    // id_token signed with HS256 rejected by verifyIdToken.
    // Tests defense against the JWS algorithm-confusion attack — jose's algorithms
    // allowlist must reject HS256 tokens even if (especially if) the JWKS happens to
    // contain matching key material.
    const nonce = "n-4";
    const now = nowSeconds();

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

    const jwks = await setupJwks(rsaJwk);

    expect(
      (
        await verifyIdToken(hs256Token, jwks, {
          clientId,
          issuer,
          nonce,
          allowedAlgs: ["RS256", "ES256"], // default allowlist
        })
      )._unsafeUnwrapErr(),
    ).toBeInstanceOf(OAuthMetadataValidationError);
  });

  it("rejects expired id_token (exp in the past)", async () => {
    const nonce = "n-exp";
    const now = nowSeconds();

    const { token, jwk } = await makeRsaJwt({
      iss: issuer,
      aud: clientId,
      sub: "user-exp",
      nonce,
      exp: now - 60, // Expired 60 seconds ago
      iat: now - 120,
    });

    const jwks = await setupJwks(jwk);

    expect(
      (
        await verifyIdToken(token, jwks, {
          clientId,
          issuer,
          nonce,
          allowedAlgs: ["RS256"],
        })
      )._unsafeUnwrapErr(),
    ).toBeInstanceOf(OAuthMetadataValidationError);
  });

  it("rejects wrong audience", async () => {
    const nonce = "n-aud";
    const now = nowSeconds();

    const { token, jwk } = await makeRsaJwt({
      iss: issuer,
      aud: "wrong-client",
      sub: "user-aud",
      nonce,
      exp: now + 60,
      iat: now,
    });

    const jwks = await setupJwks(jwk);

    expect(
      (
        await verifyIdToken(token, jwks, {
          clientId, // "client-x", but token has "wrong-client"
          issuer,
          nonce,
          allowedAlgs: ["RS256"],
        })
      )._unsafeUnwrapErr(),
    ).toBeInstanceOf(OAuthMetadataValidationError);
  });

  it("rejects wrong issuer", async () => {
    const nonce = "n-iss";
    const now = nowSeconds();

    const { token, jwk } = await makeRsaJwt({
      iss: "https://wrong-idp.example.com",
      aud: clientId,
      sub: "user-iss",
      nonce,
      exp: now + 60,
      iat: now,
    });

    const jwks = await setupJwks(jwk);

    expect(
      (
        await verifyIdToken(token, jwks, {
          clientId,
          issuer, // "https://idp.example.com", but token has wrong issuer
          nonce,
          allowedAlgs: ["RS256"],
        })
      )._unsafeUnwrapErr(),
    ).toBeInstanceOf(OAuthMetadataValidationError);
  });

  it("id_token with mismatched nonce is rejected after signature verification", async () => {
    // mismatched nonce AND missing nonce are rejected
    const expectedNonce = "n-expected";
    const wrongNonce = "n-wrong";
    const now = nowSeconds();

    const { token, jwk } = await makeRsaJwt({
      iss: issuer,
      aud: clientId,
      sub: "user-nonce",
      nonce: wrongNonce,
      exp: now + 60,
      iat: now,
    });

    const jwks = await setupJwks(jwk);

    expect(
      (
        await verifyIdToken(token, jwks, {
          clientId,
          issuer,
          nonce: expectedNonce, // Expects "n-expected" but token has "n-wrong"
          allowedAlgs: ["RS256"],
        })
      )._unsafeUnwrapErr(),
    ).toBeInstanceOf(OAuthMetadataValidationError);
  });

  it("id_token with no nonce claim is rejected (nonce required)", async () => {
    // mismatched nonce AND missing nonce are rejected
    const nonce = "n-required";
    const now = nowSeconds();

    const { token, jwk } = await makeRsaJwt({
      iss: issuer,
      aud: clientId,
      sub: "user-no-nonce",
      // Missing nonce claim
      exp: now + 60,
      iat: now,
    });

    const jwks = await setupJwks(jwk);

    expect(
      (
        await verifyIdToken(token, jwks, {
          clientId,
          issuer,
          nonce,
          allowedAlgs: ["RS256"],
        })
      )._unsafeUnwrapErr(),
    ).toBeInstanceOf(OAuthMetadataValidationError);
  });

  it("accepts array-valued aud claim (Microsoft Entra compatibility)", async () => {
    // Entra emits array `aud`. Schema must accept both.
    const nonce = "n-aud-array";
    const now = nowSeconds();

    const { token, jwk } = await makeRsaJwt({
      iss: issuer,
      aud: [clientId, "other-client"],
      sub: "user-aud-array",
      nonce,
      exp: now + 60,
      iat: now,
    });

    const jwks = await setupJwks(jwk);

    const payload = (
      await verifyIdToken(token, jwks, {
        clientId,
        issuer,
        nonce,
        allowedAlgs: ["RS256"],
      })
    )._unsafeUnwrap();

    expect(Array.isArray(payload.aud)).toBe(true);
    expect(payload.aud).toContain(clientId);
    expect(payload.aud).toContain("other-client");
  });

  it("coerces string email_verified to boolean (older Entra/Keycloak compatibility)", async () => {
    // Older Entra tenants emit "true"/"false" as strings.
    const nonce = "n-email-verified-string";
    const now = nowSeconds();

    const { token, jwk } = await makeRsaJwt({
      iss: issuer,
      aud: clientId,
      sub: "user-email-string",
      email: "user@x.com",
      email_verified: fromAny("true"), // intentional cast to test coercion
      nonce,
      exp: now + 60,
      iat: now,
    });

    const jwks = await setupJwks(jwk);

    const payload = (
      await verifyIdToken(token, jwks, {
        clientId,
        issuer,
        nonce,
        allowedAlgs: ["RS256"],
      })
    )._unsafeUnwrap();

    expect(payload.email_verified).toBe(true);
    expect(typeof payload.email_verified).toBe("boolean");
  });
});
