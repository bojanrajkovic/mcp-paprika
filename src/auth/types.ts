/**
 * Zod schemas and TypeScript types for OAuth domain shapes.
 *
 * Covers:
 * - Email verified policies (strict | skip | if-present)
 * - OIDC presets (configuration table entries with discovery URL, scopes, etc.)
 * - Resolved OAuth config (fully merged post-preset-expansion)
 * - Persisted entities: OAuthClient, OAuthToken
 * - In-memory state: AuthRequestState, AuthCodeState
 * - OIDC upstream: IdTokenPayload
 * - Authorization info: AuthInfoExtra
 * - Wire schemas: OAuthClientWireRegisterSchema, OAuthClientWireResponseSchema
 */

import { z } from "zod";

// ============================================================================
// Email Verified Policy
// ============================================================================

export const EmailVerifiedPolicySchema = z.enum(["strict", "skip", "if-present"]);

export type EmailVerifiedPolicy = z.infer<typeof EmailVerifiedPolicySchema>;

// ============================================================================
// OIDC Preset
// ============================================================================

export const OIDCPresetSchema = z.object({
  discoveryUrl: z.string().url().optional(),
  scopes: z.array(z.string()).readonly(),
  emailVerifiedPolicy: EmailVerifiedPolicySchema,
  allowedAlgs: z.array(z.string()).readonly(),
});

export type OIDCPreset = z.infer<typeof OIDCPresetSchema>;

// ============================================================================
// Resolved OAuth Config
// ============================================================================
// All fields required after preset expansion and validation
export const ResolvedOAuthConfigSchema = z.object({
  publicUrl: z.string().url(),
  presetName: z.string().nullable(),
  discoveryUrl: z.string().url(),
  scopes: z.array(z.string()).readonly(),
  emailVerifiedPolicy: EmailVerifiedPolicySchema,
  allowedAlgs: z.array(z.string()).readonly(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  allowlist: z.object({
    emails: z.array(z.string().email()).readonly(),
    subs: z.array(z.string()).readonly(),
  }),
});

export type ResolvedOAuthConfig = z.infer<typeof ResolvedOAuthConfigSchema>;

// ============================================================================
// Persisted: OAuthClient
// ============================================================================
// RFC 7591 / RFC 7592 client metadata (public client only)
export const OAuthClientSchema = z.object({
  clientId: z.string().uuid(),
  clientIdIssuedAt: z.number().int(),
  registrationAccessTokenHash: z.string(),
  tokenEndpointAuthMethod: z.literal("none"),
  grantTypes: z.array(z.enum(["authorization_code", "refresh_token"])).readonly(),
  responseTypes: z.array(z.literal("code")).readonly(),
  redirectUris: z.array(z.string().url()).readonly(),
  scope: z.string(),
  clientName: z.string().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  lastTokenActivityAt: z.number().int(),
});

export type OAuthClient = z.infer<typeof OAuthClientSchema>;

// ============================================================================
// Wire: OAuthClient Registration (RFC 7591 wire format)
// ============================================================================
// RFC 7591 uses snake_case; this schema validates and transforms to camelCase
export const OAuthClientWireRegisterSchema = z
  .object({
    client_name: z.string().optional(),
    grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).optional(),
    response_types: z.array(z.literal("code")).optional(),
    redirect_uris: z.array(z.string().url()),
    scope: z.string().optional(),
    token_endpoint_auth_method: z.literal("none").optional(),
  })
  .transform((data) => ({
    clientName: data.client_name,
    grantTypes: data.grant_types || ["authorization_code", "refresh_token"],
    responseTypes: data.response_types || ["code"],
    redirectUris: data.redirect_uris,
    scope: data.scope || "",
    tokenEndpointAuthMethod: data.token_endpoint_auth_method || "none",
  }))
  .transform((data) => ({
    clientName: data.clientName,
    grantTypes: Object.freeze(data.grantTypes) as readonly ("authorization_code" | "refresh_token")[],
    responseTypes: Object.freeze(data.responseTypes) as readonly "code"[],
    redirectUris: Object.freeze(data.redirectUris) as readonly string[],
    scope: data.scope,
    tokenEndpointAuthMethod: data.tokenEndpointAuthMethod,
  }));

