# MCP Resource Registration — Phase 1: Extend Test Utilities

**Goal:** Extend `makeTestServer()` in `tool-test-utils.ts` to capture resource handlers alongside tool handlers and expose `sendResourceListChanged` as a mockable spy. This is the prerequisite for all resource-related tests in Phases 2 and 3.

**Architecture:** Adds a parallel `resourceHandlers` Map and a `sendResourceListChanged: vi.fn()` to the existing stub server object. Exposes `callResourceList(name)` and `callResource(name, uid)` helpers on the `makeTestServer()` return value so tests can invoke list and read callbacks directly without a live MCP server.

**Tech Stack:** TypeScript 5.9, Vitest (`vi.fn()`), `@modelcontextprotocol/sdk` v1.27.1

**Scope:** 1 of 3 phases

**Codebase verified:** 2026-03-16

---

## Acceptance Criteria Coverage

This phase implements no user-visible ACs. It is pure test infrastructure. All phases that follow depend on it.

**Verifies: None** — this is an infrastructure phase. Verification is operational: `pnpm build` succeeds and all existing tool tests pass.

---

## Key Codebase Facts (verified by investigator)

- `src/tools/tool-test-utils.ts` (57 lines): exports `makeTestServer()`, `makeCtx()`, `getText()`
- `makeTestServer()` currently returns `{ server: McpServer, callTool }` only
- Stub server currently has only `registerTool(name, _config, handler)` — no `registerResource`, no `sendResourceListChanged`
- `handlers` is `Map<string, (args: Record<string, unknown>) => Promise<CallToolResult>>` (line 11)
- 7 test files import from `tool-test-utils.ts` — all must continue to pass
- `ResourceTemplate` has a `.listCallback` getter (SDK source line 796) — no private-property hacking needed
- `registerResource` signature: `(name: string, template: ResourceTemplate, config: ResourceMetadata, readCallback: ReadResourceTemplateCallback): RegisteredResourceTemplate`
- `sendResourceListChanged(): void` on `McpServer`
- Authoritative import paths from `docs/verified-api.md`:
  - `ResourceTemplate` → `@modelcontextprotocol/sdk/server/mcp.js`
  - `CallToolResult` → `@modelcontextprotocol/sdk/types.js`

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Extend `tool-test-utils.ts` with resource handler capture

**Verifies: None** (infrastructure phase)

**Files:**

- Modify: `src/tools/tool-test-utils.ts` (full file replacement — see implementation below)

**Implementation:**

The key changes to `makeTestServer()`:

1. Add a `resourceHandlers` map typed as `Map<string, { list: (() => Promise<unknown>) | undefined; read: (uri: URL, variables: Record<string, string | string[]>) => Promise<unknown> }>`.
2. Add `registerResource(name, template, _config, readCallback)` to the stub server — extracts `template.listCallback` for the list callback and stores `readCallback` for the read callback.
3. Add `sendResourceListChanged: vi.fn()` to the stub server object.
4. Add `callResourceList(name)` to the return value — invokes the stored list callback with an empty extra object `{}`.
5. Add `callResource(name, uid)` to the return value — constructs `new URL(`paprika://recipe/${uid}`)` and calls the stored read callback with `(uri, { uid }, {})`.
6. Export `sendResourceListChanged` as a top-level reference so `helpers.test.ts` can assert on it in Phase 2.

The `sendResourceListChanged` spy must be created **once** (with `vi.fn()`) and placed **both** on the stub server object (for `ctx.server.sendResourceListChanged()` calls inside the implementation) and returned from `makeTestServer()` (so test files can assert `spy.mock.calls.length`).

Complete updated file:

```typescript
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
        list: template.listCallback ? () => template.listCallback!({} as never) : undefined,
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
```

**Notes for implementor:**

- The `template.listCallback` getter returns `ListResourcesCallback | undefined`. We wrap it in an arrow that passes `{} as never` for the `extra` parameter — this is correct for unit tests since helpers never use `extra`.
- `sendResourceListChanged` is returned both as a property on the stub server AND as a top-level property on the return value so that test files can either destructure it or access it via the `server` object.
- The `ResourceTemplate` type import is `type`-only (no runtime import) — fine for the stub since we only access `.listCallback` dynamically.
- The file uses `vi.fn()`, so `import { vi } from "vitest"` is required at the top. This is confirmed by the existing pattern in `src/tools/create.test.ts` (uses explicit `import { vi } from "vitest"`). Tool-test utility files follow the same import convention as test files.

**Verification:**

Run: `pnpm build`
Expected: Compiles without errors

Run: `pnpm test`
Expected: All existing tool tests pass (no regressions)

**Commit:** `test(resources): extend makeTestServer with resource handler capture and sendResourceListChanged spy`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Verify build and existing tests pass

**Verifies: None** (infrastructure phase)

**Files:** None (verification only)

**Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: Zero type errors

**Step 2: Run tests**

Run: `pnpm test`
Expected: All tests pass — specifically the 7 existing tool test files:

- `src/tools/categories.test.ts`
- `src/tools/create.test.ts`
- `src/tools/delete.test.ts`
- `src/tools/filter.test.ts`
- `src/tools/read.test.ts`
- `src/tools/search.test.ts`
- `src/tools/update.test.ts`

If any test fails, check:

1. The `sendResourceListChanged` export from `makeTestServer()` — make sure existing tests that destructure `{ server, callTool }` still work (new properties are additive, not breaking)
2. The `vi` import — if existing test files use `vi` as a global, the `tool-test-utils.ts` file also needs to use it as a global (no explicit import). Check actual usage in `create.test.ts`.

**Commit:** (no separate commit — included in Task 1 commit after verification)

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
