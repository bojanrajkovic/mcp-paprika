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
  "features.replicateApiToken": "REPLICATE_API_TOKEN",
  "features.embeddings.apiKey": "OPENAI_API_KEY",
  "features.embeddings.baseUrl": "OPENAI_BASE_URL",
  "features.embeddings.model": "EMBEDDING_MODEL",
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
    const detail = cause instanceof Error ? cause.message : String(cause);
    return new ConfigError(`Invalid JSON in ${path}: ${detail}`, "invalid_json");
  }

  static fileReadError(path: string, cause: unknown): ConfigError {
    const detail = cause instanceof Error ? cause.message : String(cause);
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
  const result = parseDuration(val);
  if (result.isErr()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: result.error.reason,
    });
    return z.NEVER;
  }
  return result.value.as("milliseconds");
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

const embeddingConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().min(1),
  model: z.string().min(1),
});

export const paprikaConfigSchema = z.object({
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
  features: z
    .object({
      replicateApiToken: z.string().min(1).optional(),
      embeddings: embeddingConfigSchema.optional(),
    })
    .optional(),
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
function loadDotEnv(configDir: string): void {
  dotenv.config({ path: join(configDir, ".env") });
}

// Maps known env vars to the nested config object structure.
function buildEnvOverrides(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const paprika: Record<string, unknown> = {};
  const sync: Record<string, unknown> = {};
  const features: Record<string, unknown> = {};
  const embeddings: Record<string, unknown> = {};

  if (env["PAPRIKA_EMAIL"] !== undefined) paprika["email"] = env["PAPRIKA_EMAIL"];
  if (env["PAPRIKA_PASSWORD"] !== undefined) paprika["password"] = env["PAPRIKA_PASSWORD"];

  if (env["PAPRIKA_SYNC_INTERVAL"] !== undefined) sync["interval"] = env["PAPRIKA_SYNC_INTERVAL"];
  if (env["PAPRIKA_SYNC_ENABLED"] !== undefined) sync["enabled"] = env["PAPRIKA_SYNC_ENABLED"];

  if (env["REPLICATE_API_TOKEN"] !== undefined) features["replicateApiToken"] = env["REPLICATE_API_TOKEN"];
  if (env["OPENAI_API_KEY"] !== undefined) embeddings["apiKey"] = env["OPENAI_API_KEY"];
  if (env["OPENAI_BASE_URL"] !== undefined) embeddings["baseUrl"] = env["OPENAI_BASE_URL"];
  if (env["EMBEDDING_MODEL"] !== undefined) embeddings["model"] = env["EMBEDDING_MODEL"];

  if (Object.keys(embeddings).length > 0) features["embeddings"] = embeddings;
  if (Object.keys(features).length > 0) overrides["features"] = features;
  if (Object.keys(paprika).length > 0) overrides["paprika"] = paprika;
  if (Object.keys(sync).length > 0) overrides["sync"] = sync;

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

  const fileResult = readConfigFile(dir);
  if (fileResult.isErr()) {
    return err(fileResult.error);
  }

  const envOverrides = buildEnvOverrides(process.env);
  const merged = deepMerge(fileResult.value, envOverrides);

  const parseResult = paprikaConfigSchema.safeParse(merged);
  if (!parseResult.success) {
    return err(ConfigError.validation(parseResult.error.issues));
  }

  return ok(parseResult.data);
}
