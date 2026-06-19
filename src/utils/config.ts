import { readFileSync } from "node:fs";
import { join } from "node:path";

import dotenv from "dotenv";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import { parseDuration } from "./duration.js";
import { isNodeError } from "./errors.js";
import { toMessage } from "./log.js";
import { getConfigDir } from "./xdg.js";

const ENV_VAR_HINTS: Readonly<Record<string, string>> = {
  "paprika.email": "PAPRIKA_EMAIL",
  "paprika.password": "PAPRIKA_PASSWORD",
  "sync.interval": "PAPRIKA_SYNC_INTERVAL",
  "sync.enabled": "PAPRIKA_SYNC_ENABLED",
  "sync.pendingWriteTtl": "PAPRIKA_SYNC_PENDING_WRITE_TTL",
  "sync.recipeFetchConcurrency": "PAPRIKA_SYNC_RECIPE_CONCURRENCY",
  transport: "MCP_TRANSPORT",
  "http.port": "MCP_HTTP_PORT",
  "http.host": "MCP_HTTP_HOST",
  "http.allowedHosts": "MCP_ALLOWED_HOSTS",
  "http.allowedOrigins": "MCP_ALLOWED_ORIGINS",
  "http.shutdownDrainMs": "MCP_HTTP_SHUTDOWN_DRAIN_MS",
  "http.widgetPreview": "MCP_WIDGET_PREVIEW",
  "logging.level": "MCP_LOG_LEVEL",
  "logging.notifyLevel": "MCP_LOG_NOTIFY_LEVEL",
  "logging.pretty": "MCP_LOG_PRETTY",
  "logging.file": "MCP_LOG_FILE",
  "features.replicateApiToken": "REPLICATE_API_TOKEN",
  "features.embeddings.apiKey": "OPENAI_API_KEY",
  "features.embeddings.baseUrl": "OPENAI_BASE_URL",
  "features.embeddings.model": "EMBEDDING_MODEL",
  "features.imageGen.apiKey": "IMAGE_GEN_API_KEY",
  "features.imageGen.baseUrl": "IMAGE_GEN_BASE_URL",
  "features.imageGen.reuseEmbeddingsCreds": "IMAGE_GEN_REUSE_EMBEDDINGS_CREDS",
  "oauth.publicUrl": "MCP_PUBLIC_URL",
  "oauth.preset": "MCP_OIDC_PRESET",
  "oauth.discoveryUrl": "MCP_OIDC_DISCOVERY_URL",
  "oauth.scopes": "MCP_OIDC_SCOPES",
  "oauth.emailVerifiedPolicy": "MCP_OIDC_EMAIL_VERIFIED_POLICY",
  "oauth.allowedAlgs": "MCP_OIDC_ALLOWED_ALGS",
  "oauth.clientId": "MCP_OIDC_CLIENT_ID",
  "oauth.clientSecret": "MCP_OIDC_CLIENT_SECRET",
  "oauth.trustProxy": "MCP_TRUST_PROXY",
  "oauth.allowlist.emails": "MCP_ALLOWED_EMAILS",
  "oauth.allowlist.subs": "MCP_ALLOWED_SUBS",
  "oauth.redirectAllowlist": "MCP_OAUTH_REDIRECT_ALLOWLIST",
};

export class ConfigError extends Error {
  readonly reason: string;
  readonly kind: "invalid_json" | "file_read_error" | "validation";

  private constructor(reason: string, kind: ConfigError["kind"]) {
    super(reason);
    this.name = "ConfigError";
    this.reason = reason;
    this.kind = kind;
  }

  static invalidJson(path: string, cause: unknown): ConfigError {
    const detail = toMessage(cause);
    return new ConfigError(`Invalid JSON in ${path}: ${detail}`, "invalid_json");
  }

  static fileReadError(path: string, cause: unknown): ConfigError {
    const detail = toMessage(cause);
    return new ConfigError(`Cannot read ${path}: ${detail}`, "file_read_error");
  }

