# Cross-Cutting Utilities

Last verified: 2026-05-18

## Purpose

Shared utility functions and helpers used across multiple modules. Includes error base classes, logging helpers, and common transformations.

## Contracts

### xdg.ts — Platform-native application directory paths

Wraps `env-paths` v4 with app name `mcp-paprika` (no suffix). Exports 5 synchronous functions
that return absolute path strings. No I/O. No internal dependencies (leaf module).

| Function         | Returns                          |
| ---------------- | -------------------------------- |
| `getConfigDir()` | Platform-native config directory |
| `getCacheDir()`  | Platform-native cache directory  |
| `getDataDir()`   | Platform-native data directory   |
| `getLogDir()`    | Platform-native log directory    |
| `getTempDir()`   | Platform-native temp directory   |

### duration.ts — Recipe duration parsing and formatting

Parses duration strings in multiple formats (human-readable, ISO 8601, H:MM colon, bare
numbers) into Luxon `Duration` objects. Returns `Result<Duration, DurationParseError>` using
neverthrow. Formats durations as compact human-readable strings. No I/O. No internal
dependencies (leaf module).

| Function                   | Returns                                    |
| -------------------------- | ------------------------------------------ |
| `parseDuration(input)`     | `Result<Duration, DurationParseError>`     |
| `formatDuration(duration)` | Compact string (e.g., "1 hr 30 min") or "" |

| Class                | Extends | Fields                                      |
| -------------------- | ------- | ------------------------------------------- |
| `DurationParseError` | `Error` | `input: string \| number`, `reason: string` |

### config.ts — Application configuration loading

Loads configuration from three sources with priority: env vars > `.env` file > `config.json` > zod
defaults. Returns `Result<PaprikaConfig, ConfigError>` using neverthrow. Config files are read from
`getConfigDir()` (or an explicit path for testing). Synchronous — config loading is a one-time
startup cost.

| Export                | Returns / Description                                          |
| --------------------- | -------------------------------------------------------------- |
| `loadConfig()`        | `Result<PaprikaConfig, ConfigError>`                           |
| `paprikaConfigSchema` | Zod schema used for validation; defines canonical config shape |

| Type              | Description                                                                            |
| ----------------- | -------------------------------------------------------------------------------------- |
| `PaprikaConfig`   | `{ paprika, sync, transport, http, features?, oauth? }` — validated application config |
| `EmbeddingConfig` | `{ apiKey, baseUrl, model }` — embedding provider config                               |

**`oauth` block** (`paprikaConfigSchema.oauth` — optional, required when `transport === "http"`):

```
oauth: {
  publicUrl?:            string         // Canonical https:// issuer URL (no trailing slash)
  preset?:               "google" | "entra" | "okta" | "auth0" | "keycloak"
  discoveryUrl?:         string (URL)   // OIDC discovery URL; required for tenant-bound presets
  scopes?:               string[]       // Override preset's scope list
  emailVerifiedPolicy?:  "strict" | "skip" | "if-present"
  allowedAlgs?:          string[]       // Override preset's allowed id_token signing algs
  clientId?:             string         // Client ID from upstream IdP
  clientSecret?:         string         // Client secret from upstream IdP
  allowlist: {
    emails:              string[]       // Comma-separated emails (listField, default [])
    subs:                string[]       // Comma-separated subject IDs (listField, default [])
  }
}
```

**`listField` helper** — module-internal Zod field that accepts either an array of strings or a comma-separated string (e.g., from an env var) and normalizes to a trimmed, non-empty `string[]`. Used for `oauth.scopes`, `oauth.allowedAlgs`, `oauth.allowlist.emails`, and `oauth.allowlist.subs`.

**Cross-field `.superRefine()` invariant** — enforced at root schema level when `transport === "http"`:

- `oauth.publicUrl` must be present and a valid `https://` URL.
- At least one of `oauth.allowlist.emails` or `oauth.allowlist.subs` must be non-empty.
- Exactly one of `oauth.preset` or `oauth.discoveryUrl` must be set.
- Both `oauth.clientId` and `oauth.clientSecret` must be present.

**OAuth env-var mapping table:**

| Env var                          | Config path                 |
| -------------------------------- | --------------------------- |
| `MCP_PUBLIC_URL`                 | `oauth.publicUrl`           |
| `MCP_OIDC_PRESET`                | `oauth.preset`              |
| `MCP_OIDC_DISCOVERY_URL`         | `oauth.discoveryUrl`        |
| `MCP_OIDC_SCOPES`                | `oauth.scopes`              |
| `MCP_OIDC_EMAIL_VERIFIED_POLICY` | `oauth.emailVerifiedPolicy` |
| `MCP_OIDC_ALLOWED_ALGS`          | `oauth.allowedAlgs`         |
| `MCP_OIDC_CLIENT_ID`             | `oauth.clientId`            |
| `MCP_OIDC_CLIENT_SECRET`         | `oauth.clientSecret`        |
| `MCP_ALLOWED_EMAILS`             | `oauth.allowlist.emails`    |
| `MCP_ALLOWED_SUBS`               | `oauth.allowlist.subs`      |

| Class         | Extends | Fields                                                                        |
| ------------- | ------- | ----------------------------------------------------------------------------- |
| `ConfigError` | `Error` | `kind: "invalid_json" \| "file_read_error" \| "validation"`, `reason: string` |

## Dependencies

- **Leaf modules (no internal imports):** `xdg.ts` (uses `env-paths`), `duration.ts` (uses `luxon`, `parse-duration`, `neverthrow`)
- **Non-leaf modules:** `config.ts` imports from `xdg.ts` and `duration.ts`; also uses `dotenv`, `zod`, `neverthrow`
- **Used by:** All other `src/` modules may import from `src/utils/`
