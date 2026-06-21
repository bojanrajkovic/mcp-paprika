# @bojanrajkovic/mcp-paprika

An [MCP](https://modelcontextprotocol.io/) server for the [Paprika](https://www.paprikaapp.com/) recipe manager. Search, browse, create, and manage your recipes from any MCP client.

## Features

- **Full tool coverage** for recipe, pantry, grocery, meal-planner, and menu management — search, filter, CRUD, categories, pagination, pantry inventory, aisles, grocery lists and items, meal planning (the upcoming plan, history recall, meal types, dated planner entries), and menus (recipe collections, their items, and one-shot add-to-planner)
- **Semantic search** via `discover_recipes` — find recipes by natural language description using any OpenAI-compatible embedding provider
- **AI recipe photos** via `generate_recipe_photo` — generate a styled food photo for a recipe (or restyle its existing one) using OpenRouter image models, and attach it automatically
- **Background sync** — keeps your local cache in sync with Paprika's cloud
- **MCP resources** — recipes as `paprika://recipe/{uid}`, grocery lists as `paprika://grocery-list/{uid}`, and menus as `paprika://menu/{uid}`
- **Two transports** — stdio (default, for CLI clients) and Streamable HTTP (for mobile/web clients)
- **Container image** — a distroless runtime ready for self-hosting

## Transports

`mcp-paprika` speaks the MCP protocol over two transports, selected via `MCP_TRANSPORT`:

| Transport | Default? | Use it for                                                                          |
| --------- | -------- | ----------------------------------------------------------------------------------- |
| `stdio`   | yes      | Local CLI clients: Claude Code, Claude Desktop, Cursor, mcp-cli                     |
| `http`    | no       | Streamable HTTP for Claude Mobile and other HTTP-based MCP clients, or self-hosting |

The HTTP transport ships with **OAuth 2.1** (authorization code + PKCE, RFC 7591
dynamic client registration); the [HTTP transport quick start](https://github.com/bojanrajkovic/mcp-paprika/blob/main/docs/quick-start-http.md)
sets it up end to end.

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

That's the whole local setup. To enable semantic search or AI recipe photos, add the
optional provider credentials from [configuration.md](https://github.com/bojanrajkovic/mcp-paprika/blob/main/docs/configuration.md).

## Quick start — HTTP transport

For remote clients (Claude Mobile, claude.ai), the server speaks Streamable HTTP behind
OAuth 2.1, delegating identity to an upstream OIDC provider you choose. The
[HTTP transport quick start](https://github.com/bojanrajkovic/mcp-paprika/blob/main/docs/quick-start-http.md) walks an IdP from zero to a
working Claude connector, and [deployment.md](https://github.com/bojanrajkovic/mcp-paprika/blob/main/docs/deployment.md) covers running it in a
container, behind a reverse proxy, or with Docker Compose.

## Documentation

**Guides**

- **[HTTP transport quick start](https://github.com/bojanrajkovic/mcp-paprika/blob/main/docs/quick-start-http.md)** — OIDC setup from zero to a Claude connector
- **[Deployment](https://github.com/bojanrajkovic/mcp-paprika/blob/main/docs/deployment.md)** — container, TLS termination, Docker Compose

**Reference**

- **[Configuration](https://github.com/bojanrajkovic/mcp-paprika/blob/main/docs/configuration.md)** — env vars, config files, platform paths
- **[HTTP transport](https://github.com/bojanrajkovic/mcp-paprika/blob/main/docs/http-transport.md)** — binding, host/origin allowlists, graceful shutdown
- **[OAuth 2.1 configuration](https://github.com/bojanrajkovic/mcp-paprika/blob/main/docs/oauth-configuration.md)** — OIDC providers, allowlist, consent gate
- **[Tools reference](https://github.com/bojanrajkovic/mcp-paprika/tree/main/docs/tools)** — every tool with parameters and examples
- **[Embedding providers](https://github.com/bojanrajkovic/mcp-paprika/blob/main/docs/embedding-providers.md)** — semantic search with Ollama, OpenAI, OpenRouter
- **[Architecture](https://github.com/bojanrajkovic/mcp-paprika/blob/main/docs/architecture.md)** — how it works under the hood
- **[Releasing](https://github.com/bojanrajkovic/mcp-paprika/blob/main/docs/releasing.md)** — release model, prerelease validation, attestation verification

## License

[MIT](LICENSE)
