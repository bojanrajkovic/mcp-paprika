# Human Test Plan: MCP SDK Verification

## Prerequisites

- Node.js 24 installed (via mise)
- Dependencies installed: `pnpm install`
- All automated tests passing: `pnpm test`
- TypeScript compiles cleanly: `pnpm typecheck`
- Verification script passing: `npx tsx scripts/verify-sdk.ts`

## Phase 1: Dependency Installation

| Step | Action                                                        | Expected                                                                                           |
| ---- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1    | Open `package.json` and locate the `dependencies` section     | `"@modelcontextprotocol/sdk": "^1.27.1"` appears under `dependencies`, not under `devDependencies` |
| 2    | Run `pnpm ls @modelcontextprotocol/sdk` from the project root | Output shows `@modelcontextprotocol/sdk@1.27.1` as a production dependency                         |
| 3    | Run `pnpm typecheck` from the project root                    | Exit code 0, no type errors printed                                                                |

## Phase 2: Verification Script Execution

| Step | Action                                                               | Expected                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Run `npx tsx scripts/verify-sdk.ts` from the project root            | Script runs; stderr shows `[PASS]` for all 8 checks; final line reads "All verifications passed."; exit code 0                                                           |
| 2    | Run `npx tsx scripts/verify-sdk.ts 2>/dev/null` and observe terminal | No output appears on stdout (all output was sent to stderr, which was discarded)                                                                                         |
| 3    | Open `scripts/verify-sdk.ts` and review the imports on lines 11-13   | Three import statements: `McpServer` and `ResourceTemplate` from `server/mcp.js`, `StdioServerTransport` from `server/stdio.js`, `CallToolResult` (type) from `types.js` |
| 4    | In the same file, review lines 38-41                                 | Four `verify()` calls check `typeof` for `registerTool`, `registerResource`, `sendResourceListChanged`, `connect`                                                        |
| 5    | In the same file, review line 60                                     | `const exampleResult: CallToolResult = { ... }` demonstrates the type annotation compiles                                                                                |

## Phase 3: API Documentation Review

| Step | Action                                                                 | Expected                                                                                                                                                                                                                                  |
| ---- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Open `docs/verified-api.md` and navigate to Section 2 ("Import Paths") | A table lists all four constructs (`McpServer`, `StdioServerTransport`, `ResourceTemplate`, `CallToolResult`) with their verified import paths                                                                                            |
| 2    | Navigate to Section 3 ("McpServer")                                    | Constructor example shows `new McpServer({ name, version })`. Method table includes `registerTool`, `registerResource`, `sendResourceListChanged`, `sendToolListChanged`, `sendPromptListChanged`, `connect`, and `close` with signatures |
| 3    | Navigate to Section 4 ("StdioServerTransport")                         | Constructor example shows `new StdioServerTransport()` with optional `(customStdin, customStdout)` overload. Usage pattern shows `await server.connect(transport)`                                                                        |
| 4    | Navigate to Section 5 ("ResourceTemplate")                             | Constructor example shows `new ResourceTemplate("recipe:///{uid}", { list: ... })`. Read callback signature shows `(uri: URL, variables: Record<string, string>, extra)`                                                                  |
| 5    | Navigate to Section 8 ("CallToolResult")                               | Type definition shows `content` array with text/image/resource union, plus `structuredContent` and `isError` optional fields                                                                                                              |

## Phase 4: Discrepancy Table Verification

| Step | Action                                                                                                           | Expected                                                                                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Open `docs/verified-api.md` and navigate to Section 9 ("Discrepancies from Architecture Doc")                    | A table with 4 rows and columns: #, Area, Architecture Doc Assumed, Actual SDK API, Corrected Usage                                                                                                                          |
| 2    | Examine Row 1 (Import: McpServer). Read the "Corrected Usage" column                                             | Contains `import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";` -- a complete, copy-pasteable import. Matches the import path in Section 2                                                 |
| 3    | Examine Row 2 (Import: Transport). Read the "Corrected Usage" column                                             | Contains `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";` -- a complete, copy-pasteable import. Matches the import path in Section 2                                                      |
| 4    | Examine Row 3 (Notifications). Read the "Corrected Usage" column                                                 | Contains `server.sendResourceListChanged();` -- a direct method call, not the `server.notification({ method: ... })` pattern from the architecture doc. Matches the notification pattern in Section 7                        |
| 5    | Examine Row 4 (Resource callback). Read the "Corrected Usage" column                                             | Contains `async (uri, variables, extra) => { const uid = variables.uid; ... }` -- shows accessing `uid` from `variables` instead of the old `(uri, { uid })` destructuring. Matches the read callback signature in Section 5 |
| 6    | For each of the 4 rows, confirm the "Corrected Usage" column is non-empty and contains a code snippet or pattern | All 4 corrected usage entries contain actionable code patterns that a downstream implementor can copy directly                                                                                                               |

