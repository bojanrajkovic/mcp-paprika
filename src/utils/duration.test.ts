import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Duration } from "luxon";
import { describe, expect, it } from "vitest";

import { DurationParseError, formatDuration, parseDuration } from "./duration.js";

describe("Duration parsing and formatting", () => {
  describe("parseDuration handles human-readable strings", () => {
    it("parseDuration('15 min') returns Ok with Duration of 15 minutes", () => {
      parseDuration("15 min").match(
        (duration) => {
          expect(duration.as("minutes")).toBe(15);
        },
        () => {
          expect.fail("Expected Ok but got Err");
        },
      );
    });

    it("parseDuration('1 hr 30 min') returns Ok with Duration of 90 minutes", () => {
      parseDuration("1 hr 30 min").match(
        (duration) => {
          expect(duration.as("minutes")).toBe(90);
        },
        () => {
          expect.fail("Expected Ok but got Err");
        },
      );
    });

    it("parseDuration('5+ hours') reads as 5 hours, not 5ms (#162)", () => {
      // parse-duration reads a number with a detached "+" as bare milliseconds
      // ("5" → 5ms); the normalizer strips the "+" so "5+ hours" → 5 hours.
      parseDuration("5+ hours").match(
        (duration) => {
          expect(duration.as("minutes")).toBe(300);
        },
        () => {
          expect.fail("Expected Ok but got Err");
        },
      );
    });

    it("parseDuration('45 minutes') returns Ok with Duration of 45 minutes", () => {
      parseDuration("45 minutes").match(
        (duration) => {
          expect(duration.as("minutes")).toBe(45);
        },
        () => {
          expect.fail("Expected Ok but got Err");
        },
      );
    });

    it("parseDuration('1h30m') returns Ok with Duration of 90 minutes", () => {
      parseDuration("1h30m").match(
        (duration) => {
          expect(duration.as("minutes")).toBe(90);
        },
        () => {
          expect.fail("Expected Ok but got Err");
        },
      );
    });
  });

  describe("parseDuration handles ISO 8601", () => {
    it("parseDuration('PT15M') returns Ok with Duration of 15 minutes", () => {
      parseDuration("PT15M").match(
        (duration) => {
          expect(duration.as("minutes")).toBe(15);
        },
        () => {
          expect.fail("Expected Ok but got Err");
        },
      );
    });

    it("parseDuration('PT1H30M') returns Ok with Duration of 90 minutes", () => {
      parseDuration("PT1H30M").match(
        (duration) => {
          expect(duration.as("minutes")).toBe(90);
        },
        () => {
          expect.fail("Expected Ok but got Err");
        },
      );
    });
  });

  describe("parseDuration handles colon format", () => {
    it("parseDuration('1:30') returns Ok with Duration of 90 minutes", () => {
      parseDuration("1:30").match(
        (duration) => {
          expect(duration.as("minutes")).toBe(90);
        },
        () => {
          expect.fail("Expected Ok but got Err");
        },
      );
    });

    it("parseDuration('0:30') returns Ok with Duration of 30 minutes", () => {
      parseDuration("0:30").match(
        (duration) => {
          expect(duration.as("minutes")).toBe(30);
        },
        () => {
          expect.fail("Expected Ok but got Err");
        },
      );
    });

    it("parseDuration('1:60') returns Err (minutes >= 60)", () => {
      parseDuration("1:60").match(
        () => {
          expect.fail("Expected Err but got Ok");
        },
        () => {},
      );
    });
  });

  describe("parseDuration handles numeric input", () => {
    it("parseDuration(15) returns Ok with Duration of 15 minutes", () => {
      parseDuration(15).match(
        (duration) => {
          expect(duration.as("minutes")).toBe(15);
        },
        () => {
          expect.fail("Expected Ok but got Err");
        },
      );
    });

    it("parseDuration('42') returns Ok with Duration of 42 minutes", () => {
      parseDuration("42").match(
        (duration) => {
          expect(duration.as("minutes")).toBe(42);
        },
        () => {
          expect.fail("Expected Ok but got Err");
        },
      );
    });

    it("parseDuration(NaN) returns Err", () => {
      parseDuration(NaN).match(
        () => {
          expect.fail("Expected Err but got Ok");
        },
        () => {},
      );
    });

    it("parseDuration(Infinity) returns Err", () => {
      parseDuration(Infinity).match(
        () => {
          expect.fail("Expected Err but got Ok");
        },
        () => {},
      );
    });

    it("parseDuration(-5) returns Err (negative)", () => {
      parseDuration(-5).match(
        () => {
          expect.fail("Expected Err but got Ok");
        },
        () => {},
      );
    });
  });

  describe("parseDuration rejects invalid input", () => {
    it("parseDuration('') returns Err", () => {
      parseDuration("").match(
        () => {
          expect.fail("Expected Err but got Ok");
        },
        () => {},
      );
    });

    it("parseDuration('not a duration') returns Err", () => {
      parseDuration("not a duration").match(
        () => {
          expect.fail("Expected Err but got Ok");
        },
        () => {},
      );
    });

    it("all Err results contain a DurationParseError with input and reason", () => {
      const testCases: Array<string | number> = ["", "not a duration", NaN, Infinity, -5, "1:60"];

      for (const testCase of testCases) {
        parseDuration(testCase).match(
          () => {
            expect.fail(`Expected Err for input ${String(testCase)} but got Ok`);
          },
          (error) => {
            expect(error).toBeInstanceOf(DurationParseError);
            expect(error.input).toBeDefined();
            expect(error.reason).toBeDefined();
            expect(typeof error.reason).toBe("string");
          },
        );
      }
    });
  });

  describe("formatDuration produces compact output", () => {
    it("formatDuration with 1h30m returns '1 hr 30 min'", () => {
      const duration = Duration.fromObject({ hours: 1, minutes: 30 });
      const formatted = formatDuration(duration);

      expect(formatted).toBe("1 hr 30 min");
    });

    it("formatDuration with 45m returns '45 min'", () => {
      const duration = Duration.fromObject({ minutes: 45 });
      const formatted = formatDuration(duration);

      expect(formatted).toBe("45 min");
    });

    it("formatDuration with 2h returns '2 hr'", () => {
      const duration = Duration.fromObject({ hours: 2 });
      const formatted = formatDuration(duration);

      expect(formatted).toBe("2 hr");
    });

    it("formatDuration with invalid Duration returns ''", () => {
      const duration = Duration.invalid("test");
      const formatted = formatDuration(duration);

      expect(formatted).toBe("");
    });

    it("formatDuration with zero Duration returns ''", () => {
      const duration = Duration.fromObject({ minutes: 0 });
      const formatted = formatDuration(duration);

      expect(formatted).toBe("");
    });
  });

  describe("Module characteristics", () => {
    it("neverthrow is listed as a runtime dependency in package.json", () => {
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

    it("src/utils/duration.ts imports only from npm packages (leaf boundary)", () => {
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
