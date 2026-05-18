import { AuthRequestStateSchema, AuthCodeStateSchema } from "../types.js";
import type { AuthRequestState, AuthCodeState } from "../types.js";

/**
 * Defaults shared by AuthRequestState and AuthCodeState test factories.
 * Captures the seven fields the two schemas have in common; the per-factory
 * functions below add their schema-specific fields and merge caller overrides.
 */
const SHARED_STATE_DEFAULTS = {
  clientId: "00000000-0000-0000-0000-000000000001",
  codeChallenge: "dGVzdC1jb2RlLWNoYWxsZW5nZS10ZXN0LWNvZGUtY2hhbGxlbmdl",
  codeChallengeMethod: "S256",
  redirectUri: "http://localhost:3000/callback",
  resource: "https://api.example.com",
  scope: "openid email profile",
} as const;

/**
 * Factory for creating test AuthRequestState objects.
 * All fields required by AuthRequestStateSchema are provided as defaults.
 */
export function makeAuthRequestState(overrides?: Partial<AuthRequestState>): AuthRequestState {
  return AuthRequestStateSchema.parse({
    ...SHARED_STATE_DEFAULTS,
    claudeState: "claude-state-1",
    ourNonce: "nonce-1",
    createdAt: Math.floor(Date.now() / 1000),
    ...overrides,
  });
}

/**
 * Factory for creating test AuthCodeState objects.
 * All fields required by AuthCodeStateSchema are provided as defaults.
 */
export function makeAuthCodeState(overrides?: Partial<AuthCodeState>): AuthCodeState {
  return AuthCodeStateSchema.parse({
    ...SHARED_STATE_DEFAULTS,
    identity: {
      email: "test@example.com",
      sub: "sub-test-1",
      source: "email",
    },
    createdAt: Math.floor(Date.now() / 1000),
    ...overrides,
  });
}