  static validation(issues: ReadonlyArray<z.ZodIssue>): ConfigError {
    const lines = issues.map((issue) => {
      const path = issue.path.join(".");
      const hint = ENV_VAR_HINTS[path];
      const suffix = hint ? ` (set via ${hint})` : "";
      return `  - ${path}: ${issue.message}${suffix}`;
    });
    const reason = `Configuration validation failed:\n${lines.join("\n")}`;
    return new ConfigError(reason, "validation");
  }
}

const durationField = z.union([z.string(), z.number()]).transform((val, ctx) => {
  return parseDuration(val).match(
    (duration) => duration.as("milliseconds"),
    (parseErr) => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: parseErr.reason,
      });
      return z.NEVER;
    },
  );
});

const BOOLEAN_STRINGS: Readonly<Record<string, boolean>> = {
  true: true,
  false: false,
  "1": true,
  "0": false,
};

const booleanField = z.union([z.boolean(), z.string()]).transform((val, ctx) => {
  if (typeof val === "boolean") {
    return val;
  }
  const mapped = BOOLEAN_STRINGS[val];
  if (mapped === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `expected "true", "false", "1", or "0", got ${JSON.stringify(val)}`,
    });
    return z.NEVER;
  }
  return mapped;
});

const listField = z.union([z.array(z.string()), z.string()]).transform((val) => {
  if (Array.isArray(val)) return val.map((s) => s.trim()).filter((s) => s.length > 0);
  return val
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
});

const embeddingConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().min(1),
  model: z.string().min(1),
});

// Image generation (OpenRouter chat-completions) feature config. Unlike
// embeddings, the model is NOT configured here — it is selected per
// `generate_recipe_photo` tool call. Credentials come from one of two mutually
// exclusive paths, enforced by `.superRefine` below:
//   - a dedicated key (`apiKey`, optional `baseUrl`) → isolated OpenRouter
//     cost tracking for image generation, OR
//   - `reuseEmbeddingsCreds: true` → borrow `features.embeddings.{apiKey,baseUrl}`
//     (both already point at OpenRouter in the common single-account setup).
const imageGenConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().min(1).optional(),
  reuseEmbeddingsCreds: booleanField.default(false),
});

// Default base URL for the dedicated-key path. OpenRouter is the only provider
// that serves the image-generation models behind the `generate_recipe_photo` tool via
// chat-completions image output.
const DEFAULT_IMAGE_GEN_BASE_URL = "https://openrouter.ai/api/v1";

const pinoLevelSchema = z.enum(["trace", "debug", "info", "warn", "error", "fatal"]);

const loggingSchema = z
  .object({
    level: pinoLevelSchema.default("info"),
    notifyLevel: pinoLevelSchema.default("warn"),
    pretty: z.union([z.boolean(), z.literal("auto")]).default("auto"),
    file: z.string().optional(),
  })
  .default({});

