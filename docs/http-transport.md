# HTTP transport

`MCP_TRANSPORT=http` switches the server from a local stdio pipe to a Streamable
HTTP endpoint that serves the MCP protocol at `POST /mcp` and a liveness probe at
`GET /healthz`. Stdio stays the default, so existing CLI clients (Claude Code,
Claude Desktop, Cursor, mcp-cli) are unaffected.

HTTP transport requires OAuth 2.1. The server runs a full authorization server in
front of the MCP endpoint; see [oauth-configuration.md](oauth-configuration.md)
for the identity setup and [quick-start-http.md](quick-start-http.md) for an
end-to-end connect walkthrough. This page covers the networking knobs: binding,
host and origin allowlists, and graceful shutdown.

## Environment variables

| Variable                     | Config path            | Required | Default     | Description                                                                                 |
| ---------------------------- | ---------------------- | -------- | ----------- | ------------------------------------------------------------------------------------------- |
| `MCP_HTTP_PORT`              | `http.port`            | No       | `3000`      | Port to bind when `MCP_TRANSPORT=http` (1–65535)                                            |
| `MCP_HTTP_HOST`              | `http.host`            | No       | `"0.0.0.0"` | Host to bind when `MCP_TRANSPORT=http`                                                      |
| `MCP_ALLOWED_HOSTS`          | `http.allowedHosts`    | No       | `[]`        | `Host`-header allowlist (DNS rebinding protection)                                          |
| `MCP_ALLOWED_ORIGINS`        | `http.allowedOrigins`  | No       | `[]`        | `Origin`-header allowlist (browser-only; locks out CLI clients)                             |
| `MCP_HTTP_SHUTDOWN_DRAIN_MS` | `http.shutdownDrainMs` | No       | `"5s"`      | Readiness-drain delay on `SIGTERM` (see [Graceful shutdown](#graceful-shutdown-kubernetes)) |

`MCP_HTTP_PORT` accepts a number string or a bare number, coerced to an integer in
the range `1`–`65535`. `MCP_HTTP_HOST` accepts any non-empty string and defaults to
`0.0.0.0` (all interfaces).

## DNS rebinding protection

When the server is exposed directly to the public internet, with no Cloudflare
Access, Tailscale Serve, or other host-validating proxy in front, set
`MCP_ALLOWED_HOSTS` to a comma-separated list of permitted `Host` header values:

```bash
MCP_ALLOWED_HOSTS=mcp.example.com,mcp.example.com:443
```

Requests to `POST /mcp` whose `Host` header isn't on the list get a `403`. The
default is empty (no restriction), which is correct when a reverse proxy already
validates the host.

`MCP_ALLOWED_HOSTS` is the right knob for almost every deployment. Every HTTP
client sends a `Host` header (HTTP/1.1 requires it), so the check covers browser
clients (Claude Mobile, claude.ai) and CLI clients (Claude Code over HTTP, mcp-cli)
alike. It's also the header DNS rebinding can't forge: the attacker controls DNS
resolution, but the victim's browser still sends `Host: attacker.example`, which
won't be on your list.

### Origin allowlist (browser-only deployments)

`MCP_ALLOWED_ORIGINS` is a separate `Origin`-header allowlist, and **setting it
locks out CLI clients.** Once the list is non-empty, the transport also rejects
`POST /mcp` requests that arrive without an `Origin` header, and CLI MCP clients
don't send one. Use it only when the server is meant for browser clients
exclusively and you want to constrain which origins can call it:

```bash
MCP_ALLOWED_ORIGINS=https://claude.ai
```

This is belt-and-suspenders on top of `MCP_ALLOWED_HOSTS`, not a replacement for it.

### Scope and matching rules

- Only `POST /mcp` is gated. The check fires inside the MCP transport, so
  `/healthz`, the OAuth endpoints (`/.well-known/*`, `/register`, `/authorize`,
  `/token`, `/revoke`), and `/oauth/callback` are unaffected. That matches the
  threat model (DNS rebinding targets the application protocol endpoint), so
  "DNS rebinding protection" here doesn't mean "every route is locked down."
- Host and Origin values are matched exactly against the incoming header. Include
  the port if your clients send one (e.g. `mcp.example.com:443`).
- Either list automatically enables enforcement. There's no separate toggle.

## Graceful shutdown (Kubernetes)

On `SIGTERM` the server shuts down in two phases:

1. **Readiness drain.** `/healthz` immediately starts returning `503`, so
   Kubernetes marks the pod not-ready and removes it from the Service endpoints,
   and the server keeps serving for `MCP_HTTP_SHUTDOWN_DRAIN_MS` (default `5s`).
   This window lets endpoint removal and kube-proxy / ingress routing propagate, so
   a request routed just before the pod was deleted still reaches a working server
   instead of a refused connection.
2. **Drain.** The sync engine stops, open SSE streams abort, the HTTP server stops
   accepting new connections, in-flight requests finish, and idle keep-alive
   sockets close immediately (`closeIdleConnections`). A hard `10s` timeout
   force-closes anything still open (`closeAllConnections`) so the process exits
   within the grace period.

Budget the timing so the **total** stays under `terminationGracePeriodSeconds`: the
drain delay plus the `10s` drain timeout (default `5 + 10 = 15s`) must be less than
the grace period (the chart/manifest default is `30s`). `MCP_HTTP_SHUTDOWN_DRAIN_MS`
accepts a duration (`"5s"`) or milliseconds; `0` disables the drain delay, which is
appropriate when you're not running under an orchestrator, or for a single-replica
`Recreate` rollout where there's no other replica to route to. Keep it well under
`terminationGracePeriodSeconds`.

The container runs `node` as PID 1 (distroless exec-form entrypoint), so `SIGTERM`
reaches the process directly, with no shell wrapper to swallow it.

## Connector appearance

A host that adds this server as a connector can show a name, an icon, and a
project link instead of the bare URL. The metadata is exposed on three surfaces,
all derived from one source (`src/utils/branding.ts`):

- **`serverInfo`** — `title`, `websiteUrl`, and an `icons` data URI ride in the
  MCP `Implementation` (icons are spec-native, SEP-973). A host reads this only
  _after_ the client connects, and under this transport `serverInfo` sits behind
  OAuth, so a pre-auth connector card cannot use it.
- **`GET /favicon.png`** — the icon as a 128×128 PNG, served unauthenticated.
- **`logo_uri`** in the authorization-server metadata
  (`/.well-known/oauth-authorization-server`) points at `${MCP_PUBLIC_URL}/favicon.png`;
  `service_documentation` points at the project repository.

The unauthenticated `/favicon.png` and the `logo_uri` that references it are the
only surfaces a host can read _before_ the user authenticates — which is when a
connector card is rendered. Host support for connector icons is uneven and
evolving, so a host may still show a generic icon regardless; everything here is
served per spec and costs nothing when a host ignores it.
