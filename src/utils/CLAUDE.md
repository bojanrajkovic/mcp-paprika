# Cross-Cutting Utilities

Last verified: 2026-05-28

## Purpose

Shared utility functions and helpers used across multiple modules. Includes error base classes, logging helpers, and common transformations.

## Contracts

### log.ts — Structured pino logger

Constructs a process-wide pino logger with two output streams and baked-in credential redaction. Stdio transport uses stdout for the MCP wire format, so all log output must stay off stdout — the `no-console` oxlint rule enforces this. Imports from `../server/notifier.js` and `./xdg.js` (non-leaf module).

**Canonical export: `createLogger(opts: LoggerOptions): pino.Logger`**

Called exactly once per process by `buildAppContext`. Returns a pino logger configured with a primary output stream and a notifier fan-out stream. Children are created via `parent.child({ component: "<flat-name>" })` — flat single-word names, no `mcp-paprika:` prefix.

| Option        | Type                  | Default  | Description                                                                                     |
| ------------- | --------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `transport`   | `"stdio" \| "http"`   | —        | Drives primary destination selection                                                            |
| `notifier`    | `Notifier`            | —        | Fan-out target; `loggingMessage(...)` is called fire-and-forget                                 |
| `level`       | `LevelWithSilent`     | `"info"` | Primary stream threshold                                                                        |
| `notifyLevel` | `LevelWithSilent`     | `"warn"` | Fan-out threshold; `warn+` records reach connected MCP clients automatically                    |
| `pretty`      | `boolean \| "auto"`   | `"auto"` | `"auto"` = pretty for stdio (TTY → stderr, non-TTY → file), raw JSON for HTTP                   |
| `file`        | `string \| undefined` | —        | Override the default file path for stdio non-TTY; default is `getLogDir() + "/mcp-paprika.log"` |

`LevelWithSilent` is pino's native type — `"trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent"`. The `"silent"` value is reachable only when constructing `LoggerOptions` directly (the e2e harness uses this to suppress test noise). The Zod schema in `src/utils/config.ts` deliberately excludes `"silent"` from the operator-facing `MCP_LOG_LEVEL` / `MCP_LOG_NOTIFY_LEVEL` enum so production logging cannot be silenced via env vars.

**Primary destination routing:**

| transport | pretty   | stderr.isTTY | destination                              |
| --------- | -------- | ------------ | ---------------------------------------- |
| `"http"`  | any      | any          | stdout (raw JSON)                        |
| `"stdio"` | `false`  | any          | stderr (TTY) or file (non-TTY), raw JSON |
| `"stdio"` | `true`   | any          | pino-pretty to stderr (TTY) or file      |
| `"stdio"` | `"auto"` | `true`       | pino-pretty to stderr                    |
| `"stdio"` | `"auto"` | `false`      | pino-pretty to file                      |

**Redacted paths** (applied to both streams, censor value `"[Redacted]"`):
Top-level, 1-deep (`*.field`), and 2-deep (`*.*.field`) wildcards for each of the 7 credential field names: `authorization`, `password`, `token`, `client_secret`, `access_token`, `refresh_token`, `id_token`. This covers 21 paths total — bare top-level, one object wrapper, and two object wrappers (e.g., `req.headers.authorization`). The path list is exported as `REDACT_PATHS` for test parity — tests that construct their own pino logger should import this constant rather than maintaining a parallel inline list.

**File destination safety:** `mkdir -p` runs synchronously at construction. If the directory cannot be created or the file cannot be opened for writing, `createLogger` throws synchronously with a clear error message — no silent fallback to stderr.

**Fan-out stream:** A Node `Writable` that parses each serialized pino record, strips pino internals (`level`, `time`, `hostname`, `pid`, `v`), maps the numeric level to the MCP RFC 5424 subset (`debug`/`info`/`warning`/`error`/`critical`), and calls `notifier.loggingMessage(...)` fire-and-forget. The `_write` callback completes synchronously regardless of the notifier's outcome.

**Level mapping (pino → MCP):**

| pino level | MCP level  |
| ---------- | ---------- |
| `trace`    | `debug`    |
| `debug`    | `debug`    |
| `info`     | `info`     |
| `warn`     | `warning`  |
| `error`    | `error`    |
| `fatal`    | `critical` |

