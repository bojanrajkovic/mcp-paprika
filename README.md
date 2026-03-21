# @bojanrajkovic/mcp-paprika

An [MCP](https://modelcontextprotocol.io/) server for [Paprika](https://www.paprikaapp.com/) recipe manager. Search, browse, create, and manage your recipes from any MCP client.

## Features

- **10 tools** for recipe management — search, filter, CRUD, categories, pagination
- **Semantic search** via `discover_recipes` — find recipes by natural language description using any OpenAI-compatible embedding provider
- **Background sync** — keeps your local cache in sync with Paprika's cloud
- **MCP resources** — expose recipes as `paprika://recipe/{uid}` resources

## Quick start

1. Install globally:

   ```bash
   pnpm add -g @bojanrajkovic/mcp-paprika
   ```

2. Set your Paprika credentials (env vars, `.env` file, or `config.json` — see [configuration](docs/configuration.md)):

   ```bash
   export PAPRIKA_EMAIL="you@example.com"
   export PAPRIKA_PASSWORD="your-password"
   ```

3. Add to your MCP client config (e.g. Claude Desktop):

   ```json
   {
     "mcpServers": {
       "paprika": {
         "command": "mcp-paprika",
         "env": {
           "PAPRIKA_EMAIL": "you@example.com",
           "PAPRIKA_PASSWORD": "your-password"
         }
       }
     }
   }
   ```

## Documentation

- **[Configuration](docs/configuration.md)** — env vars, config files, platform paths
- **[Tools reference](docs/tools/)** — all 10 tools with parameters and examples
- **[Embedding providers](docs/embedding-providers.md)** — set up semantic search with Ollama, OpenAI, OpenRouter, etc.
- **[Architecture](docs/architecture.md)** — how it works under the hood

## License

[MIT](LICENSE)
