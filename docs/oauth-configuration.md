# OAuth 2.1 configuration

When `MCP_TRANSPORT=http`, the server runs a full OAuth 2.1 authorization server
with PKCE and Dynamic Client Registration (RFC 7591). It delegates identity to an
upstream OIDC provider and issues its own opaque access tokens to MCP clients.
[ADR-0002](adr/0002-oauth21-oidc-delegation.md) records why the server delegates
rather than authenticating directly; [quick-start-http.md](quick-start-http.md)
walks an IdP through to a working Claude connector. This page is the configuration
reference.

## Environment variables

| Variable                         | Config path                 | Required     | Default    | Description                                                                       |
| -------------------------------- | --------------------------- | ------------ | ---------- | --------------------------------------------------------------------------------- |
| `MCP_PUBLIC_URL`                 | `oauth.publicUrl`           | Yes (http)   | —          | Publicly reachable `https://` URL for this server (no trailing slash)             |
| `MCP_OIDC_PRESET`                | `oauth.preset`              | Yes (http) ¹ | —          | OIDC provider preset: `google`, `entra`, `okta`, `auth0`, `keycloak`              |
| `MCP_OIDC_DISCOVERY_URL`         | `oauth.discoveryUrl`        | Yes (http) ¹ | —          | OIDC discovery URL; an alternative to `MCP_OIDC_PRESET` for any OIDC IdP          |
| `MCP_OIDC_CLIENT_ID`             | `oauth.clientId`            | Yes (http)   | —          | OAuth client ID issued by the IdP                                                 |
| `MCP_OIDC_CLIENT_SECRET`         | `oauth.clientSecret`        | Yes (http)   | —          | OAuth client secret issued by the IdP                                             |
| `MCP_ALLOWED_EMAILS`             | `oauth.allowlist.emails`    | Yes (http) ² | `[]`       | Comma-separated email addresses allowed to use the server                         |
| `MCP_ALLOWED_SUBS`               | `oauth.allowlist.subs`      | Yes (http) ² | `[]`       | Comma-separated OIDC subject identifiers allowed to use the server                |
| `MCP_TRUST_PROXY`                | `oauth.trustProxy`          | No           | `false`    | Trust `X-Forwarded-For` for DCR rate limiting (set behind a sanitizing proxy)     |
| `MCP_OAUTH_REDIRECT_ALLOWLIST`   | `oauth.redirectAllowlist`   | No           | `[]`       | Recognized redirect origins for the [consent gate](#redirect-origin-consent-gate) |
| `MCP_OIDC_SCOPES`                | `oauth.scopes`              | No           | —          | Extra OAuth scopes to request (comma-separated)                                   |
| `MCP_OIDC_EMAIL_VERIFIED_POLICY` | `oauth.emailVerifiedPolicy` | No           | `strict` ³ | Email verification policy: `strict`, `skip`, or `if-present`                      |
| `MCP_OIDC_ALLOWED_ALGS`          | `oauth.allowedAlgs`         | No           | `RS256` ⁴  | Allowed JWT signing algorithms (comma-separated)                                  |

¹ Set at least one of `MCP_OIDC_PRESET` or `MCP_OIDC_DISCOVERY_URL` when
`MCP_TRANSPORT=http`. Tenant-bound presets (`entra`, `okta`, `auth0`, `keycloak`)
need both: the preset names the provider, and `MCP_OIDC_DISCOVERY_URL` supplies the
tenant-specific discovery endpoint. `google` needs only the preset (its discovery URL
is hardcoded). Setting only `MCP_OIDC_DISCOVERY_URL` works for any OIDC-compliant IdP.
² Set at least one of `MCP_ALLOWED_EMAILS` or `MCP_ALLOWED_SUBS` to a non-empty value
when `MCP_TRANSPORT=http`.
³ Preset-derived default: `strict` for every preset and for a custom IdP, except
`auth0`, which defaults to `if-present`. Set the variable to override it.
⁴ Code-level default from the presets; the `keycloak` preset defaults to
`RS256, ES256`. Set this only to override a preset's default.

## Choosing an OIDC provider

For `google`, set only `MCP_OIDC_PRESET=google`; the discovery URL is hardcoded. For
the tenant-bound presets (`entra`, `okta`, `auth0`, `keycloak`), set **both**
`MCP_OIDC_PRESET` and `MCP_OIDC_DISCOVERY_URL`: the preset names the provider and the
discovery URL supplies the tenant-specific endpoint. Omitting either exits the server
at startup. For any other OIDC-compliant IdP, set only `MCP_OIDC_DISCOVERY_URL` with
no preset.

**Built-in presets** (`MCP_OIDC_PRESET`):

| Preset     | Provider           |
| ---------- | ------------------ |
| `google`   | Google accounts    |
| `entra`    | Microsoft Entra ID |
| `okta`     | Okta               |
| `auth0`    | Auth0              |
| `keycloak` | Keycloak           |

**Custom IdP** (`MCP_OIDC_DISCOVERY_URL`): point it at the
`/.well-known/openid-configuration` endpoint of your IdP, e.g.
`https://accounts.example.com/.well-known/openid-configuration`.

## Allowlist

Set at least one of `MCP_ALLOWED_EMAILS` or `MCP_ALLOWED_SUBS` to a non-empty value.
Both accept comma-separated values and combine with **OR** semantics: a user is
allowed when their email appears in `MCP_ALLOWED_EMAILS` **or** their OIDC `sub` claim
appears in `MCP_ALLOWED_SUBS`.

`MCP_ALLOWED_EMAILS` is subject to `MCP_OIDC_EMAIL_VERIFIED_POLICY`, one of three
values:

- `strict`: the email must be present and `email_verified` must be `true`.
- `skip`: the email is accepted without checking `email_verified`.
- `if-present`: if the id_token carries `email_verified`, it must be `true`; if the
  claim is absent, the email is accepted.

The default is preset-derived: `strict` for `google`, `entra`, `okta`, `keycloak`,
and any custom IdP, and `if-present` for `auth0`. Set the variable to override it.

`MCP_ALLOWED_SUBS` matches the IdP's stable per-user subject identifier, so it grants
access regardless of email-verification status.

## Trust proxy

`MCP_TRUST_PROXY=true` keys the DCR rate limiter off `X-Forwarded-For` instead of the
direct peer address. Set it when a trusted reverse proxy (nginx, Tailscale Funnel,
Cloudflare) sanitizes that header before it reaches the server. The default `false` is
safe for direct internet exposure without a proxy.

## OAuth redirect URI

Register exactly `https://<your-public-url>/oauth/callback` as the authorized redirect
URI on your IdP client. Trailing slashes in `MCP_PUBLIC_URL` are stripped at parse time
so the match stays exact.

## Redirect-origin consent gate

The server accepts open Dynamic Client Registration, so any client can register and
start an authorization. `MCP_OAUTH_REDIRECT_ALLOWLIST` is the trust boundary that
decides which of those clients can finish a login without an explicit prompt: a
`/authorize` request whose `redirect_uri` origin is on the list goes straight to your
IdP, and any unrecognized origin shows a consent screen the user must approve first.
This closes a confused-deputy gap where a malicious registered client could otherwise
ride an allowlisted user's live IdP session to obtain a token bound to that user's
identity.

Set it to the origins of the clients you actually use; for a Claude deployment, that's
typically `https://claude.ai` (and likely `https://claude.com` as Anthropic migrates
domains; Claude mobile and desktop may surface additional origins as one-time prompts
until you list them). Leaving it empty is safe, just noisier: every login is gated, so
you approve the screen each time. Entries are exact origins (`scheme://host:port`),
https only, with an `http://localhost` / `127.0.0.1` / `[::1]` exemption for local
development. There are no subdomain wildcards; loopback is matched including the port.
Everything is validated at startup, so a malformed entry fails the server fast rather
than silently allowing nothing.
