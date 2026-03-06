import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Duration } from "luxon";
import { parseDuration, formatDuration, DurationParseError } from "./duration.js";

describe("Duration parsing and formatting", () => {
  describe("duration-helper.AC1: parseDuration handles human-readable strings", () => {
    it("duration-helper.AC1.1: parseDuration('15 min') returns Ok with Duration of 15 minutes", () => {
      const result = parseDuration("15 min");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.as("minutes")).toBe(15);
      }
    });

    it("duration-helper.AC1.2: parseDuration('1 hr 30 min') returns Ok with Duration of 90 minutes", () => {
      const result = parseDuration("1 hr 30 min");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.as("minutes")).toBe(90);
      }
    });

    it("duration-helper.AC1.3: parseDuration('45 minutes') returns Ok with Duration of 45 minutes", () => {
      const result = parseDuration("45 minutes");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.as("minutes")).toBe(45);
      }
    });

    it("duration-helper.AC1.4: parseDuration('1h30m') returns Ok with Duration of 90 minutes", () => {
      const result = parseDuration("1h30m");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.as("minutes")).toBe(90);
      }
    });
  });

  describe("duration-helper.AC2: parseDuration handles ISO 8601", () => {
    it("duration-helper.AC2.1: parseDuration('PT15M') returns Ok with Duration of 15 minutes", () => {
      const result = parseDuration("PT15M");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.as("minutes")).toBe(15);
      }
    });

    it("duration-helper.AC2.2: parseDuration('PT1H30M') returns Ok with Duration of 90 minutes", () => {
      const result = parseDuration("PT1H30M");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.as("minutes")).toBe(90);
      }
    });
  });

  describe("duration-helper.AC3: parseDuration handles colon format", () => {
    it("duration-helper.AC3.1: parseDuration('1:30') returns Ok with Duration of 90 minutes", () => {
      const result = parseDuration("1:30");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.as("minutes")).toBe(90);
      }
    });

    it("duration-helper.AC3.2: parseDuration('0:30') returns Ok with Duration of 30 minutes", () => {
      const result = parseDuration("0:30");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.as("minutes")).toBe(30);
      }
    });

    it("duration-helper.AC3.3: parseDuration('1:60') returns Err (minutes >= 60)", () => {
      const result = parseDuration("1:60");

      expect(result.isErr()).toBe(true);
    });
  });

  describe("duration-helper.AC4: parseDuration handles numeric input", () => {
    it("duration-helper.AC4.1: parseDuration(15) returns Ok with Duration of 15 minutes", () => {
      const result = parseDuration(15);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.as("minutes")).toBe(15);
      }
    });

    it("duration-helper.AC4.2: parseDuration('42') returns Ok with Duration of 42 minutes", () => {
      const result = parseDuration("42");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.as("minutes")).toBe(42);
      }
    });

    it("duration-helper.AC4.3: parseDuration(NaN) returns Err", () => {
      const result = parseDuration(NaN);

      expect(result.isErr()).toBe(true);
    });

    it("duration-helper.AC4.4: parseDuration(Infinity) returns Err", () => {
      const result = parseDuration(Infinity);

      expect(result.isErr()).toBe(true);
    });

    it("duration-helper.AC4.5: parseDuration(-5) returns Err (negative)", () => {
      const result = parseDuration(-5);

      expect(result.isErr()).toBe(true);
    });
  });

  describe("duration-helper.AC5: parseDuration rejects invalid input", () => {
    it("duration-helper.AC5.1: parseDuration('') returns Err", () => {
      const result = parseDuration("");

      expect(result.isErr()).toBe(true);
    });

    it("duration-helper.AC5.2: parseDuration('not a duration') returns Err", () => {
      const result = parseDuration("not a duration");

      expect(result.isErr()).toBe(true);
    });

    it("duration-helper.AC5.3: All Err results contain a DurationParseError with input and reason", () => {
      const testCases: Array<string | number> = ["", "not a duration", NaN, Infinity, -5, "1:60"];

      for (const testCase of testCases) {
        const result = parseDuration(testCase);
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          const error = result.error;
          expect(error).toBeInstanceOf(DurationParseError);
          expect(error.input).toBeDefined();
          expect(error.reason).toBeDefined();
          expect(typeof error.reason).toBe("string");
        }
      }
    });
  });

  describe("duration-helper.AC6: formatDuration produces compact output", () => {
    it("duration-helper.AC6.1: formatDuration with 1h30m returns '1 hr 30 min'", () => {
      const duration = Duration.fromObject({ hours: 1, minutes: 30 });
      const formatted = formatDuration(duration);

      expect(formatted).toBe("1 hr 30 min");
    });

    it("duration-helper.AC6.2: formatDuration with 45m returns '45 min'", () => {
      const duration = Duration.fromObject({ minutes: 45 });
      const formatted = formatDuration(duration);

      expect(formatted).toBe("45 min");
    });

    it("duration-helper.AC6.3: formatDuration with 2h returns '2 hr'", () => {
      const duration = Duration.fromObject({ hours: 2 });
      const formatted = formatDuration(duration);

      expect(formatted).toBe("2 hr");
    });

    it("duration-helper.AC6.4: formatDuration with invalid Duration returns ''", () => {
      const duration = Duration.invalid("test");
      const formatted = formatDuration(duration);

      expect(formatted).toBe("");
    });

    it("duration-helper.AC6.5: formatDuration with zero Duration returns ''", () => {
      const duration = Duration.fromObject({ minutes: 0 });
      const formatted = formatDuration(duration);

      expect(formatted).toBe("");
    });
  });

  describe("duration-helper.AC7: Module characteristics", () => {
    it("duration-helper.AC7.1: neverthrow is listed as a runtime dependency in package.json", () => {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const projectRoot = resolve(__dirname, "../../");
      const packageJsonPath = resolve(projectRoot, "package.json");
      const packageJsonContent = readFileSync(packageJsonPath, "utf-8");
      const parsed = JSON.parse(packageJsonContent);

      expect(parsed.dependencies).toBeDefined();
      expect(parsed.dependencies["neverthrow"]).toBeDefined();
      expect(typeof parsed.dependencies["neverthrow"]).toBe("string");
    });

    it("duration-helper.AC7.2: src/utils/duration.ts imports only from npm packages (leaf boundary)", () => {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const srcDir = __dirname.includes("/dist/") ? __dirname.replace("/dist/", "/src/") : __dirname;
      const sourceFilePath = resolve(srcDir, "duration.ts");
      const source = readFileSync(sourceFilePath, "utf-8");

      expect(source).not.toMatch(/from\s+["']\.\//);
      expect(source).not.toMatch(/from\s+["']\.\.\//);
    });
  });
});