export type OAuthClientWireRegister = z.infer<typeof OAuthClientWireRegisterSchema>;

// ============================================================================
// Wire: OAuthClient Response (RFC 7591 response format)
// ============================================================================
// Response includes all fields + the plaintext registration access token
export const OAuthClientWireResponseSchema = z.object({
  client_id: z.string().uuid(),
  client_id_issued_at: z.number().int(),
  client_secret_expires_at: z.literal(0), // public client, never expires
  client_name: z.string().optional(),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).readonly(),
  response_types: z.array(z.literal("code")).readonly(),
  redirect_uris: z.array(z.string().url()).readonly(),
  scope: z.string(),
  token_endpoint_auth_method: z.literal("none"),
  registration_access_token: z.string(), // plaintext RAT for management
  registration_client_uri: z.string().url(),
});

export type OAuthClientWireResponse = z.infer<typeof OAuthClientWireResponseSchema>;

// ============================================================================
// Persisted: OAuthToken
// ============================================================================
export const OAuthTokenSchema = z.object({
  tokenHash: z.string(),
  kind: z.enum(["access", "refresh"]),
  clientId: z.string().uuid(),
  scope: z.string(),
  identity: z.object({
    email: z.string().email().nullable(),
    sub: z.string(),
    source: z.enum(["email", "sub"]),
  }),
  resource: z.string().url(),
  expiresAt: z.number().int(),
  createdAt: z.number().int(),
  rotatedFromHash: z.string().optional(),
});

export type OAuthToken = z.infer<typeof OAuthTokenSchema>;

// ============================================================================
// In-Memory: AuthRequestState
// ============================================================================
// Keyed by our_state; 5-minute TTL
export const AuthRequestStateSchema = z.object({
  clientId: z.string().uuid(),
  codeChallenge: z.string(),
  codeChallengeMethod: z.literal("S256"),
  redirectUri: z.string().url(),
  resource: z.string().url(),
  claudeState: z.string(),
  scope: z.string(),
  ourNonce: z.string(),
  createdAt: z.number().int(),
});

export type AuthRequestState = z.infer<typeof AuthRequestStateSchema>;

// ============================================================================
// In-Memory: AuthCodeState
// ============================================================================
// Keyed by our_auth_code; 60-second TTL
export const AuthCodeStateSchema = z.object({
  clientId: z.string().uuid(),
  codeChallenge: z.string(),
  codeChallengeMethod: z.literal("S256"),
  redirectUri: z.string().url(),
  resource: z.string().url(),
  scope: z.string(),
  identity: z.object({
    email: z.string().email().nullable(),
    sub: z.string(),
    source: z.enum(["email", "sub"]),
  }),
  createdAt: z.number().int(),
});

export type AuthCodeState = z.infer<typeof AuthCodeStateSchema>;

// ============================================================================
// OIDC Upstream: IdTokenPayload
// ============================================================================
// id_token from upstream OIDC provider (e.g., Google, Azure, Keycloak)
// email and email_verified optional because some upstreams omit them
export const IdTokenPayloadSchema = z.object({
  iss: z.string().url(),
  sub: z.string(),
  aud: z.string(),
  email: z.string().email().optional(),
  email_verified: z.boolean().optional(),
  nonce: z.string(),
  exp: z.number().int(),
  iat: z.number().int(),
});

export type IdTokenPayload = z.infer<typeof IdTokenPayloadSchema>;

// ============================================================================
// Authorization Info Extra
// ============================================================================
// Identity information extracted from upstream id_token or user info
export const AuthInfoExtraSchema = z.object({
  email: z.string().email(),
  sub: z.string(),
  source: z.enum(["email", "sub"]),
});

export type AuthInfoExtra = z.infer<typeof AuthInfoExtraSchema>;
