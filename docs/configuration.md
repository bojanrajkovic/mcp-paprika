# Configuration

mcp-paprika resolves each setting from the first of these that defines it:

1. **The process environment** (highest priority)
2. **A `.env` file** in the config directory (see [`.env` file](#env-file))
3. **The built-in default**

Releases before 2.0 also read a `config.json` from the config directory. That file is
no longer read: if it exists, the server stops at boot and names the file, so a stale
setting can't be silently ignored. Move each setting to its environment variable
(listed below) in `.env`, then delete `config.json`.

The HTTP transport and its OAuth layer have their own config references:
[http-transport.md](http-transport.md) for binding, host/origin allowlists, and
graceful shutdown; [oauth-configuration.md](oauth-configuration.md) for OIDC
providers, the user allowlist, and the consent gate. This page covers everything
common to both transports.

## Environment variables

### Core

| Variable                          | Required | Default   | Description                                                           |
| --------------------------------- | -------- | --------- | --------------------------------------------------------------------- |
| `PAPRIKA_EMAIL`                   | Yes      | —         | Paprika account email                                                 |
| `PAPRIKA_PASSWORD`                | Yes      | —         | Paprika account password                                              |
| `PAPRIKA_SYNC_INTERVAL`           | No       | `"15m"`   | Background sync polling interval                                      |
| `PAPRIKA_SYNC_ENABLED`            | No       | `true`    | Enable background sync                                                |
| `PAPRIKA_SYNC_PENDING_WRITE_TTL`  | No       | `"60s"`   | How long a local write is shielded from sync reconciliation           |
| `PAPRIKA_SYNC_RECIPE_CONCURRENCY` | No       | `5`       | Concurrent recipe fetches during sync (see note below)                |
| `MCP_TRANSPORT`                   | No       | `"stdio"` | Transport mode: `"stdio"` (CLI clients) or `"http"` (Streamable HTTP) |

When `MCP_TRANSPORT=http`, see [http-transport.md](http-transport.md) and
[oauth-configuration.md](oauth-configuration.md) for the `MCP_HTTP_*`, `MCP_OIDC_*`,
`MCP_ALLOWED_*`, and `MCP_OAUTH_*` variables.

### Logging

| Variable               | Required | Default  | Description                                                                      |
| ---------------------- | -------- | -------- | -------------------------------------------------------------------------------- |
| `MCP_LOG_LEVEL`        | No       | `"info"` | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`                    |
| `MCP_LOG_NOTIFY_LEVEL` | No       | `"warn"` | Minimum level forwarded to connected MCP clients                                 |
| `MCP_LOG_PRETTY`       | No       | `"auto"` | Pretty-print: `true`, `false`, or `"auto"` (pretty for stdio TTY, JSON for HTTP) |
| `MCP_LOG_FILE`         | No       | —        | Override default log file path (stdio non-TTY only)                              |

### Semantic search (optional)

| Variable          | Required | Default | Description                 |
| ----------------- | -------- | ------- | --------------------------- |
| `OPENAI_API_KEY`  | No       | —       | Embedding provider API key  |
| `OPENAI_BASE_URL` | No       | —       | Embedding provider base URL |
| `EMBEDDING_MODEL` | No       | —       | Embedding model identifier  |

Set all three together to enable semantic search. If any are missing, the
`discover_recipes` tool isn't registered and the server logs
`Semantic search: disabled` on startup. [embedding-providers.md](embedding-providers.md)
covers provider choices (Ollama, OpenAI, OpenRouter) with worked examples.

### Recipe photo generation (optional)

| Variable                           | Required | Default                        | Description                                                   |
| ---------------------------------- | -------- | ------------------------------ | ------------------------------------------------------------- |
| `IMAGE_GEN_API_KEY`                | No       | —                              | OpenRouter API key dedicated to image generation              |
| `IMAGE_GEN_BASE_URL`               | No       | `https://openrouter.ai/api/v1` | OpenRouter base URL (only used with a dedicated key)          |
| `IMAGE_GEN_REUSE_EMBEDDINGS_CREDS` | No       | `false`                        | Reuse the embedding (`OPENAI_*`) credentials instead of a key |

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

### Duration format

`PAPRIKA_SYNC_INTERVAL`, `PAPRIKA_SYNC_PENDING_WRITE_TTL`, and `MCP_HTTP_SHUTDOWN_DRAIN`
take a duration in Go's format: one or more number-and-unit pairs, with no spaces.

- Units: `ns`, `us` (or `µs`/`μs`), `ms`, `s`, `m`, `h`, and `d`
- Examples: `15m`, `1h30m`, `500ms`, `1.5h`, `.5h`, `7d`
- `0` means zero (off, for the pending-write TTL and the shutdown drain)
- At most `24d`, because Node's timers can't wait longer
- The sync interval must be at least `1s`

Any other bare number (`900`, `900000`) is rejected at boot, because it doesn't say
whether it means seconds, minutes, or milliseconds. So are ISO 8601 (`PT15M`) and
phrases like `15 minutes`.

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

If Paprika rate-limits a cold start partway through, the recipes that arrived are kept,
and sync retries the rest after a short delay rather than waiting `PAPRIKA_SYNC_INTERVAL`.

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
read by the SDK itself — nothing telemetry-related lives in the `MCP_*` or
`PAPRIKA_*` namespaces. These variables may sit in the same `.env` file as the rest of the
configuration. `OTEL_LOG_LEVEL` diagnostics go to stderr (never stdout — the stdio MCP
wire). The full operator guide, including a local Grafana/collector stand-up, is
[docs/telemetry.md](telemetry.md).

## `.env` file

Place a `.env` file in the config directory (see [Config directory location](#config-directory-location)) to keep settings out of your shell or your MCP client's config. One `NAME=value` per line. A stdio (local CLI) setup:

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
