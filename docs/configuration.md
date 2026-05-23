# Configuration

mcp-paprika loads configuration from three sources, merged in this priority order:

1. **Environment variables** (highest priority)
2. **`.env` file** in the config directory
3. **`config.json`** in the config directory
4. **Schema defaults** (lowest priority)

Environment variables always win. If you set `PAPRIKA_EMAIL` as an env var and also have it in `config.json`, the env var is used.

## Environment variables

### Core

| Variable                         | Config path            | Required | Default   | Description                                                           |
| -------------------------------- | ---------------------- | -------- | --------- | --------------------------------------------------------------------- |
| `PAPRIKA_EMAIL`                  | `paprika.email`        | Yes      | —         | Paprika account email                                                 |
| `PAPRIKA_PASSWORD`               | `paprika.password`     | Yes      | —         | Paprika account password                                              |
| `PAPRIKA_SYNC_INTERVAL`          | `sync.interval`        | No       | `"15m"`   | Background sync polling interval                                      |
| `PAPRIKA_SYNC_ENABLED`           | `sync.enabled`         | No       | `true`    | Enable background sync                                                |
| `PAPRIKA_SYNC_PENDING_WRITE_TTL` | `sync.pendingWriteTtl` | No       | `"60s"`   | How long a local write is shielded from sync reconciliation           |
| `MCP_TRANSPORT`                  | `transport`            | No       | `"stdio"` | Transport mode: `"stdio"` (CLI clients) or `"http"` (Streamable HTTP) |

### HTTP transport

| Variable              | Config path           | Required | Default     | Description                                                   |
| --------------------- | --------------------- | -------- | ----------- | ------------------------------------------------------------- |
| `MCP_HTTP_PORT`       | `http.port`           | No       | `3000`      | Port to bind when `MCP_TRANSPORT=http` (1–65535)              |
| `MCP_HTTP_HOST`       | `http.host`           | No       | `"0.0.0.0"` | Host to bind when `MCP_TRANSPORT=http`                        |
| `MCP_ALLOWED_HOSTS`   | `http.allowedHosts`   | No       | `[]`        | Host-header allowlist (DNS rebinding protection)              |
| `MCP_ALLOWED_ORIGINS` | `http.allowedOrigins` | No       | `[]`        | Origin-header allowlist (browser-only; locks out CLI clients) |

### OAuth 2.1 (required when `MCP_TRANSPORT=http`)

| Variable                         | Config path                 | Required     | Default   | Description                                                                   |
| -------------------------------- | --------------------------- | ------------ | --------- | ----------------------------------------------------------------------------- |
| `MCP_PUBLIC_URL`                 | `oauth.publicUrl`           | Yes (http)   | —         | Publicly reachable `https://` URL for this server — no trailing slash         |
| `MCP_OIDC_PRESET`                | `oauth.preset`              | Yes (http) ¹ | —         | OIDC provider preset: `google`, `entra`, `okta`, `auth0`, `keycloak`          |
| `MCP_OIDC_DISCOVERY_URL`         | `oauth.discoveryUrl`        | Yes (http) ¹ | —         | OIDC discovery URL — alternative to `MCP_OIDC_PRESET` for any OIDC IdP        |
| `MCP_OIDC_CLIENT_ID`             | `oauth.clientId`            | Yes (http)   | —         | OAuth client ID issued by the IdP                                             |
| `MCP_OIDC_CLIENT_SECRET`         | `oauth.clientSecret`        | Yes (http)   | —         | OAuth client secret issued by the IdP                                         |
| `MCP_ALLOWED_EMAILS`             | `oauth.allowlist.emails`    | Yes (http) ² | `[]`      | Comma-separated email addresses allowed to use the server                     |
| `MCP_ALLOWED_SUBS`               | `oauth.allowlist.subs`      | Yes (http) ² | `[]`      | Comma-separated OIDC subject identifiers allowed to use the server            |
| `MCP_TRUST_PROXY`                | `oauth.trustProxy`          | No           | `false`   | Trust `X-Forwarded-For` for DCR rate limiting (set behind a sanitizing proxy) |
| `MCP_OIDC_SCOPES`                | `oauth.scopes`              | No           | —         | Extra OAuth scopes to request (comma-separated)                               |
| `MCP_OIDC_EMAIL_VERIFIED_POLICY` | `oauth.emailVerifiedPolicy` | No           | —         | Email verification policy: `strict`, `skip`, or `if-present`                  |
| `MCP_OIDC_ALLOWED_ALGS`          | `oauth.allowedAlgs`         | No           | `RS256` ³ | Allowed JWT signing algorithms (comma-separated)                              |