**`toMessage(e)`:** `(e: unknown) => string` — extracts a human-readable message from an unknown thrown value: `e.message` if `e instanceof Error`, else `String(e)`. Ten production sites across the codebase depend on this export.

**`SILENT_LOG`:** a process-wide silent pino `Logger` exported as the canonical default for optional `log?: Logger` parameters on classes and functions. Production callers (`DiskCacheRoot` and per-entity subcaches, `VectorStore`, `EmbeddingClient`, `PaprikaClient`) fall back to it when no logger is threaded; tests import it instead of constructing per-test `pino({ level: "silent" })` instances. Pino's silent level short-circuits every log method to a no-op, so the shared instance is safe across modules.

### xdg.ts — Platform-native application directory paths

Wraps `env-paths` v4 with app name `mcp-paprika` (no suffix). Exports 5 synchronous functions
that return absolute path strings. No internal dependencies (leaf module).

**XDG env-var overrides:** `getConfigDir`, `getCacheDir`, `getDataDir`, and `getLogDir` each
read a single `XDG_*` env var at call time and, when set to a non-empty string, return
`join(<override>, "mcp-paprika")`. This is a deliberate workaround for `env-paths`' macOS
branch, which hard-codes `~/Library/{Preferences,Caches,…}` and ignores `XDG_*` entirely —
re-implementing the override here means tests that set `XDG_CACHE_HOME` / `XDG_CONFIG_HOME`
actually redirect on macOS as well as Linux. Because `process.env` is read on every call,
these functions are not pure leaf modules.

| Function         | XDG override      | Returns                                                           |
| ---------------- | ----------------- | ----------------------------------------------------------------- |
| `getConfigDir()` | `XDG_CONFIG_HOME` | Platform-native config directory (or override + `/mcp-paprika`)   |
| `getCacheDir()`  | `XDG_CACHE_HOME`  | Platform-native cache directory (or override + `/mcp-paprika`)    |
| `getDataDir()`   | `XDG_DATA_HOME`   | Platform-native data directory (or override + `/mcp-paprika`)     |
| `getLogDir()`    | `XDG_STATE_HOME`  | Platform-native log directory (or override + `/mcp-paprika`); the |
|                  |                   | XDG Base Dir spec puts logs under state, not a dedicated log var  |
| `getTempDir()`   | (none)            | Platform-native temp directory; XDG override is intentionally     |
|                  |                   | not honored — temp paths come from the OS regardless              |

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

### dates.ts — Meal-planner date helpers

Pure helpers for parsing user-supplied date input and rendering Paprika's meal wire date
format. All operations happen in UTC (`zone: "utc"` on every Luxon constructor). No I/O.
No internal dependencies (leaf module). Consumed by meal write tools to normalize the `date`
argument before persistence.

