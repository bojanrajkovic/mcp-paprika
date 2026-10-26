import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import dotenv from "dotenv";
import { err, ok, type Result } from "neverthrow";
import parseDurationMs from "parse-duration";
import { z } from "zod";

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
  "http.shutdownDrainMs": "MCP_HTTP_SHUTDOWN_DRAIN",
  "http.widgetPreview": "MCP_WIDGET_PREVIEW",
  "logging.level": "MCP_LOG_LEVEL",
  "logging.notifyLevel": "MCP_LOG_NOTIFY_LEVEL",
  "logging.pretty": "MCP_LOG_PRETTY",
  "logging.file": "MCP_LOG_FILE",
  "features.ai.apiKey": "OPENAI_API_KEY",
  "features.ai.baseUrl": "OPENAI_BASE_URL",
  "features.embeddings.model": "EMBEDDING_MODEL",
  "features.imageGen.enabled": "IMAGE_GEN_ENABLED",
  "oauth.publicUrl": "MCP_PUBLIC_URL",
  "oauth.preset": "MCP_OIDC_PRESET",
  "oauth.discoveryUrl": "MCP_OIDC_DISCOVERY_URL",
  "oauth.scopes": "MCP_OIDC_SCOPES",
  "oauth.emailVerifiedPolicy": "MCP_OIDC_EMAIL_VERIFIED_POLICY",
  "oauth.allowedAlgs": "MCP_OIDC_ALLOWED_ALGS",
  "oauth.clientId": "MCP_OIDC_CLIENT_ID",
  "oauth.clientSecret": "MCP_OIDC_CLIENT_SECRET",
  "oauth.trustProxy": "MCP_TRUST_PROXY",
  "oauth.clientIpHeader": "MCP_CLIENT_IP_HEADER",
  "oauth.allowlist.emails": "MCP_ALLOWED_EMAILS",
  "oauth.allowlist.subs": "MCP_ALLOWED_SUBS",
  "oauth.redirectAllowlist": "MCP_OAUTH_REDIRECT_ALLOWLIST",
};

/** Env vars renamed in a breaking release: old name → new name. */
const RENAMED_ENV_VARS: Readonly<Record<string, string>> = {
  MCP_HTTP_SHUTDOWN_DRAIN_MS: "MCP_HTTP_SHUTDOWN_DRAIN",
};

/** Env vars removed in a breaking release, with what to do instead. */
const REMOVED_ENV_VARS: Readonly<Record<string, string>> = {
  IMAGE_GEN_API_KEY: "Image generation now uses OPENAI_API_KEY, shared with semantic search.",
  IMAGE_GEN_BASE_URL: "Image generation now uses OPENAI_BASE_URL, shared with semantic search.",
  IMAGE_GEN_REUSE_EMBEDDINGS_CREDS: "Image generation always uses OPENAI_API_KEY now; delete this setting.",
};

export class ConfigError extends Error {
  readonly reason: string;
  /** `validation`: a value failed the schema. `migration`: a setting from an older release that is no longer read. */
  readonly kind: "validation" | "migration";

  private constructor(reason: string, kind: ConfigError["kind"]) {
    super(reason);
    this.name = "ConfigError";
    this.reason = reason;
    this.kind = kind;
  }

  /** A `config.json` exists, but configuration is read only from env vars and the config dir's `.env`. */
  static legacyConfigFile(path: string): ConfigError {
    const envPath = join(dirname(path), ".env");
    return new ConfigError(
      `${path} is no longer read. Move its settings to environment variables or to ${envPath} ` +
        `(one NAME=value per line; see docs/configuration.md), then delete config.json.`,
      "migration",
    );
  }

  /** An env var from an older release is set under its old name. */
  static renamedEnvVar(oldName: string, newName: string): ConfigError {
    return new ConfigError(`${oldName} was renamed to ${newName}. Set ${newName} instead.`, "migration");
  }

  /** An env var from an older release is set, but nothing reads it any more. */
  static removedEnvVar(name: string, instead: string): ConfigError {
    return new ConfigError(`${name} was removed. ${instead}`, "migration");
  }

