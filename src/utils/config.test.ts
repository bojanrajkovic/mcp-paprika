import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ConfigError } from "./config.js";

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
});
