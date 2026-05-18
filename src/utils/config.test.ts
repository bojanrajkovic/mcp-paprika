import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";
import { ConfigError, paprikaConfigSchema, type EmbeddingConfig, loadConfig } from "./config.js";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

    it("config-loader.AC6.1b: entirely absent paprika produces env var hints", () => {
      const result = paprikaConfigSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        const error = ConfigError.validation(result.error.issues);
        expect(error.reason).toContain("PAPRIKA_EMAIL");
        expect(error.reason).toContain("PAPRIKA_PASSWORD");
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

  // OAuth config validation tests (AC3.9, AC6.2, AC6.3)
  describe("OAuth config", () => {
    const OAUTH_ENV_VARS = [
      "MCP_PUBLIC_URL",
      "MCP_OIDC_PRESET",
      "MCP_OIDC_DISCOVERY_URL",
      "MCP_OIDC_SCOPES",
      "MCP_OIDC_EMAIL_VERIFIED_POLICY",
      "MCP_OIDC_ALLOWED_ALGS",
      "MCP_OIDC_CLIENT_ID",
      "MCP_OIDC_CLIENT_SECRET",
      "MCP_ALLOWED_EMAILS",
      "MCP_ALLOWED_SUBS",
    ] as const;

    let tempDir: string;
    let savedEnv: Map<string, string | undefined>;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "oauth-test-"));
      savedEnv = new Map();
      const allVars = ["PAPRIKA_EMAIL", "PAPRIKA_PASSWORD", "MCP_TRANSPORT", ...OAUTH_ENV_VARS];
      for (const key of allVars) {
        savedEnv.set(key, process.env[key]);
        delete process.env[key];
      }
    });

    afterEach(() => {
      for (const [key, value] of savedEnv) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      try {
        chmodSync(join(tempDir, "config.json"), 0o644);
      } catch {
        // ignore if file doesn't exist
      }
      rmSync(tempDir, { recursive: true, force: true });
    });

    describe("oauth21-http.AC3.9: Allowlist validation", () => {
      it("rejects HTTP transport with both MCP_ALLOWED_EMAILS and MCP_ALLOWED_SUBS empty", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "http";
        process.env.MCP_PUBLIC_URL = "https://m.example.com";
        process.env.MCP_OIDC_PRESET = "google";
        process.env.MCP_OIDC_CLIENT_ID = "client123";
        process.env.MCP_OIDC_CLIENT_SECRET = "secret456";
        process.env.MCP_ALLOWED_EMAILS = "";
        process.env.MCP_ALLOWED_SUBS = "";

        const result = loadConfig(tempDir);
        result.match(
          () => {
            expect.fail("Expected Err but got Ok");
          },
          (error) => {
            expect(error.kind).toBe("validation");
            expect(error.reason).toContain("MCP_ALLOWED_EMAILS");
            expect(error.reason).toContain("MCP_ALLOWED_SUBS");
          },
        );
      });

      it("accepts HTTP transport with non-empty MCP_ALLOWED_EMAILS", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "http";
        process.env.MCP_PUBLIC_URL = "https://m.example.com";
        process.env.MCP_OIDC_PRESET = "google";
        process.env.MCP_OIDC_CLIENT_ID = "client123";
        process.env.MCP_OIDC_CLIENT_SECRET = "secret456";
        process.env.MCP_ALLOWED_EMAILS = "alice@example.com";

        const result = loadConfig(tempDir);
        result.match(
          (config) => {
            expect(config.oauth?.allowlist.emails).toEqual(["alice@example.com"]);
          },
          (error) => {
            expect.fail(`Expected Ok but got Err: ${error.reason}`);
          },
        );
      });
    });

    describe("oauth21-http.AC6.2: Public URL requirement", () => {
      it("rejects HTTP transport without MCP_PUBLIC_URL", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "http";
        process.env.MCP_OIDC_PRESET = "google";
        process.env.MCP_OIDC_CLIENT_ID = "client123";
        process.env.MCP_OIDC_CLIENT_SECRET = "secret456";
        process.env.MCP_ALLOWED_EMAILS = "alice@example.com";

        const result = loadConfig(tempDir);
        result.match(
          () => {
            expect.fail("Expected Err but got Ok");
          },
          (error) => {
            expect(error.kind).toBe("validation");
            expect(error.reason).toContain("MCP_PUBLIC_URL");
          },
        );
      });
    });

    describe("oauth21-http.AC6.3: HTTPS requirement", () => {
      it("rejects HTTP transport with http:// URL", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "http";
        process.env.MCP_PUBLIC_URL = "http://mcp.example.com";
        process.env.MCP_OIDC_PRESET = "google";
        process.env.MCP_OIDC_CLIENT_ID = "client123";
        process.env.MCP_OIDC_CLIENT_SECRET = "secret456";
        process.env.MCP_ALLOWED_EMAILS = "alice@example.com";

        const result = loadConfig(tempDir);
        result.match(
          () => {
            expect.fail("Expected Err but got Ok");
          },
          (error) => {
            expect(error.kind).toBe("validation");
            expect(error.reason).toContain("https");
          },
        );
      });

      it("accepts substring trick (https://evil/?fake=http://x) as HTTPS", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "http";
        process.env.MCP_PUBLIC_URL = "https://evil/?fake=http://x";
        process.env.MCP_OIDC_PRESET = "google";
        process.env.MCP_OIDC_CLIENT_ID = "client123";
        process.env.MCP_OIDC_CLIENT_SECRET = "secret456";
        process.env.MCP_ALLOWED_EMAILS = "alice@example.com";

        const result = loadConfig(tempDir);
        result.match(
          (config) => {
            expect(config.oauth?.publicUrl).toBe("https://evil/?fake=http://x");
          },
          (error) => {
            expect.fail(`Expected Ok but got Err: ${error.reason}`);
          },
        );
      });
    });

    describe("listField behaviors", () => {
      it("splits comma-separated values and trims whitespace", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "http";
        process.env.MCP_PUBLIC_URL = "https://m.example.com";
        process.env.MCP_OIDC_PRESET = "google";
        process.env.MCP_OIDC_CLIENT_ID = "client123";
        process.env.MCP_OIDC_CLIENT_SECRET = "secret456";
        process.env.MCP_ALLOWED_EMAILS = "a@x, b@x ,c@x";

        const result = loadConfig(tempDir);
        result.match(
          (config) => {
            expect(config.oauth?.allowlist.emails).toEqual(["a@x", "b@x", "c@x"]);
          },
          (error) => {
            expect.fail(`Expected Ok but got Err: ${error.reason}`);
          },
        );
      });

      it("filters empty entries from comma-separated values", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "http";
        process.env.MCP_PUBLIC_URL = "https://m.example.com";
        process.env.MCP_OIDC_PRESET = "google";
        process.env.MCP_OIDC_CLIENT_ID = "client123";
        process.env.MCP_OIDC_CLIENT_SECRET = "secret456";
        process.env.MCP_ALLOWED_EMAILS = ",,";

        const result = loadConfig(tempDir);
        result.match(
          () => {
            expect.fail("Expected Err but got Ok");
          },
          (error) => {
            expect(error.kind).toBe("validation");
            expect(error.reason).toContain("MCP_ALLOWED_EMAILS");
          },
        );
      });
    });

    describe("stdio transport skips OAuth validation", () => {
      it("accepts stdio transport with no OAuth config", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "stdio";

        const result = loadConfig(tempDir);
        result.match(
          (config) => {
            expect(config.transport).toBe("stdio");
          },
          (error) => {
            expect.fail(`Expected Ok but got Err: ${error.reason}`);
          },
        );
      });

      it("accepts stdio transport with invalid OAuth env vars (http:// URL is allowed)", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "stdio";
        process.env.MCP_PUBLIC_URL = "http://m.example.com";
        process.env.MCP_OIDC_PRESET = "google";

        const result = loadConfig(tempDir);
        result.match(
          (config) => {
            expect(config.transport).toBe("stdio");
          },
          (error) => {
            expect.fail(`Expected Ok but got Err: ${error.reason}`);
          },
        );
      });
    });

    describe("Preset OR discovery URL invariant", () => {
      it("rejects HTTP mode without preset and without discovery URL", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "http";
        process.env.MCP_PUBLIC_URL = "https://m.example.com";
        process.env.MCP_OIDC_CLIENT_ID = "client123";
        process.env.MCP_OIDC_CLIENT_SECRET = "secret456";
        process.env.MCP_ALLOWED_EMAILS = "alice@example.com";

        const result = loadConfig(tempDir);
        result.match(
          () => {
            expect.fail("Expected Err but got Ok");
          },
          (error) => {
            expect(error.kind).toBe("validation");
            expect(error.reason).toContain("MCP_OIDC_PRESET");
            expect(error.reason).toContain("MCP_OIDC_DISCOVERY_URL");
          },
        );
      });

      it("accepts HTTP mode with discovery URL only", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "http";
        process.env.MCP_PUBLIC_URL = "https://m.example.com";
        process.env.MCP_OIDC_DISCOVERY_URL = "https://issuer.example.com/.well-known/openid-configuration";
        process.env.MCP_OIDC_CLIENT_ID = "client123";
        process.env.MCP_OIDC_CLIENT_SECRET = "secret456";
        process.env.MCP_ALLOWED_EMAILS = "alice@example.com";

        const result = loadConfig(tempDir);
        result.match(
          (config) => {
            expect(config.oauth?.discoveryUrl).toBe("https://issuer.example.com/.well-known/openid-configuration");
          },
          (error) => {
            expect.fail(`Expected Ok but got Err: ${error.reason}`);
          },
        );
      });
    });

    describe("Client credentials requirement", () => {
      it("rejects HTTP mode without clientId", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "http";
        process.env.MCP_PUBLIC_URL = "https://m.example.com";
        process.env.MCP_OIDC_PRESET = "google";
        process.env.MCP_OIDC_CLIENT_SECRET = "secret456";
        process.env.MCP_ALLOWED_EMAILS = "alice@example.com";

        const result = loadConfig(tempDir);
        result.match(
          () => {
            expect.fail("Expected Err but got Ok");
          },
          (error) => {
            expect(error.kind).toBe("validation");
            expect(error.reason).toContain("MCP_OIDC_CLIENT_ID");
          },
        );
      });

      it("rejects HTTP mode without clientSecret", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "http";
        process.env.MCP_PUBLIC_URL = "https://m.example.com";
        process.env.MCP_OIDC_PRESET = "google";
        process.env.MCP_OIDC_CLIENT_ID = "client123";
        process.env.MCP_ALLOWED_EMAILS = "alice@example.com";

        const result = loadConfig(tempDir);
        result.match(
          () => {
            expect.fail("Expected Err but got Ok");
          },
          (error) => {
            expect(error.kind).toBe("validation");
            expect(error.reason).toContain("MCP_OIDC_CLIENT_SECRET");
          },
        );
      });
    });

    describe("Happy path", () => {
      it("accepts valid HTTP OAuth config with all required env vars", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "http";
        process.env.MCP_PUBLIC_URL = "https://mcp.example.com";
        process.env.MCP_OIDC_PRESET = "google";
        process.env.MCP_OIDC_CLIENT_ID = "client123";
        process.env.MCP_OIDC_CLIENT_SECRET = "secret456";
        process.env.MCP_ALLOWED_EMAILS = "alice@example.com,bob@example.com";

        const result = loadConfig(tempDir);
        result.match(
          (config) => {
            expect(config.oauth).toBeDefined();
            expect(config.oauth?.publicUrl).toBe("https://mcp.example.com");
            expect(config.oauth?.preset).toBe("google");
            expect(config.oauth?.clientId).toBe("client123");
            expect(config.oauth?.clientSecret).toBe("secret456");
            expect(config.oauth?.allowlist.emails).toEqual(["alice@example.com", "bob@example.com"]);
            expect(config.oauth?.allowlist.subs).toEqual([]);
          },
          (error) => {
            expect.fail(`Expected Ok but got Err: ${error.reason}`);
          },
        );
      });
    });
  });

  // Phase 2: loadConfig integration tests
  describe("Phase 2: loadConfig integration", () => {
    // Shared test infrastructure
    const CONFIG_ENV_VARS = [
      "PAPRIKA_EMAIL",
      "PAPRIKA_PASSWORD",
      "PAPRIKA_SYNC_INTERVAL",
      "PAPRIKA_SYNC_ENABLED",
      "MCP_TRANSPORT",
      "MCP_HTTP_PORT",
      "MCP_HTTP_HOST",
      "REPLICATE_API_TOKEN",
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "EMBEDDING_MODEL",
    ] as const;

    let tempDir: string;
    let savedEnv: Map<string, string | undefined>;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "config-test-"));
      savedEnv = new Map();
      for (const key of CONFIG_ENV_VARS) {
        savedEnv.set(key, process.env[key]);
        delete process.env[key];
      }
    });

    afterEach(() => {
      for (const [key, value] of savedEnv) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      // Restore permissions for cleanup
      try {
        chmodSync(join(tempDir, "config.json"), 0o644);
      } catch {
        // ignore if file doesn't exist
      }
      rmSync(tempDir, { recursive: true, force: true });
    });

    // Shared helpers
    function writeConfig(dir: string, config: Record<string, unknown>): void {
      writeFileSync(join(dir, "config.json"), JSON.stringify(config));
    }

    function writeDotEnv(dir: string, vars: Record<string, string>): void {
      const content = Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
      writeFileSync(join(dir, ".env"), content);
    }

    describe("config-loader.AC1: loadConfig returns valid PaprikaConfig", () => {
      it("config-loader.AC1.1: loadConfig returns ok with PaprikaConfig when env vars are set", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";

        loadConfig(tempDir).match(
          (config) => {
            expect(config.paprika.email).toBe("user@test.com");
            expect(config.paprika.password).toBe("secret");
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });

      it("config-loader.AC1.2: loadConfig returns ok with PaprikaConfig when config.json provides credentials", () => {
        writeFileSync(
          join(tempDir, "config.json"),
          JSON.stringify({ paprika: { email: "user@test.com", password: "secret" } }),
        );

        loadConfig(tempDir).match(
          (config) => {
            expect(config.paprika.email).toBe("user@test.com");
            expect(config.paprika.password).toBe("secret");
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });
    });

    describe("config-loader.AC2: Source priority chain", () => {
      it("config-loader.AC2.1: Env var PAPRIKA_EMAIL overrides config.json", () => {
        writeConfig(tempDir, {
          paprika: { email: "file@test.com", password: "filepw" },
        });
        process.env.PAPRIKA_EMAIL = "env@test.com";

        loadConfig(tempDir).match(
          (config) => {
            expect(config.paprika.email).toBe("env@test.com");
            expect(config.paprika.password).toBe("filepw");
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });

      it("config-loader.AC2.2: Real env vars override .env file values", () => {
        writeDotEnv(tempDir, {
          PAPRIKA_EMAIL: "dotenv@test.com",
          PAPRIKA_PASSWORD: "dotenvpw",
        });
        process.env.PAPRIKA_EMAIL = "real@test.com";

        loadConfig(tempDir).match(
          (config) => {
            expect(config.paprika.email).toBe("real@test.com");
            expect(config.paprika.password).toBe("dotenvpw");
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });

      it("config-loader.AC2.3: .env file values override config.json values", () => {
        writeConfig(tempDir, {
          paprika: { email: "file@test.com", password: "filepw" },
        });
        writeDotEnv(tempDir, { PAPRIKA_EMAIL: "dotenv@test.com" });

        loadConfig(tempDir).match(
          (config) => {
            expect(config.paprika.email).toBe("dotenv@test.com");
            expect(config.paprika.password).toBe("filepw");
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });

      it("config-loader.AC2.4: Zod defaults apply when no source provides a value", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";

        loadConfig(tempDir).match(
          (config) => {
            expect(config.sync.enabled).toBe(true);
            expect(config.sync.interval).toBe(900000);
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });
    });

    describe("config-loader.AC5: File handling", () => {
      it("config-loader.AC5.1: Missing config.json (ENOENT) does not cause an error", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";

        loadConfig(tempDir).match(
          () => {},
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });

      it("config-loader.AC5.2: Missing .env file does not cause an error", () => {
        writeConfig(tempDir, {
          paprika: { email: "user@test.com", password: "secret" },
        });

        loadConfig(tempDir).match(
          () => {},
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });

      it("config-loader.AC5.3: Invalid JSON in config.json produces ConfigError with kind 'invalid_json'", () => {
        writeFileSync(join(tempDir, "config.json"), "not valid json {");

        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";

        loadConfig(tempDir).match(
          () => {
            expect.fail("Expected Err but got Ok");
          },
          (error) => {
            expect(error.kind).toBe("invalid_json");
          },
        );
      });

      it.runIf(process.getuid?.() !== 0)(
        "config-loader.AC5.4: Permission error on config.json produces ConfigError with kind 'file_read_error'",
        () => {
          writeConfig(tempDir, {
            paprika: { email: "user@test.com", password: "secret" },
          });
          chmodSync(join(tempDir, "config.json"), 0o000);

          process.env.PAPRIKA_EMAIL = "backup@test.com";
          process.env.PAPRIKA_PASSWORD = "secret";

          loadConfig(tempDir).match(
            () => {
              expect.fail("Expected Err but got Ok");
            },
            (error) => {
              expect(error.kind).toBe("file_read_error");
            },
          );
        },
      );
    });

    describe("config-loader.AC9: transport + HTTP config", () => {
      it("config-loader.AC9.1: defaults — transport is 'stdio', http.port is 3000, http.host is '0.0.0.0'", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";

        loadConfig(tempDir).match(
          (config) => {
            expect(config.transport).toBe("stdio");
            expect(config.http.port).toBe(3000);
            expect(config.http.host).toBe("0.0.0.0");
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });

      it("config-loader.AC9.2: MCP_TRANSPORT=http sets transport", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "http";
        process.env.MCP_PUBLIC_URL = "https://mcp.example.com";
        process.env.MCP_OIDC_PRESET = "google";
        process.env.MCP_OIDC_CLIENT_ID = "client123";
        process.env.MCP_OIDC_CLIENT_SECRET = "secret456";
        process.env.MCP_ALLOWED_EMAILS = "alice@example.com";

        loadConfig(tempDir).match(
          (config) => {
            expect(config.transport).toBe("http");
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });

      it("config-loader.AC9.3: MCP_TRANSPORT=foo is rejected by validation", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_TRANSPORT = "foo";

        loadConfig(tempDir).match(
          () => {
            expect.fail("Expected Err but got Ok");
          },
          (error) => {
            expect(error.kind).toBe("validation");
            expect(error.reason).toContain("transport");
          },
        );
      });

      it("config-loader.AC9.4: MCP_HTTP_PORT='8080' string is coerced to number", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_HTTP_PORT = "8080";

        loadConfig(tempDir).match(
          (config) => {
            expect(config.http.port).toBe(8080);
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });

      it("config-loader.AC9.5: MCP_HTTP_PORT='0' is rejected (below min 1)", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_HTTP_PORT = "0";

        loadConfig(tempDir).match(
          () => {
            expect.fail("Expected Err but got Ok");
          },
          (error) => {
            expect(error.kind).toBe("validation");
            expect(error.reason).toContain("http.port");
          },
        );
      });

      it("config-loader.AC9.6: MCP_HTTP_PORT='70000' is rejected (above max 65535)", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_HTTP_PORT = "70000";

        loadConfig(tempDir).match(
          () => {
            expect.fail("Expected Err but got Ok");
          },
          (error) => {
            expect(error.kind).toBe("validation");
            expect(error.reason).toContain("http.port");
          },
        );
      });

      it("config-loader.AC9.7: MCP_HTTP_HOST='127.0.0.1' is accepted", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";
        process.env.MCP_HTTP_HOST = "127.0.0.1";

        loadConfig(tempDir).match(
          (config) => {
            expect(config.http.host).toBe("127.0.0.1");
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });
    });

    describe("config-loader.AC8: stdio transport hygiene (issue #49)", () => {
      // MCP servers communicate over stdio; any stray write to stdout (or any
      // stream that flushes through it, like console.log) corrupts the
      // JSON-RPC frame and crashes the client. dotenv 17+ prints an "◇
      // injected env" banner via console.log when it loads a .env file unless
      // told otherwise, so loadConfig must pass quiet: true.
      it("config-loader.AC8.1: loadConfig writes nothing to stdout when a .env file is present", () => {
        writeDotEnv(tempDir, {
          PAPRIKA_EMAIL: "user@test.com",
          PAPRIKA_PASSWORD: "secret",
        });

        const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        try {
          loadConfig(tempDir).match(
            () => {},
            (error) => {
              expect.fail(`Expected Ok but got Err: ${error.message}`);
            },
          );
          expect(consoleLogSpy).not.toHaveBeenCalled();
          expect(stdoutSpy).not.toHaveBeenCalled();
        } finally {
          stdoutSpy.mockRestore();
          consoleLogSpy.mockRestore();
        }
      });

      it("config-loader.AC8.2: loadConfig writes nothing to stdout when no .env file is present", () => {
        process.env.PAPRIKA_EMAIL = "user@test.com";
        process.env.PAPRIKA_PASSWORD = "secret";

        const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        try {
          loadConfig(tempDir).match(
            () => {},
            (error) => {
              expect.fail(`Expected Ok but got Err: ${error.message}`);
            },
          );
          expect(consoleLogSpy).not.toHaveBeenCalled();
          expect(stdoutSpy).not.toHaveBeenCalled();
        } finally {
          stdoutSpy.mockRestore();
          consoleLogSpy.mockRestore();
        }
      });
    });
  });
});
