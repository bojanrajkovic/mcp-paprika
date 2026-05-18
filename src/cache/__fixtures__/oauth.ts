import { createHash, randomUUID } from "node:crypto";
import { OAuthClientSchema, OAuthTokenSchema } from "../../auth/types.js";
import type { OAuthClient, OAuthToken } from "../../auth/types.js";

/**
 * Factory for creating test OAuthClient objects.
 * Generates defaults matching OAuthClientSchema requirements.
 */
export function makeOAuthClient(overrides?: Partial<OAuthClient>): OAuthClient {
  const now = Math.floor(Date.now() / 1000);

  const candidate: OAuthClient = {
    clientId: overrides?.clientId ?? randomUUID(),
    clientIdIssuedAt: now,
    registrationAccessTokenHash:
      overrides?.registrationAccessTokenHash ?? createHash("sha256").update("default-rat").digest("hex"),
    tokenEndpointAuthMethod: "none",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    redirectUris: ["http://localhost:3000/callback"],
    scope: "openid email profile",
    clientName: `Test OAuth Client ${randomUUID().substring(0, 8)}`,
    createdAt: now,
    updatedAt: now,
    lastTokenActivityAt: now,
    ...overrides,
  };

  return OAuthClientSchema.parse(candidate);
}

/**
 * Factory for creating test OAuthToken objects.
 * Generates defaults matching OAuthTokenSchema requirements.
 */
export function makeOAuthToken(overrides?: Partial<OAuthToken>): OAuthToken {
  const now = Math.floor(Date.now() / 1000);

  const candidate: OAuthToken = {
    tokenHash: overrides?.tokenHash ?? createHash("sha256").update(`token-${randomUUID()}`).digest("hex"),
    kind: "access",
    clientId: overrides?.clientId ?? randomUUID(),
    scope: "openid email profile",
    identity: {
      email: `test-${randomUUID().substring(0, 8)}@example.com`,
      sub: `sub-${randomUUID().substring(0, 8)}`,
      source: "email",
    },
    resource: "https://api.example.com",
    expiresAt: now + 3600,
    createdAt: now,
    ...overrides,
  };

  return OAuthTokenSchema.parse(candidate);
}
