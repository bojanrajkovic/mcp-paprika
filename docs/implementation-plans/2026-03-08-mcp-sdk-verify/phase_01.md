# MCP SDK Verification — Phase 1: Install SDK and Create Verification Script

**Goal:** Install `@modelcontextprotocol/sdk` as a runtime dependency and create an executable verification script that confirms all SDK constructs referenced by the Phase 2 architecture doc.

**Architecture:** This is a research unit producing infrastructure (dependency installation) and a verification script. No application code is added. The script serves as both compile-time (import resolution) and runtime (method existence) verification.

**Tech Stack:** TypeScript 5.9, Node.js 24, pnpm, tsx (script runner)

**Scope:** 2 phases from original design (phases 1-2)

**Codebase verified:** 2026-03-08

---

## Acceptance Criteria Coverage

This phase implements and verifies:

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

---

<!-- START_TASK_1 -->

### Task 1: Install @modelcontextprotocol/sdk as runtime dependency

**Verifies:** mcp-sdk-verify.AC1.1, mcp-sdk-verify.AC1.2, mcp-sdk-verify.AC1.3

**Files:**

- Modify: `/home/brajkovic/Projects/mcp-paprika/package.json` (dependencies section, line 18-25)

**Step 1: Install the SDK**

Run:

```bash
pnpm add @modelcontextprotocol/sdk@^1.27
```

Expected: Package installs successfully. `package.json` `dependencies` now includes `"@modelcontextprotocol/sdk": "^1.27"` (or resolved patch version like `^1.27.1`).

**Step 2: Verify it is in `dependencies` (not `devDependencies`)**

Run:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
console.log('In dependencies:', '@modelcontextprotocol/sdk' in pkg.dependencies);
console.log('In devDependencies:', '@modelcontextprotocol/sdk' in (pkg.devDependencies || {}));
"
```

Expected:

```
In dependencies: true
In devDependencies: false
```

**Note:** The SDK requires `zod ^3.25` as a peer dependency. The project's existing `zod@^3` (resolves to 3.25.76+) satisfies this constraint. If pnpm reports a peer dependency warning during installation, verify the installed zod version with `pnpm ls zod`.

**Step 3: Verify typecheck passes**

Run:

```bash
pnpm typecheck
```

Expected: Exits with code 0. No type errors introduced by the new dependency.

**Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(deps): add @modelcontextprotocol/sdk as runtime dependency"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Create verification script

**Verifies:** mcp-sdk-verify.AC2.1, mcp-sdk-verify.AC2.2, mcp-sdk-verify.AC2.3, mcp-sdk-verify.AC2.4, mcp-sdk-verify.AC2.5, mcp-sdk-verify.AC2.6

**Files:**

- Create: `/home/brajkovic/Projects/mcp-paprika/scripts/verify-sdk.ts`

**Important context:**

- The project bans `console.log` via oxlint `no-console: error` rule (configured in `/home/brajkovic/Projects/mcp-paprika/.oxlintrc.json`). Use `process.stderr.write()` for all output.
- Stdout is the MCP wire format — all script output MUST go to stderr.
- The lint rule applies to `src/` only (`pnpm lint` runs `oxlint --deny-warnings src/`), so `scripts/` is not linted. However, follow the convention anyway using `process.stderr.write()`.
- The `tsconfig.json` has `"rootDir": "src"`. Files in `scripts/` are outside this root. With `tsc --noEmit`, TypeScript may still check these files. If `pnpm typecheck` fails after creating the script due to a rootDir error, the implementor should verify and handle by either: (a) confirming `--noEmit` relaxes the constraint, or (b) adding `"include": ["src"]` to `tsconfig.json` so only `src/` is type-checked. The script is independently verified by running it with `npx tsx`.

**Step 1: Create the `scripts/` directory**

Run:

```bash
mkdir -p /home/brajkovic/Projects/mcp-paprika/scripts
```

**Step 2: Write `scripts/verify-sdk.ts`**

The script must:

1. Import `McpServer`, `StdioServerTransport`, `ResourceTemplate`, and `CallToolResult` from their correct SDK paths
2. **Import path discovery:** The design plan's research indicates all constructs export from `@modelcontextprotocol/sdk/server`. If that fails at compile-time, try the subpath exports: `@modelcontextprotocol/sdk/server/mcp.js` (McpServer, ResourceTemplate), `@modelcontextprotocol/sdk/server/stdio.js` (StdioServerTransport), and `@modelcontextprotocol/sdk/types.js` (CallToolResult). The script that compiles successfully determines the correct paths for the cheat sheet.
3. Instantiate `McpServer` with `{ name, version }` config
4. Check that `registerTool`, `registerResource`, `sendResourceListChanged`, and `connect` methods exist on the instance
5. Instantiate `StdioServerTransport` (no-arg constructor)
6. Instantiate `ResourceTemplate` with a URI template string and `{ list }` callback
7. Use `CallToolResult` in a type annotation
8. Output all results to stderr via `process.stderr.write()`
9. Exit 0 on success, exit 1 on any failure

**Implementation:**

```typescript
// scripts/verify-sdk.ts
//
// Compile-time + runtime verification of @modelcontextprotocol/sdk API surface.
// Confirms SDK constructs match Phase 2 architecture doc assumptions.
//
// Usage: npx tsx scripts/verify-sdk.ts
// Output goes to stderr (stdout is reserved for MCP wire protocol).

// PRIMARY import paths (from design plan research).
// If these fail at compile-time, try the ALTERNATE paths commented below.
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/server";
// ALTERNATE paths (if primary paths fail):
// import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
// import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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
```

**Step 3: Run the verification script**

Run:

```bash
npx tsx scripts/verify-sdk.ts
```

Expected: All checks output `[PASS]` to stderr. Script exits with code 0.

**Step 4: Verify `pnpm typecheck` still passes**

Run:

```bash
pnpm typecheck
```

Expected: Exits with code 0. If it fails with a rootDir error about `scripts/verify-sdk.ts`, add `"include": ["src"]` to `tsconfig.json`:

```json
{
  "extends": ["@tsconfig/strictest/tsconfig.json", "@tsconfig/node24/tsconfig.json"],
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

Then re-run `pnpm typecheck` and confirm it passes.

**Step 5: Commit**

```bash
git add scripts/verify-sdk.ts
# If tsconfig.json was modified:
# git add tsconfig.json
git commit -m "chore(sdk): add MCP SDK verification script"
```

<!-- END_TASK_2 -->