export const paprikaConfigSchema = z
  .object({
    paprika: z.preprocess(
      (val) => val ?? {},
      z.object({
        email: z.string().min(1),
        password: z.string().min(1),
      }),
    ),
    sync: z
      .object({
        enabled: booleanField.default(true),
        interval: durationField.default("15m"),
        // Window during which a local write is shielded from sync reconciliation
        // (sync would otherwise see a stale canonical list and either delete the
        // just-written item or resurrect the just-deleted one). Cleared on
        // observation for upserts; TTL-only for deletes. See issue #57.
        pendingWriteTtl: durationField.default("60s"),
        // Concurrency for the N+1 recipe fetch during sync (`getRecipe` per changed
        // recipe). Default 5. Raise it to speed up a large-library cold start;
        // reliability is the primary constraint, so PaprikaClient warns above its
        // recommended max (high concurrency against one origin risks 429s). See #174.
        recipeFetchConcurrency: z.coerce.number().int().positive().default(5),
      })
      .default({}),
    // Transport selection. `stdio` (default) keeps the current behavior for all
    // existing CLI clients (Claude Code, Claude Desktop, Cursor, mcp-cli). `http`
    // exposes Streamable HTTP for Claude Mobile and other HTTP-based MCP
    // clients. See docs/http-transport.md for the security implications.
    transport: z.enum(["stdio", "http"]).default("stdio"),
    http: z
      .object({
        port: z.coerce.number().int().min(1).max(65535).default(3000),
        host: z.string().min(1).default("0.0.0.0"),
        // DNS rebinding protection: when either list is non-empty the SDK
        // transport enforces exact-match validation of the request Host /
        // Origin header on /mcp. Both default to empty (no restriction) to
        // preserve the reverse-proxy-friendly default the HTTP transport
        // assumes — operators putting the server on the public internet
        // without a proxy should set these. See docs/http-transport.md.
        allowedHosts: listField.default([]),
        allowedOrigins: listField.default([]),
        // Pre-drain delay on SIGTERM: after shutdown begins, /healthz reports
        // not-ready and the server keeps serving for this long before closing
        // connections. Gives Kubernetes time to remove the pod from Service
        // endpoints and for kube-proxy/ingress routing to propagate, so a
        // request routed just before deletion isn't dropped. Keep it well under
        // terminationGracePeriodSeconds (the shutdown also reserves up to
        // SHUTDOWN_TIMEOUT_MS to drain). Set 0 to disable (tests, stdio).
        shutdownDrainMs: durationField.default("5s"),
        // Dev-only widget preview. When true, GET /widget-preview renders a built
        // widget in a plain browser with a fake host shim driven by ?payload=, so
        // widget UI can be iterated without a real MCP host (ADR-0019). Default
        // OFF: the route is absent in production and unauthenticated, and ?payload=
        // is untrusted (read client-side by the shim, never reflected by the
        // server). HTTP transport only. See docs/configuration.md.
        widgetPreview: booleanField.default(false),
      })
      .default({}),
    features: z
      .object({
        replicateApiToken: z.string().min(1).optional(),
        embeddings: embeddingConfigSchema.optional(),
        imageGen: imageGenConfigSchema.optional(),
      })
      .optional(),
    oauth: z
      .object({
        // Strip trailing slashes once at parse time so downstream concatenations
        // (`${publicUrl}/oauth/callback`, `${publicUrl}/register/<id>`, …) never
        // produce `//`. Upstream IdPs require exact redirect-URI matching, so a
        // `MCP_PUBLIC_URL=https://host/` would otherwise break authorization
        // and the RFC 7592 registration_client_uri it advertises.
        publicUrl: z
          .string()
          .min(1)
          .transform((v) => v.replace(/\/+$/, ""))
          .optional(),
        preset: z.enum(["google", "entra", "okta", "auth0", "keycloak"]).optional(),
        discoveryUrl: z.string().url().optional(),
        scopes: listField.optional(),
        emailVerifiedPolicy: z.enum(["strict", "skip", "if-present"]).optional(),
        allowedAlgs: listField.optional(),
        clientId: z.string().min(1).optional(),
        clientSecret: z.string().min(1).optional(),
        // Trust X-Forwarded-For / CF-Connecting-IP for the DCR rate-limit key.
        // Default false (safe for direct exposure). Set true behind a sanitizing
        // reverse proxy (k8s ingress, Tailscale Funnel, Cloudflare). See
        // src/auth/routes.ts:buildDcrRateLimit for why this matters.
        trustProxy: booleanField.default(false),
        allowlist: z
          .object({
            emails: listField.default([]),
            subs: listField.default([]),
          })
          .default({}),
        // Redirect-origin allowlist for the confused-deputy consent gate (#147).
        // Raw operator-supplied strings (origins or full redirect URLs); they are
        // normalized to canonical origins and fail-fast-validated in
        // `buildAuthContext` — config.ts must not import from src/auth/. Empty
        // (the default) means every /authorize is routed through the consent
        // screen (fail-closed). See src/auth/redirect-allowlist.ts.
        redirectAllowlist: listField.default([]),
      })
      .optional(),
    logging: loggingSchema,
  })
  .superRefine((cfg, ctx) => {
    if (cfg.transport !== "http") return;
    const oauth = cfg.oauth;

    // Check publicUrl (required when transport=http)
    if (!oauth?.publicUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["oauth", "publicUrl"],
        message: "MCP_PUBLIC_URL is required when MCP_TRANSPORT=http",
      });
    } else {
      // Validate HTTPS only if publicUrl is present
      try {
        const url = new URL(oauth.publicUrl);
        if (url.protocol !== "https:") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["oauth", "publicUrl"],
            message: "must be a valid https:// URL",
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["oauth", "publicUrl"],
          message: "must be a valid https:// URL",
        });
      }
    }

    // Treat undefined oauth as having empty allowlists, preset, and client credentials
    const emails = oauth?.allowlist?.emails ?? [];
    const subs = oauth?.allowlist?.subs ?? [];
    if (emails.length === 0 && subs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["oauth", "allowlist"],
        message: "at least one of MCP_ALLOWED_EMAILS or MCP_ALLOWED_SUBS must be non-empty when MCP_TRANSPORT=http",
      });
    }

    if (!oauth?.preset && !oauth?.discoveryUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["oauth", "preset"],
        message: "one of MCP_OIDC_PRESET or MCP_OIDC_DISCOVERY_URL must be set",
      });
    }

    if (!oauth?.clientId || !oauth?.clientSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["oauth", oauth?.clientId ? "clientSecret" : "clientId"],
        message: "MCP_OIDC_CLIENT_ID and MCP_OIDC_CLIENT_SECRET are required when MCP_TRANSPORT=http",
      });
    }
  })
  // Image-generation credential resolution is independent of transport. When the
  // block is present it must resolve to a usable credential via exactly one path.
  .superRefine((cfg, ctx) => {
    const imageGen = cfg.features?.imageGen;
    if (!imageGen) return;

    const hasKey = imageGen.apiKey !== undefined;
    const reuse = imageGen.reuseEmbeddingsCreds;

    if (hasKey && reuse) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["features", "imageGen", "apiKey"],
        message: "set either IMAGE_GEN_API_KEY or IMAGE_GEN_REUSE_EMBEDDINGS_CREDS, not both",
      });
    }
    if (!hasKey && !reuse) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["features", "imageGen", "apiKey"],
        message: "image generation requires either an API key or reuseEmbeddingsCreds=true",
      });
    }
    if (reuse && !cfg.features?.embeddings) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["features", "imageGen", "reuseEmbeddingsCreds"],
        message: "reuseEmbeddingsCreds=true requires features.embeddings to be configured",
      });
    }
    if (reuse && imageGen.baseUrl !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["features", "imageGen", "baseUrl"],
        message:
          "IMAGE_GEN_BASE_URL is ignored when reuseEmbeddingsCreds=true (the embeddings base URL is used); unset one of them",
      });
    }
  });

