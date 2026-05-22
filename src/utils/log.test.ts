import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Level as PinoLevel } from "pino";
import { pinoLevelToMcp } from "./log.js";

// ---------------------------------------------------------------------------
// Task 4 — internal types, level mapper, and redact-path constants
// ---------------------------------------------------------------------------

describe("pinoLevelToMcp", () => {
  describe("structured-logging.AC2.4: level mapping", () => {
    it("maps trace to debug", () => {
      expect(pinoLevelToMcp("trace")).toBe("debug");
    });

    it("maps debug to debug", () => {
      expect(pinoLevelToMcp("debug")).toBe("debug");
    });

    it("maps info to info", () => {
      expect(pinoLevelToMcp("info")).toBe("info");
    });

    it("maps warn to warning", () => {
      expect(pinoLevelToMcp("warn")).toBe("warning");
    });

    it("maps error to error", () => {
      expect(pinoLevelToMcp("error")).toBe("error");
    });

    it("maps fatal to critical", () => {
      expect(pinoLevelToMcp("fatal")).toBe("critical");
    });

    it("Property: pinoLevelToMcp covers all pino levels exhaustively", () => {
      const pinoLevels: Array<PinoLevel> = ["trace", "debug", "info", "warn", "error", "fatal"];
      const mcpLevels = new Set(["debug", "info", "warning", "error", "critical"]);
      fc.assert(
        fc.property(fc.constantFrom(...pinoLevels), (level) => {
          const mapped = pinoLevelToMcp(level);
          expect(mcpLevels.has(mapped)).toBe(true);
        }),
      );
    });
  });
});
