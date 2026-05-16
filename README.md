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

> **HTTP transport has no built-in authentication.** Do not expose port 3000 directly
> to the public internet. Put it behind Cloudflare Access, Tailscale Serve, an OAuth2
> proxy, or your reverse proxy of choice. OAuth 2.1 support is planned as a follow-up
> — until then, network-trust is the supported deployment model.

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

Run with env vars set:

```bash
MCP_TRANSPORT=http \
MCP_HTTP_PORT=3000 \
PAPRIKA_EMAIL=you@example.com \
PAPRIKA_PASSWORD=your-password \
  npx -y @bojanrajkovic/mcp-paprika
```

The server then exposes:

- `POST /mcp` — MCP JSON-RPC over Streamable HTTP (single endpoint that multiplexes initialize, tools/list, tools/call, etc.)
- `GET  /mcp` — long-lived SSE channel for server→client notifications (resource list changed, log messages)
- `DELETE /mcp` — session termination
- `GET /healthz` — liveness probe returning `{ "ok": true, "sessions": <n> }`

Verify locally:

```bash
curl -sf http://127.0.0.1:3000/healthz
# → {"ok":true,"sessions":0}
```

## Quick start — container

```bash
docker build -t mcp-paprika:dev .

docker run --rm \
  -e PAPRIKA_EMAIL=you@example.com \
  -e PAPRIKA_PASSWORD=your-password \
  -v "$(pwd)/data:/data" \
  -p 3000:3000 \
  mcp-paprika:dev
```

The image defaults to `MCP_TRANSPORT=http`, binds on `0.0.0.0:3000`, and persists the
disk cache and vector index under `/data` (the documented mount point). Both `/data`
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

Because the HTTP transport ships without authentication, the supported deployment is
"behind a network-trust boundary." Some good options:

- **Cloudflare Tunnel + Cloudflare Access** (recommended for public reachability) — a
  zero-trust front door with SSO/IdP integration, no inbound ports exposed.
- **Tailscale Serve** — exposes the container only over your tailnet; perfect for
  homelab / single-user setups.
- **OAuth2 proxy** (e.g. [oauth2-proxy](https://github.com/oauth2-proxy/oauth2-proxy))
  in front of the container.
- **Reverse proxy basic-auth** (nginx / Caddy `basic_auth`) for the simplest setup
  when you really just need a password gate.

## Documentation

- **[Configuration](docs/configuration.md)** — env vars, config files, transport options, platform paths
- **[Tools reference](docs/tools/)** — every tool with parameters and examples
- **[Embedding providers](docs/embedding-providers.md)** — set up semantic search with Ollama, OpenAI, OpenRouter, etc.
- **[Architecture](docs/architecture.md)** — how it works under the hood
- **[Verified MCP SDK API](docs/verified-api.md)** — the authoritative reference for SDK import paths and the Streamable HTTP wiring

## License

[MIT](LICENSE)
