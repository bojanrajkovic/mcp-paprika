# MCP SDK API Verification Design

## Summary

Install `@modelcontextprotocol/sdk` ^1.27 and verify its actual API surface against Phase 2 architecture doc assumptions. Produce an executable verification script (`scripts/verify-sdk.ts`) that compile-time and runtime checks all SDK constructs, and a cheat sheet (`docs/verified-api.md`) documenting confirmed import paths, signatures, and discrepancies. Key findings from research: import paths differ from arch doc assumptions, notifications use explicit methods not `notification()`, and resource callbacks receive `(uri, variables, extra)` not `(uri, {uid})`.

## Definition of Done

1. **`@modelcontextprotocol/sdk` installed** as a runtime dependency in `package.json` (latest stable, currently ^1.27)
2. **`docs/verified-api.md` committed** containing a cheat sheet with confirmed import paths, constructor signatures, method signatures, and type names for: McpServer, StdioServerTransport, ResourceTemplate, tool registration, notifications, and CallToolResult
3. **All discrepancies flagged** between the architecture doc (`phase-2-mcp-server.md`) assumptions and the actual SDK API surface — specifically whether it's `registerTool()` vs `tool()`, the ResourceTemplate constructor shape, and the notification method signature
4. **Downstream units unblocked** — P2-U10, P2-U11, P2-U12 can reference this document for correct API usage

## Acceptance Criteria

### mcp-sdk-verify.AC1: SDK Installation

- **mcp-sdk-verify.AC1.1 Success:** `@modelcontextprotocol/sdk` appears in `dependencies` (not `devDependencies`) in `package.json` at version `^1.27`
- **mcp-sdk-verify.AC1.2 Success:** `pnpm install` succeeds and the package is resolvable
- **mcp-sdk-verify.AC1.3 Success:** `pnpm typecheck` passes with the SDK installed

### mcp-sdk-verify.AC2: Verification Script

- **mcp-sdk-verify.AC2.1 Success:** `scripts/verify-sdk.ts` exists and is executable via `npx tsx scripts/verify-sdk.ts`
- **mcp-sdk-verify.AC2.2 Success:** Script imports `McpServer`, `StdioServerTransport`, `ResourceTemplate` from their correct SDK paths
- **mcp-sdk-verify.AC2.3 Success:** Script imports the `CallToolResult` type and uses it in a type annotation
- **mcp-sdk-verify.AC2.4 Success:** Script verifies `registerTool`, `registerResource`, `sendResourceListChanged`, and `connect` methods exist on `McpServer` instance
- **mcp-sdk-verify.AC2.5 Success:** Script outputs verification results to stderr (not stdout)
- **mcp-sdk-verify.AC2.6 Success:** Script exits with code 0 when all verifications pass

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

## Glossary

- **McpServer**: High-level server class from the MCP SDK that manages tool registration, resource registration, and transport connection
- **StdioServerTransport**: Transport implementation that communicates over stdin/stdout using JSON-RPC
- **ResourceTemplate**: SDK class for defining URI-templated resources with a `list` callback for discovery
- **CallToolResult**: TypeScript type representing the return value of an MCP tool handler
- **registerTool()**: Modern (preferred) method on McpServer for registering tool handlers with Zod parameter schemas
- **sendResourceListChanged()**: Explicit notification method on McpServer that signals resource list updates to connected clients
- **Architecture doc**: `phase-2-mcp-server.md` — the Phase 2 design document containing API assumptions that this unit verifies

## Architecture

P2-U00 is a **research unit** — it produces documentation and installs a dependency, but does not add application code. The unit has three deliverables:

1. **SDK installation** — `@modelcontextprotocol/sdk` added as a runtime dependency at `^1.27`
2. **Verification script** — `scripts/verify-sdk.ts`, an executable TypeScript file that imports all SDK constructs referenced by the Phase 2 architecture doc, instantiates them where possible, checks method existence, and logs findings to stderr
3. **Cheat sheet** — `docs/verified-api.md`, a reference document with confirmed import paths, signatures, types, and a discrepancies table

### Verification Script

`scripts/verify-sdk.ts` serves as a compile-time and runtime verification:

- **Compile-time**: The script imports every SDK construct the architecture doc references. If an import path is wrong or a type doesn't exist, `pnpm typecheck` fails.
- **Runtime**: The script instantiates constructors and checks method existence via property access, logging results to stderr (respecting the no-console rule and avoiding stdout which is the MCP wire format).
- **Execution**: `npx tsx scripts/verify-sdk.ts` — uses the project's existing tsx dependency.

Constructs to verify:

| Construct                   | Architecture Doc Assumption                             | Verification                                       |
| --------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| `McpServer`                 | Import from `@modelcontextprotocol/sdk/server/mcp.js`   | Import, instantiate with `{ name, version }`       |
| `StdioServerTransport`      | Import from `@modelcontextprotocol/sdk/server/stdio.js` | Import, instantiate (no-arg)                       |
| `ResourceTemplate`          | Constructor takes URI template string                   | Import, instantiate with `(uriTemplate, { list })` |
| `registerTool()`            | Method on McpServer                                     | Check method exists on instance                    |
| `registerResource()`        | Method on McpServer                                     | Check method exists, verify callback shape         |
| `sendResourceListChanged()` | Arch doc uses `server.notification({method: ...})`      | Check if explicit method exists instead            |
| `CallToolResult`            | Type for tool return values                             | Import type, use in type annotation                |
| `connect()`                 | Method on McpServer, takes transport                    | Check method exists, verify return type            |

### Cheat Sheet Document

`docs/verified-api.md` structure:

1. **SDK Version** — exact installed version
2. **Import Paths** — confirmed paths with code examples
3. **McpServer** — constructor, key methods, parameter types
4. **StdioServerTransport** — constructor, usage pattern
5. **ResourceTemplate** — constructor, list callback shape
6. **Tool Registration** — `registerTool()` signature, Zod schema integration
7. **Notifications** — explicit methods (not the `notification()` pattern)
8. **CallToolResult** — type shape, usage in tool handlers
9. **Discrepancies from Architecture Doc** — table: assumed vs actual, with corrected usage

## Existing Patterns

### From the codebase

- **ESM with `.js` extensions** — all imports use `.js` extension (verification script must follow this)
- **No console** — `console.log` is banned; verification script uses `process.stderr.write()`
- **Zod for types** — SDK uses Zod for tool parameter schemas, aligning with existing convention
- **Per-module CLAUDE.md** — not applicable for this research unit (no new module created)

### From the SDK

- The MCP SDK v1.27 uses a high-level `McpServer` class (not the low-level `Server` class) for typical usage
- Tool parameters are defined with Zod schemas passed directly to `registerTool()`
- Resources use `ResourceTemplate` with URI template strings and a `list` callback

## Implementation Phases

### Phase 1: Install SDK and create verification script

1. Install `@modelcontextprotocol/sdk` as a runtime dependency
2. Create `scripts/verify-sdk.ts` that imports and verifies all constructs
3. Run `pnpm typecheck` to confirm compile-time correctness
4. Run the script to confirm runtime correctness

### Phase 2: Produce cheat sheet and flag discrepancies

1. Create `docs/verified-api.md` with all sections
2. Document each construct's verified import path, constructor signature, and method signatures
3. Build the discrepancies table comparing architecture doc assumptions to actual SDK API
4. Commit both the script and the document

## Additional Considerations

### Known discrepancies (from research)

These will be confirmed by the verification script and documented in the cheat sheet:

- **Import paths**: Architecture doc assumes `/server/mcp.js` and `/server/stdio.js` — actual SDK exports from `@modelcontextprotocol/sdk/server`
- **Notifications**: Architecture doc uses `server.notification({method: 'notifications/resources/list_changed'})` — actual SDK provides `server.sendResourceListChanged()`
- **Resource callback**: Architecture doc shows `(uri, {uid})` — actual SDK passes `(uri, variables, extra)`
- **Tool registration**: Both `registerTool()` and deprecated `tool()` exist — architecture doc correctly uses `registerTool()`

### Downstream impact

P2-U10 (resource registration), P2-U11 (sync engine), and P2-U12 (entry point) all depend on correct SDK API knowledge. The cheat sheet becomes their primary reference, superseding the architecture doc where discrepancies exist.
