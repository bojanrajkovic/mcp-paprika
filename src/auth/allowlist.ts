/**
 * Identity verification against allowlists with email_verified policy enforcement.
 *
 * Pure function — no I/O, no side effects. Returns Result<VerifiedIdentity, OAuthAllowlistDenialError>.
 *
 * Algorithm (email-precedence):
 * 1. If email would be admitted (email in list AND policy allows), return with source=email
 * 2. If email is in list but policy denies, return emailNotVerified error (blocks sub fallback)
 * 3. Else if sub is in allowlist, return with source=sub
 * 4. Else return notAllowlisted error
 *
 * Policy semantics:
 * - strict: require email_verified === true; undefined or false both deny
 * - skip: ignore email_verified entirely
 * - if-present: deny only if email_verified === false; undefined (missing) is OK
 */

import { err, ok, type Result } from "neverthrow";

import type { EmailVerifiedPolicy, IdTokenPayload } from "./types.js";

import { OAuthAllowlistDenialError } from "./errors.js";

export interface AllowlistInput {
  readonly emails: ReadonlySet<string>;
  readonly subs: ReadonlySet<string>;
}

export interface VerifiedIdentity {
  readonly email: string | null;
  readonly sub: string;
  readonly source: "email" | "sub";
}

/**
 * Determines if a policy allows the given email_verified claim.
 *
 * @param verified The email_verified claim from the id_token (true | false | undefined)
 * @param policy The email verification policy (strict | skip | if-present)
 * @returns true if policy allows; false if policy denies
 */
function policyAllows(verified: boolean | undefined, policy: EmailVerifiedPolicy): boolean {
  switch (policy) {
    case "strict":
      // Only true is allowed; false and undefined both deny
      return verified === true;
    case "skip":
      // Always allow, ignore verified entirely
      return true;
    case "if-present":
      // Allow if verified is true or undefined; deny only if false
      return verified !== false;
  }
}

/**
 * Verifies an identity against email and sub allowlists with email_verified policy enforcement.
 *
 * @param payload The id_token payload from upstream OIDC provider
 * @param policy The email verification policy (strict | skip | if-present)
 * @param allowlist Email and sub allowlists as ReadonlySets
 * @returns Ok(VerifiedIdentity) if admitted; Err(OAuthAllowlistDenialError) if denied
 */
export function verifyIdentity(
  payload: IdTokenPayload,
  policy: EmailVerifiedPolicy,
  allowlist: AllowlistInput,
): Result<VerifiedIdentity, OAuthAllowlistDenialError> {
  const email = payload.email;
  const sub = payload.sub;
  const verified = payload.email_verified;

  // Step 1: Resolve email match — would email be admitted by policy?
  const emailWouldAdmit = email && allowlist.emails.has(email) && policyAllows(verified, policy);

  // Step 2: If email would be admitted, return with source=email
  if (emailWouldAdmit) {
    return ok({ email, sub, source: "email" });
  }

  // Step 3: Else if sub is in allowlist, return with source=sub
  // (sub does not depend on email_verified, so this is a fallback)
  if (sub && allowlist.subs.has(sub)) {
    return ok({ email: email ?? null, sub, source: "sub" });
  }

  // Step 4: Else if email is in list but policy denies it, return emailNotVerified error
  // (This is only reached if sub did not match, ensuring email takes precedence)
  if (email && allowlist.emails.has(email) && !policyAllows(verified, policy)) {
    return err(OAuthAllowlistDenialError.emailNotVerified(email, policy));
  }

  // Step 5: Neither email nor sub admitted the identity
  return err(OAuthAllowlistDenialError.notAllowlisted(email ?? null, sub));
}
