import { toMessage } from "./log.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import dotenv from "dotenv";
import { ok, err, type Result } from "neverthrow";
import { parseDuration } from "./duration.js";
import { getConfigDir } from "./xdg.js";

const ENV_VAR_HINTS: Readonly<Record<string, string>> = {
  "paprika.email": "PAPRIKA_EMAIL",
  "paprika.password": "PAPRIKA_PASSWORD",
  "sync.interval": "PAPRIKA_SYNC_INTERVAL",
  "sync.enabled": "PAPRIKA_SYNC_ENABLED",
  transport: "MCP_TRANSPORT",
  "http.port": "MCP_HTTP_PORT",
  "http.host": "MCP_HTTP_HOST",
  "features.replicateApiToken": "REPLICATE_API_TOKEN",
  "features.embeddings.apiKey": "OPENAI_API_KEY",
  "features.embeddings.baseUrl": "OPENAI_BASE_URL",
  "features.embeddings.model": "EMBEDDING_MODEL",
  "oauth.publicUrl": "MCP_PUBLIC_URL",
  "oauth.preset": "MCP_OIDC_PRESET",
  "oauth.discoveryUrl": "MCP_OIDC_DISCOVERY_URL",
  "oauth.scopes": "MCP_OIDC_SCOPES",
  "oauth.emailVerifiedPolicy": "MCP_OIDC_EMAIL_VERIFIED_POLICY",
  "oauth.allowedAlgs": "MCP_OIDC_ALLOWED_ALGS",
  "oauth.clientId": "MCP_OIDC_CLIENT_ID",
  "oauth.clientSecret": "MCP_OIDC_CLIENT_SECRET",
  "oauth.allowlist.emails": "MCP_ALLOWED_EMAILS",
  "oauth.allowlist.subs": "MCP_ALLOWED_SUBS",
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
      })
      .default({}),
    // Transport selection. `stdio` (default) keeps the current behavior for all
    // existing CLI clients (Claude Code, Claude Desktop, Cursor, mcp-cli). `http`
    // exposes Streamable HTTP for Claude Mobile and other HTTP-based MCP
    // clients. See docs/configuration.md for the security implications.
    transport: z.enum(["stdio", "http"]).default("stdio"),
    http: z
      .object({
        port: z.coerce.number().int().min(1).max(65535).default(3000),
        host: z.string().min(1).default("0.0.0.0"),
      })
      .default({}),
    features: z
      .object({
        replicateApiToken: z.string().min(1).optional(),
        embeddings: embeddingConfigSchema.optional(),
      })
      .optional(),
    oauth: z
      .object({
        publicUrl: z.string().min(1).optional(),
        preset: z.enum(["google", "entra", "okta", "auth0", "keycloak"]).optional(),
        discoveryUrl: z.string().url().optional(),
        scopes: listField.optional(),
        emailVerifiedPolicy: z.enum(["strict", "skip", "if-present"]).optional(),
        allowedAlgs: listField.optional(),
        clientId: z.string().min(1).optional(),
        clientSecret: z.string().min(1).optional(),
        allowlist: z
          .object({
            emails: listField.default([]),
            subs: listField.default([]),
          })
          .default({}),
      })
      .optional(),
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
  });

export type PaprikaConfig = z.infer<typeof paprikaConfigSchema>;
export type EmbeddingConfig = z.infer<typeof embeddingConfigSchema>;

