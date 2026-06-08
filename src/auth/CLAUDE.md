# OAuth 2.1 Authorization Layer

## Purpose

`src/auth/` is the OAuth 2.1 authorization-server surface `mcp-paprika` presents to remote MCP clients on the **HTTP transport only**. It plays two isolated roles at once: a full OAuth 2.1 authorization server _toward_ MCP clients (dynamic registration, PKCE auth-code flow, opaque token minting + revocation, metadata), and an OIDC _client_ toward one operator-configured upstream IdP (identity verification + allowlist). It is loaded only when `MCP_TRANSPORT=http`; in stdio mode, `buildAuthContext` returns `null` and nothing here is instantiated.

## Key References

- **ADR-0002** (`docs/adr/0002-oauth21-oidc-delegation.md`) — the canonical design rationale: why a minting AS (not a token-proxy), why opaque tokens (not JWTs), the two-isolated-relationships decision, and the three security controls (#193 redirect allowlist + consent, #194 bounded stores). Read this first.
- **Source is the catalog.** Per-file responsibilities, Zod schemas, token/client field shapes, TTL constants, route handlers, and the SDK `OAuthServerProvider` / `OAuthRegisteredClientsStore` contracts live in the `.ts` files (`types.ts`, `tokens.ts`, `provider.ts`, `routes.ts`, `token-store.ts`, etc.) and `docs/verified-api.md`. Don't re-enumerate them here.
- Wired into the app by `src/server/build.ts` (`buildAuthContext` → `app.auth`) and `src/transport/http.ts` (mounts the metadata router, DCR rate-limit, client-cap, and `mcpAuthRouter`).

## Sharp edges

These are the security and ordering invariants no grep over the source will _explain_ (the code enforces them; the WHY is here). Treat them as load-bearing: do not "simplify" any of them away.

### Stores speak `Result`; only the SDK edge throws — and only OAuth error types

The auth stores (`TokenStore`, `DiskClientRegistrationStore`'s route-facing methods, `AuthCleanup`, the OIDC fetch wrappers) are `Result`-native (ADR-0014). The SDK's `OAuthServerProvider` / DCR contracts are throw-based, so the provider and `registerClient`/`getClient` cross back onto the throw rail **only** with OAuth error types — directly (`InvalidGrantError`, …) or via the recognized `unwrapOAuth` helper in `errors.ts` — which the router serializes into spec responses. A disk-cache failure maps to a generic `server_error` at that edge (the real failure is logged first; the wire message stays generic) and to an honest 503 on our own RFC 7592 routes — never a silent pass or a 500. Don't add a non-OAuth throw to these surfaces; the conformance test pins the sanctioned set.

### The two OAuth relationships must never cross

The MCP client must never see an upstream IdP token, and the upstream IdP must never see a dynamically-registered MCP client's identifier. This server **mints and owns** its own opaque access/refresh tokens; the upstream id_token is consumed for verification and discarded. That isolation is what makes the confused-deputy fix tractable and bounds the blast radius of either side. Don't introduce token pass-through or a shared identifier across the boundary; it silently breaks the model.

### Opaque tokens are stored as hashes; plaintext never touches disk

Tokens are high-entropy random strings with no embedded claims, looked up server-side by their SHA-256 hash to resolve identity/scope/expiry. The plaintext is **never** persisted; the token-store layer hashes before any disk write, and the schema stores only the hash. Same rule for the DCR registration-access-token: returned in plaintext exactly once at registration, only its hash is kept. Never log or persist a raw token value; log `tokenHash` / `clientId` instead (the root logger also redacts `*.token`, `*.access_token`, etc., but don't rely on that as the only guard).

### Confused-deputy gate: fail-closed redirect-origin allowlist (#193)

An open-DCR proxy AS that forwards every `/authorize` upstream under one static upstream `client_id` is a confused deputy: a malicious registered client can ride an allowlisted victim's live upstream session and get a token bound to the victim but delivered to the attacker's redirect. The structural control runs **before any upstream redirect** and is deliberately strict:

- **Exact origin equality** on the request's single (already-SDK-validated) `redirect_uri`. No substring/suffix matching: `claude.ai.evil.com` and `evil-claude.ai` must never match `claude.ai`.
- **https-pinned**, with an http exemption only for the loopback literals (`localhost` / `127.0.0.1` / `[::1]`), mirroring `dcr-validator.ts`; a URI that passes DCR is judged by the same standard.
- **Scheme is re-checked at match time**, not just when the allowlist was normalized at startup, so the matcher never trusts a `URL.origin` it would not itself have admitted, regardless of how the set was built.
- **Loopback is fail-closed including the port**: `http://localhost` does NOT cover `http://localhost:51004` (RFC 8252 §7.3 ephemeral ports). A port-agnostic loopback match would be a wildcard; a loopback client with a random port prompts unless its exact origin is listed.
- **Empty allowlist means every `/authorize` is gated through consent** (fail-closed). The server ships safe and degrades to consent-on-every-login until the operator seeds `MCP_OAUTH_REDIRECT_ALLOWLIST`. A misconfigured deployment is over-cautious, never over-permissive.
- A recognized origin forwards upstream unchanged; an unrecognized one is held under an opaque single-use consent ticket and the user sees a consent screen.

### Consent runs before upstream auth; deny never redirects to the target (#193)

Ordering is the security property:

- **Consent precedes upstream authentication**, so the consent page only ever shows client-supplied data; the user's identity is not yet known and **cannot leak** on that page.
- The screen anchors on the **redirect host** (the field an attacker cannot forge) and treats the registration-supplied `client_name` as self-reported: every attacker-controlled field is HTML-escaped at every injection site, and the requested scope is never rendered (fixed coarse grant copy). Strict per-render nonce'd CSP + `X-Frame-Options: DENY` + `Cache-Control: no-store` on every consent-flow response.
- The single-use ticket doubles as the **CSRF token** for the same-origin (`form-action 'self'`) approve form; `consume()` enforces single-use.
- **Deny/expired never redirect back to the `redirect_uri`.** Because the screen fires _only_ for an unrecognized (therefore untrusted) target, redirecting a denial there would hand control to an attacker; deny/expired render terminal pages on our own origin instead. This is a deliberate divergence from RFC 6749 §4.1.2.1 that recognized clients never reach. Don't "fix" it back to spec.
- The recognized branch and the consent-approve branch funnel through one shared `redirectUpstream` helper specifically so they cannot drift apart.

### Bounded in-memory auth stores: reject-on-full, NOT a ring buffer (#194)

The three in-memory TTL stores (auth-request, auth-code, pending-authorization) are all written from the **unauthenticated, unthrottled** `/authorize` path, so a registered attacker could flood them. Each is capped at a fixed live-entry max. When a write would exceed the cap for a _new_ key, the store sweeps expired entries first, then **rejects the new write** rather than evicting an existing one.

Reject-on-full is the load-bearing choice: the oldest entry is typically a legitimate user several minutes into the upstream login and about to hit the callback. A ring buffer would evict _them_, converting a memory-exhaustion attack into a **login-denial attack against honest in-flight users**. The two unauthenticated write paths therefore surface a full store honestly (refuse with **503**) rather than handing back state that was never stored and sending the user upstream / rendering consent. The post-callback auth-code store's cap is defense-in-depth (its write is reached only after a completed upstream login + allowlist pass), but when full it degrades the client redirect to `error=temporarily_unavailable` (RFC 6749 §4.1.2.1) rather than issuing a code that would later fail at `/token`.

### Crypto fail-closed defaults

`alg=none` and HMAC (`HS*`) are never accepted for id_token verification; `allowedAlgs` is always a non-empty list of named asymmetric algorithms, and the intersection with the IdP's advertised set is checked at startup (fail-fast if empty). All upstream OIDC metadata URLs must be `https://`. Adding an HMAC alg or relaxing the https requirement defeats the whole verification chain.

### Allowlist denials must not leak identity into the redirect

A `/oauth/callback` allowlist denial redirects back with a generic `error_description="identity not allowed by server policy"`; the full reason (email + sub + which rule) goes to the operator log only. The redirect URL is forwarded to claude.ai and lands in the user's browser history: never re-introduce identity claims into it. (Denials are emitted at `warn`, which fans out to connected MCP clients via `notifications/message`; that's intended audit behavior, suppressible with `MCP_LOG_NOTIFY_LEVEL=error`.)

### Refresh rotation needs its own mutex beyond the disk-cache mutex

`TokenStore.rotateRefresh` wraps its full lookup → validate → consume → mint sequence in an `async-mutex` `_rotateLock`. The per-subcache disk mutex alone is **not** sufficient: the window between the `get` (read) and `remove` (write) lets two concurrent rotations both observe the same refresh token as valid and both consume it. Rotation is also client-bound (rejects with `invalid_grant` on a mismatched `expectedClientId`); the same `invalid_grant` covers both "unknown token" and "wrong client" so existence is never leaked.

### Startup is fail-fast; auth availability is coupled to the upstream IdP

`buildAuthContext` refuses to start on a discovery-fetch failure, an empty algorithm intersection, or invalid config; the server never runs in a degraded auth state. Consequence: a transient egress blip to the upstream IdP at startup can block the whole HTTP transport from coming up (existing unexpired tokens keep working; new logins can't be obtained while the IdP is unreachable). Check egress before blaming the image on a failed rollout.

### `redirectAllowlist` is normalized in `buildAuthContext`, not `config.ts`

`config.ts` keeps the raw `redirectAllowlist` strings unnormalized so it carries no dependency back into `src/auth/`; `buildAuthContext` normalizes them via `normalizeOrigin`. Normalizing them in `config.ts` would create a `config` → `auth` cycle.

### Auth owns its persistence; `cache/` must not depend on `auth/`

`disk.ts` holds the auth cache layer — `OAuthClientDiskCache` (the atomic DCR registration cap), the `oauthTokens` descriptor, and `buildAuthCaches` (the narrow `AuthCache` the HTTP transport stands up). They subclass/compose the generic `DiskCache` from `../cache/`, co-located here because auth is their sole owner — the same rule that keeps `RecipeDiskCache` in `domains/recipe/disk.ts`. The dependency runs one way (`auth/` → `cache/`), so `cache/` stays a generic primitive importing nothing from `auth/`. Don't move these back into `cache/` or import an OAuth schema there: it reintroduces the `auth ⇄ cache` cycle this split removed.