¹ Exactly one of `MCP_OIDC_PRESET` or `MCP_OIDC_DISCOVERY_URL` must be set when `MCP_TRANSPORT=http`.
² At least one of `MCP_ALLOWED_EMAILS` or `MCP_ALLOWED_SUBS` must be non-empty when `MCP_TRANSPORT=http`.
³ Code-level default from presets; keycloak preset defaults to `RS256, ES256`. Set this only to override the preset's default.

### Logging

| Variable               | Config path           | Required | Default  | Description                                                                      |
| ---------------------- | --------------------- | -------- | -------- | -------------------------------------------------------------------------------- |
| `MCP_LOG_LEVEL`        | `logging.level`       | No       | `"info"` | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`                    |
| `MCP_LOG_NOTIFY_LEVEL` | `logging.notifyLevel` | No       | `"warn"` | Minimum level forwarded to connected MCP clients                                 |
| `MCP_LOG_PRETTY`       | `logging.pretty`      | No       | `"auto"` | Pretty-print: `true`, `false`, or `"auto"` (pretty for stdio TTY, JSON for HTTP) |
| `MCP_LOG_FILE`         | `logging.file`        | No       | —        | Override default log file path (stdio non-TTY only)                              |

### Semantic search (optional)

| Variable          | Config path                   | Required | Default | Description                 |
| ----------------- | ----------------------------- | -------- | ------- | --------------------------- |
| `OPENAI_API_KEY`  | `features.embeddings.apiKey`  | No       | —       | Embedding provider API key  |
| `OPENAI_BASE_URL` | `features.embeddings.baseUrl` | No       | —       | Embedding provider base URL |
| `EMBEDDING_MODEL` | `features.embeddings.model`   | No       | —       | Embedding model identifier  |

All three embedding variables must be set together to enable semantic search. If any are missing, the `discover_recipes` tool won't be registered and the server logs `Semantic search: disabled` on startup.

### Sync interval format

`PAPRIKA_SYNC_INTERVAL` and `PAPRIKA_SYNC_PENDING_WRITE_TTL` accept human-readable durations:

- `"15m"`, `"30 minutes"`, `"1 hour"`
- `"1h30m"`, `"1 hr 30 min"`
- ISO 8601: `"PT15M"`
- Bare numbers are treated as milliseconds: `900000`

### Sync enabled format

`PAPRIKA_SYNC_ENABLED` accepts `"true"`, `"false"`, `"1"`, or `"0"`.

## HTTP transport

`MCP_TRANSPORT=http` switches the server from stdio to a Streamable HTTP endpoint that
serves the MCP protocol at `POST /mcp` and a liveness probe at `GET /healthz`. Stdio
remains the default so existing CLI clients (Claude Code, Claude Desktop, Cursor,
mcp-cli) are unaffected.

`MCP_HTTP_PORT` accepts a number string or bare number and is coerced to an integer
in the range `1`–`65535`. `MCP_HTTP_HOST` accepts any non-empty string; default is
`0.0.0.0` (all interfaces).

HTTP transport requires OAuth 2.1 configuration — `MCP_PUBLIC_URL`,
`MCP_OIDC_CLIENT_ID`, `MCP_OIDC_CLIENT_SECRET`, at least one of
`MCP_ALLOWED_EMAILS`/`MCP_ALLOWED_SUBS`, and either `MCP_OIDC_PRESET` or
`MCP_OIDC_DISCOVERY_URL` must all be set. The server exits with a validation error
if any required field is missing.

### DNS rebinding protection

When the server is exposed directly to the public internet (no Cloudflare
Access, Tailscale Serve, or other proxy validating hosts in front), set
`MCP_ALLOWED_HOSTS` to a comma-separated list of permitted `Host` header
values:

```bash
MCP_ALLOWED_HOSTS=mcp.example.com,mcp.example.com:443
```

Requests to `POST /mcp` whose `Host` header isn't on the list get rejected
with HTTP 403. The default is empty (no restriction), which is correct when a
reverse proxy in front already validates the host.

`MCP_ALLOWED_HOSTS` alone is the right knob for almost every deployment.
Every HTTP client sends a `Host` header — HTTP/1.1 requires it — so the
check covers browser clients (Claude Mobile, claude.ai) and CLI clients
(Claude Code over HTTP, mcp-cli) the same way. It's also the header that DNS
rebinding can't forge: the attacker controls DNS resolution, but the victim's
browser still sends `Host: attacker.example` — which won't be on your list.

#### Origin allowlist (browser-only deployments)

`MCP_ALLOWED_ORIGINS` is a separate `Origin` header allowlist. **Setting it
locks out CLI clients.** Once the list is non-empty, the MCP transport also
rejects `POST /mcp` requests that arrive without an `Origin` header, and CLI
MCP clients don't send one. Use it only when the server is intended for
browser clients exclusively and you want to constrain which origins can call
it:

```bash
MCP_ALLOWED_ORIGINS=https://claude.ai
```

This is belt-and-suspenders on top of `MCP_ALLOWED_HOSTS`, not a replacement
for it.

#### Scope and matching rules

- Only `POST /mcp` is gated. The check fires inside the MCP transport, so
  `/healthz`, OAuth endpoints (`/.well-known/*`, `/register`, `/authorize`,
  `/token`, `/revoke`), and `/oauth/callback` aren't affected. That matches
  the threat model — DNS rebinding targets the application protocol endpoint
  — but "DNS rebinding protection" here doesn't mean "every route is locked
  down."
- Host and Origin values are matched exactly against the incoming header.
  Include the port if your clients send one (e.g. `mcp.example.com:443`).
- Either list automatically enables enforcement. There's no separate toggle.

## OAuth 2.1

When `MCP_TRANSPORT=http`, the server runs a full OAuth 2.1 authorization server
with PKCE and Dynamic Client Registration (RFC 7591). It delegates identity to an
upstream OIDC provider and issues its own opaque access tokens to MCP clients.

### Choosing an OIDC provider

Either set `MCP_OIDC_PRESET` to a built-in preset, or set `MCP_OIDC_DISCOVERY_URL`
to the discovery endpoint of any OIDC-compliant IdP (not both).

**Built-in presets** (`MCP_OIDC_PRESET`):

| Preset     | Provider           |
| ---------- | ------------------ |
| `google`   | Google accounts    |
| `entra`    | Microsoft Entra ID |
| `okta`     | Okta               |
| `auth0`    | Auth0              |
| `keycloak` | Keycloak           |

**Custom IdP** (`MCP_OIDC_DISCOVERY_URL`): set to the `/.well-known/openid-configuration`
endpoint of your IdP (e.g. `https://accounts.example.com/.well-known/openid-configuration`).

### Allowlist

At least one of `MCP_ALLOWED_EMAILS` or `MCP_ALLOWED_SUBS` must be non-empty. Both
accept comma-separated values and can be combined. A user is allowed if their email
appears in `MCP_ALLOWED_EMAILS` **or** their OIDC `sub` claim appears in
`MCP_ALLOWED_SUBS`.

### Trust proxy

`MCP_TRUST_PROXY=true` makes the DCR rate limiter key off `X-Forwarded-For` instead of
the direct peer address. Set it when a trusted reverse proxy (nginx, Tailscale Funnel,
Cloudflare) sanitizes that header before reaching the server. Default is `false` (safe
for direct internet exposure without a proxy).

### OAuth redirect URI

Register exactly `https://<your-public-url>/oauth/callback` as the authorized redirect URI
on your IdP client. Trailing slashes in `MCP_PUBLIC_URL` are stripped at parse time to
ensure exact matching.

## Logging

The server uses structured [pino](https://getpino.io/) logging. In stdio mode, logs go
to stderr (TTY) or a file (non-TTY) to keep stdout clean for the MCP wire format. In
HTTP mode, logs go to stdout as raw JSON.

`MCP_LOG_PRETTY=auto` (the default) uses pino-pretty when stderr is a TTY, and raw JSON
otherwise. `MCP_LOG_FILE` overrides the default file path used in stdio non-TTY mode;
the default is `<log-dir>/mcp-paprika.log`.

Records at or above `MCP_LOG_NOTIFY_LEVEL` (default `warn`) are automatically forwarded
to connected MCP clients as logging messages.

## Config file

Place a `config.json` in the config directory. All fields are optional — you can mix config file and env vars.

```json
{
  "paprika": {
    "email": "you@example.com",
    "password": "your-password"
  },
  "sync": {
    "enabled": true,
    "interval": "15m"
  },
  "transport": "http",
  "http": {
    "port": 3000,
    "host": "0.0.0.0"
  },
  "oauth": {
    "publicUrl": "https://mcp.example.com",
    "preset": "google",
    "clientId": "...",
    "clientSecret": "...",
    "allowlist": {
      "emails": ["you@example.com"]
    }
  },
  "logging": {
    "level": "info",
    "notifyLevel": "warn"
  },
  "features": {
    "embeddings": {
      "apiKey": "sk-...",
      "baseUrl": "http://localhost:11434/v1",
      "model": "nomic-embed-text"
    }
  }
}
```

## `.env` file

You can also place a `.env` file in the config directory.

Stdio (local CLI clients):

```bash
PAPRIKA_EMAIL=you@example.com
PAPRIKA_PASSWORD=your-password
PAPRIKA_SYNC_INTERVAL=15m

# Optional: enable semantic search
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama
EMBEDDING_MODEL=nomic-embed-text
```

HTTP with OAuth (remote MCP clients, claude.ai):

```bash
PAPRIKA_EMAIL=you@example.com
PAPRIKA_PASSWORD=your-password

MCP_TRANSPORT=http
MCP_PUBLIC_URL=https://mcp.example.com

MCP_OIDC_PRESET=google
MCP_OIDC_CLIENT_ID=...apps.googleusercontent.com
MCP_OIDC_CLIENT_SECRET=GOCSPX-...

MCP_ALLOWED_EMAILS=you@example.com
```

## Config directory location

The config directory is determined by [env-paths](https://github.com/sindresorhus/env-paths) with the app name `mcp-paprika`:

| Platform | Path                                                              |
| -------- | ----------------------------------------------------------------- |
| Linux    | `$XDG_CONFIG_HOME/mcp-paprika` (default: `~/.config/mcp-paprika`) |
| macOS    | `~/Library/Preferences/mcp-paprika`                               |
| Windows  | `%APPDATA%\mcp-paprika`                                           |

## Cache directory

The disk cache (synced recipes and vector index) lives in a separate cache directory:

| Platform | Path                                                            |
| -------- | --------------------------------------------------------------- |
| Linux    | `$XDG_CACHE_HOME/mcp-paprika` (default: `~/.cache/mcp-paprika`) |
| macOS    | `~/Library/Caches/mcp-paprika`                                  |
| Windows  | `%LOCALAPPDATA%\mcp-paprika\Cache`                              |

## Error messages

If configuration is invalid, the server exits with a message like:

```
Configuration validation failed:
  - paprika.email: String must contain at least 1 character(s) (set via PAPRIKA_EMAIL)
  - paprika.password: String must contain at least 1 character(s) (set via PAPRIKA_PASSWORD)
```

The parenthetical hints tell you which env var to set.
