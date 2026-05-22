// pattern: Imperative Shell
// (Pure pinoLevelToMcp lives inside but the file constructs streams and calls fs I/O.)

import type { Notifier } from "../server/notifier.js";
import type { Level as PinoLevel } from "pino";
import { Writable } from "node:stream";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import pino from "pino";
import pretty from "pino-pretty";
import { getLogDir } from "./xdg.js";

// ---------------------------------------------------------------------------
// Public re-exports: preserved from the old shim.
// Ten production sites depend on toMessage.
// Call sites using createLogger(prefix) will be migrated in Phase 4.
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * `try { ... } catch (e)` lands `e: unknown` in strict mode; almost every site
 * wants `e.message` if it's an Error and a `String(e)` fallback otherwise.
 */
export function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * @deprecated Use `createLogger(opts: LoggerOptions)` instead.
 * Returns a function that writes `[${prefix}] ${msg}\n` to stderr.
 * Preserved for backward compatibility during Phase 1-3; migrated in Phase 4.
 */
export function createLogger(prefix: string): (msg: string) => void;
/**
 * Construct a pino logger with multistream output.
 * @see LoggerOptions for configuration details.
 */
export function createLogger(opts: LoggerOptions): pino.Logger;
export function createLogger(prefixOrOpts: string | LoggerOptions): ((msg: string) => void) | pino.Logger {
  if (typeof prefixOrOpts === "string") {
    const prefix = prefixOrOpts;
    return (msg) => process.stderr.write(`[${prefix}] ${msg}\n`);
  }
  return _createLogger(prefixOrOpts);
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface LoggerOptions {
  readonly transport: "stdio" | "http";
  readonly notifier: Notifier;
  readonly level: PinoLevel;
  readonly notifyLevel: PinoLevel;
  readonly pretty: boolean | "auto";
  readonly file?: string;
}

export type MCPLevel = "debug" | "info" | "warning" | "error" | "critical";

export interface MCPFanoutRecord {
  level: MCPLevel;
  logger: string;
  data: { msg: string; [k: string]: unknown };
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const REDACT_PATHS: ReadonlyArray<string> = [
  "authorization",
  "*.authorization",
  "*.*.authorization",
  "password",
  "*.password",
  "*.*.password",
  "token",
  "*.token",
  "*.*.token",
  "client_secret",
  "*.client_secret",
  "*.*.client_secret",
  "access_token",
  "*.access_token",
  "*.*.access_token",
  "refresh_token",
  "*.refresh_token",
  "*.*.refresh_token",
  "id_token",
  "*.id_token",
  "*.*.id_token",
];

// Numeric pino level values → level names (pino serializes numeric levels)
const NUMERIC_TO_PINO_LEVEL: Record<number, PinoLevel> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

const PINO_INTERNAL_KEYS = new Set(["level", "time", "hostname", "pid", "v"]);

const PINO_LEVEL_RANK: Record<PinoLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

// ---------------------------------------------------------------------------
// Pure mapper (AC2.4)
// @internal — exported for testing only; do not import outside log.test.ts
// ---------------------------------------------------------------------------

/** @internal Pure helper exported for testing only. */
export function pinoLevelToMcp(level: PinoLevel): MCPLevel {
  switch (level) {
    case "trace":
    case "debug":
      return "debug";
    case "info":
      return "info";
    case "warn":
      return "warning";
    case "error":
      return "error";
    case "fatal":
      return "critical";
    default: {
      const _exhaustive: never = level;
      throw new Error(`unhandled pino level: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Fan-out Writable (AC2.1–2.6)
// @internal — exported for testing only
// ---------------------------------------------------------------------------

/** @internal Exported for testing only. */
export function notifierStream(notifier: Notifier): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      try {
        const line = (chunk as Buffer).toString("utf8").trim();
        if (line.length === 0) return callback();
        const record = JSON.parse(line) as Record<string, unknown>;
        const pinoLevelName = NUMERIC_TO_PINO_LEVEL[record["level"] as number];
        if (pinoLevelName === undefined) return callback();

        const mcpLevel = pinoLevelToMcp(pinoLevelName);
        const component = typeof record["component"] === "string" ? record["component"] : "unknown";

        const data: Record<string, unknown> = { msg: String(record["msg"] ?? "") };
        for (const [k, v] of Object.entries(record)) {
          if (PINO_INTERNAL_KEYS.has(k)) continue;
          if (k === "msg") continue;
          data[k] = v;
        }

        // Fire-and-forget. Both existing Notifier implementations already swallow rejections.
        // We additionally guard with .catch to prevent unhandled-rejection events in the
        // rare case a future Notifier implementation changes that contract.
        void notifier.loggingMessage({ level: mcpLevel, logger: component, data }).catch(() => {});
      } catch {
        // Bad JSON or unexpected shape — drop silently; primary stream still receives the record.
      }
      callback();
    },
  });
}

// ---------------------------------------------------------------------------
// Primary destination resolution (AC1.1–1.4, AC10.4, AC11.1–11.2)
// @internal — exported for testing only
// ---------------------------------------------------------------------------

function resolveFilePath(override: string | undefined): string {
  if (override !== undefined && override !== "") return override;
  return join(getLogDir(), "mcp-paprika.log");
}

function ensureWritable(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  // Probe writability with an O_CREAT|O_APPEND open; close immediately.
  // pino.destination will reopen for the actual writes.
  closeSync(openSync(filePath, "a"));
}

/** @internal Exported for testing only. */
export function resolvePrimaryDestination(opts: LoggerOptions): NodeJS.WritableStream {
  const wantPretty = opts.pretty === true || (opts.pretty === "auto" && opts.transport === "stdio");

  if (opts.transport === "http") {
    // HTTP transport: raw JSON to stdout. pretty option is ignored for HTTP.
    return process.stdout;
  }

  // stdio transport
  const isTTY = Boolean(process.stderr.isTTY);
  if (isTTY) {
    // stdio + TTY: stderr destination. Apply pretty when requested.
    if (wantPretty) {
      return pretty({ sync: true, destination: process.stderr.fd, colorize: true });
    }
    return process.stderr;
  }

  // stdio + non-TTY: file destination
  const filePath = resolveFilePath(opts.file);
  ensureWritable(filePath);
  const fileStream = pino.destination({ dest: filePath, sync: true, mkdir: false });
  if (wantPretty) {
    return pretty({ sync: true, destination: fileStream });
  }
  // SonicBoom satisfies WritableStream at runtime but its TS type doesn't extend it
  return fileStream as unknown as NodeJS.WritableStream;
}

// ---------------------------------------------------------------------------
// Root-level helper: pick the lower of two pino levels
// ---------------------------------------------------------------------------

function lowestLevel(a: PinoLevel, b: PinoLevel): PinoLevel {
  return PINO_LEVEL_RANK[a] <= PINO_LEVEL_RANK[b] ? a : b;
}

// ---------------------------------------------------------------------------
// Private implementation: _createLogger
// Public overloads are defined above to preserve backward compat.
// ---------------------------------------------------------------------------

/**
 * Internal implementation. Construct a pino logger with two output streams:
 * - A primary destination (stdout JSON for HTTP; pino-pretty to stderr or
 *   file for stdio), filtered at `opts.level`.
 * - A notifier fan-out Writable that maps records to MCP logging messages,
 *   filtered at `opts.notifyLevel`.
 *
 * Redact paths are baked in at construction and apply to both streams.
 * Called exactly once per process by `buildAppContext`.
 */
function _createLogger(opts: LoggerOptions): pino.Logger {
  const primary = resolvePrimaryDestination(opts);
  const fanout = notifierStream(opts.notifier);
  const rootLevel = lowestLevel(opts.level, opts.notifyLevel);

  return pino(
    {
      level: rootLevel,
      redact: { paths: REDACT_PATHS as unknown as Array<string>, censor: "[Redacted]" },
      // Suppress default `pid`/`hostname` from emitted records — they're noise for our use case
      // and would leak into the notifier fan-out's curated data.
      // null (not undefined) is required by pino's exactOptionalPropertyTypes TS config.
      base: null,
    },
    pino.multistream(
      [
        { level: opts.level, stream: primary },
        { level: opts.notifyLevel, stream: fanout },
      ],
      { dedupe: false }, // we WANT both streams to receive matching records
    ),
  );
}
