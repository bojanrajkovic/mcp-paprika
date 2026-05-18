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
import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import { OAuthMetadataValidationError } from "./errors.js";

// ============================================================================
// Validated Output Types
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

export interface ValidatedClientMetadataPatch {
  readonly tokenEndpointAuthMethod?: "none";
  readonly grantTypes?: ReadonlyArray<"authorization_code" | "refresh_token">;
  readonly responseTypes?: ReadonlyArray<"code">;
  readonly redirectUris?: ReadonlyArray<string>;
  readonly scope?: string;
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

// Tightened schema for validateRegistration with proper field validation
const RegistrationMetadataSchema = z
  .object({
    token_endpoint_auth_method: z.literal("none").optional(),
    grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).optional(),
    response_types: z.array(z.literal("code")).optional(),
    redirect_uris: z.array(z.string()).optional(),
    scope: z.string().min(1).optional(),
    client_name: z.string().optional(),
    id_token_signed_response_alg: z.enum(["RS256", "ES256"]).optional(),
  })
  .passthrough() // Allow and preserve other RFC 7591 fields
  .superRefine((data, ctx) => {
    // Validate redirect_uris: must be present, non-empty, valid URLs with our scheme rules
    if (!Array.isArray(data.redirect_uris) || data.redirect_uris.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["redirect_uris"],
        message: "redirect_uris is required and must be a non-empty array of valid URLs",
      });
    } else {
      for (let i = 0; i < data.redirect_uris.length; i++) {
        const uri = data.redirect_uris[i];
        if (typeof uri !== "string") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["redirect_uris", i],
            message: "must be a string",
          });
        } else {
          try {
            new URL(uri);
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["redirect_uris", i],
              message: "must be a valid URL",
            });
            continue;
          }

          if (!isValidRedirectUri(uri)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["redirect_uris", i],
              message: "must use https:// or http://localhost/127.0.0.1/[::1]",
            });
          }
        }
      }
    }

    // Validate response_types: if present, must be exactly ["code"]
    if (
      data.response_types !== undefined &&
      (!Array.isArray(data.response_types) || data.response_types.length !== 1 || data.response_types[0] !== "code")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["response_types"],
        message: "must be exactly ['code'] when present",
      });
    }

    // Validate grant_types: if present, must be a non-empty subset of allowed
    if (data.grant_types !== undefined) {
      if (!Array.isArray(data.grant_types) || data.grant_types.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["grant_types"],
          message: "must be a non-empty array when present",
        });
      }
    }
  });

type RegistrationMetadataInput = z.infer<typeof RegistrationMetadataSchema>;

// Tightened schema for validateUpdate with proper field validation (all optional)
const UpdateMetadataSchema = z
  .object({
    token_endpoint_auth_method: z.literal("none").optional(),
    grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).optional(),
    response_types: z.array(z.literal("code")).optional(),
    redirect_uris: z.array(z.string()).optional(),
    scope: z.string().min(1).optional(),
    client_name: z.string().optional(),
    id_token_signed_response_alg: z.enum(["RS256", "ES256"]).optional(),
  })
  .passthrough() // Allow and preserve other RFC 7591 fields
  .superRefine((data, ctx) => {
    // Validate redirect_uris if present: must be non-empty with valid scheme
    if (data.redirect_uris !== undefined) {
      if (!Array.isArray(data.redirect_uris) || data.redirect_uris.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["redirect_uris"],
          message: "redirect_uris must be a non-empty array when present",
        });
      } else {
        for (let i = 0; i < data.redirect_uris.length; i++) {
          const uri = data.redirect_uris[i];
          if (typeof uri !== "string") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["redirect_uris", i],
              message: "must be a string",
            });
          } else {
            try {
              new URL(uri);
            } catch {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["redirect_uris", i],
                message: "must be a valid URL",
              });
              continue;
            }

            if (!isValidRedirectUri(uri)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["redirect_uris", i],
                message: "must use https:// or http://localhost/127.0.0.1/[::1]",
              });
            }
          }
        }
      }
    }

    // Validate response_types if present: must be exactly ["code"]
    if (
      data.response_types !== undefined &&
      (!Array.isArray(data.response_types) || data.response_types.length !== 1 || data.response_types[0] !== "code")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["response_types"],
        message: "must be exactly ['code'] when present",
      });
    }

    // Validate grant_types if present: must be a non-empty subset of allowed
    if (data.grant_types !== undefined) {
      if (!Array.isArray(data.grant_types) || data.grant_types.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["grant_types"],
          message: "must be a non-empty array when present",
        });
      }
    }
  });

