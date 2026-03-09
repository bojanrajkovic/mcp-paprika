import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ConfigError, paprikaConfigSchema, type EmbeddingConfig } from "./config.js";

describe("Configuration loading", () => {
  describe("config-loader.AC7.3: ConfigError class", () => {
    it("config-loader.AC7.3.1: ConfigError is an instance of Error", () => {
      const error = ConfigError.invalidJson("/path/config.json", new Error("test"));
      expect(error).toBeInstanceOf(Error);
    });

    it("config-loader.AC7.3.2: ConfigError has readonly reason field", () => {
      const error = ConfigError.invalidJson("/path/config.json", new Error("test"));
      expect(error.reason).toBeDefined();
      expect(typeof error.reason).toBe("string");
    });

    it("config-loader.AC7.3.3: ConfigError has readonly kind field", () => {
      const error = ConfigError.invalidJson("/path/config.json", new Error("test"));
      expect(error.kind).toBeDefined();
      expect(["invalid_json", "file_read_error", "validation"]).toContain(error.kind);
    });

    it("config-loader.AC7.3.4: ConfigError.invalidJson() creates error with kind 'invalid_json'", () => {
      const error = ConfigError.invalidJson("/path/config.json", new Error("unexpected token"));
      expect(error.kind).toBe("invalid_json");
      expect(error.reason).toContain("/path/config.json");
      expect(error.reason).toContain("unexpected token");
    });

    it("config-loader.AC7.3.5: ConfigError.fileReadError() creates error with kind 'file_read_error'", () => {
      const error = ConfigError.fileReadError("/path/config.json", new Error("EACCES"));
      expect(error.kind).toBe("file_read_error");
      expect(error.reason).toContain("/path/config.json");
      expect(error.reason).toContain("EACCES");
    });

    it("config-loader.AC7.3.6: ConfigError.validation() creates error with kind 'validation'", () => {
      const issues: z.ZodIssue[] = [];
      const error = ConfigError.validation(issues);
      expect(error.kind).toBe("validation");
    });
  });

  describe("config-loader.AC6.4: Validation error formatting", () => {
    it("config-loader.AC6.4.1: ConfigError.validation() produces human-readable formatted output", () => {
      const mockIssues: z.ZodIssue[] = [
        {
          code: z.ZodIssueCode.invalid_type,
          expected: "string",
          received: "undefined",
          path: ["paprika", "email"],
          message: "Required",
        },
      ];

      const error = ConfigError.validation(mockIssues);
      expect(error.reason).toContain("Configuration validation failed:");
      expect(error.reason).toContain("paprika.email");
      expect(error.reason).toContain("Required");
      expect(error.reason).toContain("(set via PAPRIKA_EMAIL)");
      expect(error.reason).toMatch(/^\s*-\s+paprika\.email/m);
    });

    it("config-loader.AC6.4.2: ConfigError.validation() formats multiple issues", () => {
      const mockIssues: z.ZodIssue[] = [
        {
          code: z.ZodIssueCode.invalid_type,
          expected: "string",
          received: "undefined",
          path: ["paprika", "email"],
          message: "Required",
        },
        {
          code: z.ZodIssueCode.invalid_type,
          expected: "string",
          received: "undefined",
          path: ["paprika", "password"],
          message: "Required",
        },
      ];

      const error = ConfigError.validation(mockIssues);
      expect(error.reason).toContain("paprika.email");
      expect(error.reason).toContain("paprika.password");
      expect(error.reason).toContain("PAPRIKA_EMAIL");
      expect(error.reason).toContain("PAPRIKA_PASSWORD");
    });

    it("config-loader.AC6.4.3: ConfigError.validation() handles unknown paths without env var hints", () => {
      const mockIssues: z.ZodIssue[] = [
        {
          code: z.ZodIssueCode.custom,
          path: ["unknown", "field"],
          message: "Invalid value",
        },
      ];

      const error = ConfigError.validation(mockIssues);
      expect(error.reason).toContain("unknown.field");
      expect(error.reason).toContain("Invalid value");
      expect(error.reason).not.toContain("(set via");
    });
  });

  describe("config-loader.AC3: Duration field", () => {
    const validBase = { paprika: { email: "user@test.com", password: "secret" } };

    it("config-loader.AC3.1: accepts '15m' string and resolves to 900000 ms", () => {
      const input = { ...validBase, sync: { interval: "15m" } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.interval).toBe(900000);
      }
    });

    it("config-loader.AC3.2: accepts 'PT15M' ISO 8601 and resolves to 900000 ms", () => {
      const input = { ...validBase, sync: { interval: "PT15M" } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.interval).toBe(900000);
      }
    });

    it("config-loader.AC3.3: accepts 15 (number, minutes) and resolves to 900000 ms", () => {
      const input = { ...validBase, sync: { interval: 15 } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.interval).toBe(900000);
      }
    });

    it("config-loader.AC3.4: rejects 'abc' with validation error", () => {
      const input = { ...validBase, sync: { interval: "abc" } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("config-loader.AC4: Boolean field (PAPRIKA_SYNC_ENABLED)", () => {
    const validBase = { paprika: { email: "user@test.com", password: "secret" } };

    it("config-loader.AC4.1: 'true' string sets sync.enabled to true", () => {
      const input = { ...validBase, sync: { enabled: "true" } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.enabled).toBe(true);
      }
    });

    it("config-loader.AC4.2: 'false' string sets sync.enabled to false", () => {
      const input = { ...validBase, sync: { enabled: "false" } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.enabled).toBe(false);
      }
    });

    it("config-loader.AC4.3: '1' string sets sync.enabled to true", () => {
      const input = { ...validBase, sync: { enabled: "1" } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.enabled).toBe(true);
      }
    });

    it("config-loader.AC4.4: '0' string sets sync.enabled to false", () => {
      const input = { ...validBase, sync: { enabled: "0" } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.enabled).toBe(false);
      }
    });

    it("config-loader.AC4.5: 'yes' string produces validation error", () => {
      const input = { ...validBase, sync: { enabled: "yes" } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("config-loader.AC1: Defaults", () => {
    const validBase = { paprika: { email: "user@test.com", password: "secret" } };

    it("config-loader.AC1.3: default sync.enabled is true when no sync block provided", () => {
      const result = paprikaConfigSchema.safeParse(validBase);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.enabled).toBe(true);
      }
    });

    it("config-loader.AC1.4: default sync.interval is 900000 ms when no sync block provided", () => {
      const result = paprikaConfigSchema.safeParse(validBase);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.interval).toBe(900000);
      }
    });

    it("config-loader.AC1.5: features is undefined when no features block provided", () => {
      const result = paprikaConfigSchema.safeParse(validBase);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.features).toBeUndefined();
      }
    });
  });

  describe("config-loader.AC6: Validation errors", () => {
    it("config-loader.AC6.1: missing email produces validation error with PAPRIKA_EMAIL hint", () => {
      const result = paprikaConfigSchema.safeParse({ paprika: {} });
      expect(result.success).toBe(false);
      if (!result.success) {
        const error = ConfigError.validation(result.error.issues);
        expect(error.reason).toContain("PAPRIKA_EMAIL");
      }
    });

    it("config-loader.AC6.2: missing password produces validation error with PAPRIKA_PASSWORD hint", () => {
      const result = paprikaConfigSchema.safeParse({ paprika: {} });
      expect(result.success).toBe(false);
      if (!result.success) {
        const error = ConfigError.validation(result.error.issues);
        expect(error.reason).toContain("PAPRIKA_PASSWORD");
      }
    });

    it("config-loader.AC6.3: empty string email fails validation", () => {
      const input = {
        paprika: { email: "", password: "secret" },
      };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("config-loader.AC7: Type exports", () => {
    const validBase = { paprika: { email: "user@test.com", password: "secret" } };

    it("config-loader.AC7.1: PaprikaConfig has paprika, sync, and optional features fields", () => {
      const result = paprikaConfigSchema.safeParse(validBase);
      expect(result.success).toBe(true);
      if (result.success) {
        const config = result.data;
        expect(config).toHaveProperty("paprika");
        expect(config).toHaveProperty("sync");
        expect(typeof config.paprika).toBe("object");
        expect(typeof config.sync).toBe("object");
        expect("email" in config.paprika).toBe(true);
        expect("password" in config.paprika).toBe(true);
        expect("enabled" in config.sync).toBe(true);
        expect("interval" in config.sync).toBe(true);
        expect(config.features).toBeUndefined();
      }
    });

    it("config-loader.AC7.2: EmbeddingConfig has required apiKey, baseUrl, model string fields", () => {
      // Compile-time verification: this const can only be assigned if it has the required fields
      const embeddingConfig: EmbeddingConfig = {
        apiKey: "test-key",
        baseUrl: "https://example.com",
        model: "test-model",
      };
      expect(embeddingConfig.apiKey).toBe("test-key");
      expect(embeddingConfig.baseUrl).toBe("https://example.com");
      expect(embeddingConfig.model).toBe("test-model");
    });
  });
});
