# OAuth 2.1 Authorization Layer

Last verified: 2026-05-18

## Purpose

`src/auth/` implements the OAuth 2.1 authorization-server surface that `mcp-paprika` presents to MCP clients (Claude Mobile, claude.ai connectors, and other HTTP-capable clients) when running in HTTP transport mode. It acts as the OAuth authorization server toward downstream MCP clients and as an OIDC client toward an upstream identity provider (IdP). Responsibilities include: dynamic client registration (RFC 7591/7592), PKCE-based authorization code flow, opaque bearer-token minting and lifecycle management (access + refresh tokens, rotation, revocation), OIDC id_token verification via jose, identity allowlist enforcement, and background cleanup of stale clients and tokens.

This module is loaded only when `MCP_TRANSPORT=http`. In stdio mode, `buildAuthContext` returns `null` and nothing in `src/auth/` is instantiated.

## Files

- `types.ts` — Zod schemas and inferred TypeScript types for every OAuth domain shape: `OAuthClient`, `OAuthToken`, `AuthRequestState`, `AuthCodeState`, `IdTokenPayload`, `AuthInfoExtra`, `ResolvedOAuthConfig`, `AuthContext`, and the RFC 7591 wire schemas (`OAuthClientWireRegisterSchema`, `OAuthClientWireResponseSchema`)
- `errors.ts` — Error class hierarchy: `OAuthConfigError` (startup config failures), `OAuthMetadataValidationError` (OIDC/DCR validation), `OAuthClientNotFoundError`, `OAuthAllowlistDenialError`; and `OAuthTokenError` namespace of factory methods returning SDK `OAuthError` subclasses (the only errors that cross the `@hono/mcp` library boundary)
- `presets.ts` — `OIDC_PRESETS` table (google, entra, okta, auth0, keycloak defaults) and `resolvePreset(name, overrides)` that merges operator overrides onto a named preset or validates custom discovery-URL mode; returns `Result<PartialResolvedConfigResult, OAuthConfigError>`
- `tokens.ts` — `generateOpaqueToken(prefix)` (32-byte CSPRNG, base64url), `hashTokenForStorage(plaintext)` (SHA-256 hex), token-type prefix constants (`TOKEN_PREFIXES`), and all TTL constants (`ACCESS_TOKEN_TTL_SECONDS` = 24h, `REFRESH_TOKEN_TTL_SECONDS` = 30d, `AUTH_CODE_TTL_SECONDS` = 60s, `AUTH_REQUEST_TTL_SECONDS` = 5min, `DCR_CLIENT_STALE_DAYS` = 90d)
- `allowlist.ts` — `verifyIdentity(identity, allowlist, policy)`: OR semantics across email + sub allowlists, with `email_verified` policy enforcement (`strict` / `skip` / `if-present`); returns `Result<AuthInfoExtra, OAuthAllowlistDenialError>`
- `dcr-validator.ts` — RFC 7591/7592 metadata validation: `validateRegistration(body)` and `validateUpdate(body)`; rejects `token_endpoint_auth_method !== "none"`, validates `grant_types` / `response_types` subsets, and enforces `redirect_uris` rules (non-empty, valid URLs, `http://localhost` exemption for non-https)
- `oidc-client.ts` — `loadDiscovery(discoveryUrl, allowedAlgs)` fetches and validates the upstream OIDC discovery document (enforces HTTPS on all URLs, checks algorithm overlap); `createJwksFor(discovery)` returns a `JWTVerifyGetKey` backed by jose's `createRemoteJWKSet`; `verifyIdToken(token, jwks, options)` calls jose's `jwtVerify` with explicit `algorithms` list
- `auth-request-store.ts` — In-memory 5-minute TTL store for `AuthRequestState` (keyed by our state parameter, carries PKCE challenge + nonce + client + redirect context). Single-use semantics: `put` / `peek` / `consume`.
- `auth-code-store.ts` — In-memory 60-second TTL store for `AuthCodeState` (keyed by our authorization code; holds the verified identity). Single-use via `consume`. Distinct from `auth-request-store.ts` to keep pre- and post-callback state separate.
- `client-registration.ts` — `DiskClientRegistrationStore` implementing the SDK `OAuthRegisteredClientsStore` interface; persists registered clients to `DiskCache`'s `oauth/clients/` namespace; enforces `registrationAccessTokenHash` on management endpoints; issues UUIDv4 `clientId` (delegated to SDK)
- `token-store.ts` — `TokenStore`: `issueAccessRefreshPair`, `lookupAccessToken`, `rotateRefresh`, `revoke`, `removeAllForClient`; all tokens stored by their `tokenHash` (SHA-256 hex of plaintext); enforces RFC 8707 resource binding and RFC 6749 §6 scope-subset-only on refresh
- `provider.ts` — `MintingOAuthServerProvider` implementing the SDK `OAuthServerProvider` interface; orchestrates the authorization code flow using the four stores; constructs the upstream OIDC authorize redirect, handles the callback, and issues tokens
- `routes.ts` — Hono route handlers for `/oauth/callback` (receives upstream IdP redirect), `PUT /register/:clientId` (RFC 7592 client update), and `DELETE /register/:clientId` (RFC 7592 client delete); exports `buildDcrRateLimit` and `buildClientCap` middleware factory functions
- `metadata.ts` — `buildCustomizedAuthorizationServerMetadata(config)` returns RFC 8414 metadata override object; `buildAuthMetadataRouter(config)` returns the Hono router that serves `/.well-known/oauth-authorization-server` (mounted before `mcpAuthRouter` so first-match-wins overrides library defaults)
- `cleanup.ts` — `AuthCleanup` background task (start/stop via `AbortController`); periodically removes clients with `lastTokenActivityAt < now - 90d` (cascade-removes their tokens), expired auth-request states, and expired auth-code states; mirrors the `SyncEngine` lifecycle contract
- `build.ts` — `buildAuthContext(config, cache) → Promise<AuthContext | null>`; fail-fast startup builder that fetches OIDC discovery, assembles all stores, creates the provider, and returns the `AuthContext` bundle; returns `null` for stdio
- `__fixtures__/oidc-stub.ts` — Test fixture: an in-process MSW-backed OIDC stub that signs JWTs with test keys; used across auth integration tests
- `__fixtures__/jose-keys.ts` — Test fixture: pre-generated test key pair (RSA/EC) for signing stub id_tokens in tests
- `__fixtures__/oauth-state.ts` — Test fixture: helpers for building consistent `AuthRequestState` and `AuthCodeState` objects in tests