| Function                | Returns            | Description                                                                                                                                       |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseInputDate(input)` | `DateTime \| null` | Tries `yyyy-MM-dd HH:mm:ss`, `yyyy-MM-dd'T'HH:mm:ss`, and `yyyy-MM-dd` in order, then ISO 8601 as fallback; returns `null` when no format matches |
| `toWireDateFormat(dt)`  | `string`           | Renders a `DateTime` as Paprika's wire date format (`yyyy-MM-dd HH:mm:ss`) in UTC                                                                 |

### errors.ts — Cross-cutting error classes and helpers

Houses error classes, types, and small helpers that span more than one domain module.

`CircuitService` is a string union — `"paprika" | "embeddings"` — naming each client that mounts cockatiel resilience. Adding a new client requires extending this union; the compile error forces a deliberate decision rather than letting typos through.

| Class              | Extends | Carries                                            | When thrown                                                                                   |
| ------------------ | ------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `CircuitOpenError` | `Error` | `service`, `endpoint`, `cause: BrokenCircuitError` | Any cockatiel-backed client's breaker rejects a call (no HTTP request issued; no fake status) |

Constructor: `new CircuitOpenError(service: CircuitService, endpoint: string, options?: ErrorOptions)`. The `service` argument aligns with the surrounding log component vocabulary — `"paprika"` is thrown from `PaprikaClient`, `"embeddings"` from `EmbeddingClient`. Message format: `"<service> circuit breaker is open (endpoint=<url>)"`.

**`isNodeError(error: unknown): error is NodeJS.ErrnoException`** — type guard for any `Error` whose `code` property is set by the runtime (typical for `fs`/`net`/`child_process`). Use as `if (isNodeError(err) && err.code === "ENOENT") { ... }`. Imported by `cache/disk/base.ts`, `cache/disk/recipes.ts`, `cache/disk/root.ts`, `vector-store.ts`, and `config.ts`.

### config.ts — Application configuration loading

Loads configuration from three sources with priority: env vars > `.env` file > `config.json` > zod
defaults. Returns `Result<PaprikaConfig, ConfigError>` using neverthrow. Config files are read from
`getConfigDir()` (or an explicit path for testing). Synchronous — config loading is a one-time
startup cost.

| Export                | Returns / Description                                          |
| --------------------- | -------------------------------------------------------------- |
| `loadConfig()`        | `Result<PaprikaConfig, ConfigError>`                           |
| `paprikaConfigSchema` | Zod schema used for validation; defines canonical config shape |

| Type              | Description                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `PaprikaConfig`   | `{ paprika, sync, transport, http, logging, features?, oauth? }` — validated application config |
| `EmbeddingConfig` | `{ apiKey, baseUrl, model }` — embedding provider config                                        |

**`sync` block** (`paprikaConfigSchema.sync`):

```
sync: {
  enabled:         boolean   // Run the background polling loop (default true)
  interval:        number    // Poll interval in milliseconds (durationField, default "15m")
  pendingWriteTtl: number    // Window in milliseconds during which a local write is shielded
                             // from sync reconciliation (durationField, default "60s"). See
                             // src/cache/CLAUDE.md "Pending-writes (issue #57)".
}
```

All three are `durationField`s except `enabled`. `pendingWriteTtl` is consumed by `buildAppContext` and passed to both `new RecipeStore({ pendingWriteTtlMs })` and `new PantryStore({ pendingWriteTtlMs })`.

**`http` block** (`paprikaConfigSchema.http`):

```
http: {
  port:            number     // 1–65535, default 3000 (z.coerce.number)
  host:            string     // bind host, default "0.0.0.0"
  allowedHosts:    string[]   // DNS rebinding Host allowlist (listField, default [])
  allowedOrigins:  string[]   // DNS rebinding Origin allowlist (listField, default [])
}
```

`allowedHosts` and `allowedOrigins` are threaded through to the `@hono/mcp` `StreamableHTTPTransport` constructor (`allowedHosts`, `allowedOrigins`, and `enableDnsRebindingProtection` — auto-enabled when either list is non-empty). The check fires inside the transport's `handleRequest`, so it only applies to `POST /mcp`; other routes (`/healthz`, OAuth endpoints, `/oauth/callback`) are not gated. The `@hono/mcp` validation is stricter than the upstream SDK's: when `allowedOrigins` is non-empty, missing-Origin requests are also rejected (the SDK only enforces when Origin is present). See `docs/configuration.md` for operator guidance.

**HTTP env-var mapping table:**

| Env var               | Config path           |
| --------------------- | --------------------- |
| `MCP_HTTP_PORT`       | `http.port`           |
| `MCP_HTTP_HOST`       | `http.host`           |
| `MCP_ALLOWED_HOSTS`   | `http.allowedHosts`   |
| `MCP_ALLOWED_ORIGINS` | `http.allowedOrigins` |

**`logging` block** (`paprikaConfigSchema.logging`):

```
logging: {
  level:        PinoLevel  // Root logger threshold ("trace"–"fatal"); default "info".
                            // "silent" is intentionally excluded — operators cannot disable
                            // the root logger entirely.
  notifyLevel:  PinoLevel  // Fan-out threshold; records at or above this level are forwarded
                            // to connected MCP clients via notifier.loggingMessage(); default "warn"
  pretty:       boolean | "auto"
                            // true = always pino-pretty; false = always raw JSON;
                            // "auto" = pretty for stdio (TTY → stderr, non-TTY → file),
                            // raw JSON for HTTP; default "auto"
  file?:        string      // Override the file path used for stdio non-TTY destination.
                            // Unset resolves to getLogDir() + "/mcp-paprika.log".
}
```

The block always exists on `PaprikaConfig` (`.default({})` on the schema object), so call sites can safely read `config.logging.level` without optional-chaining.

**Logging env-var mapping table:**

| Env var                | Config path           | Notes                                                                   |
| ---------------------- | --------------------- | ----------------------------------------------------------------------- |
| `MCP_LOG_LEVEL`        | `logging.level`       | Pino level name; validated by schema                                    |
| `MCP_LOG_NOTIFY_LEVEL` | `logging.notifyLevel` | Pino level name; validated by schema                                    |
| `MCP_LOG_PRETTY`       | `logging.pretty`      | `"true"`/`"1"` → `true`, `"false"`/`"0"` → `false`, `"auto"` → `"auto"` |
| `MCP_LOG_FILE`         | `logging.file`        | Absolute path; overrides XDG default                                    |

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
  trustProxy:            boolean        // Trust X-Forwarded-For for DCR rate-limit key (default false). Flip to true only behind a sanitizing proxy (k8s ingress, Tailscale Funnel, Cloudflare).
  allowlist: {
    emails:              string[]       // Comma-separated emails (listField, default [])
    subs:                string[]       // Comma-separated subject IDs (listField, default [])
  }
}
```

