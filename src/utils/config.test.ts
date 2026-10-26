import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  buildEnvOverrides,
  ConfigError,
  type EmbeddingConfig,
  loadConfig,
  paprikaConfigSchema,
  resolveImageGenConfig,
} from "./config.js";

/** The two required settings, for tests that only care about some other env var. */
const BASE_ENV = { PAPRIKA_EMAIL: "user@test.com", PAPRIKA_PASSWORD: "secret" } as const;

describe("Configuration loading", () => {
  describe("ConfigError", () => {
    it("ConfigError.validation() creates an Error with kind 'validation'", () => {
      const issues: z.core.$ZodIssue[] = [];
      const error = ConfigError.validation(issues);
      expect(error).toBeInstanceOf(Error);
      expect(error.kind).toBe("validation");
    });

    it("ConfigError.legacyConfigFile() names the file and where its settings go", () => {
      const error = ConfigError.legacyConfigFile("/cfg/mcp-paprika/config.json");
      expect(error.kind).toBe("migration");
      expect(error.reason).toContain("/cfg/mcp-paprika/config.json is no longer read");
      expect(error.reason).toContain("/cfg/mcp-paprika/.env");
    });

    it("ConfigError.renamedEnvVar() names both the old and the new variable", () => {
      const error = ConfigError.renamedEnvVar("MCP_HTTP_SHUTDOWN_DRAIN_MS", "MCP_HTTP_SHUTDOWN_DRAIN");
      expect(error.kind).toBe("migration");
      expect(error.reason).toBe(
        "MCP_HTTP_SHUTDOWN_DRAIN_MS was renamed to MCP_HTTP_SHUTDOWN_DRAIN. Set MCP_HTTP_SHUTDOWN_DRAIN instead.",
      );
    });
  });

  describe("Validation error formatting", () => {
    it("ConfigError.validation() produces human-readable formatted output", () => {
      const mockIssues: z.core.$ZodIssue[] = [
        {
          code: "invalid_type",
          expected: "string",
          path: ["paprika", "email"],
          message: "Invalid input: expected string, received undefined",
        },
      ];

      const error = ConfigError.validation(mockIssues);
      expect(error.reason).toContain("Configuration validation failed:");
      expect(error.reason).toContain("paprika.email");
      expect(error.reason).toContain("Invalid input: expected string, received undefined");
      expect(error.reason).toContain("(set via PAPRIKA_EMAIL)");
      expect(error.reason).toMatch(/^\s*-\s+paprika\.email/m);
    });

    it("ConfigError.validation() formats multiple issues", () => {
      const mockIssues: z.core.$ZodIssue[] = [
        {
          code: "invalid_type",
          expected: "string",
          path: ["paprika", "email"],
          message: "Invalid input: expected string, received undefined",
        },
        {
          code: "invalid_type",
          expected: "string",
          path: ["paprika", "password"],
          message: "Invalid input: expected string, received undefined",
        },
      ];

      const error = ConfigError.validation(mockIssues);
      expect(error.reason).toContain("paprika.email");
      expect(error.reason).toContain("paprika.password");
      expect(error.reason).toContain("PAPRIKA_EMAIL");
      expect(error.reason).toContain("PAPRIKA_PASSWORD");
    });

    it("ConfigError.validation() handles unknown paths without env var hints", () => {
      const mockIssues: z.core.$ZodIssue[] = [
        {
          code: "custom",
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

  describe("Duration field", () => {
    const validBase = { paprika: { email: "user@test.com", password: "secret" } };

    it("accepts '15m' string and resolves to 900000 ms", () => {
      const input = { ...validBase, sync: { interval: "15m" } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.interval).toBe(900000);
      }
    });

    it.each([
      ["1h30m", 5_400_000],
      ["500ms", 500],
      ["1.5h", 5_400_000],
      ["7d", 604_800_000],
      ["2m30s", 150_000],
      [".5h", 1_800_000],
      ["5.h", 18_000_000],
      ["1.1s", 1_100],
      ["1500μs", 2],
      ["1500µs", 2],
      ["24d", 2_073_600_000],
    ])("accepts Go-style %s", (text, ms) => {
      // pendingWriteTtl, not interval: the interval adds its own 1s minimum.
      const result = paprikaConfigSchema.safeParse({ ...validBase, sync: { pendingWriteTtl: text } });
      expect(result.success && result.data.sync.pendingWriteTtl).toBe(ms);
    });

    it("rejects a duration past Node's 24.8-day timer limit", () => {
      const result = paprikaConfigSchema.safeParse({ ...validBase, sync: { interval: "25d" } });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(ConfigError.validation(result.error.issues).reason).toContain("timer limit");
      }
    });

    it.each(["0", "500ms"])("rejects a sync interval under 1s (%s)", (text) => {
      const result = paprikaConfigSchema.safeParse({ ...validBase, sync: { interval: text } });
      expect(result.success).toBe(false);
    });

    it("accepts 0 where it means off (the pending-write TTL)", () => {
      const result = paprikaConfigSchema.safeParse({ ...validBase, sync: { pendingWriteTtl: "0" } });
      expect(result.success && result.data.sync.pendingWriteTtl).toBe(0);
    });

    it.each(["900", "PT15M", "1:30", "15 minutes", "abc", "", "-5m"])("rejects %j with a hint about units", (text) => {
      const result = paprikaConfigSchema.safeParse({ ...validBase, sync: { interval: text } });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(ConfigError.validation(result.error.issues).reason).toContain('like "15m", "1h30m"');
      }
    });

    it("accepts '60s' for pendingWriteTtl and resolves to 60000 ms", () => {
      const input = { ...validBase, sync: { pendingWriteTtl: "60s" } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.pendingWriteTtl).toBe(60000);
      }
    });

    it("default pendingWriteTtl is 60000 ms when no sync block provided", () => {
      const result = paprikaConfigSchema.safeParse(validBase);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.pendingWriteTtl).toBe(60000);
      }
    });

    it("recipeFetchConcurrency defaults to 5 when not provided (#174)", () => {
      const result = paprikaConfigSchema.safeParse(validBase);
      expect(result.success && result.data.sync.recipeFetchConcurrency).toBe(5);
    });

    it("recipeFetchConcurrency coerces a numeric string and accepts custom values (#174)", () => {
      const result = paprikaConfigSchema.safeParse({ ...validBase, sync: { recipeFetchConcurrency: "12" } });
      expect(result.success && result.data.sync.recipeFetchConcurrency).toBe(12);
    });

    it("recipeFetchConcurrency rejects non-positive / non-integer values", () => {
      expect(paprikaConfigSchema.safeParse({ ...validBase, sync: { recipeFetchConcurrency: 0 } }).success).toBe(false);
      expect(paprikaConfigSchema.safeParse({ ...validBase, sync: { recipeFetchConcurrency: -3 } }).success).toBe(false);
      expect(paprikaConfigSchema.safeParse({ ...validBase, sync: { recipeFetchConcurrency: 2.5 } }).success).toBe(
        false,
      );
    });
  });

  describe("Boolean field (PAPRIKA_SYNC_ENABLED)", () => {
    const validBase = { paprika: { email: "user@test.com", password: "secret" } };

    it("'true' string sets sync.enabled to true", () => {
      const input = { ...validBase, sync: { enabled: "true" } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.enabled).toBe(true);
      }
    });

    it("'false' string sets sync.enabled to false", () => {
      const input = { ...validBase, sync: { enabled: "false" } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.enabled).toBe(false);
      }
    });

    it("'1' string sets sync.enabled to true", () => {
      const input = { ...validBase, sync: { enabled: "1" } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.enabled).toBe(true);
      }
    });

    it("'0' string sets sync.enabled to false", () => {
      const input = { ...validBase, sync: { enabled: "0" } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.enabled).toBe(false);
      }
    });

    it("'yes' string produces validation error", () => {
      const input = { ...validBase, sync: { enabled: "yes" } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("Defaults", () => {
    const validBase = { paprika: { email: "user@test.com", password: "secret" } };

    it("default sync.enabled is true when no sync block provided", () => {
      const result = paprikaConfigSchema.safeParse(validBase);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.enabled).toBe(true);
      }
    });

    it("default sync.interval is 900000 ms when no sync block provided", () => {
      const result = paprikaConfigSchema.safeParse(validBase);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sync.interval).toBe(900000);
      }
    });

    it("features is undefined when no features block provided", () => {
      const result = paprikaConfigSchema.safeParse(validBase);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.features).toBeUndefined();
      }
    });
  });

  describe("Validation errors", () => {
    it("missing email produces validation error with PAPRIKA_EMAIL hint", () => {
      const result = paprikaConfigSchema.safeParse({ paprika: {} });
      expect(result.success).toBe(false);
      if (!result.success) {
        const error = ConfigError.validation(result.error.issues);
        expect(error.reason).toContain("PAPRIKA_EMAIL");
      }
    });

    it("entirely absent paprika produces env var hints", () => {
      const result = paprikaConfigSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        const error = ConfigError.validation(result.error.issues);
        expect(error.reason).toContain("PAPRIKA_EMAIL");
        expect(error.reason).toContain("PAPRIKA_PASSWORD");
      }
    });

    it("missing password produces validation error with PAPRIKA_PASSWORD hint", () => {
      const result = paprikaConfigSchema.safeParse({ paprika: {} });
      expect(result.success).toBe(false);
      if (!result.success) {
        const error = ConfigError.validation(result.error.issues);
        expect(error.reason).toContain("PAPRIKA_PASSWORD");
      }
    });

    it("empty string email fails validation", () => {
      const input = {
        paprika: { email: "", password: "secret" },
      };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("Type exports", () => {
    const validBase = { paprika: { email: "user@test.com", password: "secret" } };

    it("PaprikaConfig has paprika, sync, and optional features fields", () => {
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

    it("EmbeddingConfig has required apiKey, baseUrl, model string fields", () => {
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
      "MCP_OAUTH_REDIRECT_ALLOWLIST",
      "MCP_TRUST_PROXY",
      "MCP_CLIENT_IP_HEADER",
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
      rmSync(tempDir, { recursive: true, force: true });
    });

    describe("Allowlist validation", () => {
      it("rejects HTTP transport with both MCP_ALLOWED_EMAILS and MCP_ALLOWED_SUBS empty", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "https://m.example.com";
        process.env["MCP_OIDC_PRESET"] = "google";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = "";
        process.env["MCP_ALLOWED_SUBS"] = "";

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
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "https://m.example.com";
        process.env["MCP_OIDC_PRESET"] = "google";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = "alice@example.com";

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

    describe("redirect-origin allowlist (#147)", () => {
      it("defaults redirectAllowlist to [] when MCP_OAUTH_REDIRECT_ALLOWLIST is unset", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "https://m.example.com";
        process.env["MCP_OIDC_PRESET"] = "google";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = "alice@example.com";

        loadConfig(tempDir).match(
          (config) => expect(config.oauth?.redirectAllowlist).toEqual([]),
          (error) => expect.fail(`Expected Ok but got Err: ${error.reason}`),
        );
      });

      it("parses MCP_OAUTH_REDIRECT_ALLOWLIST as a trimmed comma-separated list", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "https://m.example.com";
        process.env["MCP_OIDC_PRESET"] = "google";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = "alice@example.com";
        process.env["MCP_OAUTH_REDIRECT_ALLOWLIST"] = "https://claude.ai, https://claude.com";

        loadConfig(tempDir).match(
          (config) => expect(config.oauth?.redirectAllowlist).toEqual(["https://claude.ai", "https://claude.com"]),
          (error) => expect.fail(`Expected Ok but got Err: ${error.reason}`),
        );
      });
    });

    describe("Public URL requirement", () => {
      it("rejects HTTP transport without MCP_PUBLIC_URL", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_OIDC_PRESET"] = "google";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = "alice@example.com";

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

    describe("HTTPS requirement", () => {
      it("rejects HTTP transport with http:// URL", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "http://mcp.example.com";
        process.env["MCP_OIDC_PRESET"] = "google";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = "alice@example.com";

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

      it("strips trailing slash from MCP_PUBLIC_URL once at load (so /oauth/callback doesn't become //oauth/callback)", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "https://mcp.example.com/";
        process.env["MCP_OIDC_PRESET"] = "google";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = "alice@example.com";

        const result = loadConfig(tempDir);
        result.match(
          (config) => {
            expect(config.oauth?.publicUrl).toBe("https://mcp.example.com");
          },
          (error) => {
            expect.fail(`Expected Ok but got Err: ${error.reason}`);
          },
        );
      });

      it("accepts substring trick (https://evil/?fake=http://x) as HTTPS", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "https://evil/?fake=http://x";
        process.env["MCP_OIDC_PRESET"] = "google";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = "alice@example.com";

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
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "https://m.example.com";
        process.env["MCP_OIDC_PRESET"] = "google";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = "a@x, b@x ,c@x";

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

      it("MCP_TRUST_PROXY defaults to false and parses 'true'/'false' string envs", () => {
        // Default: not set → false.
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "https://m.example.com";
        process.env["MCP_OIDC_PRESET"] = "google";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = "alice@example.com";

        loadConfig(tempDir).match(
          (config) => expect(config.oauth?.trustProxy).toBe(false),
          (error) => expect.fail(`expected Ok, got Err: ${error.reason}`),
        );

        // Explicit "true" → true.
        process.env["MCP_TRUST_PROXY"] = "true";
        loadConfig(tempDir).match(
          (config) => expect(config.oauth?.trustProxy).toBe(true),
          (error) => expect.fail(`expected Ok, got Err: ${error.reason}`),
        );

        // Explicit "false" → false.
        process.env["MCP_TRUST_PROXY"] = "false";
        loadConfig(tempDir).match(
          (config) => expect(config.oauth?.trustProxy).toBe(false),
          (error) => expect.fail(`expected Ok, got Err: ${error.reason}`),
        );
      });

      describe("MCP_CLIENT_IP_HEADER", () => {
        beforeEach(() => {
          process.env["PAPRIKA_EMAIL"] = "user@test.com";
          process.env["PAPRIKA_PASSWORD"] = "secret";
          process.env["MCP_TRANSPORT"] = "http";
          process.env["MCP_PUBLIC_URL"] = "https://m.example.com";
          process.env["MCP_OIDC_PRESET"] = "google";
          process.env["MCP_OIDC_CLIENT_ID"] = "client123";
          process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
          process.env["MCP_ALLOWED_EMAILS"] = "alice@example.com";
        });

        it("is lowercased when set alongside MCP_TRUST_PROXY", () => {
          process.env["MCP_TRUST_PROXY"] = "true";
          process.env["MCP_CLIENT_IP_HEADER"] = "CF-Connecting-IP";
          loadConfig(tempDir).match(
            (config) => expect(config.oauth?.clientIpHeader).toBe("cf-connecting-ip"),
            (error) => expect.fail(`expected Ok, got Err: ${error.reason}`),
          );
        });

        it("is rejected without MCP_TRUST_PROXY=true", () => {
          process.env["MCP_CLIENT_IP_HEADER"] = "cf-connecting-ip";
          loadConfig(tempDir).match(
            () => expect.fail("expected Err"),
            (error) => expect(error.reason).toContain("MCP_CLIENT_IP_HEADER needs MCP_TRUST_PROXY=true"),
          );
        });

        it("accepts any RFC 7230 header-name character, e.g. an underscore", () => {
          process.env["MCP_TRUST_PROXY"] = "true";
          process.env["MCP_CLIENT_IP_HEADER"] = "X_Real_IP";
          loadConfig(tempDir).match(
            (config) => expect(config.oauth?.clientIpHeader).toBe("x_real_ip"),
            (error) => expect.fail(`expected Ok, got Err: ${error.reason}`),
          );
        });

        it("treats an empty value as unset, even without MCP_TRUST_PROXY", () => {
          process.env["MCP_CLIENT_IP_HEADER"] = "";
          loadConfig(tempDir).match(
            (config) => expect(config.oauth?.clientIpHeader).toBeUndefined(),
            (error) => expect.fail(`expected Ok, got Err: ${error.reason}`),
          );
        });

        it("is rejected when it isn't a header name", () => {
          process.env["MCP_TRUST_PROXY"] = "true";
          process.env["MCP_CLIENT_IP_HEADER"] = "x-forwarded-for, cf-connecting-ip";
          loadConfig(tempDir).match(
            () => expect.fail("expected Err"),
            (error) => expect(error.reason).toContain("must be an HTTP header name"),
          );
        });
      });

      it("filters empty entries from comma-separated values", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "https://m.example.com";
        process.env["MCP_OIDC_PRESET"] = "google";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = ",,";

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
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "stdio";

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
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "stdio";
        process.env["MCP_PUBLIC_URL"] = "http://m.example.com";
        process.env["MCP_OIDC_PRESET"] = "google";

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
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "https://m.example.com";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = "alice@example.com";

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
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "https://m.example.com";
        process.env["MCP_OIDC_DISCOVERY_URL"] = "https://issuer.example.com/.well-known/openid-configuration";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = "alice@example.com";

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
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "https://m.example.com";
        process.env["MCP_OIDC_PRESET"] = "google";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = "alice@example.com";

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
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "https://m.example.com";
        process.env["MCP_OIDC_PRESET"] = "google";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_ALLOWED_EMAILS"] = "alice@example.com";

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

    describe("superRefine full fan-out when oauth is undefined", () => {
      it("produces 4 distinct validation issues when transport=http with no oauth block", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        // Note: no oauth-related env vars set

        const result = loadConfig(tempDir);
        result.match(
          () => {
            expect.fail("Expected Err but got Ok");
          },
          (error) => {
            expect(error.kind).toBe("validation");
            // Should have 4 distinct issues:
            // 1. Missing publicUrl
            // 2. Missing allowlist (empty emails and subs)
            // 3. Missing preset or discoveryUrl
            // 4. Missing clientId or clientSecret
            const reason = error.reason;
            expect(reason).toContain("MCP_PUBLIC_URL");
            expect(reason).toContain("MCP_ALLOWED_EMAILS");
            expect(reason).toContain("MCP_ALLOWED_SUBS");
            expect(reason).toContain("MCP_OIDC_PRESET");
            expect(reason).toContain("MCP_OIDC_DISCOVERY_URL");
            expect(reason).toContain("MCP_OIDC_CLIENT_ID");
            expect(reason).toContain("MCP_OIDC_CLIENT_SECRET");
            // Count the number of distinct issues in the error message
            // Should have lines starting with "  - " for each issue
            const issueCount = (reason.match(/  - /g) || []).length;
            expect(issueCount).toBe(4);
          },
        );
      });
    });

    describe("Happy path", () => {
      it("accepts valid HTTP OAuth config with all required env vars", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "https://mcp.example.com";
        process.env["MCP_OIDC_PRESET"] = "google";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = "alice@example.com,bob@example.com";

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

  describe("loadConfig integration", () => {
    // Shared test infrastructure
    const CONFIG_ENV_VARS = [
      "PAPRIKA_EMAIL",
      "PAPRIKA_PASSWORD",
      "PAPRIKA_SYNC_INTERVAL",
      "PAPRIKA_SYNC_ENABLED",
      "PAPRIKA_SYNC_PENDING_WRITE_TTL",
      "MCP_TRANSPORT",
      "MCP_HTTP_PORT",
      "MCP_HTTP_HOST",
      "MCP_ALLOWED_HOSTS",
      "MCP_ALLOWED_ORIGINS",
      "MCP_HTTP_SHUTDOWN_DRAIN",
      "MCP_HTTP_SHUTDOWN_DRAIN_MS",
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
      rmSync(tempDir, { recursive: true, force: true });
    });

    // Shared helpers

    function writeDotEnv(dir: string, vars: Record<string, string>): void {
      const content = Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
      writeFileSync(join(dir, ".env"), content);
    }

    describe("loadConfig returns valid PaprikaConfig", () => {
      it("loadConfig returns ok with PaprikaConfig when env vars are set", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";

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

      it("loadConfig returns ok with PaprikaConfig when the config dir's .env provides credentials", () => {
        writeDotEnv(tempDir, { PAPRIKA_EMAIL: "user@test.com", PAPRIKA_PASSWORD: "secret" });

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

    describe("Source priority chain", () => {
      it("real env vars override .env file values", () => {
        writeDotEnv(tempDir, {
          PAPRIKA_EMAIL: "dotenv@test.com",
          PAPRIKA_PASSWORD: "dotenvpw",
        });
        process.env["PAPRIKA_EMAIL"] = "real@test.com";

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

      it("Zod defaults apply when no source provides a value", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";

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

    describe("File handling", () => {
      it("missing .env file does not cause an error", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";

        loadConfig(tempDir).match(
          () => {},
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });

      it("a config.json in the config dir fails with a migration error, even when env vars are complete", () => {
        writeFileSync(join(tempDir, "config.json"), JSON.stringify({ paprika: { email: "file@test.com" } }));
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";

        loadConfig(tempDir).match(
          () => {
            expect.fail("Expected Err but got Ok");
          },
          (error) => {
            expect(error.kind).toBe("migration");
            expect(error.reason).toContain(join(tempDir, "config.json"));
          },
        );
      });

      it("the old MCP_HTTP_SHUTDOWN_DRAIN_MS name in the config dir's .env also fails with a migration error", () => {
        writeDotEnv(tempDir, { ...BASE_ENV, MCP_HTTP_SHUTDOWN_DRAIN_MS: "5000" });

        loadConfig(tempDir).match(
          () => {
            expect.fail("Expected Err but got Ok");
          },
          (error) => {
            expect(error.kind).toBe("migration");
            expect(error.reason).toContain("MCP_HTTP_SHUTDOWN_DRAIN instead");
          },
        );
      });

      it("the old MCP_HTTP_SHUTDOWN_DRAIN_MS name fails with a migration error naming the new one", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_HTTP_SHUTDOWN_DRAIN_MS"] = "5000";

        loadConfig(tempDir).match(
          () => {
            expect.fail("Expected Err but got Ok");
          },
          (error) => {
            expect(error.kind).toBe("migration");
            expect(error.reason).toContain("MCP_HTTP_SHUTDOWN_DRAIN");
          },
        );
      });
    });

    describe("transport + HTTP config", () => {
      it("defaults — transport is 'stdio', http.port is 3000, http.host is '0.0.0.0'", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";

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

      it("MCP_TRANSPORT=http sets transport", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "http";
        process.env["MCP_PUBLIC_URL"] = "https://mcp.example.com";
        process.env["MCP_OIDC_PRESET"] = "google";
        process.env["MCP_OIDC_CLIENT_ID"] = "client123";
        process.env["MCP_OIDC_CLIENT_SECRET"] = "secret456";
        process.env["MCP_ALLOWED_EMAILS"] = "alice@example.com";

        loadConfig(tempDir).match(
          (config) => {
            expect(config.transport).toBe("http");
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });

      it("MCP_TRANSPORT=foo is rejected by validation", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_TRANSPORT"] = "foo";

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

      it("MCP_HTTP_PORT='8080' string is coerced to number", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_HTTP_PORT"] = "8080";

        loadConfig(tempDir).match(
          (config) => {
            expect(config.http.port).toBe(8080);
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });

      it("MCP_HTTP_PORT='0' is rejected (below min 1)", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_HTTP_PORT"] = "0";

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

      it("MCP_HTTP_PORT='70000' is rejected (above max 65535)", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_HTTP_PORT"] = "70000";

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

      it("MCP_HTTP_HOST='127.0.0.1' is accepted", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_HTTP_HOST"] = "127.0.0.1";

        loadConfig(tempDir).match(
          (config) => {
            expect(config.http.host).toBe("127.0.0.1");
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });

      it("http.allowedHosts and http.allowedOrigins default to empty arrays", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";

        loadConfig(tempDir).match(
          (config) => {
            expect(config.http.allowedHosts).toEqual([]);
            expect(config.http.allowedOrigins).toEqual([]);
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });

      it("MCP_ALLOWED_HOSTS splits and trims comma-separated values", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_ALLOWED_HOSTS"] = "mcp.example.com, mcp.internal:3000 ,localhost";

        loadConfig(tempDir).match(
          (config) => {
            expect(config.http.allowedHosts).toEqual(["mcp.example.com", "mcp.internal:3000", "localhost"]);
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });

      it("MCP_ALLOWED_ORIGINS splits and trims comma-separated values", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";
        process.env["MCP_ALLOWED_ORIGINS"] = "https://app.example.com,https://other.example.com";

        loadConfig(tempDir).match(
          (config) => {
            expect(config.http.allowedOrigins).toEqual(["https://app.example.com", "https://other.example.com"]);
          },
          (err) => {
            expect.fail(`Expected Ok but got Err: ${err.message}`);
          },
        );
      });
    });

    describe("stdio transport hygiene (issue #49)", () => {
      // MCP servers communicate over stdio; any stray write to stdout (or any
      // stream that flushes through it, like console.log) corrupts the
      // JSON-RPC frame and crashes the client. dotenv 17+ prints an "◇
      // injected env" banner via console.log when it loads a .env file unless
      // told otherwise, so loadConfig must pass quiet: true.
      it("loadConfig writes nothing to stdout when a .env file is present", () => {
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

      it("loadConfig writes nothing to stdout when no .env file is present", () => {
        process.env["PAPRIKA_EMAIL"] = "user@test.com";
        process.env["PAPRIKA_PASSWORD"] = "secret";

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

  describe("logging block schema and env var routing", () => {
    const validBase = { paprika: { email: "user@test.com", password: "secret" } };

    describe("schema rejects invalid logging.level", () => {
      it("rejects logging.level='info-ish' with a validation error", () => {
        const input = { ...validBase, logging: { level: "info-ish" } };
        const result = paprikaConfigSchema.safeParse(input);
        expect(result.success).toBe(false);
        if (!result.success) {
          const error = ConfigError.validation(result.error.issues);
          expect(error.kind).toBe("validation");
          // Should mention the offending path
          expect(error.reason).toContain("logging.level");
        }
      });

      it("rejects logging.notifyLevel='silent' (silent is not a valid pino level here)", () => {
        const input = { ...validBase, logging: { notifyLevel: "silent" } };
        const result = paprikaConfigSchema.safeParse(input);
        expect(result.success).toBe(false);
      });
    });

    describe("logging block defaults", () => {
      it("defaults level to 'info' when no logging block provided", () => {
        const result = paprikaConfigSchema.safeParse(validBase);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.logging.level).toBe("info");
        }
      });

      it("defaults notifyLevel to 'warn' when no logging block provided", () => {
        const result = paprikaConfigSchema.safeParse(validBase);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.logging.notifyLevel).toBe("warn");
        }
      });

      it("defaults pretty to 'auto' when no logging block provided", () => {
        const result = paprikaConfigSchema.safeParse(validBase);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.logging.pretty).toBe("auto");
        }
      });

      it("defaults file to undefined when no logging block provided", () => {
        const result = paprikaConfigSchema.safeParse(validBase);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.logging.file).toBeUndefined();
        }
      });

      it("accepts all valid pino levels for logging.level", () => {
        const validLevels = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
        for (const level of validLevels) {
          const result = paprikaConfigSchema.safeParse({ ...validBase, logging: { level } });
          expect(result.success).toBe(true);
        }
      });

      it("accepts pretty=true and pretty=false as boolean overrides", () => {
        const resultTrue = paprikaConfigSchema.safeParse({ ...validBase, logging: { pretty: true } });
        expect(resultTrue.success).toBe(true);
        if (resultTrue.success) expect(resultTrue.data.logging.pretty).toBe(true);

        const resultFalse = paprikaConfigSchema.safeParse({ ...validBase, logging: { pretty: false } });
        expect(resultFalse.success).toBe(true);
        if (resultFalse.success) expect(resultFalse.data.logging.pretty).toBe(false);
      });

      it("accepts a file path override", () => {
        const result = paprikaConfigSchema.safeParse({ ...validBase, logging: { file: "/tmp/test.log" } });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.logging.file).toBe("/tmp/test.log");
        }
      });
    });

    describe("MCP_LOG_* env var routing", () => {
      it("MCP_LOG_LEVEL=debug routes to logging.level", () => {
        const merged = buildEnvOverrides({ ...BASE_ENV, MCP_LOG_LEVEL: "debug" });
        const result = paprikaConfigSchema.safeParse(merged);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.logging.level).toBe("debug");
        }
      });

      it("MCP_LOG_NOTIFY_LEVEL=info routes to logging.notifyLevel", () => {
        const merged = buildEnvOverrides({ ...BASE_ENV, MCP_LOG_NOTIFY_LEVEL: "info" });
        const result = paprikaConfigSchema.safeParse(merged);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.logging.notifyLevel).toBe("info");
        }
      });

      it("MCP_LOG_FILE=/tmp/x.log routes to logging.file", () => {
        const merged = buildEnvOverrides({ ...BASE_ENV, MCP_LOG_FILE: "/tmp/x.log" });
        const result = paprikaConfigSchema.safeParse(merged);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.logging.file).toBe("/tmp/x.log");
        }
      });

      it("MCP_LOG_PRETTY=true coerces to boolean true", () => {
        const merged = buildEnvOverrides({ ...BASE_ENV, MCP_LOG_PRETTY: "true" });
        const result = paprikaConfigSchema.safeParse(merged);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.logging.pretty).toBe(true);
        }
      });

      it("MCP_LOG_PRETTY=false coerces to boolean false", () => {
        const merged = buildEnvOverrides({ ...BASE_ENV, MCP_LOG_PRETTY: "false" });
        const result = paprikaConfigSchema.safeParse(merged);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.logging.pretty).toBe(false);
        }
      });

      it("MCP_LOG_PRETTY=1 coerces to boolean true", () => {
        const merged = buildEnvOverrides({ ...BASE_ENV, MCP_LOG_PRETTY: "1" });
        const result = paprikaConfigSchema.safeParse(merged);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.logging.pretty).toBe(true);
        }
      });

      it("MCP_LOG_PRETTY=0 coerces to boolean false", () => {
        const merged = buildEnvOverrides({ ...BASE_ENV, MCP_LOG_PRETTY: "0" });
        const result = paprikaConfigSchema.safeParse(merged);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.logging.pretty).toBe(false);
        }
      });

      it("MCP_LOG_PRETTY=auto passes through as the literal 'auto'", () => {
        const merged = buildEnvOverrides({ ...BASE_ENV, MCP_LOG_PRETTY: "auto" });
        const result = paprikaConfigSchema.safeParse(merged);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.logging.pretty).toBe("auto");
        }
      });

      it("MCP_LOG_PRETTY with a typo is rejected by schema validation (not silently coerced)", () => {
        // Regression test for a Codex finding: previously the env coercion
        // mapped every non-recognised value to `false`, so typos like "treu"
        // silently disabled pretty logging instead of surfacing the error.
        const merged = buildEnvOverrides({ ...BASE_ENV, MCP_LOG_PRETTY: "treu" });
        const result = paprikaConfigSchema.safeParse(merged);
        expect(result.success).toBe(false);
        if (!result.success) {
          const offending = result.error.issues.find((i) => i.path.includes("pretty"));
          expect(offending).toBeDefined();
        }
      });

      it("empty MCP_LOG_LEVEL is ignored (treated as not set)", () => {
        const merged = buildEnvOverrides({ ...BASE_ENV, MCP_LOG_LEVEL: "" });
        const result = paprikaConfigSchema.safeParse(merged);
        expect(result.success).toBe(true);
        if (result.success) {
          // Should fall back to schema default
          expect(result.data.logging.level).toBe("info");
        }
      });

      it("invalid MCP_LOG_LEVEL value causes loadConfig to return a validation ConfigError", () => {
        const merged = buildEnvOverrides({ ...BASE_ENV, MCP_LOG_LEVEL: "info-ish" });
        const result = paprikaConfigSchema.safeParse(merged);
        expect(result.success).toBe(false);
        if (!result.success) {
          const error = ConfigError.validation(result.error.issues);
          expect(error.kind).toBe("validation");
          expect(error.reason).toContain("logging.level");
        }
      });
    });
  });

  describe("features.imageGen config", () => {
    const validBase = { paprika: { email: "user@test.com", password: "secret" } };
    const embeddings = { apiKey: "emb-key", baseUrl: "https://openrouter.ai/api/v1", model: "text-embedding-3-large" };

    it("imageGen absent → resolveImageGenConfig returns null", () => {
      const result = paprikaConfigSchema.safeParse(validBase);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.features?.imageGen).toBeUndefined();
        expect(resolveImageGenConfig(result.data)).toBeNull();
      }
    });

    it("dedicated apiKey only → resolves with default OpenRouter baseUrl", () => {
      const input = { ...validBase, features: { imageGen: { apiKey: "img-key" } } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(resolveImageGenConfig(result.data)).toEqual({
          apiKey: "img-key",
          baseUrl: "https://openrouter.ai/api/v1",
        });
      }
    });

    it("dedicated apiKey + baseUrl → resolves with the custom baseUrl", () => {
      const input = { ...validBase, features: { imageGen: { apiKey: "img-key", baseUrl: "https://example.com/v1" } } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(resolveImageGenConfig(result.data)).toEqual({
          apiKey: "img-key",
          baseUrl: "https://example.com/v1",
        });
      }
    });

    it("reuseEmbeddingsCreds=true with embeddings → resolves to embeddings creds", () => {
      const input = { ...validBase, features: { embeddings, imageGen: { reuseEmbeddingsCreds: true } } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(resolveImageGenConfig(result.data)).toEqual({
          apiKey: "emb-key",
          baseUrl: "https://openrouter.ai/api/v1",
        });
      }
    });

    it("reuseEmbeddingsCreds=true WITHOUT embeddings → validation error (hints embeddings)", () => {
      const input = { ...validBase, features: { imageGen: { reuseEmbeddingsCreds: true } } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(ConfigError.validation(result.error.issues).reason).toContain("features.embeddings");
      }
    });

    it("empty imageGen block (neither key nor reuse) → validation error with IMAGE_GEN_API_KEY hint", () => {
      const input = { ...validBase, features: { imageGen: {} } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(ConfigError.validation(result.error.issues).reason).toContain("IMAGE_GEN_API_KEY");
      }
    });

    it("both apiKey and reuseEmbeddingsCreds → validation error (mutually exclusive)", () => {
      const input = { ...validBase, features: { embeddings, imageGen: { apiKey: "k", reuseEmbeddingsCreds: true } } };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(ConfigError.validation(result.error.issues).reason).toContain("not both");
      }
    });

    it("baseUrl + reuseEmbeddingsCreds → validation error (baseUrl would be silently ignored)", () => {
      const input = {
        ...validBase,
        features: { embeddings, imageGen: { reuseEmbeddingsCreds: true, baseUrl: "https://openrouter.ai/api/v1" } },
      };
      const result = paprikaConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(ConfigError.validation(result.error.issues).reason).toContain("IMAGE_GEN_BASE_URL is ignored");
      }
    });

    it("env routing: IMAGE_GEN_* vars populate features.imageGen", () => {
      const merged = buildEnvOverrides({
        ...BASE_ENV,
        IMAGE_GEN_API_KEY: "env-img-key",
        IMAGE_GEN_BASE_URL: "https://env.example/v1",
        IMAGE_GEN_REUSE_EMBEDDINGS_CREDS: "false",
      });
      const result = paprikaConfigSchema.safeParse(merged);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(resolveImageGenConfig(result.data)).toEqual({
          apiKey: "env-img-key",
          baseUrl: "https://env.example/v1",
        });
      }
    });

    it("env routing: IMAGE_GEN_REUSE_EMBEDDINGS_CREDS=true coerces to boolean and reuses", () => {
      const merged = buildEnvOverrides({
        ...BASE_ENV,
        OPENAI_API_KEY: "emb-key",
        OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
        EMBEDDING_MODEL: "text-embedding-3-large",
        IMAGE_GEN_REUSE_EMBEDDINGS_CREDS: "true",
      });
      const result = paprikaConfigSchema.safeParse(merged);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(resolveImageGenConfig(result.data)).toEqual({
          apiKey: "emb-key",
          baseUrl: "https://openrouter.ai/api/v1",
        });
      }
    });
  });
});
