// scripts/verify-sdk.ts
//
// Compile-time + runtime verification of @modelcontextprotocol/sdk API surface.
// Confirms SDK constructs match Phase 2 architecture doc assumptions.
//
// Usage: npx tsx scripts/verify-sdk.ts
// Output goes to stderr (stdout is reserved for MCP wire protocol).

// Verified import paths (subpath exports, not barrel imports).
// See docs/verified-api.md for the authoritative SDK API surface.
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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
verify("connect method exists", typeof server.connect === "function");

// --- StdioServerTransport ---
log("\n=== StdioServerTransport ===");

const transport = new StdioServerTransport();
verify("StdioServerTransport instantiated (no-arg)", transport instanceof StdioServerTransport);

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

// --- Summary ---
log("\n=== Summary ===");
if (allPassed) {
  log("All verifications passed.");
  process.exit(0);
} else {
  log("Some verifications FAILED.");
  process.exit(1);
}