**`listField` helper** — module-internal Zod field that accepts either an array of strings or a comma-separated string (e.g., from an env var) and normalizes to a trimmed, non-empty `string[]`. Used for `oauth.scopes`, `oauth.allowedAlgs`, `oauth.allowlist.emails`, and `oauth.allowlist.subs`.

**`publicUrl` normalization** — the `oauth.publicUrl` schema strips trailing slashes via `.transform(v => v.replace(/\/+$/, ""))` at parse time. Downstream code can concatenate `${publicUrl}/oauth/callback`, `${publicUrl}/register/<id>`, etc. without producing `//` — required for exact upstream IdP redirect-URI matching.

**Cross-field `.superRefine()` invariant** — enforced at root schema level when `transport === "http"`:

- `oauth.publicUrl` must be present and a valid `https://` URL.
- At least one of `oauth.allowlist.emails` or `oauth.allowlist.subs` must be non-empty.
- Exactly one of `oauth.preset` or `oauth.discoveryUrl` must be set.
- Both `oauth.clientId` and `oauth.clientSecret` must be present.

**Sync env-var mapping table:**

| Env var                          | Config path            |
| -------------------------------- | ---------------------- |
| `PAPRIKA_SYNC_ENABLED`           | `sync.enabled`         |
| `PAPRIKA_SYNC_INTERVAL`          | `sync.interval`        |
| `PAPRIKA_SYNC_PENDING_WRITE_TTL` | `sync.pendingWriteTtl` |

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
| `MCP_TRUST_PROXY`                | `oauth.trustProxy`          |
| `MCP_ALLOWED_EMAILS`             | `oauth.allowlist.emails`    |
| `MCP_ALLOWED_SUBS`               | `oauth.allowlist.subs`      |

| Class         | Extends | Fields                                                                        |
| ------------- | ------- | ----------------------------------------------------------------------------- |
| `ConfigError` | `Error` | `kind: "invalid_json" \| "file_read_error" \| "validation"`, `reason: string` |

## Dependencies

- **Leaf modules (no internal imports):** `xdg.ts` (uses `env-paths`), `duration.ts` (uses `luxon`, `parse-duration`, `neverthrow`), `dates.ts` (uses `luxon`)
- **Non-leaf modules (utils-internal):** `log.ts` imports from `../server/notifier.js` (for `Notifier` type) and `./xdg.js` (for `getLogDir()`); also uses `pino`, `pino-pretty`, `node:stream`, `node:fs`, `node:path`
- **Non-leaf modules:** `config.ts` imports from `xdg.ts` and `duration.ts`; also uses `dotenv`, `zod`, `neverthrow`
- **Used by:** All other `src/` modules may import from `src/utils/`
