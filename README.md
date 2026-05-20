# @bojanrajkovic/mcp-paprika

An [MCP](https://modelcontextprotocol.io/) server for [Paprika](https://www.paprikaapp.com/) recipe manager. Search, browse, create, and manage your recipes from any MCP client.

## Features

- **14 tools** for recipe and pantry management — search, filter, CRUD, categories, pagination, pantry inventory
- **Semantic search** via `discover_recipes` — find recipes by natural language description using any OpenAI-compatible embedding provider
- **Background sync** — keeps your local cache in sync with Paprika's cloud
- **MCP resources** — expose recipes as `paprika://recipe/{uid}` and pantry items as `paprika://pantry/{uid}` resources
- **Two transports** — stdio (default, for CLI clients) and Streamable HTTP (for mobile/web clients)
- **Container image** — `Dockerfile` ships a distroless runtime ready for self-hosting

## Transports

`mcp-paprika` can speak the MCP protocol over two transports, selected via `MCP_TRANSPORT`:

| Transport | Default? | Use it for                                                                          |
| --------- | -------- | ----------------------------------------------------------------------------------- |
| `stdio`   | yes      | Local CLI clients: Claude Code, Claude Desktop, Cursor, mcp-cli                     |
| `http`    | no       | Streamable HTTP for Claude Mobile and other HTTP-based MCP clients, or self-hosting |

The HTTP transport ships with **OAuth 2.1** (authorization code + PKCE, RFC 7591 dynamic client registration). See the [HTTP transport quick start](#quick-start--http-transport) below.

## Quick start — stdio (Claude Desktop / Claude Code / Cursor)

Add to your MCP client config:

```json
{
  "mcpServers": {
    "paprika": {
      "command": "npx",
      "args": ["-y", "@bojanrajkovic/mcp-paprika"],
      "env": {
        "PAPRIKA_EMAIL": "you@example.com",
        "PAPRIKA_PASSWORD": "your-password"
      }
    }
  }
}
```

## Quick start — HTTP transport

The HTTP transport uses **OAuth 2.1 with OIDC delegation**: `mcp-paprika` acts as the OAuth authorization server toward MCP clients, and delegates authentication to an upstream identity provider (IdP) of your choice.

### Step 1 — Choose an upstream IdP

Pick a preset or supply a raw discovery URL:

| Preset value | IdP                           | Notes                                                         |
| ------------ | ----------------------------- | ------------------------------------------------------------- |
| `google`     | Google                        | Discovery URL built-in                                        |
| `entra`      | Microsoft Entra ID (Azure AD) | Tenant-bound — requires `MCP_OIDC_DISCOVERY_URL`              |
| `okta`       | Okta                          | Tenant-bound — requires `MCP_OIDC_DISCOVERY_URL`              |
| `auth0`      | Auth0                         | Tenant-bound — requires `MCP_OIDC_DISCOVERY_URL`              |
| `keycloak`   | Keycloak                      | Tenant-bound — requires `MCP_OIDC_DISCOVERY_URL`              |
| _(none)_     | Custom                        | Set `MCP_OIDC_DISCOVERY_URL` directly; omit `MCP_OIDC_PRESET` |

### Step 2 — Register one OAuth client in your IdP

In your IdP's developer console (e.g., Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs), create a **single** OAuth 2.0 client with:

- **Application type:** Web application
- **Redirect URI:** `https://<your-MCP_PUBLIC_URL>/oauth/callback`

Copy the resulting client ID and client secret — these become `MCP_OIDC_CLIENT_ID` and `MCP_OIDC_CLIENT_SECRET`.

> **Tenant-bound presets (entra, okta, auth0, keycloak):** also copy the tenant-specific discovery URL from your IdP. For Entra this is `https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration`.

### Step 3 — Configure and start the server

Full env-var reference:

| Env var                          | Required?                     | Description                                                                       |
| -------------------------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| `MCP_TRANSPORT`                  | yes                           | Set to `http`                                                                     |
| `MCP_PUBLIC_URL`                 | yes                           | Canonical `https://` URL of this server; used as OAuth issuer. No trailing slash. |
| `MCP_OIDC_PRESET`                | one of preset or discoveryUrl | `google`, `entra`, `okta`, `auth0`, or `keycloak`                                 |
| `MCP_OIDC_DISCOVERY_URL`         | one of preset or discoveryUrl | Raw OIDC discovery URL; required for tenant-bound presets                         |
| `MCP_OIDC_CLIENT_ID`             | yes                           | Client ID from upstream IdP                                                       |
| `MCP_OIDC_CLIENT_SECRET`         | yes                           | Client secret from upstream IdP                                                   |
| `MCP_ALLOWED_EMAILS`             | one of emails or subs         | Comma-separated list of allowed email addresses                                   |
| `MCP_ALLOWED_SUBS`               | one of emails or subs         | Comma-separated list of allowed subject IDs                                       |
| `MCP_OIDC_SCOPES`                | no                            | Override preset's scope list (comma-separated; default `openid email profile`)    |
| `MCP_OIDC_EMAIL_VERIFIED_POLICY` | no                            | `strict` (default), `skip`, or `if-present`                                       |
| `MCP_OIDC_ALLOWED_ALGS`          | no                            | Override preset's allowed id_token signing algorithms (comma-separated)           |
| `MCP_TRUST_PROXY`                | no                            | `true` to trust `X-Forwarded-For` / `CF-Connecting-IP` for the DCR rate-limit key. Default `false` (safe for direct exposure). Set `true` only behind a sanitizing reverse proxy (k8s ingress, Tailscale Funnel, Cloudflare). |

Example startup command:

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

### Step 4 — Configure the allowlist

The allowlist uses **OR semantics**: access is granted if the authenticated user's email is in `MCP_ALLOWED_EMAILS` OR their subject ID is in `MCP_ALLOWED_SUBS`. At least one list must be non-empty.

- **`MCP_ALLOWED_EMAILS`** — comma-separated email addresses. Subject to `MCP_OIDC_EMAIL_VERIFIED_POLICY`:
  - `strict` (default): email must be present and `email_verified = true`
  - `skip`: email is accepted without checking `email_verified`
  - `if-present`: if `email_verified` is in the id_token, it must be `true`; if absent, the email is accepted
- **`MCP_ALLOWED_SUBS`** — comma-separated subject IDs (stable per-user opaque identifiers from the IdP). Useful when you want to allow access regardless of email verification status.

### Step 5 — Add as a Claude connector

1. Open [claude.ai](https://claude.ai) → Settings → Connectors
2. Click "Add custom connector"
3. Enter your server URL: `https://<MCP_PUBLIC_URL>/mcp`
4. Claude will redirect your browser to the upstream IdP for authentication
5. After sign-in, you are redirected back and the connector is authorized

### Verify the OAuth metadata

```bash
curl -sf https://<MCP_PUBLIC_URL>/.well-known/oauth-authorization-server | jq .issuer
# → "https://<MCP_PUBLIC_URL>"
```

The server also exposes:

- `POST /mcp` — MCP JSON-RPC over Streamable HTTP
- `GET  /mcp` — long-lived SSE channel for server→client notifications
- `DELETE /mcp` — session termination
- `GET /healthz` — liveness probe returning `{ "ok": true, "sessions": <n> }`

## Quick start — container

The image defaults to `MCP_TRANSPORT=http`, so a container run needs the same
OAuth environment that the [HTTP transport quick start](#quick-start--http-transport)
walks through — `MCP_PUBLIC_URL`, an OIDC preset (or discovery URL), upstream
client credentials, and a non-empty allowlist. Without those, the server exits
during config validation.

```bash
docker build -t mcp-paprika:dev .

docker run --rm \
  -e PAPRIKA_EMAIL=you@example.com \
  -e PAPRIKA_PASSWORD=your-password \
  -e MCP_PUBLIC_URL=https://mcp.example.com \
  -e MCP_OIDC_PRESET=google \
  -e MCP_OIDC_CLIENT_ID=123456789-abc.apps.googleusercontent.com \
  -e MCP_OIDC_CLIENT_SECRET=GOCSPX-... \
  -e MCP_ALLOWED_EMAILS=you@example.com \
  -v "$(pwd)/data:/data" \
  -p 3000:3000 \
  mcp-paprika:dev
```

For a one-shot smoke test that just verifies the image launches (no OAuth, no
remote clients), override the transport to `stdio` — note that this turns the
container into a CLI process that speaks MCP on stdin/stdout, so the port
mapping isn't used:

```bash
docker run --rm -i \
  -e MCP_TRANSPORT=stdio \
  -e PAPRIKA_EMAIL=you@example.com \
  -e PAPRIKA_PASSWORD=your-password \
  -v "$(pwd)/data:/data" \
  mcp-paprika:dev
```

The HTTP-mode image binds on `0.0.0.0:3000` and persists the disk cache and
vector index under `/data` (the documented mount point). Both `/data`
sub-directories (`config/`, `cache/`) are pre-created with `nonroot` (UID 65532)
ownership in the image so writes work the first time even on a fresh bind-mount.

If you bind-mount a host directory you created as root, pre-chown it:

```bash
mkdir -p ./data && sudo chown -R 65532:65532 ./data
```

Or use a named volume (Docker handles ownership automatically):

```bash
docker run --rm \
  -e PAPRIKA_EMAIL=... -e PAPRIKA_PASSWORD=... \
  -v mcp-paprika-data:/data \
  -p 3000:3000 \
  mcp-paprika:dev
```

The image also declares a `HEALTHCHECK` that hits `GET /healthz`; verify with:

```bash
docker inspect --format '{{.State.Health.Status}}' <container>
# → healthy
```

## Deployment patterns (HTTP transport)

The HTTP transport ships with OAuth 2.1 built in. The primary remaining concerns are TLS termination and, optionally, additional network-layer controls.

**TLS termination** is required — `MCP_PUBLIC_URL` must be `https://` and OAuth requires encrypted connections end-to-end. Recommended options:

- **Reverse proxy with TLS** (nginx / Caddy) — terminates TLS, passes `X-Forwarded-For` headers (required for rate limiting), and forwards to the container on a private port.
- **Cloudflare Tunnel** — no inbound port exposed; Cloudflare terminates TLS. Works well with Cloudflare Access for an additional authentication layer if desired.
- **Tailscale HTTPS** — Tailscale's built-in HTTPS cert provisioning; suitable for homelab setups where all clients are on your tailnet.

**Container deployment with Docker Compose:**

```yaml
services:
  mcp-paprika:
    image: ghcr.io/bojanrajkovic/mcp-paprika:latest
    environment:
      MCP_TRANSPORT: http
      MCP_PUBLIC_URL: https://mcp.example.com
      MCP_OIDC_PRESET: google
      MCP_OIDC_CLIENT_ID: "<your-client-id>"
      MCP_OIDC_CLIENT_SECRET: "<your-client-secret>"
      MCP_ALLOWED_EMAILS: "you@example.com"
      PAPRIKA_EMAIL: "you@example.com"
      PAPRIKA_PASSWORD: "<your-paprika-password>"
    volumes:
      - mcp-paprika-data:/data
    ports:
      - "127.0.0.1:3000:3000"

volumes:
  mcp-paprika-data:
```

OAuth provides authentication-level controls; the reverse proxy provides TLS, rate limiting, and any additional network-level restrictions the deployment requires.

## Documentation

- **[Configuration](docs/configuration.md)** — env vars, config files, transport options, platform paths
- **[Tools reference](docs/tools/)** — every tool with parameters and examples
- **[Embedding providers](docs/embedding-providers.md)** — set up semantic search with Ollama, OpenAI, OpenRouter, etc.
- **[Architecture](docs/architecture.md)** — how it works under the hood

## License

[MIT](LICENSE)
