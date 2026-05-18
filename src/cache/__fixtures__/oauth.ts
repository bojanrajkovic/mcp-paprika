import { randomUUID as cryptoRandomUUID } from "node:crypto";
import type { OAuthClient, OAuthToken } from "../../auth/types.js";

let oauthClientCounter = 0;
let oauthTokenCounter = 0;

/**
 * Factory for creating test OAuthClient objects.
 * Generates defaults matching OAuthClientSchema requirements.
 */
export function makeOAuthClient(overrides?: Partial<OAuthClient>): OAuthClient {
  oauthClientCounter++;
  // Generate a deterministic UUID-shaped string for testing, or use override
  const clientId =
    overrides?.clientId ??
    `${oauthClientCounter}`.padStart(8, "0") + `-0000-4000-8000-0000000${oauthClientCounter}`.padEnd(36 - 8, "0");
  const now = Math.floor(Date.now() / 1000);

  return {
    clientId,
    clientIdIssuedAt: now,
    registrationAccessTokenHash: "a".repeat(64), // 64-char hex default
    tokenEndpointAuthMethod: "none",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    redirectUris: ["http://localhost:3000/callback"],
    scope: "openid email profile",
    clientName: `Test OAuth Client ${oauthClientCounter}`,
    createdAt: now,
    updatedAt: now,
    lastTokenActivityAt: now,
    ...overrides,
  };
}

/**
 * Factory for creating test OAuthToken objects.
 * Generates defaults matching OAuthTokenSchema requirements.
 */
export function makeOAuthToken(overrides?: Partial<OAuthToken>): OAuthToken {
  oauthTokenCounter++;
  const now = Math.floor(Date.now() / 1000);

  return {
    tokenHash: "b".repeat(64), // 64-char hex default
    kind: "access",
    clientId: cryptoRandomUUID(),
    scope: "openid email profile",
    identity: {
      email: `test${oauthTokenCounter}@example.com`,
      sub: `sub-${oauthTokenCounter}`,
      source: "email",
    },
    resource: "https://api.example.com",
    expiresAt: now + 3600,
    createdAt: now,
    ...overrides,
  };
}
