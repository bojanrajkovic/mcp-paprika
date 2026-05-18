/**
 * Shared test utilities for OAuth auth module tests.
 * Exported for reuse across allowlist + oidc-client tests.
 */

import fc from "fast-check";
import type { IdTokenPayload } from "../types.js";

/**
 * Arbitrary factory for IdTokenPayload — generates valid id_token payloads for property testing.
 * Covers all required fields and optional email/email_verified variations.
 * Email is nullable (absent ~25% of the time).
 */
export function arbitraryIdTokenPayload(): fc.Arbitrary<IdTokenPayload> {
  return fc.record({
    iss: fc
      .tuple(fc.constantFrom("http", "https"), fc.webAuthority())
      .map(([scheme, authority]) => `${scheme}://${authority}`),
    sub: fc.string({ minLength: 1 }),
    aud: fc.string({ minLength: 1 }),
    email: fc.option(fc.emailAddress()),
    email_verified: fc.option(fc.boolean()),
    nonce: fc.string({ minLength: 1 }),
    exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
    iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
  });
}

/**
 * Arbitrary factory for IdTokenPayload with guaranteed email — for properties that require a valid email.
 * Never generates undefined or null email.
 */
export function arbitraryIdTokenPayloadWithEmail(): fc.Arbitrary<IdTokenPayload> {
  return fc.record({
    iss: fc
      .tuple(fc.constantFrom("http", "https"), fc.webAuthority())
      .map(([scheme, authority]) => `${scheme}://${authority}`),
    sub: fc.string({ minLength: 1 }),
    aud: fc.string({ minLength: 1 }),
    email: fc.emailAddress(),
    email_verified: fc.option(fc.boolean()),
    nonce: fc.string({ minLength: 1 }),
    exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
    iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
  });
}

/**
 * Arbitrary factory for AllowlistInput — generates email and sub allowlists.
 */
export function arbitraryAllowlist(): fc.Arbitrary<{ emails: Set<string>; subs: Set<string> }> {
  return fc
    .tuple(fc.set(fc.emailAddress(), { maxLength: 5 }), fc.set(fc.string({ minLength: 1 }), { maxLength: 5 }))
    .map(([emails, subs]) => ({
      emails: new Set(emails),
      subs: new Set(subs),
    }));
}
