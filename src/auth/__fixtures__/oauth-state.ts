import { AuthRequestStateSchema, AuthCodeStateSchema } from "../types.js";
import type { AuthRequestState, AuthCodeState } from "../types.js";

/**
 * Factory for creating test AuthRequestState objects.
 * All fields required by AuthRequestStateSchema are provided as defaults.
 */
export function makeAuthRequestState(overrides?: Partial<AuthRequestState>): AuthRequestState {
  const now = Math.floor(Date.now() / 1000);

  const candidate: AuthRequestState = {
    clientId: "00000000-0000-0000-0000-000000000001",
    codeChallenge: "dGVzdC1jb2RlLWNoYWxsZW5nZS10ZXN0LWNvZGUtY2hhbGxlbmdl",
    codeChallengeMethod: "S256",
    redirectUri: "http://localhost:3000/callback",
    resource: "https://api.example.com",
    claudeState: "claude-state-1",
    scope: "openid email profile",
    ourNonce: "nonce-1",
    createdAt: now,
    ...overrides,
  };

  return AuthRequestStateSchema.parse(candidate);
}

/**
 * Factory for creating test AuthCodeState objects.
 * All fields required by AuthCodeStateSchema are provided as defaults.
 */
export function makeAuthCodeState(overrides?: Partial<AuthCodeState>): AuthCodeState {
  const now = Math.floor(Date.now() / 1000);

  const candidate: AuthCodeState = {
    clientId: "00000000-0000-0000-0000-000000000001",
    codeChallenge: "dGVzdC1jb2RlLWNoYWxsZW5nZS10ZXN0LWNvZGUtY2hhbGxlbmdl",
    codeChallengeMethod: "S256",
    redirectUri: "http://localhost:3000/callback",
    resource: "https://api.example.com",
    scope: "openid email profile",
    identity: {
      email: "test@example.com",
      sub: "sub-test-1",
      source: "email",
    },
    createdAt: now,
    ...overrides,
  };

  return AuthCodeStateSchema.parse(candidate);
}
