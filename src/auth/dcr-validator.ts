/**
 * RFC 7591 / RFC 7592 client metadata validation for public clients only.
 *
 * Validates client registration and update metadata against our public-client-only invariants:
 * - token_endpoint_auth_method must be "none" (public client)
 * - grant_types subset of ["authorization_code", "refresh_token"]
 * - response_types exactly ["code"] (OAuth 2.1 forbids implicit/hybrid)
 * - redirect_uris required with https:// or localhost/127.0.0.1 http://
 * - id_token_signed_response_alg optional, must be RS256 or ES256 if present
 * - scope preserved but non-empty
 */

import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { OAuthMetadataValidationError } from "./errors.js";

// ============================================================================
// Validated Output Type
// ============================================================================

export interface ValidatedClientMetadata {
  readonly tokenEndpointAuthMethod: "none";
  readonly grantTypes: ReadonlyArray<"authorization_code" | "refresh_token">;
  readonly responseTypes: ReadonlyArray<"code">;
  readonly redirectUris: ReadonlyArray<string>;
  readonly scope: string;
  readonly clientName?: string;
  readonly idTokenSignedResponseAlg?: string;
}

// ============================================================================
// Validation Logic
// ============================================================================

// Helper: validate redirect URI scheme and hostname
function isValidRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);

    // https is always OK
    if (url.protocol === "https:") {
      return true;
    }

    // http only OK for localhost / 127.0.0.1 / [::1]
    if (url.protocol === "http:") {
      const hostname = url.hostname;
      return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    }

    return false;
  } catch {
    return false;
  }
}

// Helper: allowed signing algorithms for id_token
const ALLOWED_SIGNING_ALGS = ["RS256", "ES256"] as const;

// Schema for validateRegistration (all required fields)
// We accept any value for auth_method/grant_types/response_types and validate them in the rules
const RegistrationMetadataSchema = z
  .object({
    token_endpoint_auth_method: z.any().optional(),
    grant_types: z.any().optional(),
    response_types: z.any().optional(),
    redirect_uris: z.any().optional(),
    scope: z.any().optional(),
    client_name: z.string().optional(),
    id_token_signed_response_alg: z.string().optional(),
  })
  .passthrough(); // Allow and preserve other RFC 7591 fields

type RegistrationMetadataInput = z.infer<typeof RegistrationMetadataSchema>;

// Schema for validateUpdate (all optional fields, partial updates)
// We accept any value for auth_method/grant_types/response_types and validate them in the rules
const UpdateMetadataSchema = z
  .object({
    token_endpoint_auth_method: z.any().optional(),
    grant_types: z.any().optional(),
    response_types: z.any().optional(),
    redirect_uris: z.any().optional(),
    scope: z.any().optional(),
    client_name: z.string().optional(),
    id_token_signed_response_alg: z.string().optional(),
  })
  .passthrough(); // Allow and preserve other RFC 7591 fields