export type PaprikaConfig = z.infer<typeof paprikaConfigSchema>;
export type EmbeddingConfig = z.infer<typeof embeddingConfigSchema>;
export type ImageGenConfig = z.infer<typeof imageGenConfigSchema>;

/**
 * Effective image-generation credentials after resolving the dedicated-key vs
 * reuse-embeddings paths. `model` is intentionally absent — it is a
 * `generate_recipe_photo` tool-call parameter, not server config.
 */
export interface ResolvedImageGenConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
}

/**
 * Resolve `features.imageGen` to concrete credentials, or `null` when image
 * generation is not enabled. The schema's `.superRefine` guarantees a present
 * block is internally consistent; this function additionally tolerates the
 * reuse-without-embeddings case by returning `null` (defense in depth).
 */
export function resolveImageGenConfig(config: PaprikaConfig): ResolvedImageGenConfig | null {
  const imageGen = config.features?.imageGen;
  if (!imageGen) return null;

  if (imageGen.reuseEmbeddingsCreds) {
    const embeddings = config.features?.embeddings;
    return embeddings ? { apiKey: embeddings.apiKey, baseUrl: embeddings.baseUrl } : null;
  }
  if (imageGen.apiKey !== undefined) {
    return { apiKey: imageGen.apiKey, baseUrl: imageGen.baseUrl ?? DEFAULT_IMAGE_GEN_BASE_URL };
  }
  return null;
}