  static validation(issues: ReadonlyArray<z.core.$ZodIssue>): ConfigError {
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

// Go's `time.ParseDuration` grammar plus `d`: one or more number+unit pairs, e.g. `15m`,
// `1h30m`, `500ms`, `.5h`, `7d`, or a bare `0` (as in Go). Strict on purpose — any other
// bare number is ambiguous (seconds? minutes? milliseconds?), so it fails at boot with a
// hint instead of guessing. Both micro signs work for microseconds (`µs` U+00B5, `μs` U+03BC).
const GO_DURATION = /^(0|((\d+(\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h|d))+)$/;

// Node's timers can't wait longer than this; a bigger delay silently fires after 1 ms.
const MAX_TIMER_MS = 2_147_483_647;

/** Normalize what parse-duration misreads: Greek mu → micro sign, and `5.h` → `5h` (it reads `5.h` as 5 ms). */
function toParseDurationInput(val: string): string {
  return val.replaceAll("μ", "µ").replace(/(\d)\.(?=[a-zµ])/g, "$1");
}

const durationField = z
  .string()
  .trim()
  .regex(GO_DURATION, 'must be a duration with units, like "15m", "1h30m", "500ms", or "7d"')
  .transform((val) => Math.round(parseDurationMs(toParseDurationInput(val)) ?? 0))
  .pipe(z.number().max(MAX_TIMER_MS, "must be at most 24d (Node's timer limit)"));

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
      code: "custom",
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

// Default base URL for every OpenAI-compatible feature. OpenRouter serves both the
// embedding models and the image models behind `generate_recipe_photo`.
const DEFAULT_AI_BASE_URL = "https://openrouter.ai/api/v1";

// One credential block for every OpenAI-compatible feature (semantic search and image
// generation). Per-feature config holds only what differs between them.
const aiCredsSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().min(1).default(DEFAULT_AI_BASE_URL),
});

// Semantic search turns on when the shared creds AND a model are set.
const embeddingsFeatureSchema = z.object({
  model: z.string().min(1),
});

// Image generation turns on when the shared creds point at OpenRouter, unless switched
// off: it bills per image, so a deployment sharing a key for search alone can opt out.
// The model is chosen per `generate_recipe_photo` call, not here.
const imageGenFeatureSchema = z.object({
  enabled: booleanField.default(true),
});

const pinoLevelSchema = z.enum(["trace", "debug", "info", "warn", "error", "fatal"]);

const loggingSchema = z
  .object({
    level: pinoLevelSchema.default("info"),
    notifyLevel: pinoLevelSchema.default("warn"),
    pretty: z.union([z.boolean(), z.literal("auto")]).default("auto"),
    file: z.string().optional(),
  })
  .prefault({});

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
        // At least 1s: a zero interval would re-sync against Paprika back to back.
        interval: durationField.pipe(z.number().min(1000, "must be at least 1s")).prefault("15m"),
        // Window during which a local write is shielded from sync reconciliation
        // (sync would otherwise see a stale canonical list and either delete the
        // just-written item or resurrect the just-deleted one). Cleared on
        // observation for upserts; TTL-only for deletes. See issue #57.
        pendingWriteTtl: durationField.prefault("60s"),
        // Concurrency for the N+1 recipe fetch during sync (`getRecipe` per changed
        // recipe). Default 5. Raise it to speed up a large-library cold start;
        // reliability is the primary constraint, so PaprikaClient warns above its
        // recommended max (high concurrency against one origin risks 429s). See #174.
        recipeFetchConcurrency: z.coerce.number().int().positive().default(5),
      })
      .prefault({}),
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
        shutdownDrainMs: durationField.prefault("5s"),
        // Dev-only widget preview. When true, GET /widget-preview renders a built
        // widget in a plain browser with a fake host shim driven by ?payload=, so
        // widget UI can be iterated without a real MCP host (ADR-0019). Default
        // OFF: the route is absent in production and unauthenticated, and ?payload=
        // is untrusted (read client-side by the shim, never reflected by the
        // server). HTTP transport only. See docs/configuration.md.
        widgetPreview: booleanField.default(false),
      })
      .prefault({}),
    features: z
      .object({
        ai: aiCredsSchema.optional(),
        embeddings: embeddingsFeatureSchema.optional(),
        imageGen: imageGenFeatureSchema.optional(),
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
        discoveryUrl: z.url().optional(),
        scopes: listField.optional(),
        emailVerifiedPolicy: z.enum(["strict", "skip", "if-present"]).optional(),
        allowedAlgs: listField.optional(),
        clientId: z.string().min(1).optional(),
        clientSecret: z.string().min(1).optional(),
        // Trust a front proxy's client-IP header for the DCR rate-limit key and
        // the request span's client.address. Default false (safe for direct
        // exposure). Set true behind a sanitizing reverse proxy (k8s ingress,
        // Tailscale Funnel, Cloudflare). See src/transport/client-ip.ts.
        trustProxy: booleanField.default(false),
        // Which header that proxy sets (rightmost entry wins); resolved to
        // `x-forwarded-for` when unset. Meaningless without trustProxy, so the
        // superRefine below rejects that combination instead of ignoring it.
        // An empty value (a templated manifest's `value: ""`) means unset.
        clientIpHeader: z.preprocess(
          (v) => (v === "" ? undefined : v),
          z
            .string()
            .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/, "must be an HTTP header name, e.g. cf-connecting-ip")
            .transform((v) => v.toLowerCase())
            .optional(),
        ),
        allowlist: z
          .object({
            emails: listField.default([]),
            subs: listField.default([]),
          })
          .prefault({}),
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

    if (oauth?.clientIpHeader !== undefined && !oauth.trustProxy) {
      ctx.addIssue({
        code: "custom",
        path: ["oauth", "clientIpHeader"],
        message:
          "MCP_CLIENT_IP_HEADER needs MCP_TRUST_PROXY=true; without a trusted proxy the header is client-forgeable",
      });
    }

    // Check publicUrl (required when transport=http)
    if (!oauth?.publicUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["oauth", "publicUrl"],
        message: "MCP_PUBLIC_URL is required when MCP_TRANSPORT=http",
      });
    } else {
      // Validate HTTPS only if publicUrl is present
      try {
        const url = new URL(oauth.publicUrl);
        if (url.protocol !== "https:") {
          ctx.addIssue({
            code: "custom",
            path: ["oauth", "publicUrl"],
            message: "must be a valid https:// URL",
          });
        }
      } catch {
        ctx.addIssue({
          code: "custom",
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
        code: "custom",
        path: ["oauth", "allowlist"],
        message: "at least one of MCP_ALLOWED_EMAILS or MCP_ALLOWED_SUBS must be non-empty when MCP_TRANSPORT=http",
      });
    }

    if (!oauth?.preset && !oauth?.discoveryUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["oauth", "preset"],
        message: "one of MCP_OIDC_PRESET or MCP_OIDC_DISCOVERY_URL must be set",
      });
    }

    if (!oauth?.clientId || !oauth?.clientSecret) {
      ctx.addIssue({
        code: "custom",
        path: ["oauth", oauth?.clientId ? "clientSecret" : "clientId"],
        message: "MCP_OIDC_CLIENT_ID and MCP_OIDC_CLIENT_SECRET are required when MCP_TRANSPORT=http",
      });
    }
  })
  // AI feature config is independent of transport.
  .superRefine((cfg, ctx) => {
    // A model without creds would silently leave semantic search off.
    if (cfg.features?.embeddings !== undefined && cfg.features.ai === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["features", "ai", "apiKey"],
        message: "EMBEDDING_MODEL is set, but semantic search also needs OPENAI_API_KEY",
      });
    }
  });

