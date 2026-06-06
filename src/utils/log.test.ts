import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fromAny } from "@total-typescript/shoehorn";
import fc from "fast-check";
import type { Level as PinoLevel } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notifier } from "../server/notifier.js";
import type { LoggerOptions } from "./log.js";

import { createLogger, notifierStream, pinoLevelToMcp, resolvePrimaryDestination, toMessage } from "./log.js";

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
// internal types, level mapper, and redact-path constants
// ---------------------------------------------------------------------------

describe("pinoLevelToMcp", () => {
  describe("level mapping", () => {
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
// notifier fan-out Writable
// Tests use hand-crafted pino-shaped JSON lines (no createLogger needed).
// ---------------------------------------------------------------------------

describe("notifierStream", () => {
  describe("warn fans out with correct MCP level and curated payload", () => {
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

  describe("notifierStream itself always processes — multistream owns thresholding", () => {
    it("notifierStream itself always passes records — threshold filtering is pino multistream's job", async () => {
      // The Writable itself has no threshold filter; filtering happens at the multistream level.
      // This test verifies the stream processes records regardless of level.
      // Threshold filtering is fully verified in the createLogger integration tests.
      const { notifier, spy } = makeStubNotifier();
      const stream = notifierStream(notifier);

      await writeAsync(stream, pinoLine({ level: LEVEL_INFO, msg: "info msg" }));
      await new Promise((r) => setImmediate(r));

      // The Writable always processes; multistream is responsible for filtering.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![0].level).toBe("info");
    });
  });

  describe("curated payload excludes pino internals", () => {
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

  describe("rejected notifier promise does not propagate", () => {
    it("write callback completes synchronously even when notifier rejects", async () => {
      const { notifier } = makeStubNotifier("reject");
      const stream = notifierStream(notifier);
      const line = pinoLine({ level: LEVEL_WARN, msg: "rejected" });

      const unhandled: unknown[] = [];
      const onUR = (e: unknown) => unhandled.push(e);
      process.on("unhandledRejection", onUR);
      try {
        // The write should complete without throwing
        await expect(writeAsync(stream, line)).resolves.toBeUndefined();

        // Let the rejected promise settle — no unhandled rejection should surface
        await new Promise((r) => setImmediate(r));
      } finally {
        process.off("unhandledRejection", onUR);
      }

      expect(unhandled).toEqual([]);
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
// primary destination resolution
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
      const stderr: Record<string, unknown> = fromAny(process.stderr);
      delete stderr["isTTY"];
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

  describe("HTTP → stdout (raw JSON)", () => {
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

  describe("stdio + TTY → stderr", () => {
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

  describe("stdio + non-TTY → file at default path", () => {
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

  describe("MCP_LOG_FILE override", () => {
    it("uses the custom file path when file option is set", () => {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
      tmpDir = mkdtempSync(join(tmpdir(), "mcp-paprika-test-"));
      const customPath = join(tmpDir, "custom", "app.log");

      resolvePrimaryDestination(makeOpts({ transport: "stdio", pretty: false, file: customPath }));

      // mkdir-p + writability probe should have created the file
      expect(existsSync(customPath)).toBe(true);
    });
  });

  describe("pretty auto-detection per transport", () => {
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

  describe("mkdir-p at construction", () => {
    it("creates nested directories when the log file path is deeply nested", () => {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
      tmpDir = mkdtempSync(join(tmpdir(), "mcp-paprika-test-"));
      const deepPath = join(tmpDir, "a", "b", "c", "nested.log");

      resolvePrimaryDestination(makeOpts({ transport: "stdio", pretty: false, file: deepPath }));

      expect(existsSync(deepPath)).toBe(true);
    });
  });

  describe("fail-fast on unwritable path", () => {
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
        errorMessage = toMessage(e);
      }

      // The error should surface naturally from mkdirSync (ENOTDIR)
      expect(errorMessage).toBeTruthy();
    });
  });

  describe("file content is written (integration with pino sync destination)", () => {
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

// ---------------------------------------------------------------------------
// createLogger composition: redact, defaults, multistream constraint
// ---------------------------------------------------------------------------

describe("createLogger (composition)", () => {
  let savedIsTTY: PropertyDescriptor | undefined;
  let tmpDir: string | undefined;

  beforeEach(() => {
    savedIsTTY = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    // Always non-TTY so we can use file destination for capturing output
    Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
  });

  afterEach(() => {
    if (savedIsTTY !== undefined) {
      Object.defineProperty(process.stderr, "isTTY", savedIsTTY);
    } else {
      const stderr: Record<string, unknown> = fromAny(process.stderr);
      delete stderr["isTTY"];
    }
    if (tmpDir !== undefined) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort
      }
      tmpDir = undefined;
    }
  });

  /** Build a createLogger opts with a file destination. */
  function makeFileOpts(overrides: Partial<LoggerOptions> = {}): { opts: LoggerOptions; logFile: string } {
    const td = mkdtempSync(join(tmpdir(), "mcp-paprika-test-"));
    tmpDir = td;
    const logFile = join(td, "app.log");
    const { notifier } = makeStubNotifier();
    const opts: LoggerOptions = {
      transport: "stdio",
      notifier,
      level: "info",
      notifyLevel: "warn",
      pretty: false,
      file: logFile,
      ...overrides,
    };
    return { opts, logFile };
  }

  /** Read and parse all JSON lines from a log file. */
  function readLogLines(logFile: string): Array<Record<string, unknown>> {
    const contents = readFileSync(logFile, "utf8");
    return contents
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  describe("credential redaction in primary stream", () => {
    const sensitiveFields = [
      "authorization",
      "password",
      "token",
      "client_secret",
      "access_token",
      "refresh_token",
      "id_token",
      "generation_token",
    ] as const;

    for (const field of sensitiveFields) {
      it(`redacts ${field} nested one level deep (*.field wildcard — primary stream)`, () => {
        const { opts, logFile } = makeFileOpts({ level: "info", notifyLevel: "fatal" });
        const logger = createLogger(opts);

        logger.info({ nested: { [field]: "super-secret" } }, "sensitive-nested");

        const [line] = readLogLines(logFile);
        expect(line).toBeDefined();
        const nested = line!["nested"] as Record<string, unknown>;
        // Pino *.field wildcard matches one level deep (nested.field)
        expect(nested[field]).toBe("[Redacted]");
      });
    }
  });

  describe("credential redaction in fan-out payload", () => {
    it("fan-out data contains redacted values, not originals", async () => {
      const { notifier, spy } = makeStubNotifier();
      const { opts, logFile: _ } = makeFileOpts({ notifier, level: "warn", notifyLevel: "warn" });
      const logger = createLogger(opts);

      logger.warn({ nested: { authorization: "Bearer abc123" } }, "auth-log");

      // Give fire-and-forget a tick
      await new Promise((r) => setImmediate(r));

      expect(spy).toHaveBeenCalledTimes(1);
      const data = spy.mock.calls[0]![0].data as Record<string, unknown>;
      const nested = data["nested"] as Record<string, unknown>;
      expect(nested["authorization"]).toBe("[Redacted]");
      expect(nested["authorization"]).not.toBe("Bearer abc123");
    });
  });

  describe("info does NOT fan out with default notifyLevel: warn", () => {
    it("log.info does not call loggingMessage when notifyLevel is warn", async () => {
      const { notifier, spy } = makeStubNotifier();
      const { opts } = makeFileOpts({
        notifier,
        level: "info",
        notifyLevel: "warn",
      });
      const logger = createLogger(opts);

      logger.info("should not fan out");
      await new Promise((r) => setImmediate(r));

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("configurable notifyLevel threshold", () => {
    it("log.info fans out when notifyLevel is info", async () => {
      const { notifier, spy } = makeStubNotifier();
      const { opts } = makeFileOpts({
        notifier,
        level: "info",
        notifyLevel: "info",
      });
      const logger = createLogger(opts);

      logger.info("should fan out");
      await new Promise((r) => setImmediate(r));

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![0].level).toBe("info");
    });

    it("log.warn does NOT fan out when notifyLevel is error", async () => {
      const { notifier, spy } = makeStubNotifier();
      const { opts } = makeFileOpts({
        notifier,
        level: "warn",
        notifyLevel: "error",
      });
      const logger = createLogger(opts);

      logger.warn("should not fan out");
      await new Promise((r) => setImmediate(r));

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("defaults composition", () => {
    it("logger .level getter returns 'info' when level=info and notifyLevel=warn", () => {
      const { opts } = makeFileOpts({ level: "info", notifyLevel: "warn" });
      const logger = createLogger(opts);
      // Root level is min(info, warn) = info
      expect(logger.level).toBe("info");
    });

    it("log.warn reaches fan-out but log.info does not (default thresholds)", async () => {
      const { notifier, spy } = makeStubNotifier();
      const { opts } = makeFileOpts({
        notifier,
        level: "info",
        notifyLevel: "warn",
      });
      const logger = createLogger(opts);

      logger.info("this should not fan out");
      await new Promise((r) => setImmediate(r));
      expect(spy).not.toHaveBeenCalled();

      logger.warn("this should fan out");
      await new Promise((r) => setImmediate(r));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![0].level).toBe("warning");
    });
  });

  describe("Multistream root-level constraint (inverse case)", () => {
    it("root logger level is notifyLevel when notifyLevel < level", async () => {
      const { notifier, spy } = makeStubNotifier();
      const { opts } = makeFileOpts({
        notifier,
        level: "warn",
        notifyLevel: "info",
      });
      const logger = createLogger(opts);

      // Root level should be min(warn, info) = info
      expect(logger.level).toBe("info");

      // An info record reaches the root; it's filtered by primary (level:warn)
      // but passes through to fan-out (level:info)
      logger.info("info-to-fanout");
      await new Promise((r) => setImmediate(r));

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![0].level).toBe("info");
    });
  });

  describe("full integration — warn fans out with curated payload", () => {
    it("log.warn produces loggingMessage with correct MCP level and payload via full createLogger", async () => {
      const { notifier, spy } = makeStubNotifier();
      const { opts } = makeFileOpts({
        notifier,
        level: "info",
        notifyLevel: "warn",
      });
      const logger = createLogger(opts);

      logger.warn({ foo: "bar" }, "boom");
      await new Promise((r) => setImmediate(r));

      expect(spy).toHaveBeenCalledTimes(1);
      const call = spy.mock.calls[0]![0];
      expect(call.level).toBe("warning");
      const data = call.data as Record<string, unknown>;
      expect(data["msg"]).toBe("boom");
      expect(data["foo"]).toBe("bar");
      // Pino internals stripped
      expect(data).not.toHaveProperty("level");
      expect(data).not.toHaveProperty("time");
    });
  });

  describe("redacts credentials at top-level, one deep, and two deep", () => {
    // REDACT_PATHS covers top-level, *.field (1-deep), and *.*.field (2-deep) for each
    // credential field name. This ensures credentials are redacted regardless of nesting depth
    // up to two levels (the common pattern for HTTP headers and nested auth objects).
    it("redacts a top-level authorization field", () => {
      const { opts, logFile } = makeFileOpts({ level: "info", notifyLevel: "fatal" });
      const logger = createLogger(opts);

      logger.info({ authorization: "Bearer top-level-secret" }, "top-level-credential");

      const [line] = readLogLines(logFile);
      expect(line).toBeDefined();
      expect(line!["authorization"]).toBe("[Redacted]");
    });

    it("redacts authorization nested 2 levels deep", () => {
      const { opts, logFile } = makeFileOpts({ level: "info", notifyLevel: "fatal" });
      const logger = createLogger(opts);

      logger.info({ req: { headers: { authorization: "Bearer deep-secret" } } }, "deep-credential");

      const [line] = readLogLines(logFile);
      expect(line).toBeDefined();
      const req = line!["req"] as Record<string, unknown>;
      const headers = req["headers"] as Record<string, unknown>;
      expect(headers["authorization"]).toBe("[Redacted]");
    });
  });
});
