# MCP SDK Verified API Reference

> Verified against `@modelcontextprotocol/sdk` v1.27.1 — see `scripts/verify-sdk.ts` for compile-time and runtime proof.
>
> This document is the authoritative reference for downstream units (P2-U10, P2-U11, P2-U12).
> Where it differs from the Phase 2 architecture doc, **this document takes precedence**.

## 1. SDK Version

- **Package:** `@modelcontextprotocol/sdk`
- **Installed version:** 1.27.1
- **Installed as:** runtime dependency (`dependencies`, not `devDependencies`)

## 2. Import Paths

**These import paths are verified by `scripts/verify-sdk.ts` as the successful compilation paths for SDK v1.27.1.**

The design research assumed barrel exports at `@modelcontextprotocol/sdk/server`, but the actual SDK uses subpath exports. Use these paths:

```typescript
// Core server and transport classes
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
```

| Construct              | Import Path (verified by scripts/verify-sdk.ts) |
| ---------------------- | ----------------------------------------------- |
| `McpServer`            | `@modelcontextprotocol/sdk/server/mcp.js`       |
| `StdioServerTransport` | `@modelcontextprotocol/sdk/server/stdio.js`     |
| `ResourceTemplate`     | `@modelcontextprotocol/sdk/server/mcp.js`       |
| `CallToolResult`       | `@modelcontextprotocol/sdk/types.js`            |

> **Peer dependency:** The SDK requires `zod ^3.25`. The project's `zod@^3` (resolves to 3.25.76+) satisfies this constraint.

## 3. McpServer

### Constructor

```typescript
const server = new McpServer(
  { name: "mcp-paprika", version: "1.0.0" },  // Implementation: { name: string; version: string }
  options?                                      // ServerOptions (optional)
);
```

### Key Methods

| Method                    | Signature                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `registerTool`            | `(name: string, config: { description?: string; inputSchema?: ZodRawShape }, callback) => RegisteredTool`       |
| `registerResource`        | `(name: string, uri: string \| ResourceTemplate, config: ResourceMetadata, readCallback) => RegisteredResource` |
| `sendResourceListChanged` | `() => void`                                                                                                    |
| `sendToolListChanged`     | `() => void`                                                                                                    |
| `sendPromptListChanged`   | `() => void`                                                                                                    |
| `connect`                 | `(transport: Transport) => Promise<void>`                                                                       |
| `close`                   | `() => Promise<void>`                                                                                           |

## 4. StdioServerTransport

### Constructor

```typescript
const transport = new StdioServerTransport();
// Optional: new StdioServerTransport(customStdin, customStdout)
// Defaults to process.stdin and process.stdout
```

### Usage Pattern

```typescript
const transport = new StdioServerTransport();
await server.connect(transport);
```

## 5. ResourceTemplate

### Constructor

```typescript
const template = new ResourceTemplate(
  "recipe:///{uid}", // URI template string
  {
    list: async (extra) => {
      // ListResourcesCallback | undefined
      return { resources: [] };
    },
    complete: {
      // Optional: completion callbacks per variable
      uid: async (value) => [],
    },
  },
);
```

### Read Callback Signature

When registering a resource with a ResourceTemplate, the read callback receives:

```typescript
server.registerResource(
  "recipe",
  template,
  { description: "A recipe" },
  async (uri: URL, variables: Record<string, string>, extra) => {
    // uri: the resolved URI as a URL object
    // variables: extracted template variables, e.g. { uid: "abc-123" }
    // extra: RequestHandlerExtra with session info
    return { contents: [{ uri: uri.href, text: "..." }] };
  },
);
```

## 6. Tool Registration

```typescript
import { z } from "zod";

server.registerTool(
  "search-recipes",
  {
    description: "Search recipes by query",
    inputSchema: {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results"),
    },
  },
  async (args, extra) => {
    // args is typed as { query: string; limit?: number }
    return {
      content: [{ type: "text", text: JSON.stringify(results) }],
    };
  },
);
```

**Note:** Both `registerTool()` (preferred) and `tool()` (deprecated) exist. Always use `registerTool()`.

## 7. Notifications

The SDK provides **explicit notification methods** on `McpServer`:

```typescript
// Notify clients that the resource list has changed
server.sendResourceListChanged();

// Notify clients that the tool list has changed
server.sendToolListChanged();

// Notify clients that the prompt list has changed
server.sendPromptListChanged();
```

These methods automatically check `isConnected()` before sending. No manual notification construction is needed.

## 8. CallToolResult

```typescript
type CallToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; resource: { uri: string; text?: string; blob?: string } }
  >;
  structuredContent?: Record<string, unknown>; // For tools with outputSchema
  isError?: boolean; // Defaults to false
};
```

### Usage in Tool Handlers

```typescript
// Use the import path confirmed by Phase 1 verification
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

async function handleTool(args: ToolArgs): Promise<CallToolResult> {
  return {
    content: [{ type: "text", text: "Result here" }],
  };
}
```

## 9. Discrepancies from Architecture Doc

| #   | Area              | Architecture Doc Assumed                                                  | Actual SDK API (from Phase 1 verification)                                                                      | Corrected Usage                                                                          |
| --- | ----------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Import: McpServer | `import { McpServer } from "@modelcontextprotocol/sdk/server"`            | `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"` (subpath export, not barrel)              | `import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";` |
| 2   | Import: Transport | `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server"` | `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"` (subpath export, not barrel) | `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";`      |
| 3   | Notifications     | `server.notification({ method: "notifications/resources/list_changed" })` | Explicit method on McpServer: `sendResourceListChanged()`                                                       | `server.sendResourceListChanged();`                                                      |
| 4   | Resource callback | `(uri, { uid })`                                                          | `(uri: URL, variables: Record<string, string>, extra)`                                                          | `async (uri, variables, extra) => { const uid = variables.uid; ... }`                    |
