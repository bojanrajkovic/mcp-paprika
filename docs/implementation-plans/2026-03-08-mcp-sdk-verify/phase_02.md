# MCP SDK Verification — Phase 2: Produce Cheat Sheet and Flag Discrepancies

**Goal:** Create `docs/verified-api.md` documenting the confirmed SDK API surface with import paths, signatures, and a discrepancies table comparing architecture doc assumptions to actual SDK behavior.

**Architecture:** Documentation-only phase. The cheat sheet becomes the primary reference for downstream units (P2-U10, P2-U11, P2-U12), superseding the architecture doc where discrepancies exist.

**Tech Stack:** Markdown documentation

**Scope:** 2 phases from original design (phases 1-2)

**Codebase verified:** 2026-03-08

---

## Acceptance Criteria Coverage

This phase implements and verifies:

### mcp-sdk-verify.AC3: Cheat Sheet Document

- **mcp-sdk-verify.AC3.1 Success:** `docs/verified-api.md` exists and documents import paths for all verified constructs
- **mcp-sdk-verify.AC3.2 Success:** Document includes constructor signatures for `McpServer`, `StdioServerTransport`, and `ResourceTemplate`
- **mcp-sdk-verify.AC3.3 Success:** Document includes method signatures for `registerTool`, `registerResource`, `sendResourceListChanged`, and `connect`
- **mcp-sdk-verify.AC3.4 Success:** Document includes a "Discrepancies" section with a table of architecture doc assumptions vs actual SDK API

### mcp-sdk-verify.AC4: Discrepancy Flagging

- **mcp-sdk-verify.AC4.1 Success:** Import path discrepancies are flagged (arch doc paths vs actual SDK paths)
- **mcp-sdk-verify.AC4.2 Success:** Notification method discrepancy is flagged (`notification()` vs `sendResourceListChanged()`)
- **mcp-sdk-verify.AC4.3 Success:** Resource callback signature discrepancy is flagged (`(uri, {uid})` vs `(uri, variables, extra)`)
- **mcp-sdk-verify.AC4.4 Success:** Each discrepancy entry includes the corrected usage pattern

---

<!-- START_TASK_1 -->

### Task 1: Create docs/verified-api.md cheat sheet

**Verifies:** mcp-sdk-verify.AC3.1, mcp-sdk-verify.AC3.2, mcp-sdk-verify.AC3.3, mcp-sdk-verify.AC3.4, mcp-sdk-verify.AC4.1, mcp-sdk-verify.AC4.2, mcp-sdk-verify.AC4.3, mcp-sdk-verify.AC4.4

**Files:**

- Create: `/home/brajkovic/Projects/mcp-paprika/docs/verified-api.md`

**Important context:**

- The SDK version will be whatever was installed in Phase 1. The implementor should check the actual installed version with `pnpm ls @modelcontextprotocol/sdk` and use that exact version number in the document.
- The architecture doc (`phase-2-mcp-server.md`) is a future design document. The specific assumptions to compare against are listed in the design plan at `/home/brajkovic/Projects/mcp-paprika/docs/design-plans/2026-03-07-mcp-sdk-verify.md` lines 73-82 and 131-138.
- The verification script from Phase 1 (`scripts/verify-sdk.ts`) confirms these findings at compile-time and runtime.
- **Import paths must match what Phase 1 actually verified.** The template below uses the design plan's researched paths (`@modelcontextprotocol/sdk/server`). If Phase 1 discovered different paths (e.g., `@modelcontextprotocol/sdk/server/mcp.js`), update the cheat sheet to match what actually compiled and ran successfully. The verification script is the source of truth.
- The SDK requires `zod ^3.25` as a peer dependency. The project's `zod@^3` satisfies this. Document this constraint in the cheat sheet.

**Step 1: Check the installed SDK version**

Run:

```bash
pnpm ls @modelcontextprotocol/sdk
```

