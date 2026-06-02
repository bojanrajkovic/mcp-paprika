# HTTP transport quick start

The HTTP transport uses **OAuth 2.1 with OIDC delegation**: `mcp-paprika` acts as the
OAuth authorization server toward MCP clients and delegates authentication to an
upstream identity provider (IdP) you choose. This page walks one IdP from zero to a
working Claude connector. For the full configuration reference, see
[oauth-configuration.md](oauth-configuration.md) (identity) and
[http-transport.md](http-transport.md) (binding, allowlists, shutdown).

## Step 1 — Choose an upstream IdP

Pick a preset or supply a raw discovery URL:

| Preset value | IdP                           | Notes                                                         |
| ------------ | ----------------------------- | ------------------------------------------------------------- |
| `google`     | Google                        | Discovery URL built in                                        |
| `entra`      | Microsoft Entra ID (Azure AD) | Tenant-bound; also set `MCP_OIDC_DISCOVERY_URL`               |
| `okta`       | Okta                          | Tenant-bound; also set `MCP_OIDC_DISCOVERY_URL`               |
| `auth0`      | Auth0                         | Tenant-bound; also set `MCP_OIDC_DISCOVERY_URL`               |
| `keycloak`   | Keycloak                      | Tenant-bound; also set `MCP_OIDC_DISCOVERY_URL`               |
| _(none)_     | Custom                        | Set `MCP_OIDC_DISCOVERY_URL` directly; omit `MCP_OIDC_PRESET` |

## Step 2 — Register one OAuth client in your IdP

In your IdP's developer console (e.g. Google Cloud Console → APIs & Services →
Credentials → OAuth 2.0 Client IDs), create a **single** OAuth 2.0 client:

- **Application type:** Web application
- **Redirect URI:** `<MCP_PUBLIC_URL>/oauth/callback` (e.g. `https://mcp.example.com/oauth/callback`; `MCP_PUBLIC_URL` already includes the `https://` scheme)

Copy the resulting client ID and secret into `MCP_OIDC_CLIENT_ID` and
`MCP_OIDC_CLIENT_SECRET`.

> **Tenant-bound presets (entra, okta, auth0, keycloak):** also copy the
> tenant-specific discovery URL from your IdP. For Entra that's
> `https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration`.

## Step 3 — Configure and start the server

A minimal Google setup needs the transport, the public URL, the preset, the client
credentials, and a non-empty allowlist:

```bash
MCP_TRANSPORT=http \
MCP_PUBLIC_URL=https://mcp.example.com \
MCP_OIDC_PRESET=google \
MCP_OIDC_CLIENT_ID=123456789-abc.apps.googleusercontent.com \
MCP_OIDC_CLIENT_SECRET=GOCSPX-... \
MCP_ALLOWED_EMAILS=you@example.com \
PAPRIKA_EMAIL=you@example.com \
PAPRIKA_PASSWORD=your-password \
  npx -y @bojanrajkovic/mcp-paprika
```

[oauth-configuration.md](oauth-configuration.md) is the full variable reference,
including scopes, signing algorithms, the email-verified policy, and the
redirect-origin consent gate. [http-transport.md](http-transport.md) covers the
networking knobs (port, host, `Host`/`Origin` allowlists, graceful shutdown).

## Step 4 — Set the allowlist

Access is granted when the authenticated user's email is in `MCP_ALLOWED_EMAILS` **or**
their subject ID is in `MCP_ALLOWED_SUBS` (OR semantics; at least one list must be
non-empty). `MCP_ALLOWED_EMAILS` is subject to `MCP_OIDC_EMAIL_VERIFIED_POLICY`; see
the [allowlist reference](oauth-configuration.md#allowlist) for the policy values and
their per-preset defaults.

## Step 5 — Add as a Claude connector

1. Open [claude.ai](https://claude.ai) → Settings → Connectors.
2. Click "Add custom connector."
3. Enter your server URL: `<MCP_PUBLIC_URL>/mcp` (e.g. `https://mcp.example.com/mcp`).
4. Claude redirects your browser to the upstream IdP for authentication.
5. After sign-in you're redirected back, and the connector is authorized.

## Verify the OAuth metadata

```bash
curl -sf https://mcp.example.com/.well-known/oauth-authorization-server | jq .issuer
# → "https://mcp.example.com"
```

The server also exposes:

- `POST /mcp` — MCP JSON-RPC over Streamable HTTP
- `GET /mcp` — long-lived SSE channel for server→client notifications
- `DELETE /mcp` — session termination
- `GET /healthz` — liveness probe returning `{ "ok": true, "sessions": <n> }`

To run this in a container or behind a reverse proxy, see [deployment.md](deployment.md).