// Type guard for NodeJS.ErrnoException
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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
function buildEnvOverrides(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const paprika: Record<string, unknown> = {};
  const sync: Record<string, unknown> = {};
  const http: Record<string, unknown> = {};
  const features: Record<string, unknown> = {};
  const embeddings: Record<string, unknown> = {};
  const oauth: Record<string, unknown> = {};
  const allowlist: Record<string, unknown> = {};

  if (env["PAPRIKA_EMAIL"] !== undefined) paprika["email"] = env["PAPRIKA_EMAIL"];
  if (env["PAPRIKA_PASSWORD"] !== undefined) paprika["password"] = env["PAPRIKA_PASSWORD"];

  if (env["PAPRIKA_SYNC_INTERVAL"] !== undefined) sync["interval"] = env["PAPRIKA_SYNC_INTERVAL"];
  if (env["PAPRIKA_SYNC_ENABLED"] !== undefined) sync["enabled"] = env["PAPRIKA_SYNC_ENABLED"];

  if (env["MCP_TRANSPORT"] !== undefined) overrides["transport"] = env["MCP_TRANSPORT"];
  if (env["MCP_HTTP_PORT"] !== undefined) http["port"] = env["MCP_HTTP_PORT"];
  if (env["MCP_HTTP_HOST"] !== undefined) http["host"] = env["MCP_HTTP_HOST"];

  if (env["REPLICATE_API_TOKEN"] !== undefined) features["replicateApiToken"] = env["REPLICATE_API_TOKEN"];
  if (env["OPENAI_API_KEY"] !== undefined) embeddings["apiKey"] = env["OPENAI_API_KEY"];
  if (env["OPENAI_BASE_URL"] !== undefined) embeddings["baseUrl"] = env["OPENAI_BASE_URL"];
  if (env["EMBEDDING_MODEL"] !== undefined) embeddings["model"] = env["EMBEDDING_MODEL"];

  if (env["MCP_PUBLIC_URL"] !== undefined) oauth["publicUrl"] = env["MCP_PUBLIC_URL"];
  if (env["MCP_OIDC_PRESET"] !== undefined) oauth["preset"] = env["MCP_OIDC_PRESET"];
  if (env["MCP_OIDC_DISCOVERY_URL"] !== undefined) oauth["discoveryUrl"] = env["MCP_OIDC_DISCOVERY_URL"];
  if (env["MCP_OIDC_SCOPES"] !== undefined) oauth["scopes"] = env["MCP_OIDC_SCOPES"];
  if (env["MCP_OIDC_EMAIL_VERIFIED_POLICY"] !== undefined)
    oauth["emailVerifiedPolicy"] = env["MCP_OIDC_EMAIL_VERIFIED_POLICY"];
  if (env["MCP_OIDC_ALLOWED_ALGS"] !== undefined) oauth["allowedAlgs"] = env["MCP_OIDC_ALLOWED_ALGS"];
  if (env["MCP_OIDC_CLIENT_ID"] !== undefined) oauth["clientId"] = env["MCP_OIDC_CLIENT_ID"];
  if (env["MCP_OIDC_CLIENT_SECRET"] !== undefined) oauth["clientSecret"] = env["MCP_OIDC_CLIENT_SECRET"];

  if (env["MCP_ALLOWED_EMAILS"] !== undefined) allowlist["emails"] = env["MCP_ALLOWED_EMAILS"];
  if (env["MCP_ALLOWED_SUBS"] !== undefined) allowlist["subs"] = env["MCP_ALLOWED_SUBS"];

  if (Object.keys(embeddings).length > 0) features["embeddings"] = embeddings;
  if (Object.keys(allowlist).length > 0) oauth["allowlist"] = allowlist;
  if (Object.keys(features).length > 0) overrides["features"] = features;
  if (Object.keys(oauth).length > 0) overrides["oauth"] = oauth;
  if (Object.keys(paprika).length > 0) overrides["paprika"] = paprika;
  if (Object.keys(sync).length > 0) overrides["sync"] = sync;
  if (Object.keys(http).length > 0) overrides["http"] = http;

  return overrides;
}

// Recursively merges base config with overrides. Override values win for non-object fields.
/** @internal Pure helper for config merging. Exported for property-based testing only. */
export function deepMerge(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overrides)) {
    const baseVal = base[key];
    const overVal = overrides[key];
    if (
      typeof baseVal === "object" &&
      baseVal !== null &&
      !Array.isArray(baseVal) &&
      typeof overVal === "object" &&
      overVal !== null &&
      !Array.isArray(overVal)
    ) {
      result[key] = deepMerge(baseVal as Record<string, unknown>, overVal as Record<string, unknown>);
    } else {
      result[key] = overVal;
    }
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
