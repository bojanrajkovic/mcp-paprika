# Configuration

mcp-paprika loads configuration from three sources, merged in this priority order:

1. **Environment variables** (highest priority)
2. **`.env` file** in the config directory
3. **`config.json`** in the config directory
4. **Schema defaults** (lowest priority)

Environment variables always win. If you set `PAPRIKA_EMAIL` as an env var and also have it in `config.json`, the env var is used.

## Environment variables

| Variable                | Config path                   | Required | Default | Description                      |
| ----------------------- | ----------------------------- | -------- | ------- | -------------------------------- |
| `PAPRIKA_EMAIL`         | `paprika.email`               | Yes      | —       | Paprika account email            |
| `PAPRIKA_PASSWORD`      | `paprika.password`            | Yes      | —       | Paprika account password         |
| `PAPRIKA_SYNC_INTERVAL` | `sync.interval`               | No       | `"15m"` | Background sync polling interval |
| `PAPRIKA_SYNC_ENABLED`  | `sync.enabled`                | No       | `true`  | Enable background sync           |
| `OPENAI_API_KEY`        | `features.embeddings.apiKey`  | No       | —       | Embedding provider API key       |
| `OPENAI_BASE_URL`       | `features.embeddings.baseUrl` | No       | —       | Embedding provider base URL      |
| `EMBEDDING_MODEL`       | `features.embeddings.model`   | No       | —       | Embedding model identifier       |

### Embedding config gating

All three embedding variables (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `EMBEDDING_MODEL`) must be set together to enable semantic search. If any are missing, the `discover_recipes` tool won't be registered and the server logs `Semantic search: disabled` on startup.

### Sync interval format

`PAPRIKA_SYNC_INTERVAL` accepts human-readable durations:

- `"15m"`, `"30 minutes"`, `"1 hour"`
- `"1h30m"`, `"1 hr 30 min"`
- ISO 8601: `"PT15M"`
- Bare numbers are treated as milliseconds: `900000`

### Sync enabled format

`PAPRIKA_SYNC_ENABLED` accepts `"true"`, `"false"`, `"1"`, or `"0"`.

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

You can also place a `.env` file in the config directory:

```bash
PAPRIKA_EMAIL=you@example.com
PAPRIKA_PASSWORD=your-password
PAPRIKA_SYNC_INTERVAL=15m

# Optional: enable semantic search
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama
EMBEDDING_MODEL=nomic-embed-text
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