## End-to-End: Verification Script Proves Documentation Accuracy

**Purpose:** Confirm that the verification script (`scripts/verify-sdk.ts`) exercises the exact same API surface documented in `docs/verified-api.md`, ensuring the documentation is proven by compilation and runtime checks rather than aspirational.

| Step | Action                                                                                                                                                              | Expected                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Compare import statements in `scripts/verify-sdk.ts` (lines 11-13) with the import path table in `docs/verified-api.md` (Section 2)                                 | All import paths match exactly: `server/mcp.js` for McpServer and ResourceTemplate, `server/stdio.js` for StdioServerTransport, `types.js` for CallToolResult |
| 2    | Compare the `McpServer` constructor call in the script (line 36: `new McpServer({ name: "verify-sdk", version: "0.0.0" })`) with the constructor in Section 3       | Same constructor shape: object with `name` and `version` string properties                                                                                    |
| 3    | Compare the `ResourceTemplate` constructor call in the script (line 52: `new ResourceTemplate("recipe:///{uid}", { list: ... })`) with the constructor in Section 5 | Same constructor shape: URI template string + options object with `list` callback                                                                             |
| 4    | Compare the `StdioServerTransport` constructor call in the script (line 46: `new StdioServerTransport()`) with the constructor in Section 4                         | Same no-arg constructor pattern                                                                                                                               |
| 5    | Verify that all four method existence checks in the script (lines 38-41) correspond to the key methods table in Section 3                                           | `registerTool`, `registerResource`, `sendResourceListChanged`, `connect` are all listed in the Section 3 methods table                                        |
| 6    | Run `npx tsx scripts/verify-sdk.ts` one final time to confirm the full chain: SDK installed, imports resolve, constructors work, methods exist, types compile       | Exit code 0 with all `[PASS]` results                                                                                                                         |

## Human Verification Required

| Criterion            | Why Manual                                                                                                                                | Steps                                                                                                                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| mcp-sdk-verify.AC4.4 | Requires human judgment to assess whether corrected usage patterns are complete, actionable, and consistent with the rest of the document | Phase 4 steps 1-6: open `docs/verified-api.md` Section 9, inspect each of the 4 discrepancy rows, confirm each "Corrected Usage" column contains a non-empty, copy-pasteable code snippet, and cross-reference each corrected pattern against its corresponding documentation section (Sections 2, 5, and 7) |

## Traceability

| Acceptance Criterion | Automated Test                                                   | Manual Step       |
| -------------------- | ---------------------------------------------------------------- | ----------------- |
| mcp-sdk-verify.AC1.1 | `package.json` inspection: SDK in deps at `^1.27.1`              | Phase 1 Step 1    |
| mcp-sdk-verify.AC1.2 | `pnpm ls @modelcontextprotocol/sdk` exit 0                       | Phase 1 Step 2    |
| mcp-sdk-verify.AC1.3 | `pnpm typecheck` exit 0                                          | Phase 1 Step 3    |
| mcp-sdk-verify.AC2.1 | `test -f scripts/verify-sdk.ts && npx tsx scripts/verify-sdk.ts` | Phase 2 Step 1    |
| mcp-sdk-verify.AC2.2 | `rg` confirms 3 import statements in script                      | Phase 2 Step 3    |
| mcp-sdk-verify.AC2.3 | `rg` confirms `CallToolResult` type import + annotation          | Phase 2 Step 5    |
| mcp-sdk-verify.AC2.4 | `rg` confirms 4 method names in script                           | Phase 2 Step 4    |
| mcp-sdk-verify.AC2.5 | stdout capture is 0 bytes when script runs                       | Phase 2 Step 2    |
| mcp-sdk-verify.AC2.6 | `npx tsx scripts/verify-sdk.ts` exit code 0                      | Phase 2 Step 1    |
| mcp-sdk-verify.AC3.1 | `rg "Import Path"` + construct names match in doc                | Phase 3 Step 1    |
| mcp-sdk-verify.AC3.2 | `rg "new McpServer"` etc. match in doc                           | Phase 3 Steps 2-4 |
| mcp-sdk-verify.AC3.3 | `rg` confirms 4 method names in doc                              | Phase 3 Step 2    |
| mcp-sdk-verify.AC3.4 | `rg "Discrepancies"` + table headings match                      | Phase 4 Step 1    |
| mcp-sdk-verify.AC4.1 | `rg "server/mcp.js"` + `rg "server/stdio.js"` match              | Phase 4 Steps 2-3 |
| mcp-sdk-verify.AC4.2 | `rg "notification\("` + `rg "sendResourceListChanged"` match     | Phase 4 Step 4    |
| mcp-sdk-verify.AC4.3 | `rg "uri.*uid"` + `rg "uri.*variables.*extra"` match             | Phase 4 Step 5    |
| mcp-sdk-verify.AC4.4 | N/A (human only)                                                 | Phase 4 Steps 1-6 |