## Contracts

### OAuthServerProvider (SDK interface)

`MintingOAuthServerProvider` implements this SDK interface from `@modelcontextprotocol/sdk/server/auth/provider.js`. See `docs/verified-api.md` for the verified import path and method signatures.

```typescript
interface OAuthServerProvider {
  get clientsStore(): OAuthRegisteredClientsStore;
  authorize(client, params, res): Promise<void>;
  challengeForAuthorizationCode(client, authorizationCode): Promise<string>;
  exchangeAuthorizationCode(client, authorizationCode, codeVerifier, redirectUri, extra): Promise<OAuthTokens>;
  exchangeRefreshToken(client, refreshToken, scopes?, resource?): Promise<OAuthTokens>;
  verifyAccessToken(token): Promise<AuthInfo>;
  revokeToken?(client, token): Promise<void>;
}
```

### OAuthRegisteredClientsStore (SDK interface)

`DiskClientRegistrationStore` implements this SDK interface from `@modelcontextprotocol/sdk/server/auth/clients.js`. Required for dynamic client registration to be advertised in server metadata.

```typescript
interface OAuthRegisteredClientsStore {
  getClient(clientId: string): Promise<OAuthClientInformationFull | undefined>;
  registerClient(client: OAuthClientInformation): Promise<OAuthClientInformationFull>;
}
```

### AuthInfo (SDK type)

The SDK `AuthInfo` type is returned by `verifyAccessToken`. The `extra` field carries identity information:

| Field      | Type                      | Description                                                                 |
| ---------- | ------------------------- | --------------------------------------------------------------------------- |
| `token`    | `string`                  | The plaintext bearer token (from request header)                            |
| `clientId` | `string`                  | The registered client UUIDv4                                                |
| `scopes`   | `string[]`                | Granted scopes                                                              |
| `extra`    | `Record<string, unknown>` | Contains `email: string \| null`, `sub: string`, `source: "email" \| "sub"` |

