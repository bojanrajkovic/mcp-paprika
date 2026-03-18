import { vi } from "vitest";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { RecipeStore } from "../cache/recipe-store.js";
import type { ServerContext } from "../types/server-context.js";

type ResourceEntry = {
  list: (() => Promise<unknown>) | undefined;
  read: (uri: URL, variables: Record<string, string | string[]>) => Promise<unknown>;
};

/** Stubs McpServer to capture registered tool and resource handlers for direct invocation in tests. */
export function makeTestServer(): {
  server: McpServer;
  callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  callResourceList: (name: string) => Promise<unknown>;
  callResource: (name: string, uid: string) => Promise<unknown>;
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
    callResource: (name, uid) => {
      const entry = resourceHandlers.get(name);
      if (!entry) throw new Error(`Resource not registered: ${name}`);
      const uri = new URL(`paprika://recipe/${uid}`);
      return entry.read(uri, { uid } as Record<string, string | string[]>);
    },
    sendResourceListChanged,
  };
}

/**
 * Creates a minimal ServerContext for tool unit tests.
 *
 * @param store   — real RecipeStore populated by tests
 * @param server  — stub McpServer from makeTestServer()
 * @param overrides — optional partial overrides for client and/or cache.
 *   Write-tool tests inject { saveRecipe: vi.fn(), notifySync: vi.fn() } and
 *   { putRecipe: vi.fn(), flush: vi.fn() } here.
 *   Read-tool tests pass no overrides — the existing stubs suffice.
 */
export function makeCtx(
  store: RecipeStore,
  server: McpServer,
  overrides: Partial<Pick<ServerContext, "client" | "cache">> = {},
): ServerContext {
  return {
    store,
    server,
    client: {} as unknown as ServerContext["client"],
    cache: {} as unknown as ServerContext["cache"],
    ...overrides,
  } satisfies ServerContext;
}

/** Extracts the text string from a CallToolResult's first content block. */
export function getText(result: CallToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== "text") throw new Error("Expected text content");
  return first.text;
}