/**
 * The pending-write TTL each entity store is constructed with. When background sync
 * is disabled there is no cycle to sweep pending marks, so the feature is turned off
 * entirely (TTL 0 makes `markPending*` a no-op — see `src/cache/CLAUDE.md` and codex
 * P2 on PR #92); otherwise the configured TTL applies. Centralized here so the policy
 * has one definition rather than one per store-owning module.
 */
export function resolvePendingWriteTtl(config: PaprikaConfig): number {
  return config.sync.enabled ? config.sync.pendingWriteTtl : 0;
}

// Reads config.json from configDir. ENOENT returns ok({}). Invalid JSON and permission errors return err.
function readConfigFile(configDir: string): Result<Record<string, unknown>, ConfigError> {
  const filePath = join(configDir, "config.json");
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return ok({});
    }
    return err(ConfigError.fileReadError(filePath, error));
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return err(ConfigError.invalidJson(filePath, new Error("expected a JSON object")));
    }
    return ok(parsed as Record<string, unknown>);
  } catch (error: unknown) {
    return err(ConfigError.invalidJson(filePath, error));
  }
}

// Loads .env file from configDir into process.env. Missing .env is silently ignored.
// quiet: true suppresses dotenv's "◇ injected env" startup banner — MCP stdio
// transport reserves stdout for JSON-RPC framing, so any stray write corrupts
// the wire protocol (issue #49).
function loadDotEnv(configDir: string): void {
  dotenv.config({ path: join(configDir, ".env"), quiet: true });
}

