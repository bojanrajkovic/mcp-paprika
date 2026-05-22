import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import type { Level as PinoLevel } from "pino";
import { pinoLevelToMcp, notifierStream } from "./log.js";
import type { Notifier } from "../server/notifier.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a pino-shaped JSON line as pino emits it to streams. */
function pinoLine(opts: { level: number; msg: string; time?: number; [k: string]: unknown }): Buffer {
  const record = { time: Date.now(), ...opts };
  return Buffer.from(JSON.stringify(record) + "\n", "utf8");
}

/** Promisify a Writable.write call with the correct callback signature. */
function writeAsync(
  stream: { write(chunk: Buffer, cb: (err: Error | null | undefined) => void): boolean },
  chunk: Buffer,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.write(chunk, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

type LoggingMessageSpy = ReturnType<typeof vi.fn<Notifier["loggingMessage"]>>;

/** Create a stub Notifier with a spy on loggingMessage. */
function makeStubNotifier(resolveWith: "resolve" | "reject" = "resolve"): {
  notifier: Notifier;
  spy: LoggingMessageSpy;
} {
  const spy = vi.fn<Notifier["loggingMessage"]>();
  if (resolveWith === "resolve") {
    spy.mockResolvedValue(undefined);
  } else {
    spy.mockRejectedValue(new Error("notifier failed"));
  }
  const notifier: Notifier = {
    resourceListChanged: vi.fn(),
    loggingMessage: spy as Notifier["loggingMessage"],
  };
  return { notifier, spy };
}

// Pino numeric levels
const LEVEL_TRACE = 10;
const LEVEL_DEBUG = 20;
const LEVEL_INFO = 30;
const LEVEL_WARN = 40;
const LEVEL_ERROR = 50;
const LEVEL_FATAL = 60;

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

// ---------------------------------------------------------------------------
// Task 5 — notifier fan-out Writable
// Tests use hand-crafted pino-shaped JSON lines (no createLogger needed).
// ---------------------------------------------------------------------------

describe("notifierStream", () => {
  describe("structured-logging.AC2.1: warn fans out with correct MCP level and curated payload", () => {
    it("writing a warn-level record invokes loggingMessage exactly once with level 'warning'", async () => {
      const { notifier, spy } = makeStubNotifier();
      const stream = notifierStream(notifier);

      await writeAsync(stream, pinoLine({ level: LEVEL_WARN, msg: "boom", foo: "bar" }));
      // Give fire-and-forget a tick to settle
      await new Promise((r) => setImmediate(r));

      expect(spy).toHaveBeenCalledTimes(1);
      const [params] = spy.mock.calls[0]!;
      expect(params.level).toBe("warning");
      expect((params.data as Record<string, unknown>)["msg"]).toBe("boom");
      expect((params.data as Record<string, unknown>)["foo"]).toBe("bar");
    });
  });

  describe("structured-logging.AC2.2: info-level record does NOT fan out when threshold is warn (stream always delivers)", () => {
    it("notifierStream itself always passes records — threshold filtering is pino multistream's job", async () => {
      // The Writable itself has no threshold filter; filtering happens at the multistream level.
      // This test verifies the stream processes records regardless of level.
      // AC2.2 is fully verified in the createLogger integration tests (Task 7).
      const { notifier, spy } = makeStubNotifier();
      const stream = notifierStream(notifier);

      await writeAsync(stream, pinoLine({ level: LEVEL_INFO, msg: "info msg" }));
      await new Promise((r) => setImmediate(r));

      // The Writable always processes; multistream is responsible for filtering.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![0].level).toBe("info");
    });
  });

  describe("structured-logging.AC2.5: curated payload excludes pino internals", () => {
    it("loggingMessage data excludes level, time, hostname, pid, v — and contains msg and caller fields", async () => {
      const { notifier, spy } = makeStubNotifier();
      const stream = notifierStream(notifier);
      const record = pinoLine({
        level: LEVEL_WARN,
        msg: "curated",
        time: 99999,
        hostname: "myhost",
        pid: 1234,
        v: 1,
        custom: "kept",
      });

      await writeAsync(stream, record);
      await new Promise((r) => setImmediate(r));

      expect(spy).toHaveBeenCalledTimes(1);
      const data = spy.mock.calls[0]![0].data as Record<string, unknown>;
      // Pino internals must be excluded
      expect(data).not.toHaveProperty("level");
      expect(data).not.toHaveProperty("time");
      expect(data).not.toHaveProperty("hostname");
      expect(data).not.toHaveProperty("pid");
      expect(data).not.toHaveProperty("v");
      // msg and caller fields must be present
      expect(data["msg"]).toBe("curated");
      expect(data["custom"]).toBe("kept");
    });

    it("level mapping is correct for all six pino levels", async () => {
      const levelCases: Array<[number, string]> = [
        [LEVEL_TRACE, "debug"],
        [LEVEL_DEBUG, "debug"],
        [LEVEL_INFO, "info"],
        [LEVEL_WARN, "warning"],
        [LEVEL_ERROR, "error"],
        [LEVEL_FATAL, "critical"],
      ];

      for (const [numericLevel, expectedMcpLevel] of levelCases) {
        const { notifier, spy } = makeStubNotifier();
        const stream = notifierStream(notifier);

        await writeAsync(stream, pinoLine({ level: numericLevel, msg: "test" }));
        await new Promise((r) => setImmediate(r));

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]![0].level).toBe(expectedMcpLevel);
      }
    });
  });

  describe("structured-logging.AC2.6: rejected notifier promise does not propagate", () => {
    it("write callback completes synchronously even when notifier rejects", async () => {
      const { notifier } = makeStubNotifier("reject");
      const stream = notifierStream(notifier);
      const line = pinoLine({ level: LEVEL_WARN, msg: "rejected" });

      // The write should complete without throwing
      await expect(writeAsync(stream, line)).resolves.toBeUndefined();

      // Let the rejected promise settle — no unhandled rejection should surface
      await new Promise((r) => setImmediate(r));
    });
  });

  describe("component field extraction", () => {
    it("uses component field as logger name when present", async () => {
      const { notifier, spy } = makeStubNotifier();
      const stream = notifierStream(notifier);

      await writeAsync(stream, pinoLine({ level: LEVEL_WARN, msg: "comp test", component: "sync" }));
      await new Promise((r) => setImmediate(r));

      expect(spy.mock.calls[0]![0].logger).toBe("sync");
    });

    it("falls back to 'unknown' when component field is absent", async () => {
      const { notifier, spy } = makeStubNotifier();
      const stream = notifierStream(notifier);

      await writeAsync(stream, pinoLine({ level: LEVEL_INFO, msg: "no comp" }));
      await new Promise((r) => setImmediate(r));

      expect(spy.mock.calls[0]![0].logger).toBe("unknown");
    });
  });

  describe("robustness", () => {
    it("silently drops empty lines without calling loggingMessage", async () => {
      const { notifier, spy } = makeStubNotifier();
      const stream = notifierStream(notifier);

      await writeAsync(stream, Buffer.from("\n"));
      await new Promise((r) => setImmediate(r));

      expect(spy).not.toHaveBeenCalled();
    });

    it("silently drops malformed JSON without calling loggingMessage", async () => {
      const { notifier, spy } = makeStubNotifier();
      const stream = notifierStream(notifier);

      await writeAsync(stream, Buffer.from("not json\n"));
      await new Promise((r) => setImmediate(r));

      expect(spy).not.toHaveBeenCalled();
    });

    it("silently drops records with unknown numeric level", async () => {
      const { notifier, spy } = makeStubNotifier();
      const stream = notifierStream(notifier);

      await writeAsync(stream, Buffer.from(JSON.stringify({ level: 99, msg: "wat" }) + "\n"));
      await new Promise((r) => setImmediate(r));

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