### AuthContext

`AuthContext` is the OAuth runtime state bundle stored as `AppContext.auth`. All fields are `readonly`.

| Field          | Type                          | Description                                           |
| -------------- | ----------------------------- | ----------------------------------------------------- |
| `provider`     | `MintingOAuthServerProvider`  | SDK OAuthServerProvider implementation                |
| `config`       | `ResolvedOAuthConfig`         | Fully resolved OAuth config (post-preset expansion)   |
| `discovery`    | `DiscoveryDoc`                | Upstream OIDC discovery document (fetched at startup) |
| `jwks`         | `JWTVerifyGetKey`             | jose JWKS key resolver for id_token verification      |
| `authRequests` | `AuthRequestStore`            | In-memory 5-min TTL store for pre-callback state      |
| `authCodes`    | `AuthCodeStore`               | In-memory 60-s TTL store for post-callback state      |
| `tokenStore`   | `TokenStore`                  | Access + refresh token lifecycle manager              |
| `clientStore`  | `DiskClientRegistrationStore` | Persistent registered-client store                    |
| `cleanup`      | `AuthCleanup`                 | Background cleanup task handle                        |

### OAuthClient persistence schema

Persisted to `DiskCache` as `oauth/clients/${clientId}.json`. All fields are required except `clientName`.

| Field                         | Type                         | Notes                                                                    |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| `clientId`                    | `string` (UUID v4)           | Issued by SDK; filename key                                              |
| `clientIdIssuedAt`            | `number` (int, Unix epoch s) | Issuance timestamp                                                       |
| `registrationAccessTokenHash` | `string`                     | SHA-256 hex of the plaintext RAT (returned exactly once at registration) |
| `tokenEndpointAuthMethod`     | `"none"`                     | Literal — public clients only; no other value accepted                   |
| `grantTypes`                  | `readonly string[]`          | Subset of `["authorization_code", "refresh_token"]`                      |
| `responseTypes`               | `readonly "code"[]`          | Always `["code"]`                                                        |
| `redirectUris`                | `readonly string[]`          | At least one entry; `http://localhost*` exempted from HTTPS requirement  |
| `scope`                       | `string`                     | Space-separated scope string                                             |
| `clientName`                  | `string?`                    | Optional display name                                                    |
| `createdAt`                   | `number` (int)               | Unix epoch seconds                                                       |
| `updatedAt`                   | `number` (int)               | Unix epoch seconds                                                       |
| `lastTokenActivityAt`         | `number` (int)               | Updated on token issue/rotation; drives 90-day cleanup                   |

**No `clientSecret` field** — this server is public-client only. `OAuthClientSchema` has no `clientSecret` or `clientSecretHash` field.

### OAuthToken persistence schema

Persisted to `DiskCache` as `oauth/tokens/${tokenHash}.json`. `tokenHash` is the 64-character lowercase hex SHA-256 of the plaintext bearer token.

| Field             | Type                         | Notes                                                                   |
| ----------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `tokenHash`       | `string` (64-char hex)       | SHA-256 hex; filename = `${tokenHash}.json`; schema enforces with regex |
| `kind`            | `"access" \| "refresh"`      | Token type                                                              |
| `clientId`        | `string` (UUID v4)           | Owning client                                                           |
| `scope`           | `string`                     | Granted scope string                                                    |
| `identity`        | `{ email, sub, source }`     | Verified identity from upstream IdP                                     |
| `resource`        | `string` (URL) or `""`       | RFC 8707 resource binding; empty string = no binding                    |
| `expiresAt`       | `number` (int, Unix epoch s) | Access: now+24h; Refresh: now+30d                                       |
| `createdAt`       | `number` (int, Unix epoch s) | Token issuance time                                                     |
| `rotatedFromHash` | `string?`                    | Set on rotated refresh tokens; points to superseded token hash          |

## Invariants

### Cryptography

