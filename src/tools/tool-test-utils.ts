import { vi } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import type { Logger } from "pino";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { makeAppContext } from "../__fixtures__/app-context.js";
import type { RecipeStore } from "../cache/recipe-store.js";
import type { Notifier } from "../server/notifier.js";
import type { ServerContext } from "../types/server-context.js";

/**
 * Shape returned by `makePinoCapture()`. `log` is the capture logger;
 * `records` is the live array of parsed JSON records; `clear()` empties it
 * between assertions without recreating the logger.
 */
export type PinoCapture = {
  readonly log: Logger;
  readonly records: ReadonlyArray<Record<string, unknown>>;
  clear(): void;
};

/**
 * Builds a pino logger that writes newline-delimited JSON to an in-memory
 * array. Useful in unit tests for asserting on structured log records without
 * wiring up the full `createLogger` fan-out.
 *
 * Default level is `"trace"` so every record is captured regardless of
 * severity. Pass a narrower level to restrict captured records.
 *
 * Usage:
 * ```ts
 * const { log, records } = makePinoCapture();
 * // ... exercise code that uses log ...
 * expect(records.find((r) => r["msg"] === "sync complete")).toBeDefined();
 * ```
 */
export function makePinoCapture(level: pino.Level = "trace"): PinoCapture {
  const records: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
      try {
        const line = (chunk as Buffer).toString("utf8").trim();
        if (line.length > 0) records.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        /* malformed chunk — drop */
      }
      cb();
    },
  });
  const log = pino({ level }, stream);
  return {
    log,
    records,
    clear() {
      records.length = 0;
    },
  };
}

type ResourceEntry = {
  list: (() => Promise<unknown>) | undefined;
  read: (uri: URL, variables: Record<string, string | string[]>) => Promise<unknown>;
};

/** Stub Notifier with vi.fn spies on each method, for assertions in tests. */
export function makeStubNotifier(): {
  notifier: Notifier;
  resourceListChanged: ReturnType<typeof vi.fn>;
  loggingMessage: ReturnType<typeof vi.fn>;
} {
  const resourceListChanged = vi.fn();
  const loggingMessage = vi.fn().mockResolvedValue(undefined);
  return {
    notifier: { resourceListChanged, loggingMessage },
    resourceListChanged,
    loggingMessage,
  };
}

/** Stubs McpServer to capture registered tool and resource handlers for direct invocation in tests. */
export function makeTestServer(): {
  server: McpServer;
  callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  callResourceList: (name: string) => Promise<unknown>;
  callResource: (name: string, uid: string, uri?: string) => Promise<unknown>;
  sendResourceListChanged: ReturnType<typeof vi.fn>;
} {
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<CallToolResult>>();
  const resourceHandlers = new Map<string, ResourceEntry>();
  const sendResourceListChanged = vi.fn();

  const server = {
    registerTool(name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<CallToolResult>) {
      handlers.set(name, handler);
    },
    registerResource(
      name: string,
      template: ResourceTemplate,
      _config: unknown,
      readCallback: (uri: URL, variables: Record<string, string | string[]>, extra: unknown) => Promise<unknown>,
    ) {
      resourceHandlers.set(name, {
        list: template.listCallback ? async () => template.listCallback!({} as never) : undefined,
        read: (uri, variables) => readCallback(uri, variables, {}),
      });
    },
    sendResourceListChanged,
  } as unknown as McpServer;

  return {
    server,
    callTool: (name, args) => {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`Tool not registered: ${name}`);
      return handler(args);
    },
    callResourceList: (name) => {
      const entry = resourceHandlers.get(name);
      if (!entry) throw new Error(`Resource not registered: ${name}`);
      if (!entry.list) throw new Error(`Resource has no list callback: ${name}`);
      return entry.list();
    },
    callResource: (name, uid, uri) => {
      const entry = resourceHandlers.get(name);
      if (!entry) throw new Error(`Resource not registered: ${name}`);
      const url = new URL(uri ?? `paprika://recipe/${uid}`);
      return entry.read(url, { uid } as Record<string, string | string[]>);
    },
    sendResourceListChanged,
  };
}

/**
 * Creates a minimal ServerContext for tool unit tests.
 *
 * @param store   — real RecipeStore populated by tests
 * @param server  — stub McpServer from makeTestServer()
 * @param overrides — optional partial overrides for client, cache, pantryStore, vectorStore, and/or notifier.
 *   Write-tool tests inject { saveRecipe: vi.fn(), notifySync: vi.fn() } on client and
 *   { putRecipe: vi.fn(), flush: vi.fn() } on cache. Tests asserting on resource-list
 *   notifications should pass a stub notifier from `makeStubNotifier()`.
 *   Read-tool tests pass no overrides — the existing stubs suffice.
 */
export function makeCtx(
  store: RecipeStore,
  server: McpServer,
  overrides: Partial<
    Pick<
      ServerContext,
      | "client"
      | "cache"
      | "categoryStore"
      | "pantryStore"
      | "aisleStore"
      | "groceryListStore"
      | "groceryItemStore"
      | "groceryIngredientStore"
      | "mealStore"
      | "mealTypeStore"
      | "menuStore"
      | "menuItemStore"
      | "photoStore"
      | "vectorStore"
      | "notifier"
      | "log"
    >
  > = {},
): ServerContext {
  // Delegate every field default to the shared `makeAppContext` factory (see
  // `src/__fixtures__/app-context.ts`) so a new AppContext field is added in one
  // place. `overrides` is a subset of `Partial<AppContext>`, so it spreads
  // straight through; `store` and `server` are the two positional params.
  return { ...makeAppContext({ store, ...overrides }), server } satisfies ServerContext;
}

/** Extracts the text string from a CallToolResult's first content block. */
export function getText(result: CallToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== "text") throw new Error("Expected text content");
  return first.text;
}

/**
 * Logging-config shape that suppresses all output. Use for transport-test
 * setups (or anywhere a config literal is needed but logger noise isn't).
 * `notifyLevel: "fatal"` blocks fan-out at any sub-fatal level — no level
 * the production code emits today will reach the notifier through this.
 */
export const SILENT_LOGGING_CONFIG = {
  level: "silent" as const,
  notifyLevel: "fatal" as const,
  pretty: false as const,
};

/**
 * Default logging-config shape matching the schema defaults from
 * `paprikaConfigSchema`. Use when tests want production-like log behavior
 * but as a literal rather than going through `loadConfig()`.
 */
export const DEFAULT_LOGGING_CONFIG = {
  level: "info" as const,
  notifyLevel: "warn" as const,
  pretty: "auto" as const,
};

/**
 * Drives the given async call 5 times under fake timers so cockatiel's
 * consecutive-failure circuit breaker (`ConsecutiveBreaker(5)`) trips open.
 * The caller is responsible for activating fake timers
 * (`vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })`)
 * and restoring them in `afterEach`. Each call's failure is swallowed so
 * the loop can proceed; `await vi.runAllTimersAsync()` between calls drains
 * the retry backoff queue.
 *
 * Used by both `paprika/client.test.ts` and `features/embeddings.test.ts`
 * because both clients compose the same `wrap(breaker, retry)` pattern.
 */
export async function tripBreaker(makeCall: () => Promise<unknown>): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const p = makeCall().catch(() => {
      /* expected — call is meant to fail */
    });
    await vi.runAllTimersAsync();
    await p;
  }
}
