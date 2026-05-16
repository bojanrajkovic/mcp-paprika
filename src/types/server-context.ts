import type { SessionContext } from "../server/app-context.js";

/**
 * Per-session execution context passed to every tool and resource handler.
 *
 * Alias of {@link SessionContext}. Retained as `ServerContext` for backward
 * compatibility with the original stdio-only architecture; new code should
 * prefer importing `SessionContext` (per-session) or `AppContext`
 * (process-wide, no `server`) directly from `../server/app-context.js`.
 *
 * Includes process-wide shared state (`client`, `cache`, `store`,
 * `pantryStore`, `vectorStore`, `notifier`) plus the per-session
 * `server: McpServer`. In HTTP mode `server` differs per session;
 * notifications that should reach all sessions must go through
 * `ctx.notifier` rather than `ctx.server.send*()`.
 */
export type ServerContext = SessionContext;