Note the exact installed version (e.g., `1.27.1`) for the document header.

**Step 2: Create `docs/verified-api.md`**

The document must contain these 9 sections (matching the design plan's cheat sheet structure). The content below reflects the actual SDK API surface as confirmed by research and the Phase 1 verification script. The implementor should verify specifics against the installed SDK version and adjust if needed.

```markdown
# MCP SDK Verified API Reference

> Verified against `@modelcontextprotocol/sdk` v**{VERSION}** — see `scripts/verify-sdk.ts` for compile-time and runtime proof.
>
> This document is the authoritative reference for downstream units (P2-U10, P2-U11, P2-U12).
> Where it differs from the Phase 2 architecture doc, **this document takes precedence**.

## 1. SDK Version

- **Package:** `@modelcontextprotocol/sdk`
- **Installed version:** {VERSION}
- **Installed as:** runtime dependency (`dependencies`, not `devDependencies`)

## 2. Import Paths

**Use the import paths confirmed by `scripts/verify-sdk.ts` in Phase 1.** The paths below are the expected paths based on design research. If Phase 1 discovered different paths, substitute them throughout this document.

{BACKTICK}{BACKTICK}{BACKTICK}typescript
// These paths reflect the Phase 1 verification script's findings.
// Update to match whatever actually compiled successfully.
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/server";
{BACKTICK}{BACKTICK}{BACKTICK}

| Construct              | Import Path (verified by scripts/verify-sdk.ts) |
| ---------------------- | ----------------------------------------------- |
| `McpServer`            | (from Phase 1 verification)                     |
| `StdioServerTransport` | (from Phase 1 verification)                     |
| `ResourceTemplate`     | (from Phase 1 verification)                     |
| `CallToolResult`       | (from Phase 1 verification)                     |

> **Peer dependency:** The SDK requires `zod ^3.25`. The project's `zod@^3` (resolves to 3.25.76+) satisfies this constraint.

## 3. McpServer

### Constructor

{BACKTICK}{BACKTICK}{BACKTICK}typescript
const server = new McpServer(
{ name: "mcp-paprika", version: "1.0.0" }, // Implementation: { name: string; version: string }
options? // ServerOptions (optional)
);
{BACKTICK}{BACKTICK}{BACKTICK}

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

{BACKTICK}{BACKTICK}{BACKTICK}typescript
const transport = new StdioServerTransport();
// Optional: new StdioServerTransport(customStdin, customStdout)
// Defaults to process.stdin and process.stdout
{BACKTICK}{BACKTICK}{BACKTICK}

### Usage Pattern

{BACKTICK}{BACKTICK}{BACKTICK}typescript
const transport = new StdioServerTransport();
await server.connect(transport);
{BACKTICK}{BACKTICK}{BACKTICK}

## 5. ResourceTemplate

### Constructor

{BACKTICK}{BACKTICK}{BACKTICK}typescript
const template = new ResourceTemplate(
"recipe:///{uid}", // URI template string
{
list: async (extra) => { // ListResourcesCallback | undefined
return { resources: [] };
},
complete: { // Optional: completion callbacks per variable
uid: async (value) => [],
},
}
);
{BACKTICK}{BACKTICK}{BACKTICK}

### Read Callback Signature

When registering a resource with a ResourceTemplate, the read callback receives:

{BACKTICK}{BACKTICK}{BACKTICK}typescript
server.registerResource(
"recipe",
template,
{ description: "A recipe" },
async (uri: URL, variables: Record<string, string>, extra) => {
// uri: the resolved URI as a URL object
// variables: extracted template variables, e.g. { uid: "abc-123" }
// extra: RequestHandlerExtra with session info
return { contents: [{ uri: uri.href, text: "..." }] };
}
);
{BACKTICK}{BACKTICK}{BACKTICK}

## 6. Tool Registration

{BACKTICK}{BACKTICK}{BACKTICK}typescript
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
}
);
{BACKTICK}{BACKTICK}{BACKTICK}

**Note:** Both `registerTool()` (preferred) and `tool()` (deprecated) exist. Always use `registerTool()`.

## 7. Notifications

The SDK provides **explicit notification methods** on `McpServer`:

{BACKTICK}{BACKTICK}{BACKTICK}typescript
// Notify clients that the resource list has changed
server.sendResourceListChanged();

// Notify clients that the tool list has changed
server.sendToolListChanged();

// Notify clients that the prompt list has changed
server.sendPromptListChanged();
{BACKTICK}{BACKTICK}{BACKTICK}

These methods automatically check `isConnected()` before sending. No manual notification construction is needed.

## 8. CallToolResult

{BACKTICK}{BACKTICK}{BACKTICK}typescript
type CallToolResult = {
content: Array<
| { type: "text"; text: string }
| { type: "image"; data: string; mimeType: string }
| { type: "resource"; resource: { uri: string; text?: string; blob?: string } }

> ;
> structuredContent?: Record<string, unknown>; // For tools with outputSchema
> isError?: boolean; // Defaults to false
> };
> {BACKTICK}{BACKTICK}{BACKTICK}

### Usage in Tool Handlers

{BACKTICK}{BACKTICK}{BACKTICK}typescript
// Use the import path confirmed by Phase 1 verification
import type { CallToolResult } from "@modelcontextprotocol/sdk/server";

async function handleTool(args: ToolArgs): Promise<CallToolResult> {
return {
content: [{ type: "text", text: "Result here" }],
};
}
{BACKTICK}{BACKTICK}{BACKTICK}

## 9. Discrepancies from Architecture Doc

| #   | Area              | Architecture Doc Assumed                                                           | Actual SDK API (from Phase 1 verification)                                                                  | Corrected Usage                                                       |
| --- | ----------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | Import: McpServer | `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"`              | (Fill from Phase 1 — may be `@modelcontextprotocol/sdk/server` barrel or the `.../server/mcp.js` subpath)   | (Use whichever import path the verification script confirmed)         |
| 2   | Import: Transport | `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"` | (Fill from Phase 1 — may be `@modelcontextprotocol/sdk/server` barrel or the `.../server/stdio.js` subpath) | (Use whichever import path the verification script confirmed)         |
| 3   | Notifications     | `server.notification({ method: "notifications/resources/list_changed" })`          | Explicit method on McpServer                                                                                | `server.sendResourceListChanged()`                                    |
| 4   | Resource callback | `(uri, { uid })`                                                                   | `(uri: URL, variables: Record<string, string>, extra)`                                                      | `async (uri, variables, extra) => { const uid = variables.uid; ... }` |
```

**IMPORTANT:** Replace `{VERSION}` with the actual installed version from Step 1. Replace `{BACKTICK}` sequences — those are used here to avoid markdown nesting issues in this plan document. The actual file should use real triple-backtick fenced code blocks.

**Step 3: Verify the document has all required sections**

Run:

```bash
rg "^## " /home/brajkovic/Projects/mcp-paprika/docs/verified-api.md
```

Expected output should show all 9 sections:

```
## 1. SDK Version
## 2. Import Paths
## 3. McpServer
## 4. StdioServerTransport
## 5. ResourceTemplate
## 6. Tool Registration
## 7. Notifications
## 8. CallToolResult
## 9. Discrepancies from Architecture Doc
```

**Step 4: Verify discrepancies table has all 4 required entries**

Run:

```bash
rg "^\| [1-4] \|" /home/brajkovic/Projects/mcp-paprika/docs/verified-api.md
```

Expected: 4 rows (discrepancies #1 through #4).

**Step 5: Commit**

```bash
git add docs/verified-api.md
git commit -m "docs: add MCP SDK verified API cheat sheet with discrepancies"
```

<!-- END_TASK_1 -->
