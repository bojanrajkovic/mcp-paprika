// scripts/verify-sdk.ts
//
// Compile-time + runtime verification of @modelcontextprotocol/sdk API surface.
// Confirms SDK constructs match the architecture doc assumptions, including
// the Streamable HTTP transport surface used by src/transport/http.ts.
//
// Usage: npx tsx scripts/verify-sdk.ts
// Output goes to stderr (stdout is reserved for MCP wire protocol).

import { StreamableHTTPTransport } from "@hono/mcp";
// Verified import paths (subpath exports, not barrel imports).
// See docs/verified-api.md for the authoritative SDK API surface.
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { type CallToolResult, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

function check(label: string, condition: boolean): boolean {
  const status = condition ? "PASS" : "FAIL";
  log(`  [${status}] ${label}`);
  return condition;
}

let allPassed = true;

function verify(label: string, condition: boolean): void {
  if (!check(label, condition)) {
    allPassed = false;
  }
}

// --- McpServer ---
log("\n=== McpServer ===");

const server = new McpServer({ name: "verify-sdk", version: "0.0.0" });
verify("McpServer instantiated with { name, version }", server instanceof McpServer);
verify("registerTool method exists", typeof server.registerTool === "function");
verify("registerResource method exists", typeof server.registerResource === "function");
verify("sendResourceListChanged method exists", typeof server.sendResourceListChanged === "function");
verify("sendLoggingMessage method exists", typeof server.sendLoggingMessage === "function");
verify("connect method exists", typeof server.connect === "function");

// --- StdioServerTransport ---
log("\n=== StdioServerTransport ===");

const stdio = new StdioServerTransport();
verify("StdioServerTransport instantiated (no-arg)", stdio instanceof StdioServerTransport);

// --- ResourceTemplate ---
log("\n=== ResourceTemplate ===");

const template = new ResourceTemplate("recipe:///{uid}", {
  list: async () => ({ resources: [] }),
});
verify("ResourceTemplate instantiated with URI template", template instanceof ResourceTemplate);

// --- CallToolResult type ---
log("\n=== CallToolResult ===");

const exampleResult: CallToolResult = {
  content: [{ type: "text", text: "hello" }],
};
verify("CallToolResult type annotation compiles", exampleResult.content.length > 0);

// --- Streamable HTTP ---
log("\n=== Streamable HTTP ===");

verify("StreamableHTTPServerTransport import path resolves", typeof StreamableHTTPServerTransport === "function");
verify(
  "WebStandardStreamableHTTPServerTransport import path resolves (fallback)",
  typeof WebStandardStreamableHTTPServerTransport === "function",
);
verify("isInitializeRequest import resolves", typeof isInitializeRequest === "function");
verify("@hono/mcp StreamableHTTPTransport import resolves", typeof StreamableHTTPTransport === "function");

const honoTransport = new StreamableHTTPTransport();
verify("StreamableHTTPTransport instantiates (no options)", honoTransport instanceof StreamableHTTPTransport);
verify("StreamableHTTPTransport.handleRequest exists", typeof honoTransport.handleRequest === "function");
verify("StreamableHTTPTransport.close exists", typeof honoTransport.close === "function");

// --- Summary ---
log("\n=== Summary ===");
if (allPassed) {
  log("All verifications passed.");
  process.exit(0);
} else {
  log("Some verifications FAILED.");
  process.exit(1);
}
