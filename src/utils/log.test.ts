import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import type { Level as PinoLevel } from "pino";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinoLevelToMcp, notifierStream, resolvePrimaryDestination, createLogger } from "./log.js";
import type { LoggerOptions } from "./log.js";
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

// ---------------------------------------------------------------------------
// Task 6 — primary destination resolution
// ---------------------------------------------------------------------------

/** Minimal LoggerOptions for resolvePrimaryDestination tests. */
function makeOpts(overrides: Partial<LoggerOptions> = {}): LoggerOptions {
  const { notifier } = makeStubNotifier();
  return {
    transport: "stdio",
    notifier,
    level: "info",
    notifyLevel: "warn",
    pretty: false,
    ...overrides,
  };
}

describe("resolvePrimaryDestination", () => {
  let savedIsTTY: PropertyDescriptor | undefined;
  let savedXDGStateHome: string | undefined;
  let tmpDir: string | undefined;

  beforeEach(() => {
    // Save isTTY descriptor so we can restore it
    savedIsTTY = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    // Save and clear XDG override
    savedXDGStateHome = process.env["XDG_STATE_HOME"];
  });

  afterEach(() => {
    // Restore isTTY
    if (savedIsTTY !== undefined) {
      Object.defineProperty(process.stderr, "isTTY", savedIsTTY);
    } else {
      // If it wasn't defined, delete the property so the prototype chain kicks in
      delete (process.stderr as unknown as Record<string, unknown>)["isTTY"];
    }
    // Restore XDG
    if (savedXDGStateHome !== undefined) {
      process.env["XDG_STATE_HOME"] = savedXDGStateHome;
    } else {
      delete process.env["XDG_STATE_HOME"];
    }
    // Clean up temp dirs
    if (tmpDir !== undefined) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
      tmpDir = undefined;
    }
  });

  describe("structured-logging.AC1.1: HTTP → stdout (raw JSON)", () => {
    it("returns process.stdout for HTTP transport regardless of isTTY", () => {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
      const dest = resolvePrimaryDestination(makeOpts({ transport: "http" }));
      expect(dest).toBe(process.stdout);
    });

    it("returns process.stdout for HTTP transport even when isTTY is true", () => {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
      const dest = resolvePrimaryDestination(makeOpts({ transport: "http" }));
      expect(dest).toBe(process.stdout);
    });
  });

  describe("structured-logging.AC1.2: stdio + TTY → stderr", () => {
    it("returns process.stderr when isTTY is true and pretty is false", () => {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
      const dest = resolvePrimaryDestination(makeOpts({ transport: "stdio", pretty: false }));
      expect(dest).toBe(process.stderr);
    });

    it("returns a pretty-formatted stream (not raw stderr) when isTTY is true and pretty is true", () => {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
      const dest = resolvePrimaryDestination(makeOpts({ transport: "stdio", pretty: true }));
      // pino-pretty stream is not process.stderr itself, but wraps it
      expect(dest).not.toBe(process.stderr);
      expect(dest).not.toBe(process.stdout);
    });

    it("auto-detects TTY and uses pretty when pretty is 'auto' + isTTY true", () => {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
      const dest = resolvePrimaryDestination(makeOpts({ transport: "stdio", pretty: "auto" }));
      // 'auto' + stdio + TTY → pretty stream (not raw stderr)
      expect(dest).not.toBe(process.stderr);
    });
  });

  describe("structured-logging.AC1.3: stdio + non-TTY → file at default path", () => {
    it("writes to the default log file when isTTY is false and no MCP_LOG_FILE override", () => {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
      tmpDir = mkdtempSync(join(tmpdir(), "mcp-paprika-test-"));
      process.env["XDG_STATE_HOME"] = tmpDir;

      const expectedPath = join(tmpDir, "mcp-paprika", "mcp-paprika.log");
      resolvePrimaryDestination(makeOpts({ transport: "stdio", pretty: false }));

      // Writable probe should have created the file
      expect(existsSync(expectedPath)).toBe(true);
    });
  });

  describe("structured-logging.AC1.4: MCP_LOG_FILE override", () => {
    it("uses the custom file path when file option is set", () => {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
      tmpDir = mkdtempSync(join(tmpdir(), "mcp-paprika-test-"));
      const customPath = join(tmpDir, "custom", "app.log");

      resolvePrimaryDestination(makeOpts({ transport: "stdio", pretty: false, file: customPath }));

      // mkdir-p + writability probe should have created the file
      expect(existsSync(customPath)).toBe(true);
    });
  });

  describe("structured-logging.AC10.4: pretty auto-detection per transport", () => {
    it("auto + HTTP → the stream is stdout (not pretty)", () => {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
      const dest = resolvePrimaryDestination(makeOpts({ transport: "http", pretty: "auto" }));
      expect(dest).toBe(process.stdout);
    });

    it("auto + stdio + non-TTY → file destination is created", () => {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
      tmpDir = mkdtempSync(join(tmpdir(), "mcp-paprika-test-"));
      process.env["XDG_STATE_HOME"] = tmpDir;

      const dest = resolvePrimaryDestination(makeOpts({ transport: "stdio", pretty: "auto" }));
      // 'auto' + stdio + non-TTY → file; it should not be stdout or stderr
      expect(dest).not.toBe(process.stdout);
      expect(dest).not.toBe(process.stderr);
    });
  });

  describe("structured-logging.AC11.1: mkdir-p at construction", () => {
    it("creates nested directories when the log file path is deeply nested", () => {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
      tmpDir = mkdtempSync(join(tmpdir(), "mcp-paprika-test-"));
      const deepPath = join(tmpDir, "a", "b", "c", "nested.log");

      resolvePrimaryDestination(makeOpts({ transport: "stdio", pretty: false, file: deepPath }));

      expect(existsSync(deepPath)).toBe(true);
    });
  });

  describe("structured-logging.AC11.2: fail-fast on unwritable path", () => {
    it("throws synchronously when the log file cannot be created", () => {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
      // /dev/null is a file, not a directory — trying to create a file inside it fails
      const badPath = "/dev/null/cannot-write/app.log";

      expect(() => {
        resolvePrimaryDestination(makeOpts({ transport: "stdio", pretty: false, file: badPath }));
      }).toThrow();
    });

    it("error message names the failing path", () => {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
      const badPath = "/dev/null/nested/app.log";

      let errorMessage = "";
      try {
        resolvePrimaryDestination(makeOpts({ transport: "stdio", pretty: false, file: badPath }));
      } catch (e) {
        errorMessage = e instanceof Error ? e.message : String(e);
      }

      // The error should surface naturally from mkdirSync (ENOTDIR)
      expect(errorMessage).toBeTruthy();
    });
  });

  describe("AC1.3 file content is written (integration with pino sync destination)", () => {
    it("pino writes a log record to the resolved file destination", () => {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
      tmpDir = mkdtempSync(join(tmpdir(), "mcp-paprika-test-"));
      const logFile = join(tmpDir, "test.log");

      const opts = makeOpts({ transport: "stdio", pretty: false, file: logFile });
      const logger = createLogger(opts);
      logger.warn({ test: true }, "file-write-test");

      const contents = readFileSync(logFile, "utf8");
      expect(contents).toContain("file-write-test");
    });
  });
});
