/**
 * Stderr logging helpers.
 *
 * Stdio transport uses stdout for the MCP wire format, so every diagnostic
 * message MUST go to stderr. The `no-console` oxlint rule enforces this at
 * the linter; this module gives callers a typed entry point so they don't
 * write the bracket-prefix-newline shape inline at every site.
 */

/**
 * Returns a function that writes `[${prefix}] ${msg}\n` to stderr.
 *
 * Usage:
 *   const log = createLogger("mcp-paprika");
 *   log("starting up");
 *
 * Pre-existing modules used to define their own `function log(msg)` shim;
 * those are now collapsed to a single `createLogger(prefix)` call per file.
 */
export function createLogger(prefix: string): (msg: string) => void {
  return (msg) => process.stderr.write(`[${prefix}] ${msg}\n`);
}

/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * `try { ... } catch (e)` lands `e: unknown` in strict mode; almost every site
 * wants `e.message` if it's an Error and a `String(e)` fallback otherwise.
 * Captures that pattern once.
 */
export function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
