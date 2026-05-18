/**
 * OIDC preset table and resolver.
 *
 * Provides five built-in OIDC presets (google, entra, okta, auth0, keycloak)
 * and a resolver function that merges preset defaults with operator-supplied overrides.
 */

import { Result, ok, err } from "neverthrow";
import { OAuthConfigError } from "./errors.js";
import type { OIDCPreset, ResolvedOAuthConfig } from "./types.js";

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

type PartialResolvedConfigResult = {
  readonly presetName: string | null;
  readonly discoveryUrl: string;
  readonly scopes: ReadonlyArray<string>;
  readonly emailVerifiedPolicy: "strict" | "skip" | "if-present";
  readonly allowedAlgs: ReadonlyArray<string>;
};

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
      const firstMissing = missingFields[0];
      if (!firstMissing) {
        // Should never happen, but TypeScript needs this check
        return err(OAuthConfigError.missingPresetOrDiscovery("discoveryUrl"));
      }
      return err(OAuthConfigError.missingPresetOrDiscovery(firstMissing));
    }

    // All required fields present in overrides
    // At this point, TypeScript knows all these are defined
    const discoveryUrl = overrides.discoveryUrl as string;
    const scopes = overrides.scopes as ReadonlyArray<string>;
    const emailVerifiedPolicy = overrides.emailVerifiedPolicy as "strict" | "skip" | "if-present";
    const allowedAlgs = overrides.allowedAlgs as ReadonlyArray<string>;

    return ok({
      presetName: null,
      discoveryUrl,
      scopes,
      emailVerifiedPolicy,
      allowedAlgs,
    });
  }

  // Path 2-4: Preset name provided
  // Handle each known preset by name
  switch (name) {
    case "google": {
      const preset = OIDC_PRESETS.google;
      const discoveryUrl = overrides.discoveryUrl ?? preset.discoveryUrl;
      const scopes = (overrides.scopes ?? preset.scopes) as ReadonlyArray<string>;
      const emailVerifiedPolicy = (overrides.emailVerifiedPolicy ?? preset.emailVerifiedPolicy) as
        | "strict"
        | "skip"
        | "if-present";
      const allowedAlgs = (overrides.allowedAlgs ?? preset.allowedAlgs) as ReadonlyArray<string>;
      return ok({
        presetName: name,
        discoveryUrl,
        scopes,
        emailVerifiedPolicy,
        allowedAlgs,
      });
    }

    case "entra": {
      const preset = OIDC_PRESETS.entra;
      if (!overrides.discoveryUrl) {
        return err(OAuthConfigError.missingDiscoveryUrl(name));
      }
      const scopes = (overrides.scopes ?? preset.scopes) as ReadonlyArray<string>;
      const emailVerifiedPolicy = (overrides.emailVerifiedPolicy ?? preset.emailVerifiedPolicy) as
        | "strict"
        | "skip"
        | "if-present";
      const allowedAlgs = (overrides.allowedAlgs ?? preset.allowedAlgs) as ReadonlyArray<string>;
      return ok({
        presetName: name,
        discoveryUrl: overrides.discoveryUrl,
        scopes,
        emailVerifiedPolicy,
        allowedAlgs,
      });
    }

    case "okta": {
      const preset = OIDC_PRESETS.okta;
      if (!overrides.discoveryUrl) {
        return err(OAuthConfigError.missingDiscoveryUrl(name));
      }
      const scopes = (overrides.scopes ?? preset.scopes) as ReadonlyArray<string>;
      const emailVerifiedPolicy = (overrides.emailVerifiedPolicy ?? preset.emailVerifiedPolicy) as
        | "strict"
        | "skip"
        | "if-present";
      const allowedAlgs = (overrides.allowedAlgs ?? preset.allowedAlgs) as ReadonlyArray<string>;
      return ok({
        presetName: name,
        discoveryUrl: overrides.discoveryUrl,
        scopes,
        emailVerifiedPolicy,
        allowedAlgs,
      });
    }

    case "auth0": {
      const preset = OIDC_PRESETS.auth0;
      if (!overrides.discoveryUrl) {
        return err(OAuthConfigError.missingDiscoveryUrl(name));
      }
      const scopes = (overrides.scopes ?? preset.scopes) as ReadonlyArray<string>;
      const emailVerifiedPolicy = (overrides.emailVerifiedPolicy ?? preset.emailVerifiedPolicy) as
        | "strict"
        | "skip"
        | "if-present";
      const allowedAlgs = (overrides.allowedAlgs ?? preset.allowedAlgs) as ReadonlyArray<string>;
      return ok({
        presetName: name,
        discoveryUrl: overrides.discoveryUrl,
        scopes,
        emailVerifiedPolicy,
        allowedAlgs,
      });
    }

    case "keycloak": {
      const preset = OIDC_PRESETS.keycloak;
      if (!overrides.discoveryUrl) {
        return err(OAuthConfigError.missingDiscoveryUrl(name));
      }
      const scopes = (overrides.scopes ?? preset.scopes) as ReadonlyArray<string>;
      const emailVerifiedPolicy = (overrides.emailVerifiedPolicy ?? preset.emailVerifiedPolicy) as
        | "strict"
        | "skip"
        | "if-present";
      const allowedAlgs = (overrides.allowedAlgs ?? preset.allowedAlgs) as ReadonlyArray<string>;
      return ok({
        presetName: name,
        discoveryUrl: overrides.discoveryUrl,
        scopes,
        emailVerifiedPolicy,
        allowedAlgs,
      });
    }

    default:
      return err(OAuthConfigError.unknownPreset(name as string));
  }
}
