# OAuth 2.1 Authorization Layer

Last verified: 2026-06-01

## Purpose

`src/auth/` implements the OAuth 2.1 authorization-server surface that `mcp-paprika` presents to MCP clients (Claude Mobile, claude.ai connectors, and other HTTP-capable clients) when running in HTTP transport mode. It acts as the OAuth authorization server toward downstream MCP clients and as an OIDC client toward an upstream identity provider (IdP). Responsibilities include: dynamic client registration (RFC 7591/7592), PKCE-based authorization code flow, a redirect-origin allowlist + consent gate that closes the confused-deputy hole for dynamically-registered clients (#147), opaque bearer-token minting and lifecycle management (access + refresh tokens, rotation, revocation), OIDC id_token verification via jose, identity allowlist enforcement, and background cleanup of stale clients and tokens.

This module is loaded only when `MCP_TRANSPORT=http`. In stdio mode, `buildAuthContext` returns `null` and nothing in `src/auth/` is instantiated.

## Files

- `types.ts` — Zod schemas and inferred TypeScript types for every OAuth domain shape: `OAuthClient`, `OAuthToken`, `AuthRequestState`, `AuthCodeState`, `IdTokenPayload`, `AuthInfoExtra`, `ResolvedOAuthConfig`, `AuthContext`, and the RFC 7591 wire schemas (`OAuthClientWireRegisterSchema`, `OAuthClientWireResponseSchema`)
- `errors.ts` — Error class hierarchy: `OAuthConfigError` (startup config failures), `OAuthMetadataValidationError` (OIDC/DCR validation), `OAuthClientNotFoundError`, `OAuthAllowlistDenialError`; and `OAuthTokenError` namespace of factory methods returning SDK `OAuthError` subclasses (the only errors that cross the `@hono/mcp` library boundary)
- `presets.ts` — `OIDC_PRESETS` table (google, entra, okta, auth0, keycloak defaults) and `resolvePreset(name, overrides)` that merges operator overrides onto a named preset or, in custom-discovery mode (`name === undefined`), requires only `discoveryUrl` and defaults `scopes` to `["openid","email","profile"]`, `emailVerifiedPolicy` to `"strict"`, `allowedAlgs` to `["RS256"]`; returns `Result<PartialResolvedConfigResult, OAuthConfigError>`
- `tokens.ts` — `generateOpaqueToken(prefix)` (32-byte CSPRNG, base64url), `hashTokenForStorage(plaintext)` (SHA-256 hex), `nowSeconds()` (`Math.floor(Date.now() / 1000)` — the project-wide source of Unix-seconds truncation, used by every NumericDate site), token-type prefix constants (`TOKEN_PREFIXES`, including `mcp_consent_` for consent tickets), and all TTL constants (`ACCESS_TOKEN_TTL_SECONDS` = 24h, `REFRESH_TOKEN_TTL_SECONDS` = 30d, `AUTH_CODE_TTL_SECONDS` = 60s, `AUTH_REQUEST_TTL_SECONDS` = 5min, `PENDING_AUTHORIZATION_TTL_SECONDS` = 10min, `DCR_CLIENT_STALE_DAYS` = 90d), and `MAX_INMEMORY_AUTH_ENTRIES` = 50 (per-store live-entry cap)
- `redirect-allowlist.ts` — pure functional core for the confused-deputy gate (#147): `normalizeOrigin(value)` validates+canonicalizes a configured entry to its origin (https, or http for `localhost`/`127.0.0.1`/`[::1]`; returns `Result<string, OAuthConfigError>`), `isRecognizedOrigin(redirectUri, allowlist)` does exact-origin membership (fails closed on parse error, non-permitted scheme, or empty set; re-checks scheme so it never trusts an origin it wouldn't admit). No substring/suffix matching; loopback matched fail-closed including port (RFC 8252 §7.3)
- `pending-authorization-store.ts` — In-memory 10-minute TTL store for `PendingAuthorization` (keyed by an opaque single-use consent ticket; holds a downstream `/authorize` request awaiting consent, BEFORE any upstream redirect). Extends `TtlStore` (capped at `MAX_INMEMORY_AUTH_ENTRIES`); `put` / `consume`. Distinct from `auth-request-store.ts` (which holds pre-callback state, after the upstream redirect)
- `consent-page.ts` — pure HTML renderers for the consent screen (#147): `renderConsentPage({ ticket, clientName?, redirectHost })`, `renderDeniedPage()`, `renderExpiredPage()` — each returns `{ html, nonce }`; plus `consentSecurityHeaders(nonce)`. Every attacker-controlled field (`clientName`, `redirectHost`) is HTML-escaped; the requested scope is never rendered (fixed coarse grant copy); inline styles are pinned to a per-render CSP nonce
- `upstream-redirect.ts` — shared `redirectUpstream(c, deps, approved)`: mints `ourState`/`ourNonce`, persists `AuthRequestState`, and 302s to the upstream IdP. Narrow deps (no provider coupling) so the recognized branch of `provider.authorize()` and the `/oauth/consent` allow handler funnel through one implementation
- `allowlist.ts` — `verifyIdentity(identity, allowlist, policy)`: OR semantics across email + sub allowlists, with `email_verified` policy enforcement (`strict` / `skip` / `if-present`); returns `Result<AuthInfoExtra, OAuthAllowlistDenialError>`
- `dcr-validator.ts` — RFC 7591/7592 metadata validation: `validateRegistration(body)` and `validateUpdate(body)`; rejects `token_endpoint_auth_method !== "none"`, validates `grant_types` / `response_types` subsets, and enforces `redirect_uris` rules (non-empty, valid URLs, `http://localhost` exemption for non-https)
- `oidc-client.ts` — `loadDiscovery(discoveryUrl, allowedAlgs)` fetches and validates the upstream OIDC discovery document (enforces HTTPS on all URLs, checks algorithm overlap); `createJwksFor(discovery)` returns a `JWTVerifyGetKey` backed by jose's `createRemoteJWKSet`; `verifyIdToken(token, jwks, options)` calls jose's `jwtVerify` with explicit `algorithms` list. `DiscoveryDoc` carries an optional `token_endpoint_auth_methods_supported` that `routes.ts:pickTokenAuthMethod` consumes to pick between `client_secret_post` and `client_secret_basic`.
- `ttl-store.ts` — Generic base class `TtlStore<T extends { createdAt: number }>` with `put`, `consume` (delete-before-TTL-check, single-use), `sweepExpired`, and `size`; clock-injectable via `now` option, optional `maxEntries` cap. `put` returns `boolean`: when at capacity for a NEW key it sweeps expired entries first, then **rejects** (returns `false`) rather than evicting a live entry — so a `/authorize` flood cannot evict an in-flight auth, only have its own brand-new write refused. Extended by `AuthRequestStore`, `AuthCodeStore`, and `PendingAuthorizationStore`.
- `auth-request-store.ts` — In-memory 5-minute TTL store for `AuthRequestState` (keyed by our state parameter, carries PKCE challenge + nonce + client + redirect context). Extends `TtlStore` (capped at `MAX_INMEMORY_AUTH_ENTRIES`); exposes `put` / `consume` (single-use).
- `auth-code-store.ts` — In-memory 60-second TTL store for `AuthCodeState` (keyed by our authorization code; holds the verified identity). Extends `TtlStore` (capped at `MAX_INMEMORY_AUTH_ENTRIES`); adds `peek()` (read-without-consume, lazy-evicts expired entries). Single-use consume enforced via `TtlStore.consume`. Distinct from `auth-request-store.ts` to keep pre- and post-callback state separate.
- `client-registration.ts` — `DiskClientRegistrationStore` implementing the SDK `OAuthRegisteredClientsStore` interface; persists registered clients via `DiskCacheRoot.oauthClients`; enforces `registrationAccessTokenHash` on management endpoints; issues UUIDv4 `clientId` (delegated to SDK); takes a required `Logger` as 3rd ctor param and an optional `maxClients` as 4th, atomically enforces the cap via `oauthClients.tryPut` (throws `InvalidRequestError` on overflow so @hono/mcp returns 400); emits `info "client registered via DCR"` with `clientId` + `redirectUriCount` after each successful registration
- `token-store.ts` — `TokenStore`: `issueAccessRefreshPair`, `lookupAccessToken`, `lookupRefreshToken`, `getTokenRecord` (any-kind by plaintext, used for ownership checks), `rotateRefresh`, `revoke`, `removeAllForClient`; all tokens stored by their `tokenHash` (SHA-256 hex of plaintext); enforces RFC 8707 resource binding, RFC 6749 §6 scope-subset-only on refresh, and refresh-token client binding (`rotateRefresh` requires `expectedClientId`); serializes refresh rotation through an internal `async-mutex` `_rotateLock` so concurrent rotations on the same plaintext can't both consume the token
- `provider.ts` — `MintingOAuthServerProvider` implementing the SDK `OAuthServerProvider` interface; orchestrates the authorization code flow using the five stores; takes the `PendingAuthorizationStore` as its 5th ctor param and a required `Logger` as its 9th. `authorize()` applies the confused-deputy gate (#147): a recognized redirect origin goes straight upstream (via `redirectUpstream`), an unrecognized one mints a consent ticket, holds the request in the pending store, and renders the consent screen. Emits `info "access token minted (authorization_code grant)"`, `info "access token minted (refresh_token grant)"`, and `info "access token revoked"` — each with `tokenHash`, `clientId`, and `sub` fields
- `routes.ts` — Hono route handlers for `/oauth/callback` (receives upstream IdP redirect), `POST /oauth/consent` (#147 consent decision — allow forwards upstream via `redirectUpstream`, deny/expired render a terminal page on our origin and never redirect to the `redirect_uri`), `PUT /register/:clientId` (RFC 7592 client update), and `DELETE /register/:clientId` (RFC 7592 client delete); exports `buildDcrRateLimit({trustProxy})` (key derivation depends on the flag) and `buildClientCap` middleware factories plus the `MAX_REGISTERED_CLIENTS` constant (also imported by `build.ts` so the middleware fast-path and the atomic store-level enforcement share one value)
- `metadata.ts` — `buildCustomizedAuthorizationServerMetadata(config)` returns RFC 8414 metadata override object; `buildAuthMetadataRouter(config)` returns the Hono router that serves `/.well-known/oauth-authorization-server` (mounted before `mcpAuthRouter` so first-match-wins overrides library defaults)
- `cleanup.ts` — `AuthCleanup` background task (start/stop via `AbortController`, 6h interval); periodically removes clients with `lastTokenActivityAt < now - 90d` (cascade-removes their tokens), expired auth-request states, expired auth-code states, expired pending-authorization (consent-ticket) states, AND any OAuth tokens whose `expiresAt < now` whose owning client is still active (covers the refresh-rotation orphans — `rotateRefresh` deletes the prior refresh but not the prior access). Mirrors the `SyncEngine` lifecycle contract.
- `build.ts` — `buildAuthContext(config, cache) → Promise<AuthContext | null>`; fail-fast startup builder that fetches OIDC discovery, normalizes the raw `redirectAllowlist` strings to canonical origins via `normalizeOrigin` (throwing on the first malformed entry — config.ts keeps the strings raw so it has no dependency on `src/auth/`), assembles all stores (including the `PendingAuthorizationStore`), creates the provider, and returns the `AuthContext` bundle; returns `null` for stdio
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

| Field                   | Type                                   | Description                                                                                                                      |
| ----------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `provider`              | `MintingOAuthServerProvider`           | SDK OAuthServerProvider implementation                                                                                           |
| `config`                | `ResolvedOAuthConfig`                  | Fully resolved OAuth config (post-preset expansion)                                                                              |
| `discovery`             | `DiscoveryDoc`                         | Upstream OIDC discovery document (fetched at startup)                                                                            |
| `jwks`                  | `JWTVerifyGetKey`                      | jose JWKS key resolver for id_token verification                                                                                 |
| `authRequests`          | `AuthRequestStore`                     | In-memory 5-min TTL store for pre-callback state                                                                                 |
| `authCodes`             | `AuthCodeStore`                        | In-memory 60-s TTL store for post-callback state                                                                                 |
| `pendingAuthorizations` | `PendingAuthorizationStore`            | In-memory 10-min TTL store for consent-pending state (keyed by consent ticket)                                                   |
| `tokenStore`            | `TokenStore`                           | Access + refresh token lifecycle manager                                                                                         |
| `clientStore`           | `DiskClientRegistrationStore`          | Persistent registered-client store                                                                                               |
| `cleanup`               | `AuthCleanup`                          | Background cleanup task handle                                                                                                   |
| `log`                   | `{ auth: Logger; oidcClient: Logger }` | Component-scoped pino child loggers; `auth` for local route/policy/cleanup/DCR logic, `oidc-client` for upstream OIDC HTTP calls |

### OAuthClient persistence schema

Persisted by `DiskCacheRoot.oauthClients` as `oauthClients/${clientId}.json`. All fields are required except `clientName`.

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

Persisted by `DiskCacheRoot.oauthTokens` as `oauthTokens/${tokenHash}.json`. `tokenHash` is the 64-character lowercase hex SHA-256 of the plaintext bearer token.

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
- DCR `redirect_uris` are permitted to use `http://localhost`, `http://127.0.0.1`, and `http://[::1]` — these are the only explicit HTTP exemptions; all other redirect URIs must be HTTPS. Node's WHATWG URL parser preserves the brackets on IPv6 hostnames (`new URL("http://[::1]/").hostname === "[::1]"`), so the validator compares against the bracketed form.
- Bearer tokens are 32 bytes from `crypto.randomBytes`, encoded as base64url (43 characters); total entropy is 256 bits regardless of prefix.
- SHA-256 is used for all storage hashes; there is no pepper or HMAC hardening (see `tokens.ts` comment for the future-hardening note).
- Plaintext tokens never appear on disk — the token-store layer hashes before calling `putOAuthToken`; `OAuthTokenSchema` stores only `tokenHash`.

### Persistence

- Clients are keyed by `clientId` (UUIDv4 issued by the SDK); filename is `${clientId}.json`.
- Tokens are keyed by `tokenHash` (64-char SHA-256 hex); filename is `${tokenHash}.json`; `OAuthTokenSchema` enforces the 64-char hex regex on every read, so filename-equals-field is enforced at both write and read.
- All OAuth writes (client and token) are serialized via per-subcache `async-mutex` instances; `cache.flush()` is called after every mutating OAuth operation to guarantee durability before the response is sent.
- Auth codes (`AuthCodeStore`) and auth-request states (`AuthRequestStore`) are in-memory only — they do not persist across server restarts.
- The RAT (registration access token) plaintext is returned exactly once in the DCR response body and never stored; only its SHA-256 hash is persisted in `registrationAccessTokenHash`.

### Token lifecycle

- Access token TTL: 24 hours.
- Refresh token TTL: 30 days; rotated on every use (old refresh token is revoked, new one issued with a fresh 30-day window).
- Authorization code TTL: 60 seconds, single-use via `consume`.
- Auth-request state TTL: 5 minutes, single-use via `consume` in the `/oauth/callback` route handler (`routes.ts`). The `AuthCodeStore` is consumed in `MintingOAuthServerProvider.exchangeAuthorizationCode`; `challengeForAuthorizationCode` only peeks.
- RFC 8707 resource binding: the `resource` parameter from the authorization request is bound to both the access token and the refresh token; `TokenStore.rotateRefresh` (called via `exchangeRefreshToken`) enforces that the `resource` field matches, and `exchangeAuthorizationCode` passes through the resource claim.
- RFC 6749 §6 scope subsetting: `exchangeRefreshToken` only allows the requested scope to be equal to or a strict subset of the originally granted scope — scope widening is rejected.
- Refresh-token client binding (OAuth 2.1 §4.3.1): `TokenStore.rotateRefresh` requires an `expectedClientId` and rejects with `invalid_grant` if it doesn't match the stored token's `clientId` — a registered client cannot rotate another client's refresh token. The same `invalid_grant` is returned for both "unknown token" and "wrong client" so existence isn't leaked.
- Revocation client binding (RFC 7009 §2.2): `MintingOAuthServerProvider.revokeToken` looks up the token via `TokenStore.getTokenRecord` and silently no-ops when the calling client doesn't own it. The HTTP response stays 200/empty either way so existence isn't leaked.
- RFC 6749 §4.1.3 / token-request redirect_uri: `exchangeAuthorizationCode` requires the `redirect_uri` parameter to be present and exactly match the value carried over from `/authorize`. Omitting it is rejected with `invalid_grant` (a stolen code from a different endpoint cannot be redeemed).
- Upstream token-endpoint authentication (RFC 6749 §2.3.1, RFC 8414): `/oauth/callback` selects `client_secret_post` when discovery advertises it (widest IdP support — what every preset's IdP actually advertises), falls back to `client_secret_basic` when only Basic is advertised, and defaults to **Basic** when the field is absent (RFC 6749 §2.3.1 mandates Basic support on every compliant AS). In Basic mode the credentials go in `Authorization: Basic base64(percent-encode(client_id):percent-encode(client_secret))` and are NOT also sent in the body. See `routes.ts:pickTokenAuthMethod`.

### DCR

- Public-client only: `token_endpoint_auth_method` must be `"none"` in every registration or update request; any other value is rejected with `invalid_client_metadata`.
- The RAT is issued at registration as a random opaque token, hashed before storage, and returned in plaintext exactly once in the `201 Created` DCR response.
- DCR rate-limit: 10 registrations per hour per IP address (enforced via `buildDcrRateLimit` in `routes.ts`). Scoped to `POST /register` only — RFC 7592 `PUT`/`DELETE /register/:id` calls do NOT consume the bucket. The per-request key is the connection's remote address by default (`trustProxy: false`); set `MCP_TRUST_PROXY=true` only when a sanitizing reverse proxy is in front, otherwise an attacker can spoof `x-forwarded-for` per request and bypass the limit.
- Hard cap: maximum `MAX_REGISTERED_CLIENTS` (50) registered clients. Enforced in two places: `buildClientCap` middleware (`routes.ts`) returns a fast-path 429 for the common single-request overflow, and `DiskClientRegistrationStore.registerClient` does the authoritative atomic check inside `OAuthClientDiskCache.tryPut` (under the same per-subcache mutex as the put). The atomic path returns 400 `invalid_request` for the race case — both observers passed the middleware but only one wins the lock.
- Cleanup: `AuthCleanup` marks clients with `lastTokenActivityAt < now - DCR_CLIENT_STALE_DAYS` as stale and removes them along with all their tokens. It also evicts OAuth tokens past `expiresAt` whose owning client is still active — required because `rotateRefresh` deletes the prior refresh but not the prior access, so active sessions accumulate one expired access record per refresh. The background task runs every 6 hours.

### Confused-deputy consent gate (#147)

The open-DCR proxy AS forwards `/authorize` upstream with a static upstream `client_id` and never gets its own consent for the dynamically-registered downstream client — the confused-deputy gap. The gate closes it with a layered control:

- **Structural gate first.** `provider.authorize()` compares the request's `redirect_uri` _origin_ (`scheme://host:port` of the single redirect this request uses — the SDK has already validated it is one of the client's registered URIs) against `config.redirectAllowlist`. A recognized origin forwards upstream unchanged; an unrecognized one is held and the user sees a consent screen. **Empty allowlist ⇒ every `/authorize` is gated** (fail-closed; ships safe until the operator seeds the list).
- **Exact origin matching.** No substring/suffix matching (`evil-claude.ai`, `claude.ai.evil.com` never match `claude.ai`); https-pinned with the same loopback exemption as `dcr-validator.ts`; scheme checked before `URL.origin` is trusted. **Loopback is fail-closed including the port** — `http://localhost` does NOT cover `http://localhost:51004` (RFC 8252 §7.3 ephemeral ports); a loopback client with a random port prompts unless its exact origin is listed.
- **Static config, stateless.** The allowlist is operator-declared (`MCP_OAUTH_REDIRECT_ALLOWLIST`), normalized at startup. A consent decision is never remembered — there is no consent-grant persistence.
- **Ticket = CSRF token.** The consent screen carries an opaque single-use `mcp_consent_` ticket (256-bit), held in the `PendingAuthorizationStore`. It only ever appears in the victim's rendered page and the form posts same-origin (`form-action 'self'`), so the approve-POST cannot be forged. `consume()` enforces single-use.
- **Deny never redirects to the `redirect_uri`.** Because the screen only appears for an _unrecognized_ origin, every deny rejects an untrusted target; the deny/expired responses are terminal pages on our own origin. (Diverges from RFC 6749 §4.1.2.1 deliberately; recognized clients never hit this path.)
- **XSS + anti-clickjacking.** `client_name` and the redirect host are attacker-controlled (open DCR), so they are HTML-escaped at every injection site; the requested scope is never rendered (fixed grant copy). Every consent-flow response sets `Content-Security-Policy: default-src 'none'; style-src 'nonce-<n>'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`, plus `X-Frame-Options: DENY` and `Cache-Control: no-store`.
- **No identity leakage.** Consent runs before upstream auth, so the page shows only client-supplied data — the user's identity is not yet known.
- **Bounded memory.** All three in-memory stores (`AuthRequestStore`, `AuthCodeStore`, `PendingAuthorizationStore`) are capped at `MAX_INMEMORY_AUTH_ENTRIES` (50). `/authorize` is unauthenticated and unthrottled, so an attacker who registers a client could otherwise flood these maps; the cap bounds the live set, and `AuthCleanup` (6h sweep) plus `put`'s sweep-on-full reclaim expired entries. All three write paths handle a full store rather than handing back state that was never stored: `redirectUpstream` (AuthRequest, recognized origin) and `authorize`'s consent branch (Pending, unrecognized origin) refuse with **503**; the `/oauth/callback` success branch (AuthCode) redirects the client with `error=temporarily_unavailable` (RFC 6749 §4.1.2.1) instead of a `code` that would fail at `/token` with `invalid_grant`. AuthCode's cap is defense-in-depth — its `put` is reached only after a completed upstream login + allowlist pass, so it is not a flood surface — but it's handled consistently.

### HTTP surface

- The customized `wellKnownRouter` (from `buildAuthMetadataRouter`) is mounted on the Hono app **before** `mcpAuthRouter`; first-match-wins means the custom `/.well-known/oauth-authorization-server` handler is reached before the SDK's default.
- `mcpAuthRouter` is invoked with `authorizationOptions/tokenOptions/revocationOptions/clientRegistrationOptions: { rateLimit: false }` to disable its built-in rate limiters, which key off a single shared global string and would otherwise let one noisy client DoS all four endpoints. Our own per-IP `buildDcrRateLimit` handles /register; the other endpoints are gated by client_id / bearer / RAT auth.
- The issuer URL is passed to the SDK as a **string** (not a `URL` object) to work around a library URL-object bug that would otherwise append a trailing slash and break exact-match comparisons with `MCP_PUBLIC_URL`.
- RFC 9207 `iss` is included in both success and error redirects from `/oauth/callback`; this is enforced in the callback route handler.
- `POST /oauth/consent` (in `buildAuthRoutes`) handles the #147 consent decision. It is reached only after `provider.authorize()` rendered the consent screen for an unrecognized redirect origin. Allow forwards upstream via the shared `redirectUpstream`; deny/expired render terminal HTML on our origin (never a redirect to the `redirect_uri`). All three responses carry the consent CSP + `X-Frame-Options: DENY` + `Cache-Control: no-store`.
- The `bearerAuth` middleware used to protect `/mcp` is imported from `@hono/mcp` (not Hono core); on auth failure it emits `WWW-Authenticate: Bearer error="Unauthorized", error_description="Unauthorized", resource_metadata="<origin>/.well-known/oauth-protected-resource"`. **Operational caveat:** the `<origin>` here is `new URL(c.req.url).origin` — i.e., the URL the _request_ arrived at, NOT the configured `MCP_PUBLIC_URL`. Behind a reverse proxy that doesn't forward `X-Forwarded-Proto` / `X-Forwarded-Host`, the 401 hint can point at an internal-only origin and a client following it would fail to reach the protected-resource doc. Ensure the proxy forwards those headers (and Hono is configured to trust them via `app.use(trustProxy(...))` or equivalent) so `c.req.url` reflects the public origin.
- The RFC 7592 `PUT /register/{clientId}` and `DELETE /register/{clientId}` routes match the `Authorization: Bearer …` scheme case-insensitively (RFC 6750 §2.1). The RAT plaintext itself is compared by SHA-256 hash, so the scheme casing is the only loose part.
- Allowlist denials in `/oauth/callback` redirect back to the client with a generic `error_description="identity not allowed by server policy"` — the full denial reason (email + sub + which rule) goes to operator stderr only. Don't re-introduce identity claims into the redirect: the URL is forwarded to claude.ai and ends up in the user's browser history.
- Rate-limit and cap middleware are mounted on the Hono app router **before** `mcpAuthRouter` so that `/register` requests are subject to both before the SDK's registration handler runs.

### AppContext

- `app.auth` is `AuthContext | null`; it is `null` if and only if `config.transport === "stdio"`.
- `buildAuthContext` is fail-fast at startup: a discovery fetch failure, an empty algorithm intersection, or an invalid configuration causes the server to refuse to start rather than run in a degraded state.

### Logging

**Component split.** Auth code uses two component loggers, both sourced from `AuthContext.log`:

- `auth` — local route/policy/cleanup/DCR logic: allowlist accept/deny, OAuth state transitions, silent-catch debug sites, DCR registration.
- `oidc-client` — upstream OIDC HTTP calls: discovery fetch, id_token verification failures. JWKS fetches go through `jose.createRemoteJWKSet` which is opaque to per-fetch instrumentation; JWKS-related failures surface only as id_token verification failures logged at the `routes.ts` error site.

**State transitions at info level.** The following info records are emitted on each successful state change:

- `"client registered via DCR"` — `DiskClientRegistrationStore.registerClient`, fields `{ clientId, redirectUriCount }`.
- `"access token minted (authorization_code grant)"` — `MintingOAuthServerProvider.exchangeAuthorizationCode`, fields `{ tokenHash, clientId, sub }`.
- `"access token minted (refresh_token grant)"` — `MintingOAuthServerProvider.exchangeRefreshToken`, fields `{ tokenHash, clientId, sub }`.
- `"access token revoked"` — `MintingOAuthServerProvider.revokeToken` after `TokenStore.revoke()` succeeds; fields `{ tokenHash, clientId, sub }`. The early no-op returns (unknown token, wrong client) produce no record, preserving RFC 7009 §2.2 privacy intent.
- `"consent granted"` — info, `POST /oauth/consent` allow branch, fields `{ clientId, redirectOrigin, decision }`.
- `"consent denied"` — warn, `POST /oauth/consent` deny branch, fields `{ clientId, redirectOrigin, decision }`; fans out to connected MCP clients via `notifications/message`. The opaque consent ticket is never logged (it is a bearer secret for the duration of its TTL).

**Identity claims in allowlist records.** `email` and `sub` appear explicitly in allowlist accept/deny records — they're identity-gating audit logs, not operational telemetry, so they're not redacted.

- `"allowlist accepted identity"` — info, fields `{ email, sub }` — emitted in `routes.ts` on the success branch.
- `"allowlist denied identity"` — warn, fields `{ reason, email, sub }` — emitted in `routes.ts` on the `OAuthAllowlistDenialError` branch; fans out to connected MCP clients via `notifications/message` automatically.

#### Allowlist denial notifications: behavior change

Prior to the structured-logging migration, allowlist denials wrote a single `[auth]` line to stderr only. The new behavior emits a `warn`-level pino record that fans out to all connected MCP clients via `notifications/message` automatically (because `warn` meets the default `notifyLevel: "warn"` threshold). Operators wanting to suppress these notifications from MCP clients can set `MCP_LOG_NOTIFY_LEVEL=error` — at that threshold only `error`+`fatal` records fan out, and denial records stay in the primary log stream only.

**Token field redaction.** The root logger's redact config covers `*.authorization`, `*.password`, `*.token`, `*.client_secret`, `*.access_token`, `*.refresh_token`, and `*.id_token`. Auth code must not pass raw token values through pino fields — log identifiers (`tokenHash`, `clientId`) instead. `tokenHash` is the SHA-256 hex of the plaintext bearer token and is safe to include verbatim.

**Silent-catch debug logs.** Three modules log at `debug` when their normally-silent catch paths fire. Operators can enable `MCP_LOG_LEVEL=debug` to diagnose these paths in production:

- `cleanup.ts` — sweep loop catches: `"auth cleanup sweep failed; continuing"` and `"auth cleanup wait failed unexpectedly"`.
- `dcr-validator.ts` — URL parse catches: `"invalid redirect_uri rejected by parser"` and `"invalid redirect_uri item in DCR request"`.
- `client-registration.ts` — timing-safe-equal catch: `"RAT timing-safe equality failed (likely invalid hex)"`, field `{ clientId }`.

### Concurrency

- The per-subcache mutex on `DiskCacheRoot.oauthClients` and `oauthTokens` serializes all OAuth writes; concurrent calls queue in FIFO order; a failed operation does not poison subsequent ones.
- `TokenStore.rotateRefresh` also wraps its full lookup → validate → consume → mint sequence in its own `async-mutex` `_rotateLock`. The subcache mutex alone is not sufficient: the window between `oauthTokens.get` (a read) and `oauthTokens.remove` (a write) lets two concurrent rotations both observe the same token as valid. Single mutex per store is fine — rotations are bounded by `ACCESS_TOKEN_TTL_SECONDS` (~one per active session per 24h).
- In-memory stores (`AuthRequestStore`, `AuthCodeStore`) assume single-threaded Node.js event-loop execution; no per-store mutex is needed because all operations are synchronous (no `await` within a store method).

## Dependencies

**Leaf modules (no internal imports within `src/auth/`):**

- `tokens.ts` — uses only `node:crypto`
- `errors.ts` — imports only from `@modelcontextprotocol/sdk`
- `presets.ts` — imports from `errors.ts` and `types.ts`
- `allowlist.ts` — imports from `errors.ts` and `types.ts`
- `dcr-validator.ts` — imports from `errors.ts` and `types.ts`
- `types.ts` — imports type references from other `src/auth/` modules (circular-free via `import type`)
- `ttl-store.ts` — no internal imports; pure generic implementation

**Shell modules (use other auth files + external deps):**

- `oidc-client.ts` — uses `jose`
- `auth-request-store.ts`, `auth-code-store.ts` — extend `ttl-store.ts`; import from `types.ts` and `tokens.ts`
- `client-registration.ts` — uses `src/cache/disk/` (via `DiskCacheRoot.oauthClients`)
- `token-store.ts` — uses `src/cache/disk/` (via `DiskCacheRoot.oauthClients` and `.oauthTokens`)
- `provider.ts` — uses all stores, `oidc-client.ts`, and `allowlist.ts`
- `routes.ts` — uses `provider.ts`, `client-registration.ts`, `hono-rate-limiter`
- `metadata.ts` — uses `types.ts` and `@modelcontextprotocol/sdk`
- `cleanup.ts` — uses stores and `src/cache/disk/` (via `DiskCacheRoot.oauthClients` and `.oauthTokens`)
- `build.ts` — composes all of the above; imports `src/utils/config.ts` and `src/cache/disk/`

**External dependencies:** `@modelcontextprotocol/sdk` (OAuth provider/client interfaces), `jose` (JWKS, jwtVerify), `hono-rate-limiter` (rate limiting middleware), `async-mutex` (via `DiskCacheRoot`'s per-subcache mutexes)

**Used by:**

- `src/server/build.ts` — calls `buildAuthContext` and stores result as `app.auth`
- `src/transport/http.ts` — mounts `buildAuthMetadataRouter`, `buildDcrRateLimit`, `buildClientCap`, and `mcpAuthRouter(provider)` from `@hono/mcp`

## Boundaries

- `src/auth/` may import from: `src/cache/disk/` (DiskCacheRoot only), `src/utils/config.ts` and `src/utils/xdg.ts`, `@modelcontextprotocol/sdk`, `jose`, `hono-rate-limiter`, `zod`, `neverthrow`, `node:crypto`.
- `src/auth/` must NOT import from: `src/tools/`, `src/resources/`, `src/features/`, `src/paprika/`, `src/server/`, `src/transport/`.
- Only `src/server/build.ts` and `src/transport/http.ts` may import from `src/auth/`.
