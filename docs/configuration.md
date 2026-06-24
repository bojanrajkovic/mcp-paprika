# Configuration

mcp-paprika resolves each setting from the first place it's defined, in priority
order:

1. **Environment variables** (highest priority)
2. **`.env` file** in the config directory
3. **`config.json`** in the config directory
4. **Schema defaults** (the fallback when nothing above sets a value)

Environment variables always win. If you set `PAPRIKA_EMAIL` as an env var and also
list it in `config.json`, the env var is used.

The HTTP transport and its OAuth layer have their own config references:
[http-transport.md](http-transport.md) for binding, host/origin allowlists, and
graceful shutdown; [oauth-configuration.md](oauth-configuration.md) for OIDC
providers, the user allowlist, and the consent gate. This page covers everything
common to both transports.

## Environment variables

### Core

| Variable                          | Config path                   | Required | Default   | Description                                                                           |
| --------------------------------- | ----------------------------- | -------- | --------- | ------------------------------------------------------------------------------------- |
| `PAPRIKA_EMAIL`                   | `paprika.email`               | Yes      | —         | Paprika account email                                                                 |
| `PAPRIKA_PASSWORD`                | `paprika.password`            | Yes      | —         | Paprika account password                                                              |
| `PAPRIKA_SYNC_INTERVAL`           | `sync.interval`               | No       | `"15m"`   | Background sync polling interval                                                      |
| `PAPRIKA_SYNC_ENABLED`            | `sync.enabled`                | No       | `true`    | Enable background sync                                                                |
| `PAPRIKA_SYNC_PENDING_WRITE_TTL`  | `sync.pendingWriteTtl`        | No       | `"60s"`   | How long a local write is shielded from sync reconciliation                           |
| `PAPRIKA_SYNC_RECIPE_CONCURRENCY` | `sync.recipeFetchConcurrency` | No       | `5`       | Concurrent recipe fetches during sync (see note below)                                |
| `MCP_TRANSPORT`                   | `transport`                   | No       | `"stdio"` | Transport mode: `"stdio"` (CLI clients) or `"http"` (Streamable HTTP)                 |
| `MCP_DIAG`                        | `diagnostics`                 | No       | `false`   | Diagnostics mode: register config-gated diagnostic tools (both transports; see below) |

When `MCP_TRANSPORT=http`, see [http-transport.md](http-transport.md) and
[oauth-configuration.md](oauth-configuration.md) for the `MCP_HTTP_*`, `MCP_OIDC_*`,
`MCP_ALLOWED_*`, and `MCP_OAUTH_*` variables.

### Diagnostics (optional)

`MCP_DIAG=true` registers config-gated diagnostic tools that are **absent from the
advertised surface in production** (the kernel skips them, so they ship nothing into
normal tool results). Today there is one: `diag_forwarding_probe`, which returns a
fresh random token in the result's `structuredContent` only — never the text block.
Calling it in a host and asking the model to repeat the token back determines whether
that host forwards `structuredContent` to the model (forwarding can no longer be
observed passively, since every schema-bearing result now carries its payload as JSON
text too). The connection fingerprint each host advertises is captured separately by
telemetry — see [telemetry.md](telemetry.md) § "Connection fingerprint".

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

Set all three together to enable semantic search. If any are missing, the
`discover_recipes` tool isn't registered and the server logs
`Semantic search: disabled` on startup. [embedding-providers.md](embedding-providers.md)
covers provider choices (Ollama, OpenAI, OpenRouter) with worked examples.

### Recipe photo generation (optional)

| Variable                           | Config path                              | Required | Default                        | Description                                                   |
| ---------------------------------- | ---------------------------------------- | -------- | ------------------------------ | ------------------------------------------------------------- |
| `IMAGE_GEN_API_KEY`                | `features.imageGen.apiKey`               | No       | —                              | OpenRouter API key dedicated to image generation              |
| `IMAGE_GEN_BASE_URL`               | `features.imageGen.baseUrl`              | No       | `https://openrouter.ai/api/v1` | OpenRouter base URL (only used with a dedicated key)          |
| `IMAGE_GEN_REUSE_EMBEDDINGS_CREDS` | `features.imageGen.reuseEmbeddingsCreds` | No       | `false`                        | Reuse the embedding (`OPENAI_*`) credentials instead of a key |

Image generation powers the `generate_recipe_photo` tool (OpenRouter chat-completions image
models). Enable it **one** of two ways:

- Set `IMAGE_GEN_API_KEY` (and optionally `IMAGE_GEN_BASE_URL`) for a **dedicated**
  key, which gives you an isolated OpenRouter billing line for photo generation; or