// Maps known env vars to the nested config object structure.
/** @internal Pure helper for env-var routing. Exported for testing only. */
export function buildEnvOverrides(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const paprika: Record<string, unknown> = {};
  const sync: Record<string, unknown> = {};
  const http: Record<string, unknown> = {};
  const logging: Record<string, unknown> = {};
  const features: Record<string, unknown> = {};
  const embeddings: Record<string, unknown> = {};
  const imageGen: Record<string, unknown> = {};
  const oauth: Record<string, unknown> = {};
  const allowlist: Record<string, unknown> = {};

  if (env["PAPRIKA_EMAIL"] !== undefined) paprika["email"] = env["PAPRIKA_EMAIL"];
  if (env["PAPRIKA_PASSWORD"] !== undefined) paprika["password"] = env["PAPRIKA_PASSWORD"];

  if (env["PAPRIKA_SYNC_INTERVAL"] !== undefined) sync["interval"] = env["PAPRIKA_SYNC_INTERVAL"];
  if (env["PAPRIKA_SYNC_ENABLED"] !== undefined) sync["enabled"] = env["PAPRIKA_SYNC_ENABLED"];
  if (env["PAPRIKA_SYNC_PENDING_WRITE_TTL"] !== undefined)
    sync["pendingWriteTtl"] = env["PAPRIKA_SYNC_PENDING_WRITE_TTL"];
  if (env["PAPRIKA_SYNC_RECIPE_CONCURRENCY"] !== undefined)
    sync["recipeFetchConcurrency"] = env["PAPRIKA_SYNC_RECIPE_CONCURRENCY"];

  if (env["MCP_TRANSPORT"] !== undefined) overrides["transport"] = env["MCP_TRANSPORT"];
  if (env["MCP_HTTP_PORT"] !== undefined) http["port"] = env["MCP_HTTP_PORT"];
  if (env["MCP_HTTP_HOST"] !== undefined) http["host"] = env["MCP_HTTP_HOST"];
  if (env["MCP_ALLOWED_HOSTS"] !== undefined) http["allowedHosts"] = env["MCP_ALLOWED_HOSTS"];
  if (env["MCP_ALLOWED_ORIGINS"] !== undefined) http["allowedOrigins"] = env["MCP_ALLOWED_ORIGINS"];
  if (env["MCP_HTTP_SHUTDOWN_DRAIN_MS"] !== undefined) http["shutdownDrainMs"] = env["MCP_HTTP_SHUTDOWN_DRAIN_MS"];
  if (env["MCP_WIDGET_PREVIEW"] !== undefined) http["widgetPreview"] = env["MCP_WIDGET_PREVIEW"];

  if (env["MCP_LOG_LEVEL"] !== undefined && env["MCP_LOG_LEVEL"] !== "") {
    logging["level"] = env["MCP_LOG_LEVEL"];
  }
  if (env["MCP_LOG_NOTIFY_LEVEL"] !== undefined && env["MCP_LOG_NOTIFY_LEVEL"] !== "") {
    logging["notifyLevel"] = env["MCP_LOG_NOTIFY_LEVEL"];
  }
  if (env["MCP_LOG_FILE"] !== undefined && env["MCP_LOG_FILE"] !== "") {
    logging["file"] = env["MCP_LOG_FILE"];
  }
  if (env["MCP_LOG_PRETTY"] !== undefined && env["MCP_LOG_PRETTY"] !== "") {
    const raw = env["MCP_LOG_PRETTY"];
    // "auto" is the only string the schema accepts verbatim; otherwise reuse
    // BOOLEAN_STRINGS to coerce "true"/"1"/"false"/"0". Unknown values fall
    // through as the raw string so the Zod schema rejects typos like "treu"
    // with a clear validation error instead of silently defaulting to false.
    logging["pretty"] = raw === "auto" ? "auto" : (BOOLEAN_STRINGS[raw] ?? raw);
  }

  if (env["REPLICATE_API_TOKEN"] !== undefined) features["replicateApiToken"] = env["REPLICATE_API_TOKEN"];
  if (env["OPENAI_API_KEY"] !== undefined) embeddings["apiKey"] = env["OPENAI_API_KEY"];
  if (env["OPENAI_BASE_URL"] !== undefined) embeddings["baseUrl"] = env["OPENAI_BASE_URL"];
  if (env["EMBEDDING_MODEL"] !== undefined) embeddings["model"] = env["EMBEDDING_MODEL"];

  if (env["IMAGE_GEN_API_KEY"] !== undefined) imageGen["apiKey"] = env["IMAGE_GEN_API_KEY"];
  if (env["IMAGE_GEN_BASE_URL"] !== undefined) imageGen["baseUrl"] = env["IMAGE_GEN_BASE_URL"];
  if (env["IMAGE_GEN_REUSE_EMBEDDINGS_CREDS"] !== undefined)
    imageGen["reuseEmbeddingsCreds"] = env["IMAGE_GEN_REUSE_EMBEDDINGS_CREDS"];

  if (env["MCP_PUBLIC_URL"] !== undefined) oauth["publicUrl"] = env["MCP_PUBLIC_URL"];
  if (env["MCP_OIDC_PRESET"] !== undefined) oauth["preset"] = env["MCP_OIDC_PRESET"];
  if (env["MCP_OIDC_DISCOVERY_URL"] !== undefined) oauth["discoveryUrl"] = env["MCP_OIDC_DISCOVERY_URL"];
  if (env["MCP_OIDC_SCOPES"] !== undefined) oauth["scopes"] = env["MCP_OIDC_SCOPES"];
  if (env["MCP_OIDC_EMAIL_VERIFIED_POLICY"] !== undefined)
    oauth["emailVerifiedPolicy"] = env["MCP_OIDC_EMAIL_VERIFIED_POLICY"];
  if (env["MCP_OIDC_ALLOWED_ALGS"] !== undefined) oauth["allowedAlgs"] = env["MCP_OIDC_ALLOWED_ALGS"];
  if (env["MCP_OIDC_CLIENT_ID"] !== undefined) oauth["clientId"] = env["MCP_OIDC_CLIENT_ID"];
  if (env["MCP_OIDC_CLIENT_SECRET"] !== undefined) oauth["clientSecret"] = env["MCP_OIDC_CLIENT_SECRET"];
  if (env["MCP_TRUST_PROXY"] !== undefined) oauth["trustProxy"] = env["MCP_TRUST_PROXY"];
  if (env["MCP_OAUTH_REDIRECT_ALLOWLIST"] !== undefined)
    oauth["redirectAllowlist"] = env["MCP_OAUTH_REDIRECT_ALLOWLIST"];

  if (env["MCP_ALLOWED_EMAILS"] !== undefined) allowlist["emails"] = env["MCP_ALLOWED_EMAILS"];
  if (env["MCP_ALLOWED_SUBS"] !== undefined) allowlist["subs"] = env["MCP_ALLOWED_SUBS"];

  if (Object.keys(embeddings).length > 0) features["embeddings"] = embeddings;
  if (Object.keys(imageGen).length > 0) features["imageGen"] = imageGen;
  if (Object.keys(allowlist).length > 0) oauth["allowlist"] = allowlist;
  if (Object.keys(features).length > 0) overrides["features"] = features;
  if (Object.keys(logging).length > 0) overrides["logging"] = logging;
  if (Object.keys(oauth).length > 0) overrides["oauth"] = oauth;
  if (Object.keys(paprika).length > 0) overrides["paprika"] = paprika;
  if (Object.keys(sync).length > 0) overrides["sync"] = sync;
  if (Object.keys(http).length > 0) overrides["http"] = http;

  return overrides;
}