export type PaprikaConfig = z.infer<typeof paprikaConfigSchema>;
/** Everything the embedding client needs: the shared creds plus the model. */
export interface EmbeddingConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
}

/** Image generation's credentials. The model is chosen per tool call, so it isn't here. */
export interface ResolvedImageGenConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
}

/** Semantic search's config, or `null` when it's off (no creds, or no `EMBEDDING_MODEL`). */
export function resolveEmbeddingConfig(config: PaprikaConfig): EmbeddingConfig | null {
  const ai = config.features?.ai;
  const embeddings = config.features?.embeddings;
  return ai !== undefined && embeddings !== undefined ? { ...ai, model: embeddings.model } : null;
}

/**
 * Whether a base URL is OpenRouter's. The photography client speaks OpenRouter's image
 * extension of chat completions (`modalities`, `message.images`) with OpenRouter model
 * IDs, so no other endpoint can serve it.
 */
export function isOpenRouterBaseUrl(baseUrl: string): boolean {
  return URL.canParse(baseUrl) && new URL(baseUrl).hostname === "openrouter.ai";
}

/**
 * Image generation's creds, or `null` when it's off: no creds, a base URL that isn't
 * OpenRouter, or `IMAGE_GEN_ENABLED=false`.
 */
export function resolveImageGenConfig(config: PaprikaConfig): ResolvedImageGenConfig | null {
  const ai = config.features?.ai;
  const enabled = config.features?.imageGen?.enabled ?? true;
  return ai !== undefined && enabled && isOpenRouterBaseUrl(ai.baseUrl)
    ? { apiKey: ai.apiKey, baseUrl: ai.baseUrl }
    : null;
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
  const ai: Record<string, unknown> = {};
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
  if (env["MCP_HTTP_SHUTDOWN_DRAIN"] !== undefined) http["shutdownDrainMs"] = env["MCP_HTTP_SHUTDOWN_DRAIN"];
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

  if (env["OPENAI_API_KEY"] !== undefined) ai["apiKey"] = env["OPENAI_API_KEY"];
  if (env["OPENAI_BASE_URL"] !== undefined) ai["baseUrl"] = env["OPENAI_BASE_URL"];
  if (env["EMBEDDING_MODEL"] !== undefined) embeddings["model"] = env["EMBEDDING_MODEL"];
  if (env["IMAGE_GEN_ENABLED"] !== undefined) imageGen["enabled"] = env["IMAGE_GEN_ENABLED"];

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
  if (env["MCP_CLIENT_IP_HEADER"] !== undefined) oauth["clientIpHeader"] = env["MCP_CLIENT_IP_HEADER"];
  if (env["MCP_OAUTH_REDIRECT_ALLOWLIST"] !== undefined)
    oauth["redirectAllowlist"] = env["MCP_OAUTH_REDIRECT_ALLOWLIST"];

  if (env["MCP_ALLOWED_EMAILS"] !== undefined) allowlist["emails"] = env["MCP_ALLOWED_EMAILS"];
  if (env["MCP_ALLOWED_SUBS"] !== undefined) allowlist["subs"] = env["MCP_ALLOWED_SUBS"];

  if (Object.keys(ai).length > 0) features["ai"] = ai;
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

// Orchestrates the full config loading pipeline. Accepts optional configDir for testability.
export function loadConfig(configDir?: string): Result<PaprikaConfig, ConfigError> {
  const dir = configDir ?? getConfigDir();

  // Fail loudly on settings an older release read, rather than silently ignoring them.
  const legacyFile = join(dir, "config.json");
  if (existsSync(legacyFile)) return err(ConfigError.legacyConfigFile(legacyFile));

  loadDotEnv(dir);

  // After loadDotEnv, so an old name in `.env` is caught as well as one in the real env.
  for (const [oldName, newName] of Object.entries(RENAMED_ENV_VARS)) {
    if (process.env[oldName] !== undefined) return err(ConfigError.renamedEnvVar(oldName, newName));
  }
  for (const [name, instead] of Object.entries(REMOVED_ENV_VARS)) {
    // An empty leftover (`IMAGE_GEN_API_KEY=`) sets nothing, so it doesn't block boot.
    if ((process.env[name] ?? "") !== "") return err(ConfigError.removedEnvVar(name, instead));
  }

  const parseResult = paprikaConfigSchema.safeParse(buildEnvOverrides(process.env));
  if (!parseResult.success) {
    return err(ConfigError.validation(parseResult.error.issues));
  }
  return ok(parseResult.data);
}