- No `alg=none` is accepted in id_token verification — jose enforces this by default; the `algorithms` option passed to `jwtVerify` is always a non-empty list of named algorithms.
- HMAC algorithms (HS256, HS384, HS512) are never accepted for id_token verification — `allowedAlgs` defaults to `["RS256", "ES256"]` or the preset's value; HS\* algorithms must be explicitly and deliberately added to override.
- Allowed algorithms are configurable per preset (e.g., keycloak allows `["RS256", "ES256"]`) and can be further overridden via `MCP_OIDC_ALLOWED_ALGS`; the intersection with the upstream IdP's advertised algorithms is checked at startup (fail-fast if empty).
- All upstream OIDC metadata URLs (issuer, authorization endpoint, token endpoint, JWKS URI) must use `https://` — `loadDiscovery` enforces this; `http://` URLs cause a startup failure.
- DCR `redirect_uris` are permitted to use `http://localhost*` — this is the only explicit HTTP exemption; all other redirect URIs must be HTTPS.
- Bearer tokens are 32 bytes from `crypto.randomBytes`, encoded as base64url (43 characters); total entropy is 256 bits regardless of prefix.
- SHA-256 is used for all storage hashes; there is no pepper or HMAC hardening (see `tokens.ts` comment for the future-hardening note).
- Plaintext tokens never appear on disk — the token-store layer hashes before calling `putOAuthToken`; `OAuthTokenSchema` stores only `tokenHash`.

### Persistence

- Clients are keyed by `clientId` (UUIDv4 issued by the SDK); filename is `${clientId}.json`.
- Tokens are keyed by `tokenHash` (64-char SHA-256 hex); filename is `${tokenHash}.json`; `OAuthTokenSchema` enforces the 64-char hex regex on every read, so filename-equals-field is enforced at both write and read.
- All `DiskCache` writes (client and token) are serialized via `async-mutex`; `cache.flush()` is called after every mutating OAuth operation to guarantee durability before the response is sent.
- Auth codes (`AuthCodeStore`) and auth-request states (`AuthRequestStore`) are in-memory only — they do not persist across server restarts.
- The RAT (registration access token) plaintext is returned exactly once in the DCR response body and never stored; only its SHA-256 hash is persisted in `registrationAccessTokenHash`.

### Token lifecycle

- Access token TTL: 24 hours.
- Refresh token TTL: 30 days; rotated on every use (old refresh token is revoked, new one issued with a fresh 30-day window).
- Authorization code TTL: 60 seconds, single-use via `consume`.
- Auth-request state TTL: 5 minutes, single-use via `consume` in the `/oauth/callback` route handler (`routes.ts`). The `AuthCodeStore` is consumed in `MintingOAuthServerProvider.exchangeAuthorizationCode`; `challengeForAuthorizationCode` only peeks.
- RFC 8707 resource binding: the `resource` parameter from the authorization request is bound to both the access token and the refresh token; `TokenStore.rotateRefresh` (called via `exchangeRefreshToken`) enforces that the `resource` field matches, and `exchangeAuthorizationCode` passes through the resource claim.
- RFC 6749 §6 scope subsetting: `exchangeRefreshToken` only allows the requested scope to be equal to or a strict subset of the originally granted scope — scope widening is rejected.

### DCR

- Public-client only: `token_endpoint_auth_method` must be `"none"` in every registration or update request; any other value is rejected with `invalid_client_metadata`.
- The RAT is issued at registration as a random opaque token, hashed before storage, and returned in plaintext exactly once in the `201 Created` DCR response.
- DCR rate-limit: 10 registrations per hour per IP address (enforced via `buildDcrRateLimit` in `routes.ts`).
- Hard cap: maximum 50 registered clients (configurable; enforced via `buildClientCap` in `routes.ts`, which runs before `mcpAuthRouter` matches `/register`).
- Cleanup: `AuthCleanup` marks clients with `lastTokenActivityAt < now - DCR_CLIENT_STALE_DAYS` as stale and removes them along with all their tokens; the background task runs on a configurable interval.

### HTTP surface