// Recursively merges base config with overrides. Override values win for non-object fields.
// Keys are treated strictly as data: the base value is read only from base's OWN properties
// (a bracket read of an absent `__proto__` would otherwise yield `Object.prototype` and
// wrongly recurse into it), and each merged value is written with `Object.defineProperty`
// rather than `result[key] = …` (assignment honors the `__proto__` accessor, mutating or
// nulling the prototype chain instead of recording the key). See #345.
/** @internal Pure helper for config merging. Exported for property-based testing only. */
export function deepMerge(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overrides)) {
    const baseVal = Object.hasOwn(base, key) ? base[key] : undefined;
    const overVal = overrides[key];
    const merged =
      typeof baseVal === "object" &&
      baseVal !== null &&
      !Array.isArray(baseVal) &&
      typeof overVal === "object" &&
      overVal !== null &&
      !Array.isArray(overVal)
        ? deepMerge(baseVal as Record<string, unknown>, overVal as Record<string, unknown>)
        : overVal;
    Object.defineProperty(result, key, { value: merged, writable: true, enumerable: true, configurable: true });
  }
  return result;
}

// Orchestrates the full config loading pipeline. Accepts optional configDir for testability.
export function loadConfig(configDir?: string): Result<PaprikaConfig, ConfigError> {
  const dir = configDir ?? getConfigDir();

  loadDotEnv(dir);

  return readConfigFile(dir).andThen((fileConfig) => {
    const envOverrides = buildEnvOverrides(process.env);
    const merged = deepMerge(fileConfig, envOverrides);

    const parseResult = paprikaConfigSchema.safeParse(merged);
    if (!parseResult.success) {
      return err(ConfigError.validation(parseResult.error.issues));
    }

    return ok(parseResult.data);
  });
}