// Helper: validate cross-cutting rules for registration
function validateRegistrationRules(
  data: RegistrationMetadataInput,
): Result<ValidatedClientMetadata, OAuthMetadataValidationError> {
  // Default values per RFC 7591 for registration
  const authMethod = data.token_endpoint_auth_method ?? "none";
  let grantTypes = data.grant_types ?? ["authorization_code", "refresh_token"];
  let responseTypes = data.response_types ?? ["code"];
  let redirectUris = data.redirect_uris ?? [];
  let scope = data.scope ?? "";
  const clientName = data.client_name;
  const idTokenAlg = data.id_token_signed_response_alg;

  // Normalize to arrays if needed
  if (!Array.isArray(grantTypes)) {
    return err(OAuthMetadataValidationError.unsupportedGrantType(grantTypes));
  }
  if (!Array.isArray(responseTypes)) {
    return err(OAuthMetadataValidationError.unsupportedResponseType(responseTypes));
  }
  if (!Array.isArray(redirectUris)) {
    return err(OAuthMetadataValidationError.invalidRedirectUri(String(redirectUris), "must be an array"));
  }

  // Rule 1: token_endpoint_auth_method must be "none"
  if (authMethod !== "none") {
    return err(OAuthMetadataValidationError.unsupportedAuthMethod(authMethod));
  }

  // Rule 2: grant_types must be subset of allowed
  const allowedGrantTypes = new Set(["authorization_code", "refresh_token"]);
  for (const gt of grantTypes) {
    if (!allowedGrantTypes.has(gt)) {
      return err(OAuthMetadataValidationError.unsupportedGrantType(grantTypes));
    }
  }

  // Rule 3: response_types must be exactly ["code"]
  if (responseTypes.length !== 1 || responseTypes[0] !== "code") {
    return err(OAuthMetadataValidationError.unsupportedResponseType(responseTypes));
  }

  // Rule 4: redirect_uris required and valid
  if (redirectUris.length === 0) {
    return err(OAuthMetadataValidationError.emptyRedirectUris());
  }

  for (const uri of redirectUris) {
    if (typeof uri !== "string" || !isValidRedirectUri(uri)) {
      return err(
        OAuthMetadataValidationError.invalidRedirectUri(
          String(uri),
          "must be a valid https:// URL or http://localhost/127.0.0.1",
        ),
      );
    }
  }

  // Rule 5: id_token_signed_response_alg optional but must be in allowlist if present
  if (idTokenAlg !== undefined) {
    if (!ALLOWED_SIGNING_ALGS.includes(idTokenAlg as any)) {
      return err(OAuthMetadataValidationError.unsupportedSigningAlg(idTokenAlg, Array.from(ALLOWED_SIGNING_ALGS)));
    }
  }

  // Rule 6: scope must be non-empty and string
  if (typeof scope !== "string" || scope === "") {
    return err(OAuthMetadataValidationError.invalidClientMetadata("scope", "scope must be a non-empty string"));
  }

  return ok({
    tokenEndpointAuthMethod: "none",
    grantTypes: Object.freeze(grantTypes) as ReadonlyArray<"authorization_code" | "refresh_token">,
    responseTypes: Object.freeze(["code"]) as ReadonlyArray<"code">,
    redirectUris: Object.freeze(redirectUris) as ReadonlyArray<string>,
    scope,
    ...(clientName && { clientName }),
    ...(idTokenAlg && { idTokenSignedResponseAlg: idTokenAlg }),
  });
}