- The customized `wellKnownRouter` (from `buildAuthMetadataRouter`) is mounted on the Hono app **before** `mcpAuthRouter`; first-match-wins means the custom `/.well-known/oauth-authorization-server` handler is reached before the SDK's default.
- The issuer URL is passed to the SDK as a **string** (not a `URL` object) to work around a library URL-object bug that would otherwise append a trailing slash and break exact-match comparisons with `MCP_PUBLIC_URL`.
- RFC 9207 `iss` is included in both success and error redirects from `/oauth/callback`; this is enforced in the callback route handler.
- The `bearerAuth` middleware used to protect `/mcp` is imported from `@hono/mcp` (not Hono core); on auth failure it emits `WWW-Authenticate: Bearer error="Unauthorized", error_description="Unauthorized", resource_metadata="<issuer>/.well-known/oauth-protected-resource"`.
- Rate-limit and cap middleware are mounted on the Hono app router **before** `mcpAuthRouter` so that `/register` requests are subject to both before the SDK's registration handler runs.

### AppContext

- `app.auth` is `AuthContext | null`; it is `null` if and only if `config.transport === "stdio"`.
- `buildAuthContext` is fail-fast at startup: a discovery fetch failure, an empty algorithm intersection, or an invalid configuration causes the server to refuse to start rather than run in a degraded state.

### Logging

- Plaintext tokens are never logged; only `tokenHash` values appear in log output.
- Identity claims (email address, subject ID) are logged at warn level only when the allowlist denies access (`OAuthAllowlistDenialError`); they are not logged at any other point.

### Concurrency

- `DiskCache` `async-mutex` serializes all OAuth writes (clients and tokens); concurrent calls queue in FIFO order; a failed operation does not poison subsequent ones.
- In-memory stores (`AuthRequestStore`, `AuthCodeStore`) assume single-threaded Node.js event-loop execution; no per-store mutex is needed because all operations are synchronous (no `await` within a store method).

## Dependencies

**Leaf modules (no internal imports within `src/auth/`):**

- `tokens.ts` — uses only `node:crypto`
- `errors.ts` — imports only from `@modelcontextprotocol/sdk`
- `presets.ts` — imports from `errors.ts` and `types.ts`
- `allowlist.ts` — imports from `errors.ts` and `types.ts`
- `dcr-validator.ts` — imports from `errors.ts` and `types.ts`
- `types.ts` — imports type references from other `src/auth/` modules (circular-free via `import type`)

**Shell modules (use other auth files + external deps):**

- `oidc-client.ts` — uses `jose`
- `auth-request-store.ts`, `auth-code-store.ts` — use `types.ts` and `tokens.ts`
- `client-registration.ts` — uses `src/cache/disk-cache.ts` (via `DiskCache`)
- `token-store.ts` — uses `src/cache/disk-cache.ts`
- `provider.ts` — uses all stores, `oidc-client.ts`, and `allowlist.ts`
- `routes.ts` — uses `provider.ts`, `client-registration.ts`, `hono-rate-limiter`
- `metadata.ts` — uses `types.ts` and `@modelcontextprotocol/sdk`
- `cleanup.ts` — uses stores and `src/cache/disk-cache.ts`
- `build.ts` — composes all of the above; imports `src/utils/config.ts` and `src/cache/disk-cache.ts`

**External dependencies:** `@modelcontextprotocol/sdk` (OAuth provider/client interfaces), `jose` (JWKS, jwtVerify), `hono-rate-limiter` (rate limiting middleware), `async-mutex` (via `DiskCache`)

**Used by:**

- `src/server/build.ts` — calls `buildAuthContext` and stores result as `app.auth`
- `src/transport/http.ts` — mounts `buildAuthMetadataRouter`, `buildDcrRateLimit`, `buildClientCap`, and `mcpAuthRouter(provider)` from `@hono/mcp`

## Boundaries

- `src/auth/` may import from: `src/cache/` (DiskCache only), `src/utils/config.ts` and `src/utils/xdg.ts`, `@modelcontextprotocol/sdk`, `jose`, `hono-rate-limiter`, `zod`, `neverthrow`, `node:crypto`.
- `src/auth/` must NOT import from: `src/tools/`, `src/resources/`, `src/features/`, `src/paprika/`, `src/server/`, `src/transport/`.
- Only `src/server/build.ts` and `src/transport/http.ts` may import from `src/auth/`.
