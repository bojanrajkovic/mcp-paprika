/**
 * OIDC preset table and resolver.
 *
 * Provides five built-in OIDC presets (google, entra, okta, auth0, keycloak)
 * and a resolver function that merges preset defaults with operator-supplied overrides.
 */

import { Result, ok, err } from "neverthrow";
import { OAuthConfigError } from "./errors.js";
import type { OIDCPreset, ResolvedOAuthConfig, EmailVerifiedPolicy } from "./types.js";

// ============================================================================
// OIDC Presets Table
// ============================================================================

/**
 * Built-in OIDC provider presets.
 *
 * Google includes discoveryUrl (well-known endpoint). Entra, Okta, Auth0, Keycloak
 * are tenant-bound and require operator-supplied discoveryUrl.
 */
export const OIDC_PRESETS = Object.freeze({
  google: {
    discoveryUrl: "https://accounts.google.com/.well-known/openid-configuration",
    scopes: ["openid", "email", "profile"] as const,
    emailVerifiedPolicy: "strict" as const,
    allowedAlgs: ["RS256"] as const,
  },
  entra: {
    scopes: ["openid", "email", "profile"] as const,
    emailVerifiedPolicy: "strict" as const,
    allowedAlgs: ["RS256"] as const,
  },
  okta: {
    scopes: ["openid", "email", "profile"] as const,
    emailVerifiedPolicy: "strict" as const,
    allowedAlgs: ["RS256"] as const,
  },
  auth0: {
    scopes: ["openid", "email", "profile"] as const,
    emailVerifiedPolicy: "if-present" as const,
    allowedAlgs: ["RS256"] as const,
  },
  keycloak: {
    scopes: ["openid", "email", "profile"] as const,
    emailVerifiedPolicy: "strict" as const,
    allowedAlgs: ["RS256", "ES256"] as const,
  },
} as const satisfies Record<string, OIDCPreset>);

/**
 * String literal union of known preset names.
 */
export type PresetName = keyof typeof OIDC_PRESETS;

/**
 * Partial configuration that may be supplied as overrides to resolvePreset.
 * These are the fields that can be overridden per preset.
 */
type PartialResolvedConfig = Partial<
  Pick<ResolvedOAuthConfig, "discoveryUrl" | "scopes" | "emailVerifiedPolicy" | "allowedAlgs">
>;

/**
 * Result type for resolvePreset. Represents the fully merged configuration
 * after preset expansion, but excludes publicUrl, clientId, clientSecret, and
 * allowlist fields, which are handled separately during config merging in `build.ts`.
 * This narrowing is by design: presets define provider configuration only,
 * while global OAuth config provides deployment-specific fields.
 */
type PartialResolvedConfigResult = {
  readonly presetName: string | null;
  readonly discoveryUrl: string;
  readonly scopes: ReadonlyArray<string>;
  readonly emailVerifiedPolicy: EmailVerifiedPolicy;
  readonly allowedAlgs: ReadonlyArray<string>;
};

/**
 * Tenant names that require an operator-supplied discoveryUrl.
 * These four presets share identical resolution logic; they differ only in their
 * preset-table entry (scopes, emailVerifiedPolicy, allowedAlgs defaults).
 */
type TenantBoundName = "entra" | "okta" | "auth0" | "keycloak";

/** Shared type for the four tenant-bound OIDC_PRESETS entries (no discoveryUrl). */
type TenantBoundPreset = Omit<OIDCPreset, "discoveryUrl">;

/**
 * Resolves a tenant-bound preset (entra, okta, auth0, keycloak).
 * These presets require an operator-supplied discoveryUrl because the provider
 * is multi-tenant — there is no single well-known discovery endpoint.
 */
function resolveTenantBound(
  name: TenantBoundName,
  preset: TenantBoundPreset,
  overrides: PartialResolvedConfig,
): Result<PartialResolvedConfigResult, OAuthConfigError> {
  if (!overrides.discoveryUrl) {
    return err(OAuthConfigError.missingDiscoveryUrl(name));
  }
  return ok({
    presetName: name,
    discoveryUrl: overrides.discoveryUrl,
    scopes: overrides.scopes ?? preset.scopes,
    emailVerifiedPolicy: overrides.emailVerifiedPolicy ?? preset.emailVerifiedPolicy,
    allowedAlgs: overrides.allowedAlgs ?? preset.allowedAlgs,
  });
}

/**
 * Resolves an OIDC preset with optional overrides.
 *
 * Three paths:
 * 1. name === undefined: custom discovery URL mode. Requires overrides to supply
 *    discoveryUrl, scopes, emailVerifiedPolicy, allowedAlgs. Returns err if any missing.
 * 2. name is known preset with built-in discoveryUrl (google): returns preset merged with overrides.
 * 3. name is tenant-bound preset (entra, okta, auth0, keycloak): requires overrides.discoveryUrl
 *    or returns err. Returns err(missingDiscoveryUrl(name)) if override missing.
 * 4. name is unknown: returns err(unknownPreset(name)) (defensive).
 *
 * @param name - Preset name or undefined for raw discovery URL mode
 * @param overrides - Fields to override preset defaults
 * @returns Result containing fully merged config or OAuthConfigError
 */
export function resolvePreset(
  name: PresetName | undefined,
  overrides: PartialResolvedConfig,
): Result<PartialResolvedConfigResult, OAuthConfigError> {
  // Path 1: Custom discovery URL (no preset)
  if (name === undefined) {
    const missingFields: Array<keyof PartialResolvedConfig> = [];

    if (!overrides.discoveryUrl) missingFields.push("discoveryUrl");
    if (!overrides.scopes) missingFields.push("scopes");
    if (!overrides.emailVerifiedPolicy) missingFields.push("emailVerifiedPolicy");
    if (!overrides.allowedAlgs) missingFields.push("allowedAlgs");

    if (missingFields.length > 0) {
      // missingFields.length > 0 guarantees [0] is defined; the non-null assertion just
      // satisfies noUncheckedIndexedAccess without inventing an unreachable fallback branch.
      return err(OAuthConfigError.missingPresetOrDiscovery(missingFields[0]!));
    }

    // All required fields present in overrides
    // At this point, TypeScript knows all these are defined
    return ok({
      presetName: null,
      discoveryUrl: overrides.discoveryUrl!,
      scopes: overrides.scopes!,
      emailVerifiedPolicy: overrides.emailVerifiedPolicy!,
      allowedAlgs: overrides.allowedAlgs!,
    });
  }

  // Path 2-4: Preset name provided
  // Handle each known preset by name
  switch (name) {
    case "google": {
      const preset = OIDC_PRESETS.google;
      return ok({
        presetName: name,
        discoveryUrl: overrides.discoveryUrl ?? preset.discoveryUrl,
        scopes: overrides.scopes ?? preset.scopes,
        emailVerifiedPolicy: overrides.emailVerifiedPolicy ?? preset.emailVerifiedPolicy,
        allowedAlgs: overrides.allowedAlgs ?? preset.allowedAlgs,
      });
    }

    case "entra":
      return resolveTenantBound(name, OIDC_PRESETS.entra, overrides);

    case "okta":
      return resolveTenantBound(name, OIDC_PRESETS.okta, overrides);

    case "auth0":
      return resolveTenantBound(name, OIDC_PRESETS.auth0, overrides);

    case "keycloak":
      return resolveTenantBound(name, OIDC_PRESETS.keycloak, overrides);

    default:
      return err(OAuthConfigError.unknownPreset(name as string));
  }
}