// Helper: convert parsed data to ValidatedClientMetadata with defaults for registration
function buildRegistrationMetadata(data: RegistrationMetadataInput): ValidatedClientMetadata {
  return {
    tokenEndpointAuthMethod: "none",
    grantTypes: Object.freeze(data.grant_types ?? ["authorization_code", "refresh_token"]) as ReadonlyArray<
      "authorization_code" | "refresh_token"
    >,
    responseTypes: Object.freeze(data.response_types ?? ["code"]) as ReadonlyArray<"code">,
    redirectUris: Object.freeze(data.redirect_uris ?? []) as ReadonlyArray<string>,
    scope: data.scope ?? "",
    ...(data.client_name !== undefined ? { clientName: data.client_name } : {}),
    ...(data.id_token_signed_response_alg !== undefined
      ? {
          idTokenSignedResponseAlg: data.id_token_signed_response_alg,
        }
      : {}),
  };
}

// Helper: convert parsed data to ValidatedClientMetadataPatch for updates (no defaults)
function buildUpdateMetadataPatch(data: RegistrationMetadataInput): ValidatedClientMetadataPatch {
  const result: Record<string, unknown> = {};

  if (data.token_endpoint_auth_method !== undefined) {
    result["tokenEndpointAuthMethod"] = data.token_endpoint_auth_method;
  }
  if (data.grant_types !== undefined) {
    result["grantTypes"] = Object.freeze(data.grant_types) as ReadonlyArray<"authorization_code" | "refresh_token">;
  }
  if (data.response_types !== undefined) {
    result["responseTypes"] = Object.freeze(data.response_types) as ReadonlyArray<"code">;
  }
  if (data.redirect_uris !== undefined) {
    result["redirectUris"] = Object.freeze(data.redirect_uris) as ReadonlyArray<string>;
  }
  if (data.scope !== undefined) {
    result["scope"] = data.scope;
  }
  if (data.client_name !== undefined) {
    result["clientName"] = data.client_name;
  }
  if (data.id_token_signed_response_alg !== undefined) {
    result["idTokenSignedResponseAlg"] = data.id_token_signed_response_alg;
  }

  return result as ValidatedClientMetadataPatch;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Validates client metadata for RFC 7591 registration.
 * Requires all essential fields: redirect_uris.
 * token_endpoint_auth_method defaults to "none".
 * grant_types defaults to ["authorization_code", "refresh_token"].
 * response_types defaults to ["code"].
 * scope defaults to empty string.
 */
export function validateRegistration(meta: unknown): Result<ValidatedClientMetadata, OAuthMetadataValidationError> {
  // Parse with Zod schema (includes field validation and redirect_uri scheme checks)
  const parseResult = RegistrationMetadataSchema.safeParse(meta);

  if (!parseResult.success) {
    // Translate first Zod error to OAuth error
    const issue = parseResult.error.issues[0];
    if (!issue) {
      return err(OAuthMetadataValidationError.invalidClientMetadata("", "unknown validation error"));
    }

    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    const message = issue.message;

    return err(OAuthMetadataValidationError.invalidClientMetadata(path, message));
  }

  // Build result with defaults for registration
  return ok(buildRegistrationMetadata(parseResult.data));
}

/**
 * Validates client metadata for RFC 7592 updates.
 * All fields are optional (partial updates per RFC 7592 §2.2).
 * Present fields pass the same validation as registration.
 * Omitted fields are NOT synthesized in the output (unlike registration).
 */
export function validateUpdate(meta: unknown): Result<ValidatedClientMetadataPatch, OAuthMetadataValidationError> {
  // Parse with Zod schema (includes field validation and redirect_uri scheme checks)
  const parseResult = UpdateMetadataSchema.safeParse(meta);

  if (!parseResult.success) {
    // Translate first Zod error to OAuth error
    const issue = parseResult.error.issues[0];
    if (!issue) {
      return err(OAuthMetadataValidationError.invalidClientMetadata("", "unknown validation error"));
    }

    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    const message = issue.message;

    return err(OAuthMetadataValidationError.invalidClientMetadata(path, message));
  }

  // Build result as a patch (no defaults, only present fields)
  return ok(buildUpdateMetadataPatch(parseResult.data));
}
