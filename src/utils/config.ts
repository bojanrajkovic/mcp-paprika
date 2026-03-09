import { z } from "zod";
import { parseDuration } from "./duration.js";

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
  paprika: z
    .object({
      email: z.string().min(1),
      password: z.string().min(1),
    })
    // @ts-expect-error zod allows empty default for object drilling validation
    .default({}),
  sync: z
    .object({
      enabled: booleanField.optional().default(true),
      interval: durationField.optional().default("15m"),
    })
    .optional()
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