- Set `IMAGE_GEN_REUSE_EMBEDDINGS_CREDS=true` to **reuse** your embedding provider's
  credentials (valid only when `features.embeddings` is configured and points at
  OpenRouter).

Setting both, or setting neither while the block exists, is a configuration error. The
**model is chosen per `generate_recipe_photo` call**, not in config. If image generation isn't
enabled, `generate_recipe_photo` isn't registered.

### Sync interval format

`PAPRIKA_SYNC_INTERVAL` and `PAPRIKA_SYNC_PENDING_WRITE_TTL` accept human-readable
durations:

- `"15m"`, `"30 minutes"`, `"1 hour"`
- `"1h30m"`, `"1 hr 30 min"`
- ISO 8601: `"PT15M"`
- Bare numbers are treated as milliseconds: `900000`

### Sync enabled format

`PAPRIKA_SYNC_ENABLED` accepts `"true"`, `"false"`, `"1"`, or `"0"`.

### Recipe fetch concurrency

The first sync after a cold start fetches each recipe individually (`listRecipes`, then
one `getRecipe` per recipe), throttled by a concurrency bulkhead.
`PAPRIKA_SYNC_RECIPE_CONCURRENCY` (default `5`) sets that limit. For most libraries the
default is plenty; a few hundred recipes reconcile in a second or two. If you have a
very large library and want a faster cold start, raise it, but **reliability is the
tradeoff**: high concurrency against a single origin makes rate-limiting (HTTP 429) and
circuit-breaker trips more likely. Values above `20` are allowed but log a startup
warning. The retry and circuit-breaker stack still protects you; tune conservatively.

## Logging

The server uses structured [pino](https://getpino.io/) logging. In stdio mode, logs go
to stderr (TTY) or a file (non-TTY) to keep stdout clean for the MCP wire format. In
HTTP mode, logs go to stdout as raw JSON.

`MCP_LOG_PRETTY=auto` (the default) uses pino-pretty for all stdio output, both TTY (to
stderr) and non-TTY (to the log file). HTTP transport always emits raw JSON to stdout
regardless of this setting. `MCP_LOG_FILE` overrides the default file path used in
stdio non-TTY mode; the default is `<log-dir>/mcp-paprika.log`.

Records at or above `MCP_LOG_NOTIFY_LEVEL` (default `warn`) are forwarded to connected
MCP clients as logging messages.

## Telemetry (OpenTelemetry)

Traces and metrics are **off by default** and activate when `OTEL_EXPORTER_OTLP_ENDPOINT`
(or a signal-specific `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `…_METRICS_ENDPOINT`) is
set. Configuration uses the [standard OTel environment variables](https://opentelemetry.io/docs/languages/sdk-configuration/)
read by the SDK itself — nothing telemetry-related lives in `config.json` or the
`MCP_*` namespace. These variables may sit in the same `.env` file as the rest of the
configuration. `OTEL_LOG_LEVEL` diagnostics go to stderr (never stdout — the stdio MCP
wire). The full operator guide, including a local Grafana/collector stand-up, is
[docs/telemetry.md](telemetry.md).

## Config file

Place a `config.json` in the config directory. All fields are optional, and you can mix
config file and env vars.

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
    },
    "imageGen": {
      "apiKey": "sk-or-..."
    }
  }
}
```

## `.env` file

You can also place a `.env` file in the config directory. A stdio (local CLI) setup:

```bash
PAPRIKA_EMAIL=you@example.com
PAPRIKA_PASSWORD=your-password
PAPRIKA_SYNC_INTERVAL=15m

# Optional: enable semantic search
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama
EMBEDDING_MODEL=nomic-embed-text

# Optional: enable AI recipe-photo generation (generate_recipe_photo).
# Either a dedicated OpenRouter key:
IMAGE_GEN_API_KEY=sk-or-...
# ...or reuse the embedding creds above (when they point at OpenRouter):
# IMAGE_GEN_REUSE_EMBEDDINGS_CREDS=true
```

The same variables work for HTTP; [quick-start-http.md](quick-start-http.md) shows the
full HTTP + OAuth set.

## Config directory location

[env-paths](https://github.com/sindresorhus/env-paths) determines the config directory
from the app name `mcp-paprika`:

| Platform | Path                                                              |
| -------- | ----------------------------------------------------------------- |
| Linux    | `$XDG_CONFIG_HOME/mcp-paprika` (default: `~/.config/mcp-paprika`) |
| macOS    | `~/Library/Preferences/mcp-paprika`                               |
| Windows  | `%APPDATA%\mcp-paprika`                                           |

## Cache directory

The disk cache (synced recipes and the vector index) lives in a separate cache
directory:

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