// Helper: validate cross-cutting rules for updates (partial validation)
function validateUpdateRules(
  data: RegistrationMetadataInput,
): Result<ValidatedClientMetadata, OAuthMetadataValidationError> {
  // Updates allow omitted fields (partial updates per RFC 7592 §2.2)
  // but present fields must pass the same validation

  // Rule 1: if token_endpoint_auth_method present, must be "none"
  if (data.token_endpoint_auth_method !== undefined && data.token_endpoint_auth_method !== "none") {
    return err(OAuthMetadataValidationError.unsupportedAuthMethod(data.token_endpoint_auth_method));
  }

  // Rule 2: if grant_types present, must be subset
  if (data.grant_types !== undefined) {
    if (!Array.isArray(data.grant_types)) {
      return err(OAuthMetadataValidationError.unsupportedGrantType(data.grant_types));
    }

    const allowedGrantTypes = new Set(["authorization_code", "refresh_token"]);
    for (const gt of data.grant_types) {
      if (!allowedGrantTypes.has(gt)) {
        return err(OAuthMetadataValidationError.unsupportedGrantType(data.grant_types));
      }
    }
  }

  // Rule 3: if response_types present, must be exactly ["code"]
  if (data.response_types !== undefined) {
    if (!Array.isArray(data.response_types) || data.response_types.length !== 1 || data.response_types[0] !== "code") {
      return err(OAuthMetadataValidationError.unsupportedResponseType(data.response_types));
    }
  }

  // Rule 4: if redirect_uris present, all must be valid
  if (data.redirect_uris !== undefined) {
    if (!Array.isArray(data.redirect_uris) || data.redirect_uris.length === 0) {
      return err(OAuthMetadataValidationError.emptyRedirectUris());
    }

    for (const uri of data.redirect_uris) {
      if (typeof uri !== "string" || !isValidRedirectUri(uri)) {
        return err(
          OAuthMetadataValidationError.invalidRedirectUri(
            String(uri),
            "must be a valid https:// URL or http://localhost/127.0.0.1",
          ),
        );
      }
    }
  }

  // Rule 5: if id_token_signed_response_alg present, must be allowed
  if (data.id_token_signed_response_alg !== undefined) {
    if (!ALLOWED_SIGNING_ALGS.includes(data.id_token_signed_response_alg as any)) {
      return err(
        OAuthMetadataValidationError.unsupportedSigningAlg(
          data.id_token_signed_response_alg,
          Array.from(ALLOWED_SIGNING_ALGS),
        ),
      );
    }
  }

  // Rule 6: if scope present, must be non-empty
  if (data.scope !== undefined) {
    if (typeof data.scope !== "string" || data.scope === "") {
      return err(OAuthMetadataValidationError.invalidClientMetadata("scope", "scope must be a non-empty string"));
    }
  }

  // For updates, we only validate what's present. Return partial metadata.
  const grantTypes = data.grant_types ?? ["authorization_code", "refresh_token"];
  const responseTypes = data.response_types ?? ["code"];
  const redirectUris = data.redirect_uris ?? [];
  const scope = data.scope ?? "";

  const result: ValidatedClientMetadata = {
    tokenEndpointAuthMethod: data.token_endpoint_auth_method ?? "none",
    grantTypes: Object.freeze(grantTypes) as ReadonlyArray<"authorization_code" | "refresh_token">,
    responseTypes: Object.freeze(responseTypes) as ReadonlyArray<"code">,
    redirectUris: Object.freeze(redirectUris) as ReadonlyArray<string>,
    scope,
    ...(data.client_name && { clientName: data.client_name }),
    ...(data.id_token_signed_response_alg && { idTokenSignedResponseAlg: data.id_token_signed_response_alg }),
  };

  return ok(result);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Validates client metadata for RFC 7591 registration.
 * Requires all essential fields: redirect_uris, scope defaults to empty string.
 * token_endpoint_auth_method defaults to "none".
 * grant_types defaults to ["authorization_code", "refresh_token"].
 * response_types defaults to ["code"].
 */
export function validateRegistration(meta: unknown): Result<ValidatedClientMetadata, OAuthMetadataValidationError> {
  // First parse with Zod to narrow type
  const parseResult = RegistrationMetadataSchema.safeParse(meta);

  if (!parseResult.success) {
    // Zod error: return first issue
    const issue = parseResult.error.issues[0];
    if (!issue) {
      return err(OAuthMetadataValidationError.invalidClientMetadata("", "unknown validation error"));
    }
    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    return err(OAuthMetadataValidationError.invalidClientMetadata(path, issue.message));
  }

  // Then apply cross-cutting validation rules
  return validateRegistrationRules(parseResult.data);
}

/**
 * Validates client metadata for RFC 7592 updates.
 * All fields are optional (partial updates). Present fields pass the same validation as registration.
 */
export function validateUpdate(meta: unknown): Result<ValidatedClientMetadata, OAuthMetadataValidationError> {
  // First parse with Zod to narrow type
  const parseResult = UpdateMetadataSchema.safeParse(meta);

  if (!parseResult.success) {
    // Zod error: return first issue
    const issue = parseResult.error.issues[0];
    if (!issue) {
      return err(OAuthMetadataValidationError.invalidClientMetadata("", "unknown validation error"));
    }
    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    return err(OAuthMetadataValidationError.invalidClientMetadata(path, issue.message));
  }

  // Then apply cross-cutting validation rules (with partial semantics)
  return validateUpdateRules(parseResult.data);
}
